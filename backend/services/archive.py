"""Сервіс архівування — безпечне видалення старих записів з БД."""
from datetime import date, timedelta
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session


# Назва системної статті для snapshot-балансу клієнта
ARCHIVE_SNAPSHOT_ARTICLE_NAME = "Архівний залишок"


def _ensure_snapshot_article(db: Session) -> int:
    """
    Повертає id статті 'Архівний залишок', створюючи її якщо немає.
    is_system=1 — не можна видалити.
    """
    row = db.execute(
        text("SELECT id FROM finance_articles WHERE name = :n"),
        {"n": ARCHIVE_SNAPSHOT_ARTICLE_NAME},
    ).fetchone()
    if row:
        return row[0]
    db.execute(
        text(
            "INSERT INTO finance_articles (name, direction, is_system) "
            "VALUES (:n, 'income', 1)"
        ),
        {"n": ARCHIVE_SNAPSHOT_ARTICLE_NAME},
    )
    db.flush()
    row = db.execute(
        text("SELECT id FROM finance_articles WHERE name = :n"),
        {"n": ARCHIVE_SNAPSHOT_ARTICLE_NAME},
    ).fetchone()
    return row[0]


def get_archive_preview(db: Session, cutoff_date: str) -> dict[str, Any]:
    """
    Підраховує скільки записів буде видалено при архівуванні до cutoff_date.
    Не вносить жодних змін.
    cutoff_date — рядок 'YYYY-MM-DD'; видаляються записи СТРОГО < cutoff_date.
    """
    c = cutoff_date

    counts: dict[str, int] = {}

    counts["baking_tasks"] = db.execute(
        text("SELECT COUNT(*) FROM baking_tasks WHERE task_date < :c"), {"c": c}
    ).scalar() or 0

    counts["surplus_allocations"] = db.execute(
        text("SELECT COUNT(*) FROM surplus_allocations WHERE alloc_date < :c"), {"c": c}
    ).scalar() or 0

    counts["shop_counts"] = db.execute(
        text("SELECT COUNT(*) FROM shop_counts WHERE count_date < :c"), {"c": c}
    ).scalar() or 0

    counts["other_stock_in"] = db.execute(
        text("SELECT COUNT(*) FROM other_stock_in WHERE stock_date < :c"), {"c": c}
    ).scalar() or 0

    counts["route_cancellations"] = db.execute(
        text("SELECT COUNT(*) FROM route_cancellations WHERE cancel_date < :c"), {"c": c}
    ).scalar() or 0

    counts["movements"] = db.execute(
        text("SELECT COUNT(*) FROM movements WHERE move_date < :c"), {"c": c}
    ).scalar() or 0

    # daily_balances: видаляємо тільки ті що строго < (cutoff - 1 день)
    anchor_date = (date.fromisoformat(c) - timedelta(days=1)).isoformat()
    counts["daily_balances"] = db.execute(
        text("SELECT COUNT(*) FROM daily_balances WHERE balance_date < :a"),
        {"a": anchor_date},
    ).scalar() or 0

    counts["orders"] = db.execute(
        text("SELECT COUNT(*) FROM orders WHERE order_date < :c"), {"c": c}
    ).scalar() or 0

    # Рахуємо тільки накладні без corrective_for_id що виходить за межі діапазону
    counts["invoices"] = db.execute(
        text("""
            SELECT COUNT(*) FROM invoices i
            WHERE i.invoice_date < :c
              AND NOT EXISTS (
                  SELECT 1 FROM invoices corr
                  WHERE corr.corrective_for_id = i.id
                    AND corr.invoice_date >= :c
              )
        """),
        {"c": c},
    ).scalar() or 0

    counts["finances"] = db.execute(
        text("""
            SELECT COUNT(*) FROM finances
            WHERE finance_date < :c
              AND (SELECT name FROM finance_articles WHERE id = article_id) != :snap
        """),
        {"c": c, "snap": ARCHIVE_SNAPSHOT_ARTICLE_NAME},
    ).scalar() or 0

    total = sum(counts.values())
    return {"cutoff_date": c, "tables": counts, "total": total}


