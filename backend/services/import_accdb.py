"""Сервіс імпорту даних з Microsoft Access (.accdb) у SQLite."""

from __future__ import annotations

import threading
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import create_engine, func, text
from sqlalchemy.orm import Session

from backend.database import DATABASE_URL
from backend.models.finances import Finance, FinanceArticle
from backend.models.orders import Order
from backend.models.pricing import ClientPriceOverride, Price
from backend.models.references import Category, Client, Product, Route, Unit
from backend.models.shop import ShopReconciliation, ShopReconciliationLine
from backend.schemas.import_accdb import (
    AccdbPreview,
    BalanceMismatch,
    EntityPreview,
    EntityReport,
    ImportMapping,
    ImportReport,
    ValidationReport,
)

# ─── Глобальний стан прогресу ─────────────────────────────────────────────────

_import_lock = threading.Lock()
_import_state: dict[str, Any] = {
    "running": False,
    "step": "",
    "progress": 0,
    "error": None,
    "result": None,
}


def _update_state(**kwargs: Any) -> None:
    with _import_lock:
        _import_state.update(kwargs)


def get_import_status() -> dict[str, Any]:
    with _import_lock:
        return dict(_import_state)


# ─── pyodbc ───────────────────────────────────────────────────────────────────

def _require_pyodbc():
    try:
        import pyodbc  # noqa: PLC0415
        return pyodbc
    except ImportError:
        raise RuntimeError(
            "Бібліотека pyodbc не встановлена. Виконайте: pip install pyodbc"
        )


_CONN_TMPL_NO_PWD = (
    "Driver={{Microsoft Access Driver (*.mdb, *.accdb)}};"
    "DBQ={path};"
    "ExtendedAnsiSQL=1;"
)
_CONN_TMPL_PWD = (
    "Driver={{Microsoft Access Driver (*.mdb, *.accdb)}};"
    "DBQ={path};"
    "PWD={password};"
    "ExtendedAnsiSQL=1;"
)


def check_access_driver() -> str | None:
    """Перевіряє наявність Access ODBC Driver. Повертає None якщо OK, або рядок помилки."""
    try:
        pyodbc = _require_pyodbc()
        drivers = [d for d in pyodbc.drivers() if 'Access' in d]
        if not drivers:
            return _driver_missing_msg()
        return None
    except RuntimeError as e:
        return str(e)
    except Exception as e:
        return str(e)


def _driver_missing_msg() -> str:
    import struct
    bits = struct.calcsize('P') * 8
    exe = 'AccessDatabaseEngine_X64.exe' if bits == 64 else 'AccessDatabaseEngine.exe'
    return (
        f"Microsoft Access ODBC Driver ({bits}-bit) не знайдено.\n\n"
        f"Якщо на комп'ютері вже встановлений Office 32-bit, запустіть інсталятор з ключем /passive:\n"
        f"  1. Завантажте '{exe}' (Microsoft Access Database Engine 2016 Redistributable)\n"
        f"     з microsoft.com/download → пошук 'Access Database Engine 2016'\n"
        f"  2. Відкрийте командний рядок від імені Адміністратора і виконайте:\n"
        f"     {exe} /passive\n"
        f"  3. Перезапустіть сервер пекарні (трей → Перезапустити)"
    )


def _get_access_connection(path: str, password: str = ""):
    pyodbc = _require_pyodbc()
    if password:
        conn_str = _CONN_TMPL_PWD.format(path=path, password=password)
    else:
        conn_str = _CONN_TMPL_NO_PWD.format(path=path)
    try:
        conn = pyodbc.connect(conn_str, autocommit=True)
    except Exception as e:
        err_str = str(e)
        if 'IM002' in err_str or 'Data source name not found' in err_str or 'driver' in err_str.lower():
            raise RuntimeError(_driver_missing_msg()) from e
        if '28000' in err_str or 'password' in err_str.lower() or 'не дійсний пароль' in err_str:
            raise RuntimeError("Невірний пароль до файлу Access") from e
        raise RuntimeError(f"Помилка підключення до Access: {e}") from e
    # Спробуємо налаштувати декодування (не всі версії pyodbc підтримують)
    try:
        conn.setdecoding(pyodbc.SQL_CHAR, encoding="cp1251")
        conn.setdecoding(pyodbc.SQL_WCHAR, encoding="utf-8")
        conn.setencoding(encoding="utf-8")
    except AttributeError:
        pass
    return conn


