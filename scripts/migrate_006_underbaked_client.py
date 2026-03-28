"""
Міграція БД 006 — системний клієнт 'Недопечено' (client_kind='underbaked').

Використовується для фіксації нестачі випічки:
  Коли спечено менше ніж замовлено — оператор створює дочірні рядки orders
  з client_id = <id клієнта 'Недопечено'> та parent_order_id = <id батьківського рядка>.

Запускати один раз:
  python scripts/migrate_006_underbaked_client.py

Скрипт ідемпотентний — повторний запуск безпечний.
"""

import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "bakery.db"


def run():
    print(f"Підключення до {DB_PATH}")
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    # Перевіряємо чи вже існує клієнт з client_kind='underbaked'
    cur.execute("SELECT id FROM clients WHERE client_kind = 'underbaked' LIMIT 1")
    row = cur.fetchone()
    if row:
        print(f"  = клієнт 'Недопечено' вже існує (id={row[0]})")
    else:
        cur.execute(
            """
            INSERT INTO clients (full_name, short_name, client_kind, is_active, discount_pct, created_at)
            VALUES ('Недопечено', 'Недопечено', 'underbaked', 1, 0, datetime('now'))
            """
        )
        print(f"  + клієнт 'Недопечено' створено (id={cur.lastrowid})")

    conn.commit()
    conn.close()
    print("Міграція 006 завершена OK")


if __name__ == "__main__":
    run()