def run_archive(db: Session, cutoff_date: str) -> dict[str, Any]:
    """
    Виконує архівування: видаляє старі записи в безпечному порядку,
    зберігаючи цілісність накопичувальних значень.

    Повертає статистику {deleted_rows, tables}.
    """
    c = cutoff_date
    deleted: dict[str, int] = {}

    # ── 1. Finances snapshot ───────────────────────────────────────────────────
    # Для кожного клієнта рахуємо баланс до cutoff_date та вставляємо snapshot
    snap_article_id = _ensure_snapshot_article(db)
    clients_with_finances = db.execute(
        text("""
            SELECT DISTINCT client_id FROM finances
            WHERE finance_date < :c
              AND client_id IS NOT NULL
        """),
        {"c": c},
    ).fetchall()

    for (client_id,) in clients_with_finances:
        balance = db.execute(
            text("""
                SELECT COALESCE(SUM(amount * sign), 0) FROM finances
                WHERE client_id = :cid AND finance_date < :c
            """),
            {"cid": client_id, "c": c},
        ).scalar() or 0.0

        if balance == 0.0:
            continue

        sign = 1 if balance >= 0 else -1
        db.execute(
            text("""
                INSERT INTO finances (finance_date, client_id, finance_type, article_id,
                                      amount, sign, notes, created_at)
                VALUES (:d, :cid, 'archive_snapshot', :aid, :amt, :sgn,
                        'Архівний залишок до ' || :d, datetime('now'))
            """),
            {
                "d": c,
                "cid": client_id,
                "aid": snap_article_id,
                "amt": abs(balance),
                "sgn": sign,
            },
        )

    # ── 2. Cascade: cancellation_lines → route_cancellations ──────────────────
    r = db.execute(
        text("""
            DELETE FROM cancellation_lines
            WHERE cancellation_id IN (
                SELECT id FROM route_cancellations WHERE cancel_date < :c
            )
        """),
        {"c": c},
    )
    deleted["cancellation_lines"] = r.rowcount

    r = db.execute(
        text("DELETE FROM route_cancellations WHERE cancel_date < :c"), {"c": c}
    )
    deleted["route_cancellations"] = r.rowcount

    # ── 3. Прості таблиці ──────────────────────────────────────────────────────
    for table, col in [
        ("other_stock_in",      "stock_date"),
        ("shop_counts",         "count_date"),
        ("surplus_allocations", "alloc_date"),
        ("baking_tasks",        "task_date"),
        ("movements",           "move_date"),
    ]:
        r = db.execute(
            text(f"DELETE FROM {table} WHERE {col} < :c"), {"c": c}  # noqa: S608
        )
        deleted[table] = r.rowcount

    # ── 4. daily_balances (зберігаємо запис cutoff-1 як якір) ─────────────────
    anchor_date = (date.fromisoformat(c) - timedelta(days=1)).isoformat()
    r = db.execute(
        text("DELETE FROM daily_balances WHERE balance_date < :a"), {"a": anchor_date}
    )
    deleted["daily_balances"] = r.rowcount

    # ── 5. Orders: спочатку дочірні, потім батьківські ────────────────────────
    r = db.execute(
        text("""
            DELETE FROM orders
            WHERE order_date < :c AND parent_order_id IS NOT NULL
        """),
        {"c": c},
    )
    deleted["child_orders"] = r.rowcount

    r = db.execute(
        text("""
            DELETE FROM orders
            WHERE order_date < :c AND parent_order_id IS NULL
        """),
        {"c": c},
    )
    deleted["parent_orders"] = r.rowcount
    deleted["orders"] = deleted["child_orders"] + deleted["parent_orders"]

    # ── 6. Invoices + invoice_lines (cascade) ─────────────────────────────────
    # Пропускаємо накладні, на які є corrective invoice поза діапазоном
    r = db.execute(
        text("""
            DELETE FROM invoices
            WHERE invoice_date < :c
              AND NOT EXISTS (
                  SELECT 1 FROM invoices corr
                  WHERE corr.corrective_for_id = invoices.id
                    AND corr.invoice_date >= :c
              )
        """),
        {"c": c},
    )
    deleted["invoices"] = r.rowcount
    # invoice_lines видаляються каскадно через ON DELETE CASCADE

    # ── 7. Finances (крім щойно доданих snapshot) ─────────────────────────────
    r = db.execute(
        text("""
            DELETE FROM finances
            WHERE finance_date < :c
              AND article_id != :aid
        """),
        {"c": c, "aid": snap_article_id},
    )
    deleted["finances"] = r.rowcount

    db.commit()

    # VACUUM для звільнення місця
    freed_mb = 0.0
    try:
        db.execute(text("PRAGMA wal_checkpoint(FULL)"))
        # VACUUM не можна в транзакції — використовуємо окреме з'єднання
        import sqlite3 as _sqlite3
        from pathlib import Path as _Path
        # Отримуємо URL через connection
        conn_str = str(db.bind.url) if hasattr(db, "bind") and db.bind else ""
        db_path = conn_str.replace("sqlite:///", "").replace("sqlite://", "")
        if db_path and _Path(db_path).exists():
            size_before = _Path(db_path).stat().st_size
            con = _sqlite3.connect(db_path)
            con.execute("VACUUM")
            con.close()
            size_after = _Path(db_path).stat().st_size
            freed_mb = round((size_before - size_after) / 1_048_576, 2)
    except Exception:
        pass

    total_deleted = sum(v for k, v in deleted.items()
                        if k not in ("child_orders", "parent_orders"))
    return {"deleted_rows": total_deleted, "freed_mb": freed_mb, "tables": deleted}
