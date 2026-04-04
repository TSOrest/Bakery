from __future__ import annotations
from typing import Any, Literal
from pydantic import BaseModel, Field


class EntityPreview(BaseModel):
    count: int = 0
    sample: list[dict[str, Any]] = []
    warnings: list[str] = []


class AccdbPreview(BaseModel):
    temp_file_token: str
    access_tables: list[str] = []
    routes: EntityPreview = EntityPreview()
    clients: EntityPreview = EntityPreview()
    products: EntityPreview = EntityPreview()
    prices: EntityPreview = EntityPreview()
    overrides: EntityPreview = EntityPreview()
    orders: EntityPreview = EntityPreview()
    finances: EntityPreview = EntityPreview()
    stock: EntityPreview = EntityPreview()


class ProductCategoryMapping(BaseModel):
    access_product_id: int
    new_category_id: int


class ClientKindMapping(BaseModel):
    access_client_id: int
    client_kind: Literal['customer', 'shop', 'writeoff', 'ration']


class ImportMapping(BaseModel):
    temp_file_token: str
    db_password: str = ''                         # пароль до .accdb (порожньо = без пароля)
    transition_date: str                          # YYYY-MM-DD
    finance_months: int = Field(2, ge=1, le=24)
    order_days: int = Field(14, ge=1, le=60)
    product_categories: list[ProductCategoryMapping] = []
    client_kinds: list[ClientKindMapping] = []
    default_client_kind: str = 'customer'


class EntityReport(BaseModel):
    found: int = 0
    imported: int = 0
    skipped: int = 0
    warnings: list[str] = []
    errors: list[str] = []


class BalanceMismatch(BaseModel):
    client_name: str
    access_balance: float
    computed_balance: float
    diff: float


class ValidationReport(BaseModel):
    balance_mismatches: list[BalanceMismatch] = []
    zero_price_products: list[str] = []
    order_count_ok: bool = True
    overall_ok: bool = True


class ImportReport(BaseModel):
    success: bool
    started_at: str
    finished_at: str
    transition_date: str
    entities: dict[str, EntityReport] = {}
    validation: ValidationReport = ValidationReport()
