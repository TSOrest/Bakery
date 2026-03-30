"""Підключення до SQLite та сесія SQLAlchemy."""

import os
from pathlib import Path
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, DeclarativeBase

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