def _list_access_tables(conn) -> list[str]:
    cursor = conn.cursor()
    tables = sorted(
        row.table_name
        for row in cursor.tables(tableType="TABLE")
        if not row.table_name.startswith("MSys")
    )
    cursor.close()
    return tables


# ─── Fuzzy column / table discovery ──────────────────────────────────────────

_TABLE_HINTS: dict[str, list[str]] = {
    "clients":  ["клієнт", "client"],
    "products": ["завод", "product", "виріб", "продукт"],
    "routes":   ["ліда", "лідо", "маршр", "агент", "route", "шофер", "водій"],
    "prices":   ["ціни", "ціна", "price"],
    "orders":   ["замовлен", "order", "відтиск"],
    "finances": ["операц", "financ"],
    "stock":    ["поточн", "stock", "залиш"],
}


def _find_table(tables: list[str], hints: list[str]) -> str | None:
    for hint in hints:
        match = next((t for t in tables if hint.lower() in t.lower()), None)
        if match:
            return match
    return None


def _discover_columns(
    cursor, table: str, hints: dict[str, list[str]]
) -> dict[str, str | None]:
    """Повертає {canonical: actual_column | None} через fuzzy substring match."""
    try:
        cursor.execute(f"SELECT * FROM [{table}] WHERE 1=0")
        actual = [c[0] for c in cursor.description] if cursor.description else []
    except Exception:
        actual = []

    result: dict[str, str | None] = {}
    for canonical, subs in hints.items():
        result[canonical] = next(
            (col for col in actual if any(s.lower() in col.lower() for s in subs)),
            None,
        )
    return result


# ─── Утиліти читання ──────────────────────────────────────────────────────────

def _fetch_rows(cursor, table: str, where: str = "", top: int | None = None) -> list[dict[str, Any]]:
    if top:
        q = f"SELECT TOP {top} * FROM [{table}]"
    else:
        q = f"SELECT * FROM [{table}]"
    if where:
        q += f" WHERE {where}"
    cursor.execute(q)
    cols = [c[0] for c in cursor.description]
    return [dict(zip(cols, row)) for row in cursor.fetchall()]


def _safe_str(val: Any, max_len: int = 255) -> str | None:
    if val is None:
        return None
    s = str(val).strip()
    return s[:max_len] if s else None


def _safe_float(val: Any) -> float | None:
    if val is None:
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None


