"""
Міграція БД — Фаза 3.5.

Запускати один раз після оновлення коду:
  python scripts/migrate_003_phase35.py

Скрипт ідемпотентний — повторний запуск безпечний.
"""

import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "bakery.db"


def column_exists(cur: sqlite3.Cursor, table: str, column: str) -> bool:
    cur.execute(f"PRAGMA table_info({table})")
    return any(row[1] == column for row in cur.fetchall())


def table_exists(cur: sqlite3.Cursor, table: str) -> bool:
    cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table,))
    return cur.fetchone() is not None


def run():
    print(f"Підключення до {DB_PATH}")
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    # ── orders ──────────────────────────────────────────────────────────────────
    if not column_exists(cur, "orders", "parent_order_id"):
        cur.execute("ALTER TABLE orders ADD COLUMN parent_order_id INTEGER REFERENCES orders(id)")
        print("  + orders.parent_order_id")

    if not column_exists(cur, "orders", "delivered_qty"):
        cur.execute("ALTER TABLE orders ADD COLUMN delivered_qty REAL")
        print("  + orders.delivered_qty")

    # ── clients ──────────────────────────────────────────────────────────────────
    client_cols = {
        "is_own_shop":          "INTEGER DEFAULT 0",
        "print_invoice":        "INTEGER DEFAULT 1",
        "receiver_name":        "TEXT",
        "delivery_agent":       "TEXT",
        "delivery_note_number": "TEXT",
        "delivery_note_date":   "TEXT",
        "client_group":         "TEXT",
    }
    for col, definition in client_cols.items():
        if not column_exists(cur, "clients", col):
            cur.execute(f"ALTER TABLE clients ADD COLUMN {col} {definition}")
            print(f"  + clients.{col}")

    # ── products ──────────────────────────────────────────────────────────────────
    if not column_exists(cur, "products", "initial_stock"):
        cur.execute("ALTER TABLE products ADD COLUMN initial_stock REAL DEFAULT 0")
        print("  + products.initial_stock")

    # ── finance_articles ──────────────────────────────────────────────────────────
    if not table_exists(cur, "finance_articles"):
        cur.execute("""
            CREATE TABLE finance_articles (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                name      TEXT NOT NULL,
                direction TEXT NOT NULL CHECK(direction IN ('income','expense')),
                is_system INTEGER DEFAULT 0
            )
        """)
        print("  + table finance_articles")

    # Seed системних статей (тільки якщо таблиця порожня)
    cur.execute("SELECT COUNT(*) FROM finance_articles")
    if cur.fetchone()[0] == 0:
        system_articles = [
            ("Накладна",        "expense", 1),
            ("Оплата",          "income",  1),
            ("Списання",        "income",  1),
            ("Внесення в касу", "income",  1),
            ("Готівка водія",   "income",  1),
            ("Кредит обміну",   "expense", 1),
        ]
        cur.executemany(
            "INSERT INTO finance_articles (name, direction, is_system) VALUES (?,?,?)",
            system_articles,
        )
        print(f"  + {len(system_articles)} системних статей фінансів")

    # ── finances.article_id ───────────────────────────────────────────────────────
    if not column_exists(cur, "finances", "article_id"):
        cur.execute("ALTER TABLE finances ADD COLUMN article_id INTEGER REFERENCES finance_articles(id)")
        print("  + finances.article_id")

    # Backfill: прив'язати існуючі finance_type до article_id
    cur.execute("SELECT COUNT(*) FROM finances WHERE article_id IS NULL AND finance_type IS NOT NULL")
    unlinked = cur.fetchone()[0]
    if unlinked > 0:
        type_to_name = {
            "invoice":        "Накладна",
            "payment":        "Оплата",
            "writeoff":       "Списання",
            "deposit":        "Внесення в касу",
            "route_cash":     "Готівка водія",
            "exchange_credit":"Кредит обміну",
        }
        for ft, name in type_to_name.items():
            cur.execute(
                """UPDATE finances
                   SET article_id = (SELECT id FROM finance_articles WHERE name = ? LIMIT 1)
                   WHERE finance_type = ? AND article_id IS NULL""",
                (name, ft),
            )
        print(f"  ~ backfill article_id для {unlinked} записів finances")

    conn.commit()
    conn.close()
    print("Міграція завершена OK")


if __name__ == "__main__":
    run()
