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
            pass
    dst.commit()


def _get_cols(con: sqlite3.Connection, table: str) -> list[str]:
    """Повертає список колонок таблиці."""
    cur = con.execute(f"SELECT * FROM {table} LIMIT 0")  # noqa: S608
    return [d[0] for d in cur.description] if cur.description else []


def _copy_table_full(src: sqlite3.Connection, dst: sqlite3.Connection, table: str) -> int:
    """Копіює всі рядки таблиці, беручи тільки спільні колонки."""
    # Перевіряємо чи існує таблиця в dst
    exists = dst.execute(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?", (table,)
    ).fetchone()[0]
    if not exists:
        return 0

    src_cols = _get_cols(src, table)
    dst_cols = _get_cols(dst, table)
    shared = [c for c in src_cols if c in dst_cols]
    if not shared:
        return 0

    rows = src.execute(
        f"SELECT {','.join(shared)} FROM {table}"  # noqa: S608
    ).fetchall()
    if not rows:
        return 0
    placeholders = ",".join("?" * len(shared))
    dst.executemany(
        f"INSERT OR REPLACE INTO {table} ({','.join(shared)}) VALUES ({placeholders})",  # noqa: S608
        rows,
    )
    dst.commit()
    return len(rows)


def generate(source_path: str, output_path: str) -> None:
    print(f"Джерело: {source_path}")
    print(f"Вивід:   {output_path}")

    src = _connect(source_path)
    dst = _connect(output_path)

    # ── Схема ─────────────────────────────────────────────────────────────────
    _copy_schema(src, dst)
    # schema.sql може включати PRAGMA foreign_keys=ON — перевмикаємо OFF для заповнення
    dst.execute("PRAGMA foreign_keys = OFF")

    # ── Довідники (копіюємо повністю) ─────────────────────────────────────────
    for table in ("units", "categories", "ingredients",
                  "product_ingredients", "finance_articles", "settings",
                  "other_products", "users"):
        n = _copy_table_full(src, dst, table)
        print(f"  {table}: {n} рядків")

    # ── Вироби: реальні + синтетичні до 60 ───────────────────────────────────
    # Визначаємо наявні колонки в src і dst
    src_prod_cols_raw = [r[1] for r in src.execute("PRAGMA table_info(products)")]
    dst_prod_cols_raw = [r[1] for r in dst.execute("PRAGMA table_info(products)")]
    # Беремо спільні колонки (які є в обох)
    shared_cols = [c for c in dst_prod_cols_raw if c in src_prod_cols_raw]
    # Колонки для вставки в dst: shared + type (якщо є в dst але не src — з дефолтом)
    dst_insert_cols = dst_prod_cols_raw[:]

    real_products = src.execute(
        f"SELECT {','.join(shared_cols)} FROM products"  # noqa: S608
    ).fetchall()

    # Вставляємо в dst — для відсутніх колонок (напр. type) ставимо дефолт 'other'
    for row in real_products:
        row_dict = dict(zip(shared_cols, row))
        if "type" not in row_dict:
            row_dict["type"] = "other"
        vals = [row_dict.get(c) for c in dst_insert_cols]
        dst.execute(
            f"INSERT OR REPLACE INTO products ({','.join(dst_insert_cols)}) "
            f"VALUES ({','.join('?'*len(dst_insert_cols))})",
            vals,
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

    # Базовий набір колонок для синтетичних виробів
    syn_base = {"id": None, "name": None, "short_name": None, "type": "other",
                "weight": None, "unit_id": unit_id, "category_id": None,
                "cost_per_unit": 0, "is_active": 1, "created_at": "datetime('now')",
                "initial_stock": 0}
    syn_cols = [c for c in dst_prod_cols_raw if c in syn_base]

    existing_count = len(real_products)
    for syn_name, short, ptype, weight in SYNTHETIC_PRODUCTS:
        if existing_count + added >= 60:
            break
        cat = cat_bun if ptype == "bun" else (cat_bread if ptype == "bread" else None)
        row = {**syn_base, "id": next_id, "name": syn_name, "short_name": short,
               "type": ptype, "weight": weight, "category_id": cat}
        vals = [row[c] for c in syn_cols]
        # created_at як SQL функція
        sql_cols = syn_cols[:]
        if "created_at" in sql_cols:
            idx = sql_cols.index("created_at")
            placeholders_list = ["?" if c != "created_at" else "datetime('now')" for c in sql_cols]
            vals_filtered = [v for c, v in zip(sql_cols, vals) if c != "created_at"]
            dst.execute(
                f"INSERT OR IGNORE INTO products ({','.join(sql_cols)}) "
                f"VALUES ({','.join(placeholders_list)})",
                vals_filtered,
            )
        else:
            dst.execute(
                f"INSERT OR IGNORE INTO products ({','.join(syn_cols)}) "
                f"VALUES ({','.join('?'*len(syn_cols))})",
                vals,
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
    # Визначаємо спільні колонки між src і dst для clients
    src_cli_cols = _get_cols(src, "clients")
    dst_cli_cols = _get_cols(dst, "clients")
    cli_shared = [c for c in src_cli_cols if c in dst_cli_cols]

    sys_clients_raw = src.execute(
        f"SELECT {','.join(cli_shared)} FROM clients "  # noqa: S608
        "WHERE client_kind IN ('writeoff','ration','underbaked')"
    ).fetchall() if "client_kind" in src_cli_cols else []

    if sys_clients_raw:
        dst.executemany(
            f"INSERT OR REPLACE INTO clients ({','.join(cli_shared)}) "
            f"VALUES ({','.join('?'*len(cli_shared))})",
            sys_clients_raw,
        )
        dst.commit()
    max_client_id = max((r[0] for r in sys_clients_raw), default=0) + 1

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

    # Базові значення для синтетичних клієнтів — використовуємо тільки dst_cli_cols
    cli_defaults = {
        "id": None, "full_name": None, "short_name": None, "address": None,
        "phone": None, "director": None, "accountant": None, "route_id": None,
        "discount_pct": 0, "is_active": 1, "created_at": None,
        "is_own_shop": 0, "print_invoice": 1, "client_kind": "customer",
        "receiver_name": None, "delivery_agent": None, "delivery_note_number": None,
        "delivery_note_date": None, "client_group": None, "bot_phones": None,
    }
    syn_cli_cols = [c for c in dst_cli_cols if c in cli_defaults]
    syn_cli_ph = []
    for c in syn_cli_cols:
        syn_cli_ph.append("datetime('now')" if c == "created_at" else "?")
    syn_cli_val_cols = [c for c in syn_cli_cols if c != "created_at"]

    for route_id in route_ids:
        for j in range(25):
            prefix = rng.choice(CLIENT_PREFIXES)
            surname = CLIENT_SURNAMES[j % len(CLIENT_SURNAMES)]
            name = f"{prefix} {surname}"
            short = surname[:10]
            discount = rng.choice([0, 0, 0, 3, 5])
            row = {**cli_defaults, "id": client_id, "full_name": name, "short_name": short,
                   "route_id": route_id, "discount_pct": discount}
            vals = [row[c] for c in syn_cli_val_cols]
            dst.execute(
                f"INSERT OR REPLACE INTO clients ({','.join(syn_cli_cols)}) "
                f"VALUES ({','.join(syn_cli_ph)})",
                vals,
            )
            all_client_ids.append(client_id)
            client_id += 1

    dst.commit()
    print(f"  clients: {len(all_client_ids)} синтетичних")

    # ── Замовлення: 30 днів ───────────────────────────────────────────────────
    dst_prod_final_cols = _get_cols(dst, "products")
    if "type" in dst_prod_final_cols:
        all_products = dst.execute(
            "SELECT id,type FROM products WHERE is_active=1 AND type != 'other'"
        ).fetchall()
    else:
        # Якщо немає type — беремо всі активні продукти з ptype='bread' (для qty)
        all_products = [(r[0], "bread") for r in dst.execute(
            "SELECT id FROM products WHERE is_active=1"
        ).fetchall()]
    today = date.today()
    # Визначаємо колонки orders в dst динамічно
    dst_order_cols = _get_cols(dst, "orders")
    order_defaults = {
        "id": None, "client_id": None, "product_id": None, "qty": None,
        "order_date": None, "status": "confirmed", "source": "phone",
        "exchange_type": "none", "exchange_qty": 0, "exchange_price": None,
        "exchange_notes": None, "price_override": None, "notes": None,
        "created_at": None, "created_by": None,
        # бот-поля (якщо є в dst)
        "bot_status": None, "bot_rejection_reason": None, "bot_original_qty": None,
        "placed_by_chat_id": None, "parent_order_id": None, "delivered_qty": None,
    }
    order_insert_cols = [c for c in dst_order_cols if c in order_defaults]
    order_ph = ",".join("?" * len(order_insert_cols))

    order_id = 1
    order_rows = []
    for delta in range(30, 0, -1):
        d = (today - timedelta(days=delta)).isoformat()
        for cid in all_client_ids:
            # Кожен клієнт замовляє 3–6 різних виробів
            sample = rng.sample(all_products, min(rng.randint(3, 6), len(all_products)))
            for (pid, ptype) in sample:
                qty = rng.randint(5, 30) if ptype == "bread" else rng.randint(10, 60)
                row = {**order_defaults, "id": order_id, "client_id": cid, "product_id": pid,
                       "qty": qty, "order_date": d, "created_at": f"{d}T08:00:00"}
                order_rows.append(tuple(row[c] for c in order_insert_cols))
                order_id += 1

    dst.executemany(
        f"INSERT OR REPLACE INTO orders ({','.join(order_insert_cols)}) VALUES ({order_ph})",
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

    dst_fin_cols = _get_cols(dst, "finances")
    fin_defaults = {
        "id": None, "finance_date": None, "client_id": None,
        "finance_type": "payment", "amount": None, "sign": 1,
        "notes": "Оплата готівка", "created_at": None, "created_by": None,
        "article_id": None,
    }
    fin_insert_cols = [c for c in dst_fin_cols if c in fin_defaults]
    fin_ph = ",".join("?" * len(fin_insert_cols))

    if article_id or "article_id" not in dst_fin_cols:
        fin_id = 1
        for delta in range(8, 0, -1):
            d = (today - timedelta(days=delta)).isoformat()
            for cid in rng.sample(all_client_ids, min(10, len(all_client_ids))):
                amount = round(rng.uniform(200, 2000), 2)
                row = {**fin_defaults, "id": fin_id, "finance_date": d, "client_id": cid,
                       "amount": amount, "created_at": f"{d}T10:00:00", "article_id": article_id}
                vals = tuple(row[c] for c in fin_insert_cols)
                dst.execute(
                    f"INSERT OR REPLACE INTO finances ({','.join(fin_insert_cols)}) VALUES ({fin_ph})",
                    vals,
                )
                fin_id += 1
        dst.commit()
        print(f"  finances: {fin_id - 1} записів")

    src.close()
    dst.close()
    print(f"\nGotovo! demo.db zghenerovano: {output_path}")


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
