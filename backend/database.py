"""Підключення до SQLite та сесія SQLAlchemy."""

import os
import logging
from pathlib import Path
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import sessionmaker, DeclarativeBase

log = logging.getLogger(__name__)

_data_dir = os.getenv("BAKERY_DATA_DIR")
if _data_dir:
    _db_path = Path(_data_dir) / "bakery.db"
    DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{_db_path}")
else:
    DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./bakery.db")

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
    echo=False,
)


# Вмикаємо foreign keys для кожного з'єднання SQLite
@event.listens_for(engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA journal_mode=WAL")
    # FULL — безпечно при раптовому вимкненні живлення (без UPS).
    # На пекарні з ~50 транзакціями/хв накладні витрати ~5-10мс на write —
    # непомітно для оператора, але гарантує цілісність БД.
    cursor.execute("PRAGMA synchronous=FULL")
    # 32 MB кеш — оптимум для робочих станцій з 4-8 GB RAM.
    # Раніше 64 MB було надмірно для більшості сценаріїв.
    cursor.execute("PRAGMA cache_size=-32768")
    cursor.execute("PRAGMA temp_store=MEMORY")    # тимчасові таблиці в RAM
    cursor.execute("PRAGMA mmap_size=134217728")  # 128 MB mmap
    # Без цього SQLite віддає "database is locked" МИТТЄВО при конкурентній
    # записи (кілька операторів + бот + трей) замість короткого очікування —
    # саме це спричиняло каскадні PendingRollbackError у реальних логах
    # клієнта (сотні за день у пікові дні).
    cursor.execute("PRAGMA busy_timeout=5000")
    cursor.close()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    """Dependency для FastAPI — повертає сесію БД."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def safe_commit(db, *, conflict_msg: str = "Конфлікт даних: запис із такими параметрами вже існує"):
    """
    Безпечний commit з обробкою IntegrityError → 409 Conflict.
    Решта помилок логуються і піднімаються як 500.
    Завжди робить rollback на помилці.

    Використання замість db.commit():
        from backend.database import safe_commit
        safe_commit(db)  # замість db.commit()
        # або з кастомним повідомленням:
        safe_commit(db, conflict_msg="Клієнт з таким логіном існує")
    """
    from fastapi import HTTPException
    from sqlalchemy.exc import IntegrityError, OperationalError
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        log.info("IntegrityError у commit: %s", exc)
        raise HTTPException(status_code=409, detail=conflict_msg)
    except OperationalError as exc:
        db.rollback()
        log.exception("OperationalError у commit (БД заблокована або disk full)")
        raise HTTPException(status_code=503, detail="Тимчасова помилка БД, спробуйте ще раз")
    except Exception as exc:
        db.rollback()
        log.exception("Невідома помилка у commit: %s", exc)
        raise HTTPException(status_code=500, detail="Помилка збереження даних")


def _column_exists(conn, table: str, column: str) -> bool:
    """Чи існує колонка в таблиці (для ідемпотентності ALTER TABLE ADD COLUMN)."""
    try:
        rows = conn.execute(text(f"PRAGMA table_info({table})")).fetchall()
        return any(r[1] == column for r in rows)
    except Exception:
        return False


def _should_skip_alter_add_column(conn, stmt: str) -> bool:
    """Перевіряє чи це ALTER TABLE ADD COLUMN для вже існуючої колонки."""
    import re
    m = re.match(
        r"^\s*ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+(\w+)",
        stmt, re.IGNORECASE
    )
    if not m:
        return False
    return _column_exists(conn, m.group(1), m.group(2))


def _strip_sql_comments(sql: str) -> str:
    """Прибирає `--`-коментарі з кожного рядка (до кінця рядка), не лише
    рядки що ПОВНІСТЮ є коментарем.

    ⚠ Баг (виявлено тестом, виправлено): попередня логіка (`run_migrations`)
    спершу ділила файл на statements по `;`, а коментарі прибирала ЛИШЕ
    цілими рядками (`ln.strip().startswith("--")`). Якщо коментар містив
    крапку з комою всередині тексту (напр. "зберігається окремим рядком;
    written_off = ..." у 013_shop_disposal_lines.sql, чи "дата
    надходження/випічки; NULL = залишок..." у 014_shop_line_batch_date.sql)
    — `split(";")` різав СЕРЕДИНУ коментаря навпіл: перша половина йшла з
    `--`-префіксом (коректно відфільтровувалась), друга половина лишалась
    БЕЗ префіксу і потрапляла в SQL як сміття. У 014 це ламало
    `CREATE TABLE shop_reconciliation_lines_v2 (...)` синтаксичною
    помилкою — і оскільки в тому ж файлі нижче є безумовні `DROP TABLE
    shop_reconciliation_lines`/`shop_disposal_lines` (окремі, синтаксично
    чисті statements, що виконувались УСПІШНО), таблиці видалялись
    назавжди, а перестворення (rename `_v2` → оригінал) НІКОЛИ не
    відбувалось через провал самого початкового CREATE. На реальній
    продакшн-базі це непомітно, бо міграція 014 позначена застосованою
    задовго до того, як цей коментар зіпсувався — але БУДЬ-ЯКА нова
    інсталяція (і тестова БД) втрачала обидві таблиці мовчки назавжди.
    Виправлено: коментарі прибираються по рядку (до кінця рядка) ще ДО
    поділу на statements — крапка з комою всередині коментаря більше не
    впливає на межі statement.
    """
    out_lines = []
    for ln in sql.splitlines():
        idx = ln.find("--")
        out_lines.append(ln[:idx] if idx != -1 else ln)
    return "\n".join(out_lines)


def run_migrations() -> None:
    """Автоматично застосовує нові SQL-міграції з database/migrations/.

    Логіка ідемпотентна: кожен statement обгорнуто окремим try/except,
    ALTER TABLE ADD COLUMN для існуючих колонок пропускається без помилки.
    """
    migrations_dir = Path(__file__).parent.parent / "database" / "migrations"
    if not migrations_dir.exists():
        return

    with engine.connect() as conn:
        conn.execute(text(
            "CREATE TABLE IF NOT EXISTS schema_migrations "
            "(name TEXT PRIMARY KEY, applied_at TEXT DEFAULT (datetime('now')))"
        ))
        conn.commit()

        applied = {r[0] for r in conn.execute(text("SELECT name FROM schema_migrations"))}

        for sql_file in sorted(migrations_dir.glob("*.sql")):
            if sql_file.name in applied:
                continue
            # ⚠ Баг (виявлено тестом, виправлено): 014_shop_line_batch_date.sql
            # перебудовує shop_reconciliation_lines/shop_disposal_lines через
            # create-copy-DROP-rename (потрібно було зняти старий UNIQUE-
            # constraint, замінивши partial-indexes). На РЕАЛЬНІЙ базі це вже
            # застосовано (позначено applied) задовго до цього фіксу. Але на
            # СВІЖІЙ базі (`create_all()` створює фінальну схему одразу,
            # включно з batch_date) create-copy крок падає з mismatch
            # (shop_disposal_lines там уже має пізнішу колонку `price` з
            # міграції 029) — а безумовні DROP TABLE нижче в тому ж файлі всі
            # одно виконувались УСПІШНО (окремі, синтаксично чисті
            # statements), назавжди видаляючи обидві таблиці без
            # відновлення. Не помічено раніше: жоден live-тест не створював
            # СВІЖУ базу з нуля — і на dev/prod bakery.db, і в тестах раніше
            # ці таблиці підвантажувались лише непрямо. Виправлено: якщо
            # цільовий стан (колонка batch_date) вже є — все re-build не
            # потрібен, файл повністю пропускається.
            if sql_file.name == "014_shop_line_batch_date.sql" and _column_exists(
                conn, "shop_reconciliation_lines", "batch_date"
            ):
                # Партиційні unique-індекси з цього файлу все одно потрібні —
                # створюємо їх напряму (IF NOT EXISTS: на вже мігрованій
                # реальній базі вони вже є з оригінального прогону 014).
                conn.execute(text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS idx_recline_opening "
                    "ON shop_reconciliation_lines(reconciliation_id, product_id) "
                    "WHERE batch_date IS NULL"
                ))
                conn.execute(text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS idx_recline_batch "
                    "ON shop_reconciliation_lines(reconciliation_id, product_id, batch_date) "
                    "WHERE batch_date IS NOT NULL"
                ))
                conn.execute(text("INSERT INTO schema_migrations (name) VALUES (:n)"), {"n": sql_file.name})
                conn.commit()
                continue
            sql = _strip_sql_comments(sql_file.read_text(encoding="utf-8"))
            errors: list[str] = []
            for raw_stmt in sql.split(";"):
                stmt = raw_stmt.strip()
                if not stmt:
                    continue
                # Пропустити ALTER TABLE ADD COLUMN якщо колонка вже існує
                if _should_skip_alter_add_column(conn, stmt):
                    continue
                try:
                    conn.execute(text(stmt))
                except Exception as exc:
                    # Логуємо кожну помилку — попередньо мовчазно ховались.
                    # УВАГА: міграція все одно позначається застосованою (нижче).
                    # Це навмисно: `create_all` створює свіжу БД одразу у фінальній
                    # схемі, тож історичні міграції-трансформери на новій БД дають
                    # очікувані помилки (немає старих колонок/таблиць) — це НЕ збій.
                    # Позначення застосованою не дає їм повторюватись щозапуску.
                    errors.append(f"{stmt[:120]}... → {exc}")
                    conn.rollback()
                    continue
            try:
                conn.execute(text("INSERT INTO schema_migrations (name) VALUES (:n)"), {"n": sql_file.name})
                conn.commit()
                if errors:
                    log.warning("Migration %s applied with %d statement errors:", sql_file.name, len(errors))
                    for e in errors:
                        log.warning("  %s", e)
                else:
                    log.info("Migration applied: %s", sql_file.name)
            except Exception as exc:
                log.warning("Could not mark migration %s as applied: %s", sql_file.name, exc)
                conn.rollback()
