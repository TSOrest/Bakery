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
    cursor.execute("PRAGMA synchronous=NORMAL")   # FULL→NORMAL: 2-3x швидше write
    cursor.execute("PRAGMA cache_size=-65536")    # 64 MB кеш сторінок
    cursor.execute("PRAGMA temp_store=MEMORY")    # тимчасові таблиці в RAM
    cursor.execute("PRAGMA mmap_size=134217728")  # 128 MB mmap
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
            sql = sql_file.read_text(encoding="utf-8")
            errors: list[str] = []
            for raw_stmt in sql.split(";"):
                # Прибираємо коментарі окремими рядками
                lines = [ln for ln in raw_stmt.splitlines() if not ln.strip().startswith("--")]
                stmt = "\n".join(lines).strip()
                if not stmt:
                    continue
                # Пропустити ALTER TABLE ADD COLUMN якщо колонка вже існує
                if _should_skip_alter_add_column(conn, stmt):
                    continue
                try:
                    conn.execute(text(stmt))
                except Exception as exc:
                    # Логуємо кожну помилку — попередньо мовчазно ховались
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
