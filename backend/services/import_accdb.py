"""Сервіс імпорту даних з Microsoft Access (.accdb) у SQLite.

Читання Access: спочатку пробує pyodbc (потребує 64-bit ODBC Driver),
якщо драйвер відсутній — автоматично перемикається на 32-bit PowerShell
(SysWOW64) яке бачить 32-bit Access ODBC Driver від Office.
"""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import threading
from datetime import datetime, timedelta
from pathlib import Path
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


# ─── _Reader: абстракція над джерелом даних Access ────────────────────────────

class _Reader:
    """Контейнер з усіма даними Access (завантаженими одноразово)."""

    def __init__(self, tables: list[str], data: dict[str, dict]):
        # data: {table: {"count": int, "columns": [str,...], "rows": [dict,...]}}
        self._tables = tables
        self._data = data

    def tables(self) -> list[str]:
        return self._tables

    def count(self, table: str) -> int:
        return self._data.get(table, {}).get("count", 0)

    def columns(self, table: str) -> list[str]:
        return self._data.get(table, {}).get("columns", [])

    def rows(self, table: str) -> list[dict[str, Any]]:
        return self._data.get(table, {}).get("rows", [])


# ─── pyodbc reader (64-bit ODBC driver) ───────────────────────────────────────

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


def _open_pyodbc_reader(path: str, password: str, top_n: int) -> _Reader:
    """Читає Access через pyodbc (потребує 64-bit ODBC Driver)."""
    import pyodbc  # noqa: PLC0415

    conn_str = (_CONN_TMPL_PWD.format(path=path, password=password)
                if password else _CONN_TMPL_NO_PWD.format(path=path))
    try:
        conn = pyodbc.connect(conn_str, autocommit=True)
    except Exception as e:
        raise _classify_conn_error(e) from e

    try:
        conn.setdecoding(pyodbc.SQL_CHAR, encoding="cp1251")
        conn.setdecoding(pyodbc.SQL_WCHAR, encoding="utf-8")
        conn.setencoding(encoding="utf-8")
    except AttributeError:
        pass

    try:
        cur = conn.cursor()
        table_list = sorted(
            r.table_name for r in cur.tables(tableType="TABLE")
            if not r.table_name.startswith("MSys")
        )
        data: dict[str, dict] = {}
        for tbl in table_list:
            try:
                cur.execute(f"SELECT COUNT(*) FROM [{tbl}]")
                cnt = cur.fetchone()[0] or 0
            except Exception:
                cnt = 0
            # column names
            try:
                cur.execute(f"SELECT * FROM [{tbl}] WHERE 1=0")
                cols = [c[0] for c in (cur.description or [])]
            except Exception:
                cols = []
            # rows
            try:
                q = (f"SELECT TOP {top_n} * FROM [{tbl}]"
                     if top_n else f"SELECT * FROM [{tbl}]")
                cur.execute(q)
                col_names = [c[0] for c in cur.description]
                rows = [dict(zip(col_names, r)) for r in cur.fetchall()]
            except Exception:
                rows = []
            data[tbl] = {"count": cnt, "columns": cols, "rows": rows}
        return _Reader(table_list, data)
    finally:
        conn.close()


def _classify_conn_error(e: Exception) -> RuntimeError:
    s = str(e)
    if "IM002" in s or "Data source name not found" in s or "driver" in s.lower():
        return RuntimeError("NO_64BIT_DRIVER")
    if "28000" in s or "password" in s.lower() or "не дійсний пароль" in s:
        return RuntimeError("Невірний пароль до файлу Access")
    return RuntimeError(f"Помилка підключення до Access: {e}")


# ─── PowerShell 32-bit reader (fallback) ──────────────────────────────────────

_PS32 = r"C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe"

