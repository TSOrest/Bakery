"""Сервіс імпорту даних з Microsoft Access (.accdb) у SQLite.

Читання Access: спочатку пробує pyodbc (64-bit ODBC Driver),
якщо драйвер відсутній — використовує 32-bit PowerShell (SysWOW64)
з Microsoft.ACE.OLEDB.12.0 (входить до складу Office 32-bit).
"""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import threading
from collections import Counter
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
    ClientPreview,
    ColumnMap,
    EntityReport,
    ImportMapping,
    ImportReport,
    PriceCategory,
    RoutePreview,
    TableDetail,
    ValidationReport,
    ZeroPriceProduct,
)

# ─── Глобальний стан прогресу ─────────────────────────────────────────────────

_import_lock = threading.Lock()
_import_state: dict[str, Any] = {
    "running": False, "step": "", "progress": 0, "error": None, "result": None,
}


def _update_state(**kwargs: Any) -> None:
    with _import_lock:
        _import_state.update(kwargs)


def get_import_status() -> dict[str, Any]:
    with _import_lock:
        return dict(_import_state)


# ─── Точні назви таблиць та колонок (Пекарня_base.accdb) ──────────────────────

# key → точна назва таблиці в Access
_EXACT_TABLES: dict[str, str] = {
    "units":      "_Одиниці",
    "routes":     "_Маршрути",
    "products":   "_Вироби",
    "clients":    "_Клієнти",
    "prices":     "^Ціни",
    "orders":     "^Закази",
    "finances":   "^Баланс",
    "articles":   "_Статті",        # фін. статті → визначаємо напрям (Прихід/Витрата)
    "price_cats": "_Категорії",     # цінові категорії клієнтів
    "stock":      "tblDailyBalances",  # денні залишки → початковий залишок магазину
}

# key → {target_field: access_column}
_EXACT_COLS: dict[str, dict[str, str]] = {
    "units": {
        "id":   "Код",
        "name": "Назва",
    },
    "routes": {
        "id":     "id",
        "name":   "Маршрут",
        "active": "Діє",
    },
    "products": {
        "id":            "id",
        "name":          "Назва",
        "weight":        "Вага",
        "active":        "Діє",
        "type":          "Тип",
        "unit_id":       "Одиниця",   # посилання на _Одиниці (може бути Код або Назва)
        "initial_stock": "Залишок",
    },
    "clients": {
        "id":                   "id",
        "short_name":           "Клієнт",
        "full_name":            "Повна назва",
        "phone":                "Телефон",
        "address":              "Адреса",
        "route_id":             "Маршрут",
        "delivery_agent":       "ВідпЧерез",
        "delivery_note_number": "НомерДоруч",
        "delivery_note_date":   "ДатаДоруч",
        "receiver_name":        "Прийняв",
        "price_category_id":    "КатегоріяЦін",
        "active":               "Діє",
        "print_invoice":        "Друк",
        "is_own_shop":          "Свій",
        "client_group":         "Група",
    },
    "prices": {
        "price_cat_id": "КодКатегорії",
        "product_id":   "КодВиробу",
        "price":        "Ціна",
        "active":       "Діє",
        "ts":           "TS",    # timestamp — дата встановлення ціни
    },
    "price_cats": {
        "id":     "Код",
        "name":   "Категорія",
        "active": "Діє",
    },
    "orders": {
        "client_id":  "Код Клієнта",
        "product_id": "Код Виробу",
        "qty":        "Кількість",
        "date":       "На Дату",
        # "Обмін" читається окремо через _ORDER_EXCHANGE_COL
    },
    "finances": {
        "article_id": "Стаття",
        "client_id":  "Контрагент",
        "date":       "ДатаОперації",
        "notes":      "Примітка",
        "amount":     "Сума",
    },
    "articles": {
        "id":        "Ідентифікатор",
        "name":      "Стаття",
        "direction": "Напрям",   # Прихід=income, Витрата=expense
    },
    "stock": {
        "product_id":  "ProductID",
        "date":        "BalanceDate",
        "end_balance": "EndBalance",
    },
}

# Точна назва колонки обміну в таблиці ^Закази
_ORDER_EXCHANGE_COL = "Обмін"

# Описи полів (Ukrainian) для відображення у Preview
_COL_DESC: dict[str, dict[str, str]] = {
    "units":    {"id": "Код", "name": "Назва одиниці"},
    "routes":   {"id": "Код", "name": "Назва маршруту", "active": "Активний"},
    "products": {
        "id": "Код", "name": "Назва виробу", "weight": "Вага (кг)",
        "active": "Активний", "type": "Тип → Категорія (маппінг)", "initial_stock": "Залишок",
    },
    "clients": {
        "id": "Код", "short_name": "Коротка назва", "full_name": "Повна назва",
        "phone": "Телефон", "address": "Адреса", "route_id": "Маршрут",
        "delivery_agent": "Відправляється через", "delivery_note_number": "Номер доручення",
        "delivery_note_date": "Дата доручення", "receiver_name": "Прийняв",
        "price_category_id": "Цінова категорія", "active": "Активний",
        "print_invoice": "Друкувати накладну", "is_own_shop": "Власний магазин",
        "client_group": "Група",
    },
    "prices":   {
        "price_cat_id": "Цінова категорія клієнта", "product_id": "Виріб",
        "price": "Ціна", "active": "Активна",
    },
    "orders":   {
        "client_id": "Клієнт", "product_id": "Виріб",
        "qty": "Кількість", "date": "Дата замовлення",
        "exchange_qty": "К-сть обміну (Обмін)",
    },
    "finances": {
        "article_id": "Стаття (тип операції)", "client_id": "Контрагент",
        "date": "Дата операції", "notes": "Примітка", "amount": "Сума",
    },
    "stock": {
        "product_id": "Виріб", "date": "Дата", "end_balance": "Залишок на кінець дня",
    },
}


# ─── _Reader абстракція ────────────────────────────────────────────────────────

class _Reader:
    def __init__(self, tables: list[str], data: dict[str, dict]):
        self._tables = tables
        self._data   = data

    def tables(self) -> list[str]:
        return self._tables

    def count(self, table: str) -> int:
        return self._data.get(table, {}).get("count", 0)

    def columns(self, table: str) -> list[str]:
        return self._data.get(table, {}).get("columns", [])

    def rows(self, table: str) -> list[dict[str, Any]]:
        return self._data.get(table, {}).get("rows", [])


# ─── PowerShell 32-bit reader (OleDb ACE) ─────────────────────────────────────

_PS32 = r"C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe"

