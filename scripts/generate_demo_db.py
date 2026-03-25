"""
Генератор демо-бази (demo.db).

Використовує реальні дані з bakery.db як основу:
  - Копіює довідники (products, categories, units, ingredients, prices)
  - 3 маршрути × 25 синтетичних клієнтів = 75 клієнтів
  - 60 виробів (реальні + синтетичні до мінімуму)
  - 30 днів замовлень + 10 днів накладних
  - Кілька фінансових записів

Запуск:
    python scripts/generate_demo_db.py
    python scripts/generate_demo_db.py --source bakery.db --output demo.db
"""
import argparse
import random
import sqlite3
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).parent.parent


DEMO_ROUTE_NAMES = ["Маршрут Північ", "Маршрут Центр", "Маршрут Південь"]

# Синтетичні українські назви клієнтів (шаблони)
CLIENT_PREFIXES = [
    "ФОП", "Магазин", "Супермаркет", "Кіоск", "Павільйон",
    "Торгова точка", "Міні-маркет", "Гастроном",
]
CLIENT_SURNAMES = [
    "Коваленко", "Бойко", "Ткаченко", "Шевченко", "Кравченко",
    "Олійник", "Лисенко", "Марченко", "Гриценко", "Мороз",
    "Савченко", "Бондаренко", "Поліщук", "Тимченко", "Романенко",
    "Хоменко", "Петренко", "Іванченко", "Литвин", "Сидоренко",
    "Остапенко", "Довгаль", "Луценко", "Василенко", "Захаренко",
    "Зінченко", "Яценко", "Кузьменко", "Пономаренко", "Павленко",
]

SYNTHETIC_PRODUCTS = [
    ("Батон пшеничний №1", "Батон №1", "bread", 0.6),
    ("Батон пшеничний №2", "Батон №2", "bread", 0.6),
    ("Батон пшеничний №3", "Батон №3", "bread", 0.7),
    ("Хліб сірий домашній", "Хліб сірий", "bread", 0.7),
    ("Хліб житній особливий", "Хліб жит.", "bread", 0.65),
    ("Хліб з висівками", "Висівк.", "bread", 0.7),
    ("Хліб зерновий", "Зерновий", "bread", 0.75),
    ("Хліб солодкий", "Солодкий", "bread", 0.5),
    ("Рулет з маком", "Рулет мак", "bun", 0.3),
    ("Рулет з повидлом", "Рулет пов.", "bun", 0.3),
    ("Булочка здобна мала", "Булочка м.", "bun", 0.08),
    ("Булочка здобна велика", "Булочка в.", "bun", 0.12),
    ("Булочка з корицею", "Кориця", "bun", 0.09),
    ("Булочка молочна", "Молочна", "bun", 0.1),
    ("Плетінка", "Плетінка", "bun", 0.4),
    ("Пиріжок з капустою", "Пиріж. кап.", "bun", 0.1),
    ("Пиріжок з картоплею", "Пиріж. карт.", "bun", 0.1),
    ("Пиріжок з яблуком", "Пиріж. ябл.", "bun", 0.1),
    ("Пончик класичний", "Пончик", "bun", 0.08),
    ("Пончик з джемом", "Пончик джем", "bun", 0.09),
    ("Рогалик вершковий", "Рогалик вер.", "bun", 0.07),
    ("Рогалик з маком", "Рогалик мак", "bun", 0.07),
    ("Круасан", "Круасан", "bun", 0.08),
    ("Бублик соляний", "Бублик сол.", "bun", 0.07),
    ("Бублик кунжутний", "Бублик кун.", "bun", 0.07),
    ("Штрудель яблучний", "Штрудель", "bun", 0.35),
    ("Кекс лимонний", "Кекс лим.", "other", 0.3),
    ("Кекс родзинковий", "Кекс род.", "other", 0.3),
    ("Пряник медовий", "Пряник", "other", 0.05),
    ("Пряник глазурований", "Пряник гл.", "other", 0.06),
]


def _connect(path: str) -> sqlite3.Connection:
    con = sqlite3.connect(path)
    con.execute("PRAGMA foreign_keys = OFF")
    con.execute("PRAGMA journal_mode = WAL")
    return con