# PowerShell скрипт читає всі таблиці через 32-bit ODBC і пише JSON у файл
_PS_SCRIPT = r"""
param([string]$DbPath, [string]$Password = "", [int]$TopN = 0, [string]$OutFile)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Data

$cs = "Driver={Microsoft Access Driver (*.mdb, *.accdb)};DBQ=$DbPath;ExtendedAnsiSQL=1"
if ($Password -ne "") { $cs += ";PWD=$Password" }

$conn = New-Object System.Data.Odbc.OdbcConnection($cs)
$conn.Open()

$schema = $conn.GetSchema("Tables")
$tbls = [System.Collections.Generic.List[string]]::new()
foreach ($r in $schema.Rows) {
    if ($r["TABLE_TYPE"] -eq "TABLE" -and -not $r["TABLE_NAME"].ToString().StartsWith("MSys")) {
        $tbls.Add($r["TABLE_NAME"].ToString())
    }
}

$dataObj = [ordered]@{}
foreach ($tbl in $tbls) {
    $cnt = -1
    try {
        $c = $conn.CreateCommand(); $c.CommandText = "SELECT COUNT(*) FROM [$tbl]"
        $cnt = [int]($c.ExecuteScalar())
    } catch {}

    $colList = [System.Collections.Generic.List[string]]::new()
    $rowList = [System.Collections.Generic.List[object]]::new()
    try {
        $top = if ($TopN -gt 0) { "TOP $TopN " } else { "" }
        $c2 = $conn.CreateCommand(); $c2.CommandText = "SELECT $($top)* FROM [$tbl]"
        $dr = $c2.ExecuteReader()
        for ($i = 0; $i -lt $dr.FieldCount; $i++) { $colList.Add($dr.GetName($i)) }
        while ($dr.Read()) {
            $row = [ordered]@{}
            for ($i = 0; $i -lt $dr.FieldCount; $i++) {
                $v = $dr.GetValue($i)
                $row[$colList[$i]] = if ($v -is [System.DBNull]) { $null } else { $v.ToString() }
            }
            $rowList.Add($row)
        }
        $dr.Close()
    } catch {}

    $dataObj[$tbl] = [ordered]@{ count = $cnt; columns = @($colList); rows = @($rowList) }
}
$conn.Close()

$out = [ordered]@{ tables = @($tbls); data = $dataObj }
$json = $out | ConvertTo-Json -Depth 10 -Compress
[System.IO.File]::WriteAllText($OutFile, $json, [System.Text.Encoding]::UTF8)
"""


def _open_ps32_reader(path: str, password: str, top_n: int) -> _Reader:
    """Читає Access через 32-bit PowerShell + 32-bit ODBC Driver."""
    if not Path(_PS32).exists():
        raise RuntimeError(
            "32-bit PowerShell не знайдено. Встановіть Microsoft Access Database Engine Redistributable."
        )

    ps_fd, ps_path = tempfile.mkstemp(suffix=".ps1", prefix="bakery_")
    out_fd, out_path = tempfile.mkstemp(suffix=".json", prefix="bakery_")
    try:
        os.close(ps_fd)
        os.close(out_fd)
        Path(ps_path).write_text(_PS_SCRIPT, encoding="utf-8")

        result = subprocess.run(
            [
                _PS32, "-NoProfile", "-NonInteractive",
                "-ExecutionPolicy", "Bypass",
                "-File", ps_path,
                "-DbPath", path,
                "-Password", password or "",
                "-TopN", str(top_n),
                "-OutFile", out_path,
            ],
            capture_output=True,
            timeout=300,
        )

        if result.returncode != 0:
            stderr = result.stderr.decode("utf-8", errors="replace").strip()
            if not stderr:
                stderr = result.stdout.decode("utf-8", errors="replace").strip()
            if "password" in stderr.lower() or "не дійсний пароль" in stderr:
                raise RuntimeError("Невірний пароль до файлу Access")
            raise RuntimeError(f"Помилка читання Access:\n{stderr[:800]}")

        raw = Path(out_path).read_text(encoding="utf-8-sig")
        parsed = json.loads(raw)

        table_list: list[str] = parsed.get("tables", [])
        raw_data: dict = parsed.get("data", {})
        data: dict[str, dict] = {}
        for tbl, td in raw_data.items():
            rows = td.get("rows") or []
            cols = td.get("columns") or (list(rows[0].keys()) if rows else [])
            data[tbl] = {
                "count":   td.get("count", len(rows)),
                "columns": cols,
                "rows":    rows,
            }
        return _Reader(table_list, data)
    finally:
        for p in (ps_path, out_path):
            try:
                os.unlink(p)
            except OSError:
                pass


# ─── Factory: вибирає метод читання автоматично ───────────────────────────────

def _open_reader(path: str, password: str, top_n: int) -> _Reader:
    """Спочатку пробує pyodbc (64-bit), при відсутності — PS32 (32-bit)."""
    # Перевірка наявності 64-bit pyodbc + driver
    try:
        import pyodbc  # noqa: PLC0415
        has_64bit = any("Access" in d for d in pyodbc.drivers())
    except ImportError:
        has_64bit = False

    if has_64bit:
        return _open_pyodbc_reader(path, password, top_n)

    # Fallback: 32-bit PowerShell
    return _open_ps32_reader(path, password, top_n)


