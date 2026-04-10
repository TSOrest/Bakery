from __future__ import annotations
from typing import Any, Literal
from pydantic import BaseModel, Field


class ColumnMap(BaseModel):
    """Одна колонка: Access → нова система."""
    access_col:   str        # точна назва колонки в Access
    target_field: str        # назва поля в SQLite
    description:  str = ""  # людиночитаний опис українською


class TableDetail(BaseModel):
    """Деталі однієї сутності: Access таблиця → SQLite таблиця."""
    access_table: str | None = None   # точна назва таблиці в Access (None = не знайдено)
    target_table: str = ""            # цільова таблиця
    count:        int = 0             # кількість рядків в Access
    column_map:   list[ColumnMap] = []
    sample:       list[dict[str, Any]] = []  # до 3 зразкових рядків (Access значення)
    warnings:     list[str] = []


class PriceCategory(BaseModel):
    """Цінова категорія з Access (_Категорії)."""
    access_id:    str   # значення КодКатегорії ("1", "9", "10", …)
    name:         str   # назва категорії
    price_count:  int = 0
    client_count: int = 0


class RoutePreview(BaseModel):
    access_id: int
    name:      str


class ClientPreview(BaseModel):
    access_id: int
    name:      str


class AccdbPreview(BaseModel):
    temp_file_token: str
    access_tables:       list[str] = []
    product_types:       list[str] = []          # унікальні значення поля 'Тип' з _Вироби
    price_categories:    list[PriceCategory] = [] # цінові категорії з _Категорії
    base_price_category: str = ""                # auto-detected Access id базової категорії

    routes:    TableDetail = Field(default_factory=lambda: TableDetail(target_table="routes"))
    clients:   TableDetail = Field(default_factory=lambda: TableDetail(target_table="clients"))
    products:  TableDetail = Field(default_factory=lambda: TableDetail(target_table="products"))
    prices:    TableDetail = Field(default_factory=lambda: TableDetail(target_table="prices"))
    orders:    TableDetail = Field(default_factory=lambda: TableDetail(target_table="orders"))
    finances:  TableDetail = Field(default_factory=lambda: TableDetail(target_table="finances"))
    stock:     TableDetail = Field(default_factory=lambda: TableDetail(target_table="shop_reconciliation_lines"))

    # Повні списки для wizard-маппінгу
    all_routes:           list[RoutePreview]  = []  # всі маршрути Access
    all_clients_preview:  list[ClientPreview] = []  # всі клієнти Access (id + name)

    # Авто-пропозиції для маппінгу
    suggested_route_skips:   list[str]  = []   # назви маршрутів для auto-skip (system, ПЕКАРНЯ)
    suggested_non_customers: list[dict] = []   # [{access_id, name, suggested_kind, suggested_merge_id}]


# ─── Маппінги для нового wizard ───────────────────────────────────────────────

class RouteMapping(BaseModel):
    """Маппінг одного маршруту Access."""
    access_id:    int
    import_it:    bool = True      # False = пропустити (не імпортувати)
    name_override: str = ""        # порожньо = використати оригінальну назву
    sort_order:   int = 0


class CategoryMapping(BaseModel):
    """Маппінг типу виробу Access → категорія нової системи."""
    access_type:   str            # значення 'Тип' в Access ('Хліб', 'Булка', …)
    category_name: str            # назва категорії в новій системі
    is_baked:      int = 1        # 1 = печеться, 0 = лише магазин
    sort_order:    int = 0
    reserve_pct:   float = 5.0


class ClientMapping(BaseModel):
    """Маппінг одного клієнта Access."""
    access_id:   int
    client_kind: str = 'customer'  # customer|shop|writeoff|ration
    merge_with:  int | None = None # якщо задано — не створювати, використати існуючий SQLite client_id
    skip:        bool = False      # якщо True — не створювати і не включати в жоден маппінг


class ImportMapping(BaseModel):
    temp_file_token:  str
    db_password:      str = ''
    transition_date:  str                           # YYYY-MM-DD
    finance_months:   int = Field(0, ge=0)   # 0 = вся історія
    order_days:       int = Field(0, ge=0)   # 0 = вся історія
    route_mappings:   list[RouteMapping] = []
    category_mappings: list[CategoryMapping] = []  # замінює product_type_categories
    client_mappings:  list[ClientMapping] = []     # замінює client_kinds
    default_client_kind: str = 'customer'
    base_price_category: str = ''                  # Access КодКатегорії для базових цін
    invoice_draft_from: str | None = None          # YYYY-MM-DD; накладні з цієї дати = draft


# ─── Звіт ─────────────────────────────────────────────────────────────────────

class EntityReport(BaseModel):
    found:        int = 0
    imported:     int = 0
    skipped:      int = 0
    skip_reasons: dict[str, int] = {}   # причина → кількість
    warnings:     list[str] = []
    errors:       list[str] = []
    notes:        str = ""


class BalanceMismatch(BaseModel):
    client_id:        int
    client_name:      str
    access_balance:   float
    computed_balance: float
    diff:             float


class ZeroPriceProduct(BaseModel):
    id:   int
    name: str


class ValidationReport(BaseModel):
    balance_mismatches:   list[BalanceMismatch] = []
    zero_price_products:  list[ZeroPriceProduct] = []
    order_count_ok:       bool = True
    overall_ok:           bool = True


class ImportReport(BaseModel):
    success:         bool
    started_at:      str
    finished_at:     str
    transition_date: str
    entities:        dict[str, EntityReport] = {}
    validation:      ValidationReport = ValidationReport()


# ─── Контекст для merge-маппінгу ──────────────────────────────────────────────

class ExistingClient(BaseModel):
    id:          int
    full_name:   str
    short_name:  str | None = None
    client_kind: str


class ExistingRoute(BaseModel):
    id:         int
    name:       str
    sort_order: int = 0


class ExistingCategory(BaseModel):
    id:         int
    name:       str
    is_baked:   int = 1
    sort_order: int = 0


class ImportContext(BaseModel):
    """Існуючі сутності БД для merge-маппінгу в wizard."""
    existing_clients:    list[ExistingClient] = []
    existing_routes:     list[ExistingRoute] = []
    existing_categories: list[ExistingCategory] = []
