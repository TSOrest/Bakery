"""
Міграція БД — Фаза 3.5 доповнення: client_kind.

Додає поле client_kind ('customer'|'shop'|'writeoff'|'ration') до клієнтів.
Створює системних клієнтів "Списання" та "Пайок".

Запускати один раз:
  python scripts/migrate_004_client_kinds.py

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

    # 1. Додаємо колонку client_kind
    if not column_exists(cur, "clients", "client_kind"):
        cur.execute("ALTER TABLE clients ADD COLUMN client_kind TEXT DEFAULT 'customer'")
        print("  + clients.client_kind")
    else:
        print("  = clients.client_kind вже існує")

    # 2. Встановлюємо kind='shop' для існуючих магазинів (is_own_shop=1)
    cur.execute(
        "UPDATE clients SET client_kind = 'shop' WHERE is_own_shop = 1 AND client_kind = 'customer'"
    )
    print(f"  ~ оновлено магазинів: {cur.rowcount}")

    # 3. Створюємо системного клієнта "Списання" (якщо ще немає)
    cur.execute("SELECT id FROM clients WHERE client_kind = 'writeoff' LIMIT 1")
    if cur.fetchone() is None:
        cur.execute(
            "INSERT INTO clients (full_name, short_name, client_kind, is_active, is_own_shop, discount_pct, print_invoice)"
            " VALUES (?, ?, 'writeoff', 1, 0, 0, 0)",
            ("Списання", "Списання"),
        )
        print("  + клієнт 'Списання' (writeoff) створено")
    else:
        print("  = клієнт 'Списання' вже існує")

    # 4. Створюємо системного клієнта "Пайок" (якщо ще немає)
    cur.execute("SELECT id FROM clients WHERE client_kind = 'ration' LIMIT 1")
    if cur.fetchone() is None:
        cur.execute(
            "INSERT INTO clients (full_name, short_name, client_kind, is_active, is_own_shop, discount_pct, print_invoice)"
            " VALUES (?, ?, 'ration', 1, 0, 0, 0)",
            ("Пайок", "Пайок"),
        )
        print("  + клієнт 'Пайок' (ration) створено")
    else:
        print("  = клієнт 'Пайок' вже існує")

    conn.commit()
    conn.close()
    print("Міграція 004 завершена OK")


if __name__ == "__main__":
    run()