def check_access_driver() -> str | None:
    """Повертає None якщо читання Access можливе, або рядок з поясненням."""
    # Option 1: 64-bit ODBC driver
    try:
        import pyodbc  # noqa: PLC0415
        if any("Access" in d for d in pyodbc.drivers()):
            return None
    except ImportError:
        pass

    # Option 2: 32-bit PowerShell fallback (завжди є на 64-bit Windows)
    if Path(_PS32).exists():
        return None  # PS32 доступний — буде використаний автоматично

    # Нічого немає
    import struct
    bits = struct.calcsize("P") * 8
    exe = "AccessDatabaseEngine_X64.exe" if bits == 64 else "AccessDatabaseEngine.exe"
    return (
        f"Неможливо відкрити .accdb файл. Встановіть:\n"
        f"Microsoft Access Database Engine 2016 Redistributable ({bits}-bit)\n"
        f"Файл: {exe}\n"
        f"Знайдіть на microsoft.com → 'Access Database Engine 2016'"
    )


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
    actual_cols: list[str], hints: dict[str, list[str]]
) -> dict[str, str | None]:
    """Повертає {canonical: actual_column | None} через fuzzy substring match."""
    result: dict[str, str | None] = {}
    for canonical, subs in hints.items():
        result[canonical] = next(
            (col for col in actual_cols
             if any(s.lower() in col.lower() for s in subs)),
            None,
        )
    return result


# ─── Утиліти перетворення значень ─────────────────────────────────────────────

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
    # PowerShell повертає дати як "MM/DD/YYYY HH:MM:SS" або "YYYY-MM-DD HH:MM:SS"
    for fmt in (
        "%Y-%m-%d %H:%M:%S", "%d.%m.%Y %H:%M:%S",
        "%m/%d/%Y %H:%M:%S", "%m/%d/%Y %I:%M:%S %p",
        "%Y-%m-%d", "%d.%m.%Y", "%m/%d/%Y",
    ):
        try:
            return datetime.strptime(s, fmt).strftime("%Y-%m-%d")
        except ValueError:
            pass
    # Спроба взяти перші 10 символів
    if len(s) >= 10:
        for fmt in ("%Y-%m-%d", "%d.%m.%Y", "%m/%d/%Y"):
            try:
                return datetime.strptime(s[:10], fmt).strftime("%Y-%m-%d")
            except ValueError:
                pass
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
    reader = _open_reader(path, password, top_n=3)
    tables = reader.tables()

    def _prev(key: str) -> EntityPreview:
        tname = _find_table(tables, _TABLE_HINTS.get(key, [key]))
        if not tname:
            return EntityPreview(warnings=[f"Таблицю '{key}' не знайдено"])
        cnt = reader.count(tname)
        sample = _serialize_sample(reader.rows(tname))
        return EntityPreview(count=cnt, sample=sample)

    # Кількість overrides: рядки в таблиці цін де є client_id
    price_tname = _find_table(tables, _TABLE_HINTS["prices"])
    overrides_ep = EntityPreview()
    if price_tname:
        cm = _discover_columns(reader.columns(price_tname),
                               {"client_id": ["клієнт", "client", "код_клієнт"]})
        if cm.get("client_id"):
            col = cm["client_id"]
            overrides_ep = EntityPreview(count=sum(
                1 for r in reader.rows(price_tname)
                if r.get(col) not in (None, "", "0", 0)
            ))

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


# ─── Full import (runs in background thread) ──────────────────────────────────