_PS_SCRIPT = r"""
param([string]$DbPath, [string]$Password = "", [int]$TopN = 0, [string]$OutFile)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Data

$cs = "Provider=Microsoft.ACE.OLEDB.12.0;Data Source=$DbPath"
if ($Password -ne "") { $cs += ";Jet OLEDB:Database Password=$Password" }

$conn = New-Object System.Data.OleDb.OleDbConnection($cs)
$conn.Open()

$schemaTbl = $conn.GetOleDbSchemaTable(
    [System.Data.OleDb.OleDbSchemaGuid]::Tables,
    @($null, $null, $null, "TABLE")
)
$tbls = [System.Collections.Generic.List[string]]::new()
foreach ($r in $schemaTbl.Rows) {
    $tname = $r["TABLE_NAME"].ToString()
    if (-not $tname.StartsWith("MSys")) { $tbls.Add($tname) }
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
                $row[$colList[$i]] = if ($v -is [System.DBNull]) { $null }
                                     elseif ($v -is [System.DateTime]) { $v.ToString("yyyy-MM-ddTHH:mm:ss") }
                                     else { $v.ToString() }
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
    if not Path(_PS32).exists():
        raise RuntimeError(
            "32-bit PowerShell не знайдено. "
            "Встановіть Microsoft Access Database Engine Redistributable."
        )

    ps_fd,  ps_path  = tempfile.mkstemp(suffix=".ps1",  prefix="bakery_")
    out_fd, out_path = tempfile.mkstemp(suffix=".json", prefix="bakery_")
    try:
        os.close(ps_fd); os.close(out_fd)
        Path(ps_path).write_text(_PS_SCRIPT, encoding="utf-8")

        result = subprocess.run(
            [_PS32, "-NoProfile", "-NonInteractive",
             "-ExecutionPolicy", "Bypass", "-File", ps_path,
             "-DbPath", path, "-Password", password or "",
             "-TopN", str(top_n), "-OutFile", out_path],
            capture_output=True, timeout=300,
        )

        if result.returncode != 0:
            stderr = result.stderr.decode("utf-8", errors="replace").strip()
            stdout = result.stdout.decode("utf-8", errors="replace").strip()
            msg = stderr or stdout
            low = msg.lower()
            if "password" in low or "пароль" in low or "not a valid password" in low:
                raise RuntimeError("Невірний пароль до файлу Access")
            raise RuntimeError(f"Помилка читання Access:\n{msg[:800]}")

        raw    = Path(out_path).read_text(encoding="utf-8-sig")
        parsed = json.loads(raw)

        table_list: list[str] = parsed.get("tables", [])
        data: dict[str, dict] = {}
        for tbl, td in parsed.get("data", {}).items():
            rows = td.get("rows") or []
            cols = td.get("columns") or (list(rows[0].keys()) if rows else [])
            data[tbl] = {"count": td.get("count", len(rows)), "columns": cols, "rows": rows}
        return _Reader(table_list, data)
    finally:
        for p in (ps_path, out_path):
            try:
                os.unlink(p)
            except OSError:
                pass


# ─── pyodbc reader (64-bit fallback, якщо встановлений) ───────────────────────

def _open_pyodbc_reader(path: str, password: str, top_n: int) -> _Reader:
    import pyodbc  # noqa: PLC0415
    conn_str = (
        f"Driver={{Microsoft Access Driver (*.mdb, *.accdb)}};DBQ={path};ExtendedAnsiSQL=1;"
        + (f"PWD={password};" if password else "")
    )
    conn = pyodbc.connect(conn_str, autocommit=True)
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
            try:
                q = (f"SELECT TOP {top_n} * FROM [{tbl}]"
                     if top_n else f"SELECT * FROM [{tbl}]")
                cur.execute(q)
                cols = [c[0] for c in cur.description]
                rows = [dict(zip(cols, r)) for r in cur.fetchall()]
            except Exception:
                cols, rows = [], []
            data[tbl] = {"count": cnt, "columns": cols, "rows": rows}
        return _Reader(table_list, data)
    finally:
        conn.close()


def _open_reader(path: str, password: str, top_n: int) -> _Reader:
    try:
        import pyodbc  # noqa: PLC0415
        if any("Access" in d for d in pyodbc.drivers()):
            return _open_pyodbc_reader(path, password, top_n)
    except ImportError:
        pass
    return _open_ps32_reader(path, password, top_n)


def check_access_driver() -> str | None:
    try:
        import pyodbc  # noqa: PLC0415
        if any("Access" in d for d in pyodbc.drivers()):
            return None
    except ImportError:
        pass
    if Path(_PS32).exists():
        return None
    import struct
    bits = struct.calcsize("P") * 8
    exe  = "AccessDatabaseEngine_X64.exe" if bits == 64 else "AccessDatabaseEngine.exe"
    return (
        f"Неможливо відкрити .accdb. Встановіть:\n"
        f"Microsoft Access Database Engine 2016 Redistributable ({bits}-bit)\n"
        f"Файл: {exe}"
    )


# ─── Утиліти знаходження таблиць / колонок ────────────────────────────────────

def _find_table_for(key: str, tables: list[str]) -> str | None:
    """Точна назва → якщо є в таблицях, повертає її; інакше None."""
    exact = _EXACT_TABLES.get(key)
    if exact and exact in tables:
        return exact
    return None


def _cols_for(key: str, actual_cols: list[str]) -> dict[str, str | None]:
    """Повертає {target_field: access_col | None} за точними назвами."""
    result: dict[str, str | None] = {}
    for target_field, access_col in _EXACT_COLS.get(key, {}).items():
        result[target_field] = access_col if access_col in actual_cols else None
    return result


def _build_table_detail(key: str, reader: _Reader) -> TableDetail:
    tname = _find_table_for(key, reader.tables())
    if not tname:
        expected = _EXACT_TABLES.get(key, key)
        return TableDetail(
            target_table=key,
            warnings=[f"Таблицю '{expected}' не знайдено в базі Access"],
        )

    actual_cols = reader.columns(tname)
    cm_raw      = _cols_for(key, actual_cols)
    descs       = _COL_DESC.get(key, {})

    column_map = [
        ColumnMap(
            access_col=ac,
            target_field=tf,
            description=descs.get(tf, tf),
        )
        for tf, ac in cm_raw.items() if ac is not None
    ]
    not_found = [tf for tf, ac in cm_raw.items() if ac is None]
    warnings  = [f"Колонку не знайдено для поля '{tf}'" for tf in not_found]

    sample = _serialize_sample(reader.rows(tname)[:3])
    return TableDetail(
        access_table=tname,
        target_table=key,
        count=reader.count(tname),
        column_map=column_map,
        sample=sample,
        warnings=warnings,
    )


# ─── Утиліти перетворення значень ─────────────────────────────────────────────

def _safe_str(val: Any, max_len: int = 255) -> str | None:
    if val is None:
        return None
    s = str(val).strip()
    return s[:max_len] if s else None


def _safe_float(val: Any) -> float | None:
    """Парсить число; підтримує кому як десятковий роздільник ('2808,9' → 2808.9)."""
    if val is None:
        return None
    if isinstance(val, (int, float)):
        return float(val)
    s = str(val).strip().replace(" ", "").replace(",", ".")
    try:
        return float(s)
    except (ValueError, TypeError):
        return None


def _safe_bool(val: Any) -> bool:
    """Парсить 'True'/'False'/1/0 у bool."""
    if isinstance(val, bool):
        return val
    return str(val).strip().lower() in ("true", "1", "так", "yes")


def _safe_date(val: Any) -> str | None:
    """Конвертує значення дати Access у рядок YYYY-MM-DD."""
    if val is None:
        return None
    if hasattr(val, "strftime"):
        return val.strftime("%Y-%m-%d")
    s = str(val).strip()
    for fmt in (
        "%Y-%m-%d %H:%M:%S", "%d.%m.%Y %H:%M:%S",
        "%m/%d/%Y %H:%M:%S", "%m/%d/%Y %I:%M:%S %p",
        "%Y-%m-%d", "%d.%m.%Y", "%m/%d/%Y",
    ):
        try:
            return datetime.strptime(s, fmt).strftime("%Y-%m-%d")
        except ValueError:
            pass
    if len(s) >= 10:
        for fmt in ("%Y-%m-%d", "%d.%m.%Y", "%m/%d/%Y"):
            try:
                return datetime.strptime(s[:10], fmt).strftime("%Y-%m-%d")
            except ValueError:
                pass
    return None


def _serialize_sample(rows: list[dict]) -> list[dict]:
    result = []
    for row in rows:
        result.append({
            k: (v.strftime("%Y-%m-%d %H:%M:%S") if hasattr(v, "strftime")
                else (str(v) if v is not None else None))
            for k, v in row.items()
        })
    return result


# ─── Preview ──────────────────────────────────────────────────────────────────

def read_accdb_preview(path: str, password: str = "") -> AccdbPreview:
    """Читає .accdb, повертає попередній перегляд без запису в SQLite.
    top_n=200 — вистачає для всіх довідникових таблиць (_Вироби=84, _Клієнти=111)."""
    reader = _open_reader(path, password, top_n=200)
    tables = reader.tables()

    products_detail = _build_table_detail("products", reader)

    # Унікальні типи виробів для маппінгу на кроці 3
    p_tname = _find_table_for("products", tables)
    p_cm    = _cols_for("products", reader.columns(p_tname) if p_tname else [])
    type_col = p_cm.get("type")
    product_types: list[str] = []
    if p_tname and type_col:
        seen: set[str] = set()
        for row in reader.rows(p_tname):
            t = _safe_str(row.get(type_col), 50)
            if t and t not in seen:
                seen.add(t)
                product_types.append(t)

    # Цінові категорії з _Категорії + статистика
    price_cats: list[PriceCategory] = []
    base_cat_id = ""
    pc_tname = _find_table_for("price_cats", tables)
    price_tname = _find_table_for("prices", tables)
    c_tname     = _find_table_for("clients", tables)

    if pc_tname:
        pc_cm = _cols_for("price_cats", reader.columns(pc_tname))
        # Рахуємо ціни і клієнтів по категоріях
        price_cnt: dict[str, int] = {}
        client_cnt: dict[str, int] = {}
        if price_tname:
            pr_cm = _cols_for("prices", reader.columns(price_tname))
            for row in reader.rows(price_tname):
                cid = str(row.get(pr_cm.get("price_cat_id", ""), "") or "").strip()
                if cid:
                    price_cnt[cid] = price_cnt.get(cid, 0) + 1
        if c_tname:
            cl_cm = _cols_for("clients", reader.columns(c_tname))
            for row in reader.rows(c_tname):
                cid = str(row.get(cl_cm.get("price_category_id", ""), "") or "").strip()
                if cid:
                    client_cnt[cid] = client_cnt.get(cid, 0) + 1

        for row in reader.rows(pc_tname):
            aid  = str(row.get(pc_cm.get("id", ""), "") or "").strip()
            name = _safe_str(row.get(pc_cm.get("name", ""), ""), 100) or aid
            if not aid:
                continue
            active = _safe_bool(row.get(pc_cm.get("active", ""), True)) if pc_cm.get("active") else True
            if not active:
                continue
            price_cats.append(PriceCategory(
                access_id=aid, name=name,
                price_count=price_cnt.get(aid, 0),
                client_count=client_cnt.get(aid, 0),
            ))

        # Auto-detect: базова категорія = та що має найбільше цінових записів
        if price_cats:
            base_cat_id = max(price_cats, key=lambda c: c.price_count).access_id

    # ── Всі маршрути + авто-пропозиції skip ──────────────────────────────────
    SKIP_ROUTE_KEYWORDS = {"system", "пекарня", "склад", "офіс"}
    suggested_route_skips: list[str] = []
    all_routes: list[RoutePreview] = []
    r_tname = _find_table_for("routes", tables)
    if r_tname:
        r_cm = _cols_for("routes", reader.columns(r_tname))
        id_col   = r_cm.get("id")
        name_col = r_cm.get("name")
        if name_col:
            for row in reader.rows(r_tname):
                rname  = _safe_str(row.get(name_col), 200) or ""
                raw_id = row.get(id_col) if id_col else None
                try:   rid = int(float(raw_id)) if raw_id is not None else None
                except (ValueError, TypeError): rid = None
                if rid is not None and rname:
                    all_routes.append(RoutePreview(access_id=rid, name=rname))
                if rname and any(kw in rname.lower() for kw in SKIP_ROUTE_KEYWORDS):
                    suggested_route_skips.append(rname)

    # ── Всі клієнти + авто-пропозиції не-customer ─────────────────────────
    # Критерій: лише Свій = True (колонка is_own_shop).
    # Всередині — розрізняємо за назвою: надлишки/списання → writeoff,
    # пайок → ration, решта → shop.
    INTERNAL_WRITEOFF_KW = {"надлишк", "списан"}
    INTERNAL_RATION_KW   = {"пайок"}
    suggested_non_customers: list[dict] = []
    all_clients_preview: list[ClientPreview] = []
    if c_tname:
        cl_cm    = _cols_for("clients", reader.columns(c_tname))
        id_col   = cl_cm.get("id")
        name_col = cl_cm.get("short_name") or cl_cm.get("full_name")
        shop_col = cl_cm.get("is_own_shop")
        for row in reader.rows(c_tname):
            rname   = _safe_str(row.get(name_col) if name_col else None, 100) or ""
            raw_id  = row.get(id_col) if id_col else None
            is_own  = _safe_bool(row.get(shop_col, False)) if shop_col else False
            rname_l = rname.lower()
            try:   aid = int(float(raw_id)) if raw_id is not None else None
            except (ValueError, TypeError): aid = None

            if aid is not None and rname:
                all_clients_preview.append(ClientPreview(access_id=aid, name=rname))

            # Лише внутрішні (Свій=True) потрапляють у suggested_non_customers
            if is_own and aid is not None:
                if any(kw in rname_l for kw in INTERNAL_WRITEOFF_KW):
                    suggested_kind = "writeoff"
                elif any(kw in rname_l for kw in INTERNAL_RATION_KW):
                    suggested_kind = "ration"
                else:
                    suggested_kind = "shop"
                suggested_non_customers.append({
                    "access_id": aid, "name": rname,
                    "suggested_kind": suggested_kind, "suggested_merge_id": None,
                })

    return AccdbPreview(
        temp_file_token="",
        access_tables=tables,
        product_types=sorted(product_types),
        price_categories=sorted(price_cats, key=lambda c: -c.price_count),
        base_price_category=base_cat_id,
        routes=_build_table_detail("routes", reader),
        clients=_build_table_detail("clients", reader),
        products=products_detail,
        prices=_build_table_detail("prices", reader),
        orders=_build_table_detail("orders", reader),
        finances=_build_table_detail("finances", reader),
        stock=_build_table_detail("stock", reader),
        all_routes=all_routes,
        all_clients_preview=all_clients_preview,
        suggested_route_skips=suggested_route_skips,
        suggested_non_customers=suggested_non_customers,
    )


# ─── Створення архівних накладних з імпортованих замовлень ───────────────────

def _create_historical_invoices(
    db: Session,
    orders: list[Order],
    draft_from: str | None = None,
) -> tuple[int, int]:
    """Групує імпортовані замовлення по (client_id, order_date) і створює накладні.
    Накладні до draft_from — статус 'accepted'; починаючи з draft_from — 'draft'.
    Якщо draft_from=None — всі 'accepted'.
    НЕ викликає create_invoice_finance_entry — фінанси вже імпортовані з ^Баланс.
    Повертає (кількість накладних, кількість рядків накладних)."""
    from collections import defaultdict

    from backend.models.invoices import Invoice, InvoiceLine
    from backend.services.invoices import generate_invoice_number
    from backend.services.prices import get_price

    if not orders:
        return 0, 0

    # Кешуємо route_id клієнтів щоб не звертатись до БД у циклі
    cids = {o.client_id for o in orders}
    route_of: dict[int, int | None] = {
        c.id: c.route_id
        for c in db.query(Client).filter(Client.id.in_(cids)).all()
    }

    # Групуємо по (client_id, order_date), сортуємо по даті щоб номери Invoice зростали
    groups: dict[tuple[int, str], list[Order]] = defaultdict(list)
    for o in orders:
        if o.qty and o.qty > 0:
            groups[(o.client_id, o.order_date)].append(o)

    inv_count = line_count = 0
    for (client_id, order_date), grp in sorted(groups.items(), key=lambda x: x[0][1]):
        inv_num = generate_invoice_number(db, order_date)
        inv_status = "draft" if (draft_from and order_date >= draft_from) else "accepted"
        inv = Invoice(
            invoice_number=inv_num,
            invoice_date=order_date,
            client_id=client_id,
            route_id=route_of.get(client_id),
            status=inv_status,
            total_sum=0.0,
        )
        db.add(inv)
        db.flush()  # отримуємо inv.id

        total = 0.0
        for o in grp:
            price = o.price_override or get_price(db, o.product_id, client_id, order_date) or 0.0
            line_sum = round(o.qty * price, 2)
            db.add(InvoiceLine(
                invoice_id=inv.id,
                product_id=o.product_id,
                qty=o.qty,
                price=price,
                sum=line_sum,
            ))
            total += line_sum
            line_count += 1

        inv.total_sum = round(total, 2)
        inv_count += 1

    return inv_count, line_count


# ─── Full import ──────────────────────────────────────────────────────────────

def run_import(accdb_path: str, mapping: ImportMapping) -> None:
    """Повний імпорт. Запускається в окремому треді."""
    started_at = datetime.now().isoformat()
    entities: dict[str, EntityReport] = {}

    try:
        _update_state(running=True, step="Читання бази Access", progress=2,
                      error=None, result=None)

        reader = _open_reader(accdb_path, mapping.db_password, top_n=0)
        tables = reader.tables()

        tr_date        = mapping.transition_date
        finance_cutoff = None   # вся фінансова історія
        order_cutoff   = None   # всі замовлення

        # ── CategoryMapping: Тип Access → атрибути категорії ────────────────
        # Підтримуємо обидва формати: нові category_mappings і старі product_type_categories
        _cat_mapping: dict[str, any] = {}
        for m in mapping.category_mappings:
            _cat_mapping[m.access_type] = m
        # backward compat: якщо є старі product_type_categories і немає нових
        if not _cat_mapping and hasattr(mapping, 'product_type_categories'):
            for m in (mapping.product_type_categories or []):
                from backend.schemas.import_accdb import CategoryMapping as _CM
                _cat_mapping[m.access_type] = _CM(
                    access_type=m.access_type, category_name=m.category_name or m.access_type
                )
        def _resolve_cat_name(ptype: str) -> str:
            m = _cat_mapping.get(ptype)
            return (m.category_name or ptype) if m else ptype

        # Кеш: category_name → id
        _cat_id_cache: dict[str, int] = {}

        # ── RouteMapping: access_id → {import_it, name_override, sort_order} ─
        route_mapping_by_id: dict[int, any] = {
            rm.access_id: rm for rm in mapping.route_mappings
        }
        # Назви маршрутів що треба пропустити (авто-пропозиції або явні)
        route_skip_names: set[str] = {
            rm.name_override or ""  # ігноруємо override для skip
            for rm in mapping.route_mappings if not rm.import_it
        }
        # Для skip по id зберігаємо окремо
        route_skip_ids: set[int] = {
            rm.access_id for rm in mapping.route_mappings if not rm.import_it
        }

        # ── ClientMapping: access_id → {kind, merge_with} ───────────────────
        client_mapping_by_id: dict[int, any] = {
            cm.access_id: cm for cm in mapping.client_mappings
        }
        # backward compat для client_kinds
        if not client_mapping_by_id and hasattr(mapping, 'client_kinds'):
            for ck in (mapping.client_kinds or []):
                from backend.schemas.import_accdb import ClientMapping as _CKM
                client_mapping_by_id[ck.access_client_id] = _CKM(
                    access_id=ck.access_client_id, client_kind=ck.client_kind
                )
        # старий kind_map для сумісності (використовується нижче)
        kind_map: dict[int, str] = {
            aid: cm.client_kind
            for aid, cm in client_mapping_by_id.items()
        }

        db_engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
        db = Session(db_engine)

        try:
            # Захист від подвійного імпорту
            existing = db.query(func.count(Client.id)).filter(
                Client.client_kind == "customer"
            ).scalar() or 0
            if existing > 0:
                raise ValueError(
                    "БД вже містить клієнтів. Скиньте дані перед імпортом."
                )

            db.execute(text("PRAGMA foreign_keys=OFF"))
            now_str = datetime.now().isoformat()

            # ── 1. Units (_Одиниці) ───────────────────────────────────────────
            _update_state(step="Одиниці виміру", progress=5)
            unit_map:    dict[str, int] = {}   # name → sqlite_id
            unit_id_map: dict[int, int] = {}   # access_code → sqlite_id
            ep = EntityReport()
            tname = _find_table_for("units", tables)
            if tname:
                cm = _cols_for("units", reader.columns(tname))
                seen_units: set[str] = set()
                for row in reader.rows(tname):
                    uname = _safe_str(row.get(cm.get("name", "")), 50) if cm.get("name") else None
                    if not uname or uname in seen_units:
                        continue
                    seen_units.add(uname)
                    ep.found += 1
                    ex = db.query(Unit).filter(Unit.name == uname).first()
                    if ex:
                        sqlite_uid = ex.id
                        unit_map[uname] = sqlite_uid
                        ep.skipped += 1
                    else:
                        u = Unit(name=uname, is_active=1)
                        db.add(u); db.flush()
                        sqlite_uid = u.id
                        unit_map[uname] = sqlite_uid
                        ep.imported += 1
                    # Map access numeric code → sqlite id
                    raw_code = row.get(cm.get("id", "")) if cm.get("id") else None
                    if raw_code is not None:
                        try:
                            unit_id_map[int(float(raw_code))] = sqlite_uid
                        except (ValueError, TypeError):
                            pass
            entities["units"] = ep

            # ── 2. Routes (_Маршрути) ─────────────────────────────────────────
            _update_state(step="Маршрути", progress=10)
            route_map: dict[int, int | None] = {}   # None = пропущений маршрут
            ep = EntityReport()
            tname = _find_table_for("routes", tables)
            if tname:
                cm = _cols_for("routes", reader.columns(tname))
                for i, row in enumerate(reader.rows(tname)):
                    ep.found += 1
                    rname  = _safe_str(row.get(cm.get("name", ""), ""), 200) if cm.get("name") else None
                    rid    = row.get(cm.get("id", "")) if cm.get("id") else None
                    active = _safe_bool(row.get(cm.get("active", ""), True)) if cm.get("active") else True

                    try: access_rid = int(float(rid)) if rid is not None else None
                    except (ValueError, TypeError): access_rid = None

                    if not rname:
                        ep.skipped += 1; continue

                    # Перевіряємо route_mappings: пропустити?
                    rm = route_mapping_by_id.get(access_rid) if access_rid is not None else None
                    if rm and not rm.import_it:
                        # Маршрут пропущено — клієнти цього маршруту отримають route_id=None
                        if access_rid is not None:
                            route_map[access_rid] = None
                        ep.skipped += 1
                        continue

                    # Назва та sort_order з override якщо є
                    display_name = (rm.name_override or rname) if rm else rname
                    sort_ord     = rm.sort_order if rm else i

                    ex = db.query(Route).filter(Route.name == display_name).first()
                    if ex:
                        if access_rid is not None:
                            route_map[access_rid] = ex.id
                        ep.skipped += 1
                    else:
                        r = Route(name=display_name, sort_order=sort_ord,
                                  is_active=1 if active else 0)
                        db.add(r); db.flush()
                        if access_rid is not None:
                            route_map[access_rid] = r.id
                        ep.imported += 1
            entities["routes"] = ep

            # ── 3. Products (_Вироби) ─────────────────────────────────────────
            _update_state(step="Вироби", progress=18)
            product_map:      dict[int, int] = {}
            product_name_map: dict[str, int] = {}
            ep = EntityReport()
            tname = _find_table_for("products", tables)
            if tname:
                cm = _cols_for("products", reader.columns(tname))
                for row in reader.rows(tname):
                    ep.found += 1
                    raw_id = row.get(cm.get("id", "")) if cm.get("id") else None
                    name   = _safe_str(row.get(cm.get("name", "")) if cm.get("name") else None, 200)
                    if not name:
                        ep.skipped += 1; continue

                    weight = _safe_float(row.get(cm.get("weight", "")) if cm.get("weight") else None)
                    active = _safe_bool(row.get(cm.get("active", ""), True)) if cm.get("active") else True
                    ptype  = _safe_str(row.get(cm.get("type", "")) if cm.get("type") else None, 50)
                    init_s = _safe_float(row.get(cm.get("initial_stock", "")) if cm.get("initial_stock") else None) or 0.0

                    # Resolve unit_id: спочатку як числовий код (_Одиниці.Код),
                    # потім як текстова назва (_Одиниці.Назва)
                    resolved_uid: int | None = None
                    raw_unit = row.get(cm.get("unit_id", "")) if cm.get("unit_id") else None
                    if raw_unit is not None:
                        try:
                            resolved_uid = unit_id_map.get(int(float(raw_unit)))
                        except (ValueError, TypeError):
                            pass
                        if resolved_uid is None:
                            resolved_uid = unit_map.get(str(raw_unit).strip())

                    # Визначаємо/створюємо категорію за типом + атрибути з CategoryMapping
                    cat_id: int | None = None
                    if ptype:
                        cat_name = _resolve_cat_name(ptype)
                        if cat_name not in _cat_id_cache:
                            ex_cat = db.query(Category).filter(Category.name == cat_name).first()
                            if ex_cat:
                                _cat_id_cache[cat_name] = ex_cat.id
                            else:
                                ma = _cat_mapping.get(ptype)
                                new_cat = Category(
                                    name=cat_name,
                                    is_active=1,
                                    is_baked=ma.is_baked if ma else 1,
                                    sort_order=ma.sort_order if ma else 0,
                                    reserve_pct=ma.reserve_pct if ma else 5.0,
                                )
                                db.add(new_cat); db.flush()
                                _cat_id_cache[cat_name] = new_cat.id
                        cat_id = _cat_id_cache[cat_name]

                    try: prod_aid = int(float(raw_id)) if raw_id is not None else None
                    except (ValueError, TypeError): prod_aid = None

                    p = Product(
                        name=name, short_name=name[:30],
                        weight=weight, unit_id=resolved_uid,
                        category_id=cat_id,
                        cost_per_unit=0, is_active=1 if active else 0,
                        created_at=now_str, initial_stock=init_s,
                    )
                    db.add(p); db.flush()
                    if prod_aid is not None:
                        product_map[prod_aid] = p.id
                    product_name_map[name.lower()] = p.id
                    ep.imported += 1
            entities["products"] = ep

            # ── 4. Clients (_Клієнти) ─────────────────────────────────────────
            _update_state(step="Клієнти", progress=28)
            client_map:      dict[int, int]   = {}
            client_bal_map:  dict[int, float] = {}   # SQLite id → баланс з Access
            client_price_cat: dict[int, str]  = {}   # SQLite id → КатегоріяЦін
            ep = EntityReport()
            tname = _find_table_for("clients", tables)
            if tname:
                cm = _cols_for("clients", reader.columns(tname))
                for row in reader.rows(tname):
                    ep.found += 1
                    raw_id   = row.get(cm.get("id", "")) if cm.get("id") else None
                    short_nm = _safe_str(row.get(cm.get("short_name", "")) if cm.get("short_name") else None, 100)
                    full_nm  = _safe_str(row.get(cm.get("full_name",  "")) if cm.get("full_name")  else None, 255)
                    if not short_nm and not full_nm:
                        ep.skipped += 1; continue

                    phone       = _safe_str(row.get(cm.get("phone",    "")) if cm.get("phone")    else None, 50)
                    address     = _safe_str(row.get(cm.get("address",  "")) if cm.get("address")  else None, 255)
                    active      = _safe_bool(row.get(cm.get("active",  ""), True)) if cm.get("active") else True
                    print_inv   = _safe_bool(row.get(cm.get("print_invoice", ""), True)) if cm.get("print_invoice") else True
                    is_own_shop = _safe_bool(row.get(cm.get("is_own_shop",  ""), False)) if cm.get("is_own_shop") else False
                    grp         = _safe_str(row.get(cm.get("client_group",  "")) if cm.get("client_group")  else None, 100)
                    recv        = _safe_str(row.get(cm.get("receiver_name", "")) if cm.get("receiver_name") else None, 100)
                    dagent      = _safe_str(row.get(cm.get("delivery_agent", "")) if cm.get("delivery_agent") else None, 100)
                    dnumber     = _safe_str(row.get(cm.get("delivery_note_number", "")) if cm.get("delivery_note_number") else None, 50)
                    ddate       = _safe_date(row.get(cm.get("delivery_note_date", "")) if cm.get("delivery_note_date") else None)

                    route_raw = row.get(cm.get("route_id", "")) if cm.get("route_id") else None
                    route_id: int | None = None
                    if route_raw is not None:
                        try: route_id = route_map.get(int(float(route_raw)))
                        except (ValueError, TypeError): pass

                    try: access_id = int(float(raw_id)) if raw_id is not None else None
                    except (ValueError, TypeError): access_id = None

                    price_cat_raw = row.get(cm.get("price_category_id", "")) if cm.get("price_category_id") else None
                    price_cat_str = str(price_cat_raw).strip() if price_cat_raw is not None else ""

                    # ── client_mappings: skip / merge / kind ─────────────────
                    cm_entry = client_mapping_by_id.get(access_id) if access_id is not None else None

                    # 1. Skip: взагалі не створювати, не включати у жоден map
                    if cm_entry and cm_entry.skip:
                        ep.skipped += 1
                        continue

                    # 2. Merge: прив'язати до існуючого клієнта замість створення нового
                    if cm_entry and cm_entry.merge_with is not None:
                        target = db.get(Client, cm_entry.merge_with)
                        if target and cm_entry.client_kind != "customer":
                            target.client_kind = cm_entry.client_kind
                            if cm_entry.client_kind == "shop":
                                target.is_own_shop = 1
                        client_map[access_id] = cm_entry.merge_with
                        client_price_cat[cm_entry.merge_with] = price_cat_str
                        client_bal_map[cm_entry.merge_with]   = 0.0
                        ep.skipped += 1
                        continue

                    # 3. Якщо is_own_shop=True — завжди skip на цьому етапі.
                    # skip і merge_with вже оброблені вище і мають continue.
                    # Будь-який is_own_shop клієнт що дійшов сюди = немає merge_with
                    # → не створювати дублів системних/магазину.
                    if is_own_shop:
                        ep.skipped += 1
                        continue

                    # 4. Тип клієнта: явний override у mapping → default
                    if cm_entry:
                        kind = cm_entry.client_kind
                    elif access_id is not None and access_id in kind_map:
                        kind = kind_map[access_id]
                    else:
                        kind = mapping.default_client_kind

                    c = Client(
                        full_name=full_nm or short_nm, short_name=short_nm,
                        address=address, phone=phone, route_id=route_id,
                        discount_pct=0, is_active=1 if active else 0,
                        is_own_shop=1 if is_own_shop else 0,
                        print_invoice=1 if print_inv else 0,
                        client_kind=kind, client_group=grp,
                        receiver_name=recv, delivery_agent=dagent,
                        delivery_note_number=dnumber, delivery_note_date=ddate,
                        created_at=now_str,
                    )
                    db.add(c); db.flush()
                    if access_id is not None:
                        client_map[access_id] = c.id
                    client_price_cat[c.id] = price_cat_str
                    client_bal_map[c.id]   = 0.0
                    ep.imported += 1
            entities["clients"] = ep

            # ── 5. Фін. статті (_Статті) + нова стаття для корекцій ──────────
            _update_state(step="Фінансові статті", progress=35)

            # ── Маппінг назв статей Access → назви статей нової БД ──────────
            # Ключ: (нижній регістр назви Access, direction)
            # Значення: назва статті в новій БД
            _ACCESS_ARTICLE_MAP: dict[tuple[str, str], str] = {
                ("клієнт",           "income"):  "Оплата",
                ("клієнт",           "expense"): "Накладна",
                ("видача виручки",   "expense"): "Виведення з каси",
                ("внесення в касу",  "income"):  "Внесення в касу",
                ("оплата з каси",    "expense"): "Оплата з каси",
                ("списання магазину","expense"): "Списання магазину",
            }

            # Читаємо статті з Access → будуємо access_art_id → (direction, new_name)
            access_article_dir:  dict[str, str] = {}  # id → 'income'|'expense'
            access_article_newid: dict[str, int] = {}  # id → finance_articles.id нової БД

            # Індекс статей нової БД: назва.lower() → id
            db_art_by_name: dict[str, int] = {
                a.name.lower(): a.id
                for a in db.query(FinanceArticle).all()
            }

            art_tname = _find_table_for("articles", tables)
            if art_tname:
                cm_art = _cols_for("articles", reader.columns(art_tname))
                for row in reader.rows(art_tname):
                    a_id   = _safe_str(row.get(cm_art.get("id",        "")) if cm_art.get("id")        else None, 10)
                    a_name = _safe_str(row.get(cm_art.get("name",      "")) if cm_art.get("name")      else None, 100) or ""
                    a_dir  = _safe_str(row.get(cm_art.get("direction", "")) if cm_art.get("direction") else None, 50)  or ""
                    if not a_id:
                        continue
                    direction = "income" if "рихід" in a_dir else "expense"
                    access_article_dir[a_id] = direction

                    # Пробуємо знайти відповідну статтю в новій БД
                    new_name = _ACCESS_ARTICLE_MAP.get((a_name.lower().strip(), direction))
                    if new_name:
                        new_id = db_art_by_name.get(new_name.lower())
                        if new_id:
                            access_article_newid[a_id] = new_id

            # Fallback-статті якщо маппінг не спрацював
            fallback_income_id  = db_art_by_name.get("оплата") or next(
                (a.id for a in db.query(FinanceArticle)
                 .filter(FinanceArticle.direction == "income", FinanceArticle.is_system == 1).all()),
                None)
            fallback_expense_id = db_art_by_name.get("накладна") or next(
                (a.id for a in db.query(FinanceArticle)
                 .filter(FinanceArticle.direction == "expense", FinanceArticle.is_system == 1).all()),
                None)

            # Стаття для корекцій початкового балансу — знаходимо або створюємо ОДИН раз
            import_art_id: int
            existing_import_art = db_art_by_name.get("початковий баланс")
            if existing_import_art:
                import_art_id = existing_import_art
            else:
                import_art = FinanceArticle(
                    name="Початковий баланс", direction="income", is_system=1
                )
                db.add(import_art); db.flush()
                import_art_id = import_art.id
                db_art_by_name["початковий баланс"] = import_art_id

            # ── 6. Ціни (^Ціни) — повна історія через TS ────────────────────
            _update_state(step="Ціни", progress=42)
            ep_prices = EntityReport()
            ep_ovr    = EntityReport()
            price_tname = _find_table_for("prices", tables)

            # Базова категорія з маппінгу (fallback → авто-вибір)
            base_cat = str(mapping.base_price_category or "").strip()

            if price_tname:
                cm = _cols_for("prices", reader.columns(price_tname))

                # price_cat → [sqlite_client_id]
                cat_to_clients: dict[str, list[int]] = {}
                for cid, cat in client_price_cat.items():
                    cat_to_clients.setdefault(cat, []).append(cid)

                # Якщо base_cat не вказано — обираємо категорію з найбільшою кількістю записів
                if not base_cat:
                    cat_counts: Counter = Counter()
                    for row in reader.rows(price_tname):
                        pc = str(row.get(cm.get("price_cat_id", ""), "") or "").strip()
                        if pc:
                            cat_counts[pc] += 1
                    base_cat = cat_counts.most_common(1)[0][0] if cat_counts else ""

                # Читаємо всі записи і групуємо за (ціновою_категорією, виробом)
                # Ключ: (price_cat_str, access_product_id_int) → list[(ts_datetime, price_float)]
                price_history: dict[tuple[str, int], list[tuple[datetime, float]]] = {}
                for row in reader.rows(price_tname):
                    price_val = _safe_float(row.get(cm.get("price", "")) if cm.get("price") else None)
                    if not price_val or price_val <= 0:
                        continue
                    pid_raw = row.get(cm.get("product_id", "")) if cm.get("product_id") else None
                    if pid_raw is None:
                        continue
                    try:
                        access_pid = int(float(pid_raw))
                    except (ValueError, TypeError):
                        continue
                    if access_pid not in product_map:
                        continue
                    price_cat = str(row.get(cm.get("price_cat_id", ""), "") or "").strip()
                    if not price_cat:
                        continue

                    # TS — дата встановлення ціни; якщо відсутній — використовуємо tr_date
                    ts_raw = row.get(cm.get("ts", "")) if cm.get("ts") else None
                    ts_dt: datetime | None = None
                    if ts_raw is not None:
                        if isinstance(ts_raw, datetime):
                            ts_dt = ts_raw
                        else:
                            s = str(ts_raw).strip()
                            for _fmt in (
                                "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S",
                                "%d.%m.%Y %H:%M:%S", "%m/%d/%Y %I:%M:%S %p",
                                "%m/%d/%Y %H:%M:%S", "%Y-%m-%d",
                                "%d.%m.%Y", "%m/%d/%Y",
                            ):
                                try:
                                    ts_dt = datetime.strptime(s, _fmt)
                                    break
                                except ValueError:
                                    continue
                    if ts_dt is None:
                        ts_dt = datetime.fromisoformat(tr_date)

                    key = (price_cat, access_pid)
                    price_history.setdefault(key, []).append((ts_dt, price_val))

                # Для кожної групи: сортуємо за TS, обчислюємо valid_from / valid_to
                for (price_cat, access_pid), entries in price_history.items():
                    sqlite_pid = product_map.get(access_pid)
                    if not sqlite_pid:
                        continue

                    entries.sort(key=lambda x: x[0])  # сортуємо за часом

                    # Дедублікуємо: якщо кілька записів на одну дату — залишаємо останній
                    deduped: list[tuple[datetime, float]] = []
                    for _ts, _pv in entries:
                        if deduped and deduped[-1][0].date() == _ts.date():
                            deduped[-1] = (_ts, _pv)
                        else:
                            deduped.append((_ts, _pv))
                    entries = deduped

                    for i, (ts_dt, price_val) in enumerate(entries):
                        valid_from = ts_dt.strftime("%Y-%m-%d")
                        valid_to: str | None = None
                        if i + 1 < len(entries):
                            # дата кінця = дата початку наступного запису (exclusive)
                            next_ts = entries[i + 1][0]
                            # valid_to = день перед наступним записом
                            valid_to = (next_ts - timedelta(days=1)).strftime("%Y-%m-%d")
                            # якщо valid_from == valid_to — пропускаємо нульовий діапазон
                            if valid_to < valid_from:
                                valid_to = valid_from

                        if price_cat == base_cat:
                            # Базова ціна → таблиця prices
                            ep_prices.found += 1
                            is_last = (i + 1 == len(entries))
                            db.add(Price(
                                product_id=sqlite_pid,
                                price=price_val,
                                valid_from=valid_from,
                                valid_to=valid_to,
                                is_active=1 if is_last else 0,
                                created_at=now_str,
                            ))
                            ep_prices.imported += 1
                        else:
                            # Не-базова категорія → override для кожного клієнта цієї категорії
                            client_list = cat_to_clients.get(price_cat, [])
                            for sqlite_cid in client_list:
                                ep_ovr.found += 1
                                try:
                                    sp = db.begin_nested()  # savepoint
                                    db.add(ClientPriceOverride(
                                        client_id=sqlite_cid,
                                        product_id=sqlite_pid,
                                        price=price_val,
                                        valid_from=valid_from,
                                        valid_to=valid_to,
                                    ))
                                    sp.commit()
                                    ep_ovr.imported += 1
                                except Exception:
                                    sp.rollback()  # відкочуємо лише цей один запис
                                    ep_ovr.skipped += 1

            entities["prices"]    = ep_prices
            entities["overrides"] = ep_ovr

            # ── 7. Замовлення (^Закази) ───────────────────────────────────────
            _update_state(step="Замовлення", progress=55)
            ep = EntityReport()
            order_objs: list[Order] = []
            order_tname = _find_table_for("orders", tables)
            if order_tname:
                actual_order_cols = reader.columns(order_tname)
                cm = _cols_for("orders", actual_order_cols)
                has_exchange_col = _ORDER_EXCHANGE_COL in actual_order_cols
                ep_exchange_count = 0
                for row in reader.rows(order_tname):
                    ep.found += 1
                    date_val = _safe_date(row.get(cm.get("date", "")) if cm.get("date") else None)
                    if not date_val or (order_cutoff and date_val < order_cutoff):
                        ep.skipped += 1
                        ep.skip_reasons["Невалідна або відсутня дата"] = ep.skip_reasons.get("Невалідна або відсутня дата", 0) + 1
                        continue

                    cid_raw = row.get(cm.get("client_id", "")) if cm.get("client_id") else None
                    client_id: int | None = None
                    if cid_raw is not None:
                        try: client_id = client_map.get(int(float(cid_raw)))
                        except (ValueError, TypeError): pass
                    if not client_id:
                        ep.skipped += 1
                        ep.skip_reasons["Клієнт пропущений або не знайдений"] = ep.skip_reasons.get("Клієнт пропущений або не знайдений", 0) + 1
                        continue

                    pid_raw = row.get(cm.get("product_id", "")) if cm.get("product_id") else None
                    prod_id = None
                    if pid_raw is not None:
                        try: prod_id = product_map.get(int(float(pid_raw)))
                        except (ValueError, TypeError): pass
                    if not prod_id:
                        ep.skipped += 1
                        ep.skip_reasons["Виріб не знайдений"] = ep.skip_reasons.get("Виріб не знайдений", 0) + 1
                        ep.warnings.append(f"Невідомий виріб {pid_raw!r} в замовленні")
                        continue

                    qty_raw = row.get(cm.get("qty", "")) if cm.get("qty") else None
                    qty = _safe_float(qty_raw) or 0
                    if qty <= 0:
                        ep.skipped += 1
                        ep.skip_reasons["Кількість = 0"] = ep.skip_reasons.get("Кількість = 0", 0) + 1
                        continue

                    o = Order(
                        client_id=client_id, product_id=prod_id,
                        qty=qty, order_date=date_val,
                        source="phone", created_at=now_str, created_by="import",
                    )
                    order_objs.append(o)
                    db.add(o)
                    ep.imported += 1

                    # Обмін: якщо є колонка і значення > 0 — окремий рядок pre_order
                    if has_exchange_col:
                        exch_qty = _safe_float(row.get(_ORDER_EXCHANGE_COL)) or 0
                        if exch_qty > 0:
                            db.add(Order(
                                client_id=client_id, product_id=prod_id,
                                qty=exch_qty, order_date=date_val,
                                exchange_type="pre_order",
                                price_override=0.0,
                                source="phone", created_at=now_str, created_by="import",
                            ))
                            ep_exchange_count += 1

            # Flush щоб orders отримали id, потім створюємо архівні накладні.
            # НЕ викликаємо create_invoice_finance_entry — фінанси вже є з ^Баланс.
            if order_objs:
                db.flush()
                _update_state(step="Створення накладних", progress=62)
                inv_count, inv_lines = _create_historical_invoices(
                    db, order_objs, draft_from=mapping.invoice_draft_from
                )
                exch_note = f", обмінів: {ep_exchange_count}" if ep_exchange_count else ""
                ep.notes = f"Створено {inv_count} накладних ({inv_lines} рядків{exch_note})"

            entities["orders"] = ep

            # ── 8. Фінансові операції (^Баланс) ──────────────────────────────
            _update_state(step="Фінансові операції", progress=68)
            ep = EntityReport()
            computed_bal: dict[int, float] = {}   # SQLite client_id → sum(sign*amount)
            fin_tname = _find_table_for("finances", tables)
            if fin_tname:
                cm = _cols_for("finances", reader.columns(fin_tname))
                for row in reader.rows(fin_tname):
                    ep.found += 1
                    date_val = _safe_date(row.get(cm.get("date", "")) if cm.get("date") else None)
                    if not date_val or (finance_cutoff and date_val < finance_cutoff):
                        ep.skipped += 1
                        ep.skip_reasons["Невалідна або відсутня дата"] = ep.skip_reasons.get("Невалідна або відсутня дата", 0) + 1
                        continue

                    amount = _safe_float(row.get(cm.get("amount", "")) if cm.get("amount") else None)
                    if amount is None or amount == 0:
                        ep.skipped += 1
                        ep.skip_reasons["Сума = 0"] = ep.skip_reasons.get("Сума = 0", 0) + 1
                        continue
                    amount = abs(amount)

                    cid_raw = row.get(cm.get("client_id", "")) if cm.get("client_id") else None
                    client_id = None
                    if cid_raw is not None:
                        try: client_id = client_map.get(int(float(cid_raw)))
                        except (ValueError, TypeError): pass

                    # Визначаємо напрям через _Статті
                    art_raw   = str(row.get(cm.get("article_id", ""), "") or "").strip()
                    direction = access_article_dir.get(art_raw, "income")
                    sign      = 1 if direction == "income" else -1
                    art_id    = access_article_newid.get(art_raw) or (
                        fallback_income_id if direction == "income" else fallback_expense_id
                    ) or import_art_id
                    ftype     = "payment" if direction == "income" else "invoice"

                    notes = _safe_str(row.get(cm.get("notes", "")) if cm.get("notes") else None, 500)
                    db.add(Finance(
                        finance_date=date_val, client_id=client_id,
                        finance_type=ftype, article_id=art_id,
                        amount=amount, sign=sign,
                        notes=notes or "Імпорт з Access",
                        created_at=now_str, created_by="import",
                    ))
                    if client_id is not None:
                        computed_bal[client_id] = computed_bal.get(client_id, 0.0) + sign * amount
                    ep.imported += 1
            entities["finances"] = ep

            # ── 9. Звірка балансів ───────────────────────────────────────────
            # Перераховуємо баланс по ВСІХ записах Access ^Баланс (включно з пропущеними)
            # щоб порівняти очікуваний результат з реально імпортованим.
            _update_state(step="Звірка балансів", progress=82)
            access_expected_bal: dict[int, float] = {}   # access_client_id → balance
            if fin_tname:
                cm_f = _cols_for("finances", reader.columns(fin_tname))
                for row in reader.rows(fin_tname):
                    amt = _safe_float(row.get(cm_f.get("amount", "")) if cm_f.get("amount") else None)
                    if not amt or amt == 0:
                        continue
                    amt = abs(amt)
                    cid_raw = row.get(cm_f.get("client_id", "")) if cm_f.get("client_id") else None
                    if cid_raw is None:
                        continue
                    try:
                        acc_cid = int(float(cid_raw))
                    except (ValueError, TypeError):
                        continue
                    art_raw = str(row.get(cm_f.get("article_id", ""), "") or "").strip()
                    direction = access_article_dir.get(art_raw, "income")
                    sign = 1 if direction == "income" else -1
                    access_expected_bal[acc_cid] = access_expected_bal.get(acc_cid, 0.0) + sign * amt

            mismatches: list[BalanceMismatch] = []
            for acc_cid, expected in sorted(access_expected_bal.items()):
                if abs(expected) < 0.01:
                    continue   # нульовий баланс — не цікавить
                sqlite_cid = client_map.get(acc_cid)
                if sqlite_cid is None:
                    continue   # клієнт пропущений / не знайдений у маппінгу
                actual = computed_bal.get(sqlite_cid, 0.0)
                diff   = round(expected - actual, 2)
                client_obj  = db.get(Client, sqlite_cid)
                client_name = client_obj.full_name if client_obj else f"Client #{sqlite_cid}"
                mismatches.append(BalanceMismatch(
                    client_id=sqlite_cid,
                    client_name=client_name,
                    access_balance=round(expected, 2),
                    computed_balance=round(actual, 2),
                    diff=diff,
                ))

            # ── 10. Залишки (tblDailyBalances) → щоденні звірки магазину ─────
            # Для кожної дати в tblDailyBalances створюємо закриту ShopReconciliation.
            # opening  = EndBalance попереднього дня
            # received = замовлення на магазин за цей день (вже імпортовані в крок 7)
            # entered  = EndBalance цього дня
            # calculated_sold = max(0, opening + received - entered)
            _update_state(step="Залишки магазину", progress=90)
            ep = EntityReport()
            stock_tname = _find_table_for("stock", tables)
            if stock_tname:
                cm = _cols_for("stock", reader.columns(stock_tname))
                shop_client = (
                    db.query(Client).filter(Client.is_own_shop == 1).first()
                    or db.query(Client).filter(Client.client_kind == "shop").first()
                )
                # Зчитуємо всі рядки → {date_str: {prod_id: end_balance}}
                daily: dict[str, dict[int, float]] = {}
                if cm.get("product_id") and cm.get("date") and cm.get("end_balance"):
                    for row in reader.rows(stock_tname):
                        d = _safe_date(row.get(cm["date"]))
                        if not d or d > tr_date:
                            continue
                        pid_raw = row.get(cm["product_id"])
                        try:
                            prod_id = product_map.get(int(float(pid_raw))) if pid_raw else None
                        except (ValueError, TypeError):
                            prod_id = None
                        if not prod_id:
                            continue
                        bal = _safe_float(row.get(cm["end_balance"])) or 0.0
                        daily.setdefault(d, {})[prod_id] = bal

                if shop_client and daily:
                    sorted_dates   = sorted(daily.keys())
                    last_import_date = sorted_dates[-1]   # остання дата залишається ВІДКРИТОЮ
                    prev_balance: dict[int, float] = {}
                    for date_str in sorted_dates:
                        day_bal = daily[date_str]
                        is_last = date_str == last_import_date

                        # Надходження з замовлень за цей день (вже в БД після кроку 7)
                        recv_rows = (
                            db.query(Order.product_id, func.sum(Order.qty).label("t"))
                            .filter(
                                Order.client_id == shop_client.id,
                                Order.origin_id == 0,
                                Order.order_date == date_str,
                            )
                            .group_by(Order.product_id)
                            .all()
                        )
                        received_day: dict[int, float] = {r.product_id: float(r.t) for r in recv_rows}

                        # Остання дата — залишається відкритою (може бути незавершена в старій системі)
                        recon = ShopReconciliation(
                            shop_client_id=shop_client.id,
                            period_from=date_str, period_to=date_str,
                            cash_expected=0,
                            closed=0 if is_last else 1,
                            closed_at=None if is_last else now_str,
                            closed_by=None if is_last else "import",
                            created_at=now_str,
                        )
                        db.add(recon)
                        db.flush()

                        all_pids = set(day_bal) | set(prev_balance) | set(received_day)
                        for pid in all_pids:
                            opening  = prev_balance.get(pid, 0.0)
                            received = received_day.get(pid, 0.0)
                            entered  = day_bal.get(pid, 0.0)
                            c_sold   = max(0.0, opening + received - entered)
                            db.add(ShopReconciliationLine(
                                reconciliation_id=recon.id,
                                product_id=pid,
                                batch_date=None,
                                opening_balance=opening,
                                received=received,
                                entered_balance=entered,
                                written_off=0.0,
                                calculated_sold=c_sold,
                                price=None,
                                expected_cash=0.0,
                            ))
                            ep.imported += 1

                        # Оновлюємо prev_balance для наступного дня
                        for pid, bal in day_bal.items():
                            prev_balance[pid] = bal

                    ep.found = len(daily)
                    if daily:
                        ep.warnings.append(
                            f"Остання звірка ({last_import_date}) позначена як ВІДКРИТА — "
                            "перевірте залишки і закрийте її вручну у вкладці Магазин."
                        )
                elif not shop_client:
                    ep.warnings.append(
                        "Клієнта-магазин не знайдено (is_own_shop=1 або client_kind='shop')"
                    )
            entities["stock"] = ep

            # ── Commit ────────────────────────────────────────────────────────
            _update_state(step="Збереження даних", progress=95)
            db.execute(text("PRAGMA foreign_keys=ON"))
            db.commit()

            # ── Validation ────────────────────────────────────────────────────
            imported_product_ids = set(product_map.values())
            zero_price: list[ZeroPriceProduct] = []
            for p in db.query(Product).filter(Product.is_active == 1).all():
                if p.id not in imported_product_ids:
                    continue
                if not db.query(Price).filter(Price.product_id == p.id, Price.is_active == 1).first():
                    zero_price.append(ZeroPriceProduct(id=p.id, name=p.name))

            validation = ValidationReport(
                balance_mismatches=mismatches,
                zero_price_products=zero_price,
                order_count_ok=entities.get("orders", EntityReport()).imported > 0,
                overall_ok=(not any(abs(m.diff) > 0.01 for m in mismatches) and len(zero_price) == 0),
            )
            report = ImportReport(
                success=True,
                started_at=started_at,
                finished_at=datetime.now().isoformat(),
                transition_date=tr_date,
                entities=entities,
                validation=validation,
            )
            _update_state(running=False, step="Завершено", progress=100,
                          result=report.model_dump())

        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    except Exception as exc:
        _update_state(running=False, step="Помилка", progress=0, error=str(exc))