def _safe_date(val: Any) -> str | None:
    """Конвертує значення дати Access у рядок YYYY-MM-DD."""
    if val is None:
        return None
    if hasattr(val, "strftime"):
        return val.strftime("%Y-%m-%d")
    s = str(val).strip()
    for fmt in ("%Y-%m-%d", "%d.%m.%Y", "%m/%d/%Y", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(s[:10], fmt[:8]).strftime("%Y-%m-%d")
        except ValueError:
            pass
    try:
        return datetime.strptime(s, fmt).strftime("%Y-%m-%d")
    except Exception:
        return None


def _serialize_sample(rows: list[dict]) -> list[dict]:
    """Перетворює значення Access на JSON-серіалізовані рядки."""
    result = []
    for row in rows:
        result.append({
            k: (v.strftime("%Y-%m-%d %H:%M:%S") if hasattr(v, "strftime")
                else (str(v) if v is not None else None))
            for k, v in row.items()
        })
    return result


# ─── Preview (read-only) ──────────────────────────────────────────────────────

def read_accdb_preview(path: str, password: str = "") -> AccdbPreview:
    """Читає .accdb і повертає попередній перегляд без запису в SQLite."""
    conn = _get_access_connection(path, password)
    try:
        tables = _list_access_tables(conn)
        cursor = conn.cursor()

        def _prev(key: str) -> EntityPreview:
            tname = _find_table(tables, _TABLE_HINTS.get(key, [key]))
            if not tname:
                return EntityPreview(warnings=[f"Таблицю '{key}' не знайдено"])
            try:
                cursor.execute(f"SELECT COUNT(*) FROM [{tname}]")
                count: int = cursor.fetchone()[0] or 0
                sample = _serialize_sample(_fetch_rows(cursor, tname, top=3))
                return EntityPreview(count=count, sample=sample)
            except Exception as exc:
                return EntityPreview(warnings=[str(exc)])

        # Ціни: розрахуємо кількість overrides окремо
        price_tname = _find_table(tables, _TABLE_HINTS["prices"])
        overrides_ep = EntityPreview()
        if price_tname:
            P_HINTS = {"client_id": ["клієнт", "client", "код_клієнт"]}
            cm = _discover_columns(cursor, price_tname, P_HINTS)
            if cm.get("client_id"):
                col = cm["client_id"]
                try:
                    cursor.execute(
                        f"SELECT COUNT(*) FROM [{price_tname}] "
                        f"WHERE [{col}] IS NOT NULL AND [{col}] <> 0"
                    )
                    overrides_ep = EntityPreview(count=cursor.fetchone()[0] or 0)
                except Exception:
                    pass

        return AccdbPreview(
            temp_file_token="",   # встановлює router
            access_tables=tables,
            routes=_prev("routes"),
            clients=_prev("clients"),
            products=_prev("products"),
            prices=_prev("prices"),
            overrides=overrides_ep,
            orders=_prev("orders"),
            finances=_prev("finances"),
            stock=_prev("stock"),
        )
    finally:
        conn.close()


# ─── Full import (runs in background thread) ──────────────────────────────────

def run_import(accdb_path: str, mapping: ImportMapping) -> None:
    """Повний імпорт. Запускається в окремому треді, оновлює _import_state."""
    started_at = datetime.now().isoformat()
    entities: dict[str, EntityReport] = {}

    try:
        _update_state(running=True, step="Підключення до Access", progress=2,
                      error=None, result=None)

        conn = _get_access_connection(accdb_path, mapping.db_password)
        tables = _list_access_tables(conn)
        cursor = conn.cursor()

        tr_date = mapping.transition_date
        finance_cutoff = (
            datetime.strptime(tr_date, "%Y-%m-%d") - timedelta(days=mapping.finance_months * 30)
        ).strftime("%Y-%m-%d")
        order_cutoff = (
            datetime.strptime(tr_date, "%Y-%m-%d") - timedelta(days=mapping.order_days)
        ).strftime("%Y-%m-%d")

        cat_map: dict[int, int] = {m.access_product_id: m.new_category_id
                                    for m in mapping.product_categories}
        kind_map: dict[int, str] = {m.access_client_id: m.client_kind
                                     for m in mapping.client_kinds}

        engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
        db = Session(engine)

        try:
            # Захист від подвійного імпорту
            existing = db.query(func.count(Client.id)).filter(
                Client.client_kind == "customer"
            ).scalar() or 0
            if existing > 0:
                raise ValueError(
                    "БД вже містить клієнтів типу 'customer'. "
                    "Скиньте дані перед імпортом."
                )

            db.execute(text("PRAGMA foreign_keys=OFF"))
            now_str = datetime.now().isoformat()

            # ── 1. Units ──────────────────────────────────────────────────────
            _update_state(step="Одиниці виміру", progress=5)
            unit_map: dict[str, int] = {}   # Access unit name → new SQLite id
            ep = EntityReport()
            prod_table = _find_table(tables, _TABLE_HINTS["products"])
            if prod_table:
                UNIT_HINTS = {"unit_name": ["вихід", "одиниц", "unit"]}
                cm = _discover_columns(cursor, prod_table, UNIT_HINTS)
                unit_col = cm.get("unit_name")
                if unit_col:
                    cursor.execute(
                        f"SELECT DISTINCT [{unit_col}] FROM [{prod_table}] "
                        f"WHERE [{unit_col}] IS NOT NULL"
                    )
                    for (uval,) in cursor.fetchall():
                        uname = _safe_str(uval, 50)
                        if not uname:
                            continue
                        ep.found += 1
                        existing_u = db.query(Unit).filter(Unit.name == uname).first()
                        if existing_u:
                            unit_map[uname] = existing_u.id
                            ep.skipped += 1
                        else:
                            u = Unit(name=uname, is_active=1)
                            db.add(u)
                            db.flush()
                            unit_map[uname] = u.id
                            ep.imported += 1
            entities["units"] = ep

            # ── 2. Routes ─────────────────────────────────────────────────────
            _update_state(step="Маршрути", progress=10)
            route_map: dict[int, int] = {}
            ep = EntityReport()
            route_table = _find_table(tables, _TABLE_HINTS["routes"])
            if route_table:
                ROUTE_HINTS = {
                    "id":   ["id", "код", "номер"],
                    "name": ["назв", "маршр", "агент", "name", "ліда", "лідо"],
                }
                cm = _discover_columns(cursor, route_table, ROUTE_HINTS)
                if cm.get("name"):
                    for i, row in enumerate(_fetch_rows(cursor, route_table)):
                        ep.found += 1
                        rname = _safe_str(row.get(cm["name"]), 200)
                        if not rname:
                            ep.skipped += 1
                            continue
                        rid_raw = row.get(cm["id"]) if cm.get("id") else None
                        existing_r = db.query(Route).filter(Route.name == rname).first()
                        if existing_r:
                            if rid_raw is not None:
                                route_map[int(rid_raw)] = existing_r.id
                            ep.skipped += 1
                        else:
                            r = Route(name=rname, sort_order=i, is_active=1)
                            db.add(r)
                            db.flush()
                            if rid_raw is not None:
                                route_map[int(rid_raw)] = r.id
                            ep.imported += 1
            entities["routes"] = ep

            # ── 3. Products ───────────────────────────────────────────────────
            _update_state(step="Вироби", progress=18)
            product_map: dict[int, int] = {}        # Access product id → SQLite id
            product_name_map: dict[str, int] = {}   # lower name → SQLite id
            ep = EntityReport()
            if prod_table:
                PROD_HINTS = {
                    "id":     ["id", "код"],
                    "name":   ["назв", "name", "номенкл"],
                    "weight": ["вага", "weight"],
                    "unit":   ["вихід", "одиниц", "unit"],
                    "active": ["дійсн", "activ"],
                }
                cm = _discover_columns(cursor, prod_table, PROD_HINTS)
                for row in _fetch_rows(cursor, prod_table):
                    ep.found += 1
                    raw_id = row.get(cm["id"]) if cm.get("id") else None
                    name   = _safe_str(row.get(cm["name"]) if cm.get("name") else None, 200)
                    if not name:
                        ep.skipped += 1
                        continue

                    weight    = _safe_float(row.get(cm["weight"]) if cm.get("weight") else None)
                    unit_name = _safe_str(row.get(cm["unit"]) if cm.get("unit") else None, 50)
                    unit_id   = unit_map.get(unit_name) if unit_name else None
                    prod_aid  = int(raw_id) if raw_id is not None else None
                    cat_id    = cat_map.get(prod_aid) if prod_aid is not None else None

                    p = Product(
                        name=name,
                        short_name=name[:30],
                        weight=weight,
                        unit_id=unit_id,
                        category_id=cat_id,
                        cost_per_unit=0,
                        is_active=1,
                        created_at=now_str,
                        initial_stock=0,
                    )
                    db.add(p)
                    db.flush()
                    if prod_aid is not None:
                        product_map[prod_aid] = p.id
                    product_name_map[name.lower()] = p.id
                    ep.imported += 1
                    if not cat_id:
                        ep.warnings.append(f"Виріб '{name}' без категорії")
            entities["products"] = ep

            # ── 4. Clients ────────────────────────────────────────────────────
            _update_state(step="Клієнти", progress=28)
            client_map: dict[int, int] = {}          # Access client id → SQLite id
            client_balance_map: dict[int, float] = {}  # SQLite client id → Access balance
            ep = EntityReport()
            client_table = _find_table(tables, _TABLE_HINTS["clients"])
            if client_table:
                CLIENT_HINTS = {
                    "id":         ["id", "код"],
                    "short_name": ["клієнт", "коротк", "назва"],
                    "full_name":  ["повне", "повн", "full"],
                    "phone":      ["телефон", "phone"],
                    "address":    ["адрес", "address"],
                    "balance":    ["залиш", "balance", "борг"],
                    "route_id":   ["агент", "маршр", "route", "шофер"],
                    "discount":   ["знижк", "discount"],
                    "active":     ["дійсн", "activ"],
                }
                cm = _discover_columns(cursor, client_table, CLIENT_HINTS)
                for row in _fetch_rows(cursor, client_table):
                    ep.found += 1
                    raw_id   = row.get(cm["id"]) if cm.get("id") else None
                    short_nm = _safe_str(row.get(cm["short_name"]) if cm.get("short_name") else None, 100)
                    full_nm  = _safe_str(row.get(cm["full_name"]) if cm.get("full_name") else None, 255)
                    if not short_nm and not full_nm:
                        ep.skipped += 1
                        continue

                    phone    = _safe_str(row.get(cm["phone"]) if cm.get("phone") else None, 50)
                    address  = _safe_str(row.get(cm["address"]) if cm.get("address") else None, 255)
                    balance  = _safe_float(row.get(cm["balance"]) if cm.get("balance") else None) or 0.0
                    discount = _safe_float(row.get(cm["discount"]) if cm.get("discount") else None) or 0.0

                    route_raw = row.get(cm["route_id"]) if cm.get("route_id") else None
                    route_id  = route_map.get(int(route_raw)) if route_raw is not None else None

                    access_id = int(raw_id) if raw_id is not None else None
                    kind = kind_map.get(access_id, mapping.default_client_kind) \
                        if access_id is not None else mapping.default_client_kind

                    c = Client(
                        full_name=full_nm or short_nm,
                        short_name=short_nm,
                        address=address,
                        phone=phone,
                        route_id=route_id,
                        discount_pct=discount,
                        is_active=1,
                        client_kind=kind,
                        print_invoice=1,
                        created_at=now_str,
                    )
                    db.add(c)
                    db.flush()
                    if access_id is not None:
                        client_map[access_id] = c.id
                    client_balance_map[c.id] = balance
                    ep.imported += 1
            entities["clients"] = ep

            # ── 5. FinanceArticle для балансових корекцій ────────────────────
            _update_state(step="Фінансові статті", progress=35)
            import_article = FinanceArticle(
                name="Початковий баланс (імпорт з Access)",
                direction="income",
                is_system=1,
            )
            db.add(import_article)
            db.flush()
            import_article_id = import_article.id

            # Знаходимо існуючі статті для розносу операцій
            income_article = (
                db.query(FinanceArticle)
                .filter(FinanceArticle.direction == "income",
                        FinanceArticle.is_system == 1,
                        FinanceArticle.name.ilike("%оплат%"))
                .first()
                or db.query(FinanceArticle)
                .filter(FinanceArticle.direction == "income",
                        FinanceArticle.is_system == 1)
                .first()
            )
            expense_article = (
                db.query(FinanceArticle)
                .filter(FinanceArticle.direction == "expense",
                        FinanceArticle.is_system == 1,
                        FinanceArticle.name.ilike("%накладн%"))
                .first()
                or db.query(FinanceArticle)
                .filter(FinanceArticle.direction == "expense",
                        FinanceArticle.is_system == 1)
                .first()
            )

            # ── 6. Базові ціни + overrides ────────────────────────────────────
            _update_state(step="Ціни", progress=42)
            ep_prices = EntityReport()
            ep_ovr    = EntityReport()
            price_table = _find_table(tables, _TABLE_HINTS["prices"])
            if price_table:
                PRICE_HINTS = {
                    "product_id":   ["код_вир", "виріб", "product", "номенкл_", "id_вир"],
                    "product_name": ["назв", "номенкл"],
                    "client_id":    ["клієнт", "client", "код_клієнт"],
                    "price":        ["ціна", "price", "сума"],
                }
                cm = _discover_columns(cursor, price_table, PRICE_HINTS)
                for row in _fetch_rows(cursor, price_table):
                    price_val = _safe_float(row.get(cm["price"]) if cm.get("price") else None)
                    if price_val is None or price_val <= 0:
                        continue

                    # Resolve product
                    prod_id: int | None = None
                    if cm.get("product_id") and row.get(cm["product_id"]) is not None:
                        try:
                            prod_id = product_map.get(int(row[cm["product_id"]]))
                        except (ValueError, TypeError):
                            pass
                    if prod_id is None and cm.get("product_name"):
                        pn = _safe_str(row.get(cm["product_name"]), 200)
                        if pn:
                            prod_id = product_name_map.get(pn.lower())
                    if prod_id is None:
                        continue

                    # Resolve client (override?)
                    client_raw = row.get(cm["client_id"]) if cm.get("client_id") else None
                    is_override = (
                        client_raw is not None
                        and str(client_raw).strip() not in ("", "0", "None")
                    )
                    client_id: int | None = None
                    if is_override:
                        try:
                            client_id = client_map.get(int(client_raw))
                        except (ValueError, TypeError):
                            pass

                    if is_override and client_id:
                        ep_ovr.found += 1
                        try:
                            ovr = ClientPriceOverride(
                                client_id=client_id,
                                product_id=prod_id,
                                price=price_val,
                                valid_from=tr_date,
                            )
                            db.add(ovr)
                            db.flush()
                            ep_ovr.imported += 1
                        except Exception:
                            db.rollback()
                            ep_ovr.skipped += 1
                    else:
                        ep_prices.found += 1
                        pr = Price(
                            product_id=prod_id,
                            price=price_val,
                            valid_from=tr_date,
                            is_active=1,
                            created_at=now_str,
                        )
                        db.add(pr)
                        ep_prices.imported += 1

            entities["prices"]    = ep_prices
            entities["overrides"] = ep_ovr

            # ── 7. Замовлення ─────────────────────────────────────────────────
            _update_state(step="Замовлення", progress=55)
            ep = EntityReport()
            order_table = _find_table(tables, _TABLE_HINTS["orders"])
            if order_table:
                ORDER_HINTS = {
                    "client_id":    ["клієнт", "client", "код_клієнт"],
                    "product_name": ["номенкл", "назв", "виріб"],
                    "product_id":   ["код_вир", "product_id"],
                    "qty":          ["кількість", "кільк", "qty"],
                    "order_date":   ["дата", "date"],
                }
                cm = _discover_columns(cursor, order_table, ORDER_HINTS)
                for row in _fetch_rows(cursor, order_table):
                    ep.found += 1
                    date_val = _safe_date(row.get(cm["order_date"]) if cm.get("order_date") else None)
                    if not date_val or date_val < order_cutoff:
                        ep.skipped += 1
                        continue

                    client_raw = row.get(cm["client_id"]) if cm.get("client_id") else None
                    client_id  = None
                    if client_raw is not None:
                        try:
                            client_id = client_map.get(int(client_raw))
                        except (ValueError, TypeError):
                            pass
                    if not client_id:
                        ep.skipped += 1
                        continue

                    # Resolve product
                    prod_id = None
                    if cm.get("product_id") and row.get(cm["product_id"]) is not None:
                        try:
                            prod_id = product_map.get(int(row[cm["product_id"]]))
                        except (ValueError, TypeError):
                            pass
                    if prod_id is None and cm.get("product_name"):
                        pn = _safe_str(row.get(cm["product_name"]), 200)
                        if pn:
                            prod_id = product_name_map.get(pn.lower())
                    if not prod_id:
                        ep.skipped += 1
                        ep.warnings.append(
                            f"Невідомий виріб у замовленні клієнта {client_raw}: {row}"
                        )
                        continue

                    qty = _safe_float(row.get(cm["qty"]) if cm.get("qty") else None) or 0
                    if qty <= 0:
                        ep.skipped += 1
                        continue

                    o = Order(
                        client_id=client_id,
                        product_id=prod_id,
                        qty=qty,
                        order_date=date_val,
                        source="phone",
                        created_at=now_str,
                        created_by="import",
                    )
                    db.add(o)
                    ep.imported += 1
            entities["orders"] = ep

            # ── 8. Фінансові операції ─────────────────────────────────────────
            _update_state(step="Фінансові операції", progress=68)
            ep = EntityReport()
            computed_balance: dict[int, float] = {}   # SQLite client_id → sum(sign*amount)
            fin_table = _find_table(tables, _TABLE_HINTS["finances"])
            if fin_table:
                FIN_HINTS = {
                    "client_id":  ["клієнт", "client", "код_клієнт"],
                    "amount":     ["сума", "вихід_цін", "amount", "знач"],
                    "is_income":  ["наслідок", "тип", "income", "direction"],
                    "date":       ["дата", "timestamp", "date"],
                    "notes":      ["нотатк", "опис", "notes", "коментар"],
                }
                cm = _discover_columns(cursor, fin_table, FIN_HINTS)
                for row in _fetch_rows(cursor, fin_table):
                    ep.found += 1
                    date_val = _safe_date(row.get(cm["date"]) if cm.get("date") else None)
                    if not date_val or date_val < finance_cutoff:
                        ep.skipped += 1
                        continue

                    amount = _safe_float(row.get(cm["amount"]) if cm.get("amount") else None)
                    if amount is None or amount == 0:
                        ep.skipped += 1
                        continue
                    amount = abs(amount)

                    client_raw = row.get(cm["client_id"]) if cm.get("client_id") else None
                    client_id  = None
                    if client_raw is not None:
                        try:
                            client_id = client_map.get(int(client_raw))
                        except (ValueError, TypeError):
                            pass

                    is_income_raw = row.get(cm["is_income"]) if cm.get("is_income") else None
                    is_income = is_income_raw in (1, True, "True", "1", "income", "платіж", -1)
                    # Якщо наслідок = -1 у старій системі означає "списання боргу" (income)
                    if isinstance(is_income_raw, (int, float)) and is_income_raw < 0:
                        is_income = True

                    if is_income:
                        sign = 1
                        article_id = income_article.id if income_article else import_article_id
                        ftype = "payment"
                    else:
                        sign = -1
                        article_id = expense_article.id if expense_article else import_article_id
                        ftype = "invoice"

                    notes = _safe_str(row.get(cm["notes"]) if cm.get("notes") else None, 500)
                    f = Finance(
                        finance_date=date_val,
                        client_id=client_id,
                        finance_type=ftype,
                        article_id=article_id,
                        amount=amount,
                        sign=sign,
                        notes=notes or "Імпорт з Access",
                        created_at=now_str,
                        created_by="import",
                    )
                    db.add(f)
                    if client_id is not None:
                        computed_balance[client_id] = (
                            computed_balance.get(client_id, 0.0) + sign * amount
                        )
                    ep.imported += 1
            entities["finances"] = ep

            # ── 9. Корекція балансів ──────────────────────────────────────────
            _update_state(step="Корекція балансів", progress=82)
            mismatches: list[BalanceMismatch] = []
            for sqlite_cid, access_bal in client_balance_map.items():
                # access_bal — борг клієнта (позитивне = клієнт винен)
                # computed — sum(sign*amount): позитивне = клієнт переплатив
                computed = computed_balance.get(sqlite_cid, 0.0)
                # access_bal і -computed мають збігатись (обидва = "борг клієнта")
                diff = round(access_bal - (-computed), 2)
                if abs(diff) > 0.01:
                    c_obj = db.get(Client, sqlite_cid)
                    c_name = (c_obj.short_name or c_obj.full_name) if c_obj else str(sqlite_cid)
                    mismatches.append(BalanceMismatch(
                        client_name=c_name,
                        access_balance=access_bal,
                        computed_balance=-computed,
                        diff=diff,
                    ))
                    # Вставляємо коригуючий запис
                    # diff > 0 → клієнт винен більше → вставляємо витрату (sign=-1)
                    correction_sign = -1 if diff > 0 else 1
                    fc = Finance(
                        finance_date=tr_date,
                        client_id=sqlite_cid,
                        finance_type="invoice" if diff > 0 else "payment",
                        article_id=import_article_id,
                        amount=abs(diff),
                        sign=correction_sign,
                        notes=f"Корекція балансу (імпорт з Access, різниця: {diff:+.2f})",
                        created_at=now_str,
                        created_by="import",
                    )
                    db.add(fc)

            # ── 10. Залишки магазину ──────────────────────────────────────────
            _update_state(step="Залишки магазину", progress=90)
            ep = EntityReport()
            stock_table = _find_table(tables, _TABLE_HINTS["stock"])
            if stock_table:
                STOCK_HINTS = {
                    "product_name": ["назв", "номенкл", "виріб"],
                    "product_id":   ["код_вир", "product_id", "id_вир"],
                    "qty":          ["залиш", "кільк", "qty", "кількість"],
                    "price":        ["ціна", "price"],
                }
                cm = _discover_columns(cursor, stock_table, STOCK_HINTS)

                # Знайти клієнта-магазин
                shop_client = (
                    db.query(Client).filter(Client.is_own_shop == 1).first()
                    or db.query(Client).filter(Client.client_kind == "shop").first()
                )

                rows_stock = _fetch_rows(cursor, stock_table)
                if shop_client and rows_stock:
                    recon = ShopReconciliation(
                        shop_client_id=shop_client.id,
                        period_from=tr_date,
                        period_to=tr_date,
                        cash_expected=0,
                        closed=1,
                        closed_at=now_str,
                        closed_by="import",
                        created_at=now_str,
                    )
                    db.add(recon)
                    db.flush()

                    for row in rows_stock:
                        ep.found += 1
                        qty = _safe_float(row.get(cm["qty"]) if cm.get("qty") else None)
                        if qty is None or qty <= 0:
                            ep.skipped += 1
                            continue

                        prod_id = None
                        if cm.get("product_id") and row.get(cm["product_id"]) is not None:
                            try:
                                prod_id = product_map.get(int(row[cm["product_id"]]))
                            except (ValueError, TypeError):
                                pass
                        if prod_id is None and cm.get("product_name"):
                            pn = _safe_str(row.get(cm["product_name"]), 200)
                            if pn:
                                prod_id = product_name_map.get(pn.lower())
                        if not prod_id:
                            ep.skipped += 1
                            continue

                        price_val = _safe_float(
                            row.get(cm["price"]) if cm.get("price") else None
                        )
                        line = ShopReconciliationLine(
                            reconciliation_id=recon.id,
                            product_id=prod_id,
                            batch_date=None,
                            opening_balance=qty,
                            received=0,
                            entered_balance=qty,
                            written_off=0,
                            calculated_sold=0,
                            price=price_val,
                            expected_cash=0,
                        )
                        db.add(line)
                        ep.imported += 1
                elif not shop_client:
                    ep.warnings.append(
                        "Клієнта-магазин не знайдено (is_own_shop=1 або client_kind='shop') — "
                        "залишки магазину не імпортовано"
                    )
            entities["stock"] = ep

            # ── Commit ────────────────────────────────────────────────────────
            _update_state(step="Збереження даних", progress=95)
            db.execute(text("PRAGMA foreign_keys=ON"))
            db.commit()

            # ── Validation ────────────────────────────────────────────────────
            zero_price_prods: list[str] = []
            imported_ids = set(product_map.values())
            for p in db.query(Product).filter(Product.is_active == 1).all():
                if p.id not in imported_ids:
                    continue
                has_price = (
                    db.query(Price)
                    .filter(Price.product_id == p.id, Price.is_active == 1)
                    .first()
                )
                if not has_price:
                    zero_price_prods.append(p.name)

            validation = ValidationReport(
                balance_mismatches=mismatches,
                zero_price_products=zero_price_prods,
                order_count_ok=entities.get("orders", EntityReport()).imported > 0,
                overall_ok=(len(mismatches) == 0 and len(zero_price_prods) == 0),
            )

            finished_at = datetime.now().isoformat()
            report = ImportReport(
                success=True,
                started_at=started_at,
                finished_at=finished_at,
                transition_date=tr_date,
                entities=entities,
                validation=validation,
            )
            _update_state(
                running=False, step="Завершено", progress=100,
                result=report.model_dump()
            )

        except Exception:
            db.rollback()
            raise
        finally:
            db.close()
            conn.close()

    except Exception as exc:
        _update_state(
            running=False, step="Помилка", progress=0,
            error=str(exc)
        )
