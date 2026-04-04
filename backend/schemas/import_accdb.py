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


class AccdbPreview(BaseModel):
    temp_file_token: str
    access_tables:   list[str] = []
    product_types:   list[str] = []   # унікальні значення поля 'Тип' з _Вироби

    routes:    TableDetail = Field(default_factory=lambda: TableDetail(target_table="routes"))
    clients:   TableDetail = Field(default_factory=lambda: TableDetail(target_table="clients"))
    products:  TableDetail = Field(default_factory=lambda: TableDetail(target_table="products"))
    prices:    TableDetail = Field(default_factory=lambda: TableDetail(target_table="prices"))
    orders:    TableDetail = Field(default_factory=lambda: TableDetail(target_table="orders"))
    finances:  TableDetail = Field(default_factory=lambda: TableDetail(target_table="finances"))
    stock:     TableDetail = Field(default_factory=lambda: TableDetail(target_table="shop_reconciliation_lines"))


class ProductTypeMapping(BaseModel):
    """Маппінг поля 'Тип' з _Вироби → назва категорії нової системи.
    Категорія створюється під час імпорту якщо ще не існує."""
    access_type:   str   # значення Тип у Access (напр. 'Хліб', 'Булка')
    category_name: str   # назва категорії в новій системі (можна змінити)


class ClientKindMapping(BaseModel):
    access_client_id: int
    client_kind: Literal['customer', 'shop', 'writeoff', 'ration']


class ImportMapping(BaseModel):
    temp_file_token:        str
    db_password:            str = ''
    transition_date:        str                          # YYYY-MM-DD
    finance_months:         int = Field(2, ge=1, le=24)
    order_days:             int = Field(14, ge=1, le=60)
    product_type_categories: list[ProductTypeMapping] = []
    client_kinds:           list[ClientKindMapping] = []
    default_client_kind:    str = 'customer'


class EntityReport(BaseModel):
    found:    int = 0
    imported: int = 0
    skipped:  int = 0
    warnings: list[str] = []
    errors:   list[str] = []


class BalanceMismatch(BaseModel):
    client_name:      str
    access_balance:   float
    computed_balance: float
    diff:             float


class ValidationReport(BaseModel):
    balance_mismatches:   list[BalanceMismatch] = []
    zero_price_products:  list[str] = []
    order_count_ok:       bool = True
    overall_ok:           bool = True


class ImportReport(BaseModel):
    success:         bool
    started_at:      str
    finished_at:     str
    transition_date: str
    entities:        dict[str, EntityReport] = {}
    validation:      ValidationReport = ValidationReport()
