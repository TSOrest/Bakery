"""
Міграція БД 005 — origin_id для таблиці orders.

origin_id INTEGER:
  NULL = звичайне замовлення клієнта
  0    = надлишок випічки (розподілено вручну оператором)
  X    = переміщення з orders.id = X

Запускати один раз:
  python scripts/migrate_005_origin_id.py

Скрипт ідемпотентний — повторний запуск безпечний.
"""

import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "bakery.db"


def column_exists(cur: sqlite3.Cursor, table: str, column: str) -> bool:
    cur.execute(f"PRAGMA table_info({table})")
    return any(row[1] == column for row in cur.fetchall())


def run():
    print(f"Підключення до {DB_PATH}")
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    # 1. Додаємо origin_id до orders
    if not column_exists(cur, "orders", "origin_id"):
        cur.execute("ALTER TABLE orders ADD COLUMN origin_id INTEGER")
        print("  + orders.origin_id")
    else:
        print("  = orders.origin_id вже існує")

    conn.commit()
    conn.close()
    print("Міграція 005 завершена OK")


if __name__ == "__main__":
    run()