def run_import(accdb_path: str, mapping: ImportMapping) -> None:
    """Повний імпорт. Запускається в окремому треді, оновлює _import_state."""
    started_at = datetime.now().isoformat()
    entities: dict[str, EntityReport] = {}

    try:
        _update_state(running=True, step="Читання бази Access", progress=2,
                      error=None, result=None)

        reader = _open_reader(accdb_path, mapping.db_password, top_n=0)
        tables = reader.tables()

        tr_date = mapping.transition_date
        finance_cutoff = (
            datetime.strptime(tr_date, "%Y-%m-%d") - timedelta(days=mapping.finance_months * 30)
        ).strftime("%Y-%m-%d")
        order_cutoff = (
            datetime.strptime(tr_date, "%Y-%m-%d") - timedelta(days=mapping.order_days)
        ).strftime("%Y-%m-%d")

        cat_map:  dict[int, int] = {m.access_product_id: m.new_category_id
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
            unit_map: dict[str, int] = {}
            ep = EntityReport()
            prod_table = _find_table(tables, _TABLE_HINTS["products"])
            if prod_table:
                UNIT_HINTS = {"unit_name": ["вихід", "одиниц", "unit"]}
                cm = _discover_columns(reader.columns(prod_table), UNIT_HINTS)
                unit_col = cm.get("unit_name")
                if unit_col:
                    seen_units: set[str] = set()
                    for row in reader.rows(prod_table):
                        uname = _safe_str(row.get(unit_col), 50)
                        if not uname or uname in seen_units:
                            continue
                        seen_units.add(uname)
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
                cm = _discover_columns(reader.columns(route_table), ROUTE_HINTS)
                if cm.get("name"):
                    for i, row in enumerate(reader.rows(route_table)):
                        ep.found += 1
                        rname = _safe_str(row.get(cm["name"]), 200)
                        if not rname:
                            ep.skipped += 1
                            continue
                        rid_raw = row.get(cm["id"]) if cm.get("id") else None
                        existing_r = db.query(Route).filter(Route.name == rname).first()
                        if existing_r:
                            if rid_raw is not None:
                                try:
                                    route_map[int(float(rid_raw))] = existing_r.id
                                except (ValueError, TypeError):
                                    pass
                            ep.skipped += 1
                        else:
                            r = Route(name=rname, sort_order=i, is_active=1)
                            db.add(r)
                            db.flush()
                            if rid_raw is not None:
                                try:
                                    route_map[int(float(rid_raw))] = r.id
                                except (ValueError, TypeError):
                                    pass
                            ep.imported += 1
            entities["routes"] = ep

            # ── 3. Products ───────────────────────────────────────────────────
            _update_state(step="Вироби", progress=18)
            product_map:      dict[int, int] = {}
            product_name_map: dict[str, int] = {}
            ep = EntityReport()
            if prod_table:
                PROD_HINTS = {
                    "id":     ["id", "код"],
                    "name":   ["назв", "name", "номенкл"],
                    "weight": ["вага", "weight"],
                    "unit":   ["вихід", "одиниц", "unit"],
                    "active": ["дійсн", "activ"],
                }
                cm = _discover_columns(reader.columns(prod_table), PROD_HINTS)
                for row in reader.rows(prod_table):
                    ep.found += 1
                    raw_id = row.get(cm["id"]) if cm.get("id") else None
                    name   = _safe_str(row.get(cm["name"]) if cm.get("name") else None, 200)
                    if not name:
                        ep.skipped += 1
                        continue

                    weight    = _safe_float(row.get(cm["weight"]) if cm.get("weight") else None)
                    unit_name = _safe_str(row.get(cm["unit"]) if cm.get("unit") else None, 50)
                    unit_id   = unit_map.get(unit_name) if unit_name else None
                    try:
                        prod_aid = int(float(raw_id)) if raw_id is not None else None
                    except (ValueError, TypeError):
                        prod_aid = None
                    cat_id = cat_map.get(prod_aid) if prod_aid is not None else None

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
            client_map:         dict[int, int]   = {}
            client_balance_map: dict[int, float] = {}
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
                }
                cm = _discover_columns(reader.columns(client_table), CLIENT_HINTS)
                for row in reader.rows(client_table):
                    ep.found += 1
                    raw_id   = row.get(cm["id"]) if cm.get("id") else None
                    short_nm = _safe_str(row.get(cm["short_name"]) if cm.get("short_name") else None, 100)
                    full_nm  = _safe_str(row.get(cm["full_name"])  if cm.get("full_name")  else None, 255)
                    if not short_nm and not full_nm:
                        ep.skipped += 1
                        continue

                    phone    = _safe_str(row.get(cm["phone"])   if cm.get("phone")   else None, 50)
                    address  = _safe_str(row.get(cm["address"]) if cm.get("address") else None, 255)
                    balance  = _safe_float(row.get(cm["balance"])  if cm.get("balance")  else None) or 0.0
                    discount = _safe_float(row.get(cm["discount"]) if cm.get("discount") else None) or 0.0

                    route_raw = row.get(cm["route_id"]) if cm.get("route_id") else None
                    route_id: int | None = None
                    if route_raw is not None:
                        try:
                            route_id = route_map.get(int(float(route_raw)))
                        except (ValueError, TypeError):
                            pass

                    try:
                        access_id = int(float(raw_id)) if raw_id is not None else None
                    except (ValueError, TypeError):
                        access_id = None
                    kind = (kind_map.get(access_id, mapping.default_client_kind)
                            if access_id is not None else mapping.default_client_kind)

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

            # ── 5. FinanceArticle для імпорту ─────────────────────────────────
            _update_state(step="Фінансові статті", progress=35)
            import_article = FinanceArticle(
                name="Початковий баланс (імпорт з Access)",
                direction="income",
                is_system=1,
            )
            db.add(import_article)
            db.flush()
            import_article_id = import_article.id

            income_article = (
                db.query(FinanceArticle)
                .filter(FinanceArticle.direction == "income",
                        FinanceArticle.is_system == 1,
                        FinanceArticle.name.ilike("%оплат%"))
                .first()
                or db.query(FinanceArticle)
                .filter(FinanceArticle.direction == "income", FinanceArticle.is_system == 1)
                .first()
            )
            expense_article = (
                db.query(FinanceArticle)
                .filter(FinanceArticle.direction == "expense",
                        FinanceArticle.is_system == 1,
                        FinanceArticle.name.ilike("%накладн%"))
                .first()
                or db.query(FinanceArticle)
                .filter(FinanceArticle.direction == "expense", FinanceArticle.is_system == 1)
                .first()
            )

            # ── 6. Ціни + overrides ───────────────────────────────────────────
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
                cm = _discover_columns(reader.columns(price_table), PRICE_HINTS)
                for row in reader.rows(price_table):
                    price_val = _safe_float(row.get(cm["price"]) if cm.get("price") else None)
                    if price_val is None or price_val <= 0:
                        continue

                    prod_id: int | None = None
                    if cm.get("product_id") and row.get(cm["product_id"]) is not None:
                        try:
                            prod_id = product_map.get(int(float(row[cm["product_id"]])))
                        except (ValueError, TypeError):
                            pass
                    if prod_id is None and cm.get("product_name"):
                        pn = _safe_str(row.get(cm["product_name"]), 200)
                        if pn:
                            prod_id = product_name_map.get(pn.lower())
                    if prod_id is None:
                        continue

                    client_raw = row.get(cm["client_id"]) if cm.get("client_id") else None
                    is_override = client_raw not in (None, "", "0", 0)
                    client_id: int | None = None
                    if is_override:
                        try:
                            client_id = client_map.get(int(float(client_raw)))
                        except (ValueError, TypeError):
                            pass

                    if is_override and client_id:
                        ep_ovr.found += 1
                        try:
                            db.add(ClientPriceOverride(
                                client_id=client_id, product_id=prod_id,
                                price=price_val, valid_from=tr_date,
                            ))
                            db.flush()
                            ep_ovr.imported += 1
                        except Exception:
                            db.rollback()
                            ep_ovr.skipped += 1
                    else:
                        ep_prices.found += 1
                        db.add(Price(
                            product_id=prod_id, price=price_val,
                            valid_from=tr_date, is_active=1, created_at=now_str,
                        ))
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
                cm = _discover_columns(reader.columns(order_table), ORDER_HINTS)
                for row in reader.rows(order_table):
                    ep.found += 1
                    date_val = _safe_date(row.get(cm["order_date"]) if cm.get("order_date") else None)
                    if not date_val or date_val < order_cutoff:
                        ep.skipped += 1
                        continue

                    client_raw = row.get(cm["client_id"]) if cm.get("client_id") else None
                    client_id = None
                    if client_raw is not None:
                        try:
                            client_id = client_map.get(int(float(client_raw)))
                        except (ValueError, TypeError):
                            pass
                    if not client_id:
                        ep.skipped += 1
                        continue

                    prod_id = None
                    if cm.get("product_id") and row.get(cm["product_id"]) is not None:
                        try:
                            prod_id = product_map.get(int(float(row[cm["product_id"]])))
                        except (ValueError, TypeError):
                            pass
                    if prod_id is None and cm.get("product_name"):
                        pn = _safe_str(row.get(cm["product_name"]), 200)
                        if pn:
                            prod_id = product_name_map.get(pn.lower())
                    if not prod_id:
                        ep.skipped += 1
                        ep.warnings.append(f"Невідомий виріб у замовленні клієнта {client_raw}")
                        continue

                    qty = _safe_float(row.get(cm["qty"]) if cm.get("qty") else None) or 0
                    if qty <= 0:
                        ep.skipped += 1
                        continue

                    db.add(Order(
                        client_id=client_id, product_id=prod_id,
                        qty=qty, order_date=date_val,
                        source="phone", created_at=now_str, created_by="import",
                    ))
                    ep.imported += 1
            entities["orders"] = ep

            # ── 8. Фінансові операції ─────────────────────────────────────────
            _update_state(step="Фінансові операції", progress=68)
            ep = EntityReport()
            computed_balance: dict[int, float] = {}
            fin_table = _find_table(tables, _TABLE_HINTS["finances"])
            if fin_table:
                FIN_HINTS = {
                    "client_id": ["клієнт", "client", "код_клієнт"],
                    "amount":    ["сума", "вихід_цін", "amount", "знач"],
                    "is_income": ["наслідок", "тип", "income", "direction"],
                    "date":      ["дата", "timestamp", "date"],
                    "notes":     ["нотатк", "опис", "notes", "коментар"],
                }
                cm = _discover_columns(reader.columns(fin_table), FIN_HINTS)
                for row in reader.rows(fin_table):
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
                    client_id = None
                    if client_raw is not None:
                        try:
                            client_id = client_map.get(int(float(client_raw)))
                        except (ValueError, TypeError):
                            pass

                    is_income_raw = row.get(cm["is_income"]) if cm.get("is_income") else None
                    try:
                        ir = float(is_income_raw) if is_income_raw is not None else None
                        is_income = ir is not None and ir > 0
                    except (ValueError, TypeError):
                        is_income = str(is_income_raw).lower() in ("true", "1", "income", "платіж")

                    sign       = 1 if is_income else -1
                    article_id = (income_article.id if is_income and income_article
                                  else expense_article.id if not is_income and expense_article
                                  else import_article_id)
                    ftype      = "payment" if is_income else "invoice"

                    notes = _safe_str(row.get(cm["notes"]) if cm.get("notes") else None, 500)
                    db.add(Finance(
                        finance_date=date_val, client_id=client_id,
                        finance_type=ftype, article_id=article_id,
                        amount=amount, sign=sign,
                        notes=notes or "Імпорт з Access",
                        created_at=now_str, created_by="import",
                    ))
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
                computed = computed_balance.get(sqlite_cid, 0.0)
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
                    correction_sign = -1 if diff > 0 else 1
                    db.add(Finance(
                        finance_date=tr_date, client_id=sqlite_cid,
                        finance_type="invoice" if diff > 0 else "payment",
                        article_id=import_article_id,
                        amount=abs(diff), sign=correction_sign,
                        notes=f"Корекція балансу (імпорт з Access, різниця: {diff:+.2f})",
                        created_at=now_str, created_by="import",
                    ))

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
                cm = _discover_columns(reader.columns(stock_table), STOCK_HINTS)
                shop_client = (
                    db.query(Client).filter(Client.is_own_shop == 1).first()
                    or db.query(Client).filter(Client.client_kind == "shop").first()
                )
                rows_stock = reader.rows(stock_table)
                if shop_client and rows_stock:
                    recon = ShopReconciliation(
                        shop_client_id=shop_client.id,
                        period_from=tr_date, period_to=tr_date,
                        cash_expected=0, closed=1,
                        closed_at=now_str, closed_by="import", created_at=now_str,
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
                                prod_id = product_map.get(int(float(row[cm["product_id"]])))
                            except (ValueError, TypeError):
                                pass
                        if prod_id is None and cm.get("product_name"):
                            pn = _safe_str(row.get(cm["product_name"]), 200)
                            if pn:
                                prod_id = product_name_map.get(pn.lower())
                        if not prod_id:
                            ep.skipped += 1
                            continue
                        price_val = _safe_float(row.get(cm["price"]) if cm.get("price") else None)
                        db.add(ShopReconciliationLine(
                            reconciliation_id=recon.id, product_id=prod_id,
                            batch_date=None, opening_balance=qty,
                            received=0, entered_balance=qty, written_off=0,
                            calculated_sold=0, price=price_val, expected_cash=0,
                        ))
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

    except Exception as exc:
        _update_state(running=False, step="Помилка", progress=0, error=str(exc))