def _copy_schema(src: sqlite3.Connection, dst: sqlite3.Connection) -> None:
    """Копіює схему (CREATE TABLE / CREATE INDEX) з src до dst."""
    for row in src.execute(
        "SELECT sql FROM sqlite_master WHERE type IN ('table','index') AND sql IS NOT NULL "
        "ORDER BY rootpage"
    ):
        try:
            dst.execute(row[0])
        except sqlite3.OperationalError:
            pass  # таблиця вже існує
    dst.commit()


def _copy_table_full(src: sqlite3.Connection, dst: sqlite3.Connection, table: str) -> int:
    """Копіює всі рядки таблиці."""
    rows = src.execute(f"SELECT * FROM {table}").fetchall()  # noqa: S608
    if not rows:
        return 0
    cols = [d[0] for d in src.execute(f"SELECT * FROM {table} LIMIT 0").description]  # noqa: S608
    placeholders = ",".join("?" * len(cols))
    dst.executemany(f"INSERT OR REPLACE INTO {table} VALUES ({placeholders})", rows)  # noqa: S608
    dst.commit()
    return len(rows)


def generate(source_path: str, output_path: str) -> None:
    print(f"Джерело: {source_path}")
    print(f"Вивід:   {output_path}")

    src = _connect(source_path)
    dst = _connect(output_path)

    # ── Схема ─────────────────────────────────────────────────────────────────
    _copy_schema(src, dst)

    # ── Довідники (копіюємо повністю) ─────────────────────────────────────────
    for table in ("units", "categories", "ingredients",
                  "product_ingredients", "finance_articles", "settings",
                  "other_products", "users"):
        n = _copy_table_full(src, dst, table)
        print(f"  {table}: {n} рядків")

    # ── Вироби: реальні + синтетичні до 60 ───────────────────────────────────
    real_products = src.execute(
        "SELECT id,name,short_name,type,weight,unit_id,category_id,cost_per_unit,"
        "is_active,created_at,initial_stock FROM products"
    ).fetchall()
    prod_cols = ("id","name","short_name","type","weight","unit_id","category_id",
                 "cost_per_unit","is_active","created_at","initial_stock")
    dst.executemany(
        f"INSERT OR REPLACE INTO products ({','.join(prod_cols)}) VALUES ({','.join('?'*len(prod_cols))})",
        real_products,
    )

    next_id = (max((r[0] for r in real_products), default=0) + 1) if real_products else 1
    added = 0
    # unit_id=1 fallback
    unit_id = src.execute("SELECT id FROM units LIMIT 1").fetchone()
    unit_id = unit_id[0] if unit_id else 1
    # category_id для bun
    cat_bun = src.execute("SELECT id FROM categories WHERE name LIKE '%Булк%' OR name LIKE '%bun%' LIMIT 1").fetchone()
    cat_bun = cat_bun[0] if cat_bun else None
    cat_bread = src.execute("SELECT id FROM categories WHERE name LIKE '%Хліб%' OR name LIKE '%bread%' LIMIT 1").fetchone()
    cat_bread = cat_bread[0] if cat_bread else None

    existing_count = len(real_products)
    for name, short, ptype, weight in SYNTHETIC_PRODUCTS:
        if existing_count + added >= 60:
            break
        cat = cat_bun if ptype == "bun" else (cat_bread if ptype == "bread" else None)
        dst.execute(
            "INSERT OR IGNORE INTO products (id,name,short_name,type,weight,unit_id,"
            "category_id,cost_per_unit,is_active,created_at,initial_stock) "
            "VALUES (?,?,?,?,?,?,?,0,1,datetime('now'),0)",
            (next_id, name, short, ptype, weight, unit_id, cat),
        )
        next_id += 1
        added += 1

    dst.commit()
    print(f"  products: {existing_count} реальних + {added} синтетичних")

    # ── Ціни ─────────────────────────────────────────────────────────────────
    n = _copy_table_full(src, dst, "prices")
    n += _copy_table_full(src, dst, "client_price_overrides")
    print(f"  prices: {n} рядків")

    # ── Системні клієнти ──────────────────────────────────────────────────────
    sys_clients = src.execute(
        "SELECT id,full_name,short_name,address,phone,director,accountant,"
        "route_id,discount_pct,is_active,created_at,is_own_shop,print_invoice,"
        "receiver_name,delivery_agent,delivery_note_number,delivery_note_date,"
        "client_group,client_kind,bot_phones FROM clients "
        "WHERE client_kind IN ('writeoff','ration','underbaked')"
    ).fetchall()
    client_cols = ("id","full_name","short_name","address","phone","director","accountant",
                   "route_id","discount_pct","is_active","created_at","is_own_shop","print_invoice",
                   "receiver_name","delivery_agent","delivery_note_number","delivery_note_date",
                   "client_group","client_kind","bot_phones")
    dst.executemany(
        f"INSERT OR REPLACE INTO clients ({','.join(client_cols)}) VALUES ({','.join('?'*len(client_cols))})",
        sys_clients,
    )
    dst.commit()
    max_client_id = max((r[0] for r in sys_clients), default=0) + 1

    # ── Маршрути ─────────────────────────────────────────────────────────────
    real_routes = src.execute(
        "SELECT id,name,sort_order,is_active FROM routes WHERE is_active=1 LIMIT 3"
    ).fetchall()

    route_ids = []
    if real_routes:
        dst.executemany(
            "INSERT OR REPLACE INTO routes (id,name,sort_order,is_active) VALUES (?,?,?,?)",
            real_routes,
        )
        route_ids = [r[0] for r in real_routes]
        max_route_id = max(route_ids)
    else:
        max_route_id = 0

    # Доповнюємо до 3 маршрутів
    for i in range(len(route_ids), 3):
        max_route_id += 1
        dst.execute(
            "INSERT OR REPLACE INTO routes (id,name,sort_order,is_active) VALUES (?,?,?,1)",
            (max_route_id, DEMO_ROUTE_NAMES[i], i + 1),
        )
        route_ids.append(max_route_id)

    dst.commit()
    print(f"  routes: {len(route_ids)} маршрути")

    # ── Клієнти: 25 на маршрут ────────────────────────────────────────────────
    rng = random.Random(42)
    all_client_ids = []
    client_id = max_client_id + 100  # запас після системних

    for route_id in route_ids:
        for j in range(25):
            prefix = rng.choice(CLIENT_PREFIXES)
            surname = CLIENT_SURNAMES[j % len(CLIENT_SURNAMES)]
            name = f"{prefix} {surname}"
            short = surname[:10]
            discount = rng.choice([0, 0, 0, 3, 5])
            dst.execute(
                "INSERT OR REPLACE INTO clients "
                "(id,full_name,short_name,route_id,discount_pct,is_active,created_at,"
                "is_own_shop,print_invoice,client_kind) "
                "VALUES (?,?,?,?,?,1,datetime('now'),0,1,'customer')",
                (client_id, name, short, route_id, discount),
            )
            all_client_ids.append(client_id)
            client_id += 1

    dst.commit()
    print(f"  clients: {len(all_client_ids)} синтетичних")

    # ── Замовлення: 30 днів ───────────────────────────────────────────────────
    all_products = dst.execute(
        "SELECT id,type FROM products WHERE is_active=1 AND type != 'other'"
    ).fetchall()
    today = date.today()
    order_id = 1
    order_rows = []
    for delta in range(30, 0, -1):
        d = (today - timedelta(days=delta)).isoformat()
        for cid in all_client_ids:
            # Кожен клієнт замовляє 3–6 різних виробів
            sample = rng.sample(all_products, min(rng.randint(3, 6), len(all_products)))
            for (pid, ptype) in sample:
                qty = rng.randint(5, 30) if ptype == "bread" else rng.randint(10, 60)
                order_rows.append((order_id, cid, pid, qty, d, "confirmed", "phone",
                                   "none", 0, None, None, None, None, None,
                                   datetime_now := f"{d}T08:00:00", None, None, None, None, None))
                order_id += 1

    order_cols = ("id","client_id","product_id","qty","order_date","status","source",
                  "exchange_type","exchange_qty","exchange_price","exchange_notes",
                  "price_override","notes","created_at","bot_status","bot_rejection_reason",
                  "bot_original_qty","placed_by_chat_id","parent_order_id","delivered_qty")
    dst.executemany(
        f"INSERT OR REPLACE INTO orders ({','.join(order_cols)}) VALUES ({','.join('?'*len(order_cols))})",
        order_rows,
    )
    dst.commit()
    print(f"  orders: {len(order_rows)} рядків")

    # ── Накладні: 10 днів ────────────────────────────────────────────────────
    from datetime import datetime as _dt

    # Беремо ціни з dst для розрахунку суми
    price_cache: dict = {}
    for (pid,) in dst.execute("SELECT id FROM products").fetchall():
        row = dst.execute(
            "SELECT price FROM prices WHERE product_id=? AND is_active=1 LIMIT 1", (pid,)
        ).fetchone()
        price_cache[pid] = row[0] if row else 5.0

    inv_id = 1
    inv_line_id = 1
    statuses = ["sent", "sent", "processing", "accepted", "accepted"]

    for delta in range(10, 0, -1):
        d = (today - timedelta(days=delta)).isoformat()
        d_num = d.replace("-", "")
        inv_num = 1
        for cid in all_client_ids[:15]:  # перші 15 клієнтів
            inv_number = f"{d_num}-{inv_num:03d}"
            route_id = dst.execute(
                "SELECT route_id FROM clients WHERE id=?", (cid,)
            ).fetchone()[0]
            status = rng.choice(statuses)
            total = 0.0

            client_orders = dst.execute(
                "SELECT product_id, qty FROM orders WHERE client_id=? AND order_date=?",
                (cid, d),
            ).fetchall()

            if not client_orders:
                continue

            dst.execute(
                "INSERT OR REPLACE INTO invoices "
                "(id,invoice_number,invoice_date,route_id,client_id,status,total_sum,created_at) "
                "VALUES (?,?,?,?,?,?,0,?)",
                (inv_id, inv_number, d, route_id, cid, status, f"{d}T09:00:00"),
            )

            for (pid, qty) in client_orders:
                price = price_cache.get(pid, 5.0)
                line_sum = round(qty * price, 2)
                total += line_sum
                dst.execute(
                    "INSERT OR REPLACE INTO invoice_lines "
                    "(id,invoice_id,product_id,qty,price,is_exchange,is_stale,sum) "
                    "VALUES (?,?,?,?,?,0,0,?)",
                    (inv_line_id, inv_id, pid, qty, price, line_sum),
                )
                inv_line_id += 1

            dst.execute(
                "UPDATE invoices SET total_sum=? WHERE id=?",
                (round(total, 2), inv_id),
            )
            inv_id += 1
            inv_num += 1

    dst.commit()
    print(f"  invoices: {inv_id - 1} накладних")

    # ── Фінансові записи ─────────────────────────────────────────────────────
    article_id = dst.execute(
        "SELECT id FROM finance_articles WHERE name='Оплата' LIMIT 1"
    ).fetchone()
    article_id = article_id[0] if article_id else None

    if article_id:
        fin_id = 1
        for delta in range(8, 0, -1):
            d = (today - timedelta(days=delta)).isoformat()
            for cid in rng.sample(all_client_ids, min(10, len(all_client_ids))):
                amount = round(rng.uniform(200, 2000), 2)
                dst.execute(
                    "INSERT OR REPLACE INTO finances "
                    "(id,finance_date,client_id,finance_type,article_id,amount,sign,notes,created_at) "
                    "VALUES (?,?,?,'payment',?,?,1,'Оплата готівка',?)",
                    (fin_id, d, cid, article_id, amount, f"{d}T10:00:00"),
                )
                fin_id += 1
        dst.commit()
        print(f"  finances: {fin_id - 1} записів")

    src.close()
    dst.close()
    print(f"\n✓ demo.db згенеровано: {output_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Генератор демо-бази")
    parser.add_argument("--source", default=str(ROOT / "bakery.db"), help="Джерело даних")
    parser.add_argument("--output", default=str(ROOT / "demo.db"),   help="Вихідний файл")
    args = parser.parse_args()

    if not Path(args.source).exists():
        print(f"ПОМИЛКА: файл '{args.source}' не знайдено")
        raise SystemExit(1)

    if Path(args.output).exists():
        import time as _time
        backup = args.output + f".bak-{_time.strftime('%Y%m%d-%H%M%S')}"
        Path(args.output).rename(backup)
        print(f"Старий demo.db збережено як {backup}")

    generate(args.source, args.output)
