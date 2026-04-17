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


def run_migrations() -> None:
    """Автоматично застосовує нові SQL-міграції з database/migrations/."""
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
            try:
                sql = sql_file.read_text(encoding="utf-8")
                for statement in sql.split(";"):
                    stmt = statement.strip()
                    if stmt:
                        conn.execute(text(stmt))
                conn.execute(text("INSERT INTO schema_migrations (name) VALUES (:n)"), {"n": sql_file.name})
                conn.commit()
                log.info("Migration applied: %s", sql_file.name)
            except Exception as exc:
                log.warning("Migration %s skipped: %s", sql_file.name, exc)
                conn.rollback()
