"""Pydantic-схеми для магазину."""

from __future__ import annotations
from typing import Optional, List
from pydantic import BaseModel, ConfigDict


# ─── Стара схема (ShopCount) — залишається для сумісності ─────────────────────

class ShopCountOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    count_date: str
    product_id: int
    product_type: str
    yesterday_balance: float
    received_today: float
    entered_balance: Optional[float]
    written_off_entered: float
    calculated_sold: Optional[float]
    price: Optional[float]
    saved: int


class ShopCountUpdate(BaseModel):
    entered_balance: Optional[float] = None
    written_off_entered: Optional[float] = None
    price: Optional[float] = None


class OtherStockInCreate(BaseModel):
    other_product_id: int
    qty: float
    purchase_price: Optional[float] = None
    notes: Optional[str] = None


class OtherStockInOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    stock_date: str
    other_product_id: int
    qty: float
    purchase_price: Optional[float]
    notes: Optional[str]


# ─── Нові схеми (ShopReconciliation) ──────────────────────────────────────────

class ShopDisposalLineCreate(BaseModel):
    disposal_type: str  # writeoff | ration | client | sale
    client_id: Optional[int] = None
    qty: float
    price: Optional[float] = None   # для disposal_type='sale' — ціна продажу
    notes: Optional[str] = None


class ShopDisposalLineOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    reconciliation_line_id: int
    disposal_type: str
    client_id: Optional[int]
    qty: float
    price: Optional[float]
    notes: Optional[str]


class ShopReconciliationLineOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    reconciliation_id: int
    product_id: int
    batch_date: Optional[str]
    opening_balance: float
    received: float
    entered_balance: Optional[float]
    written_off: float
    calculated_sold: Optional[float]
    price: Optional[float]
    expected_cash: Optional[float]
    disposal_lines: List[ShopDisposalLineOut] = []


class ShopReconciliationLineUpdate(BaseModel):
    entered_balance: Optional[float] = None
    price: Optional[float] = None


class ShopReconciliationHeaderOut(BaseModel):
    """Схема звірки БЕЗ рядків — для швидкого завантаження календаря."""
    model_config = ConfigDict(from_attributes=True)
    id: int
    shop_client_id: int
    period_from: str
    period_to: str
    cash_expected: float
    cash_actual: Optional[float]
    cash_diff: Optional[float]
    notes: Optional[str]
    closed: int
    closed_at: Optional[str]
    closed_by: Optional[str]
    created_at: Optional[str]
    rec_type: str = 'regular'


class ShopReconciliationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    shop_client_id: int
    period_from: str
    period_to: str
    cash_expected: float
    cash_actual: Optional[float]
    cash_diff: Optional[float]
    notes: Optional[str]
    closed: int
    closed_at: Optional[str]
    closed_by: Optional[str]
    created_at: Optional[str]
    rec_type: str = 'regular'
    lines: List[ShopReconciliationLineOut] = []
    # Поля обчислюються динамічно (не зберігаються в БД):
    prev_cash_balance: Optional[float] = None   # залишок у касі після попередньої звірки
    prev_stock_value: Optional[float] = None    # вартість товару на кінець попередньої звірки
    terminal_cash: Optional[float] = None       # термінальна частина cash_actual
    opening_prices: Optional[dict] = None       # {str(pid): price} — ціни ДО початку звірки
    revaluation_sum: Optional[float] = None     # переоцінка: Σ entered × (closing_price − opening_price)


class ShopReconciliationCreate(BaseModel):
    shop_client_id: int
    period_from: str
    period_to: str


class ShopReconciliationOpeningCreate(BaseModel):
    shop_client_id: int
    start_date: str                      # перший день реального обліку (rec датується start_date - 1)
    lines: List[dict]                    # [{product_id: int, qty: float}]
    cash_actual: Optional[float] = None  # None → авто з finances


class ShopReconciliationOpeningCashUpdate(BaseModel):
    cash_actual: float


class ShopReconciliationConfirm(BaseModel):
    cash_actual: Optional[float] = None
    notes: Optional[str] = None


# ─── Надходження ззовні ────────────────────────────────────────────────────────

class ShopReceiptCreate(BaseModel):
    shop_client_id: int
    receipt_date: str
    product_id: int
    qty: float
    purchase_price: Optional[float] = 0.0
    notes: Optional[str] = None


class ShopReceiptOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    shop_client_id: int
    receipt_date: str
    product_id: int
    qty: float
    purchase_price: float
    notes: Optional[str]
    created_at: Optional[str]


# ─── Зведений стан магазину (summary card) ────────────────────────────────────

# ─── POS-продажі ──────────────────────────────────────────────────────────────

class ShopSaleLineIn(BaseModel):
    product_id: int
    qty: float
    price: float
    batch_date: Optional[str] = None   # яку партію продано (дата надходження)


class ShopSaleCreate(BaseModel):
    shop_client_id: int
    sale_date: str
    lines: List[ShopSaleLineIn]
    session_id: Optional[str] = None
    notes: Optional[str] = None


class ShopSaleLineOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    product_id: int
    qty: float
    price: float
    amount: float
    batch_date: Optional[str] = None


class ShopSaleOut(BaseModel):
    session_id: str
    shop_client_id: int
    sale_date: str
    lines: List[ShopSaleLineOut]
    total: float
    created_at: Optional[str]
    created_by: Optional[str]


class PosProductRow(BaseModel):
    product_id: int
    name: str
    short_name: Optional[str]
    category_id: Optional[int]
    category_name: Optional[str]
    price: Optional[float]
    current_balance: float
    batch_date: Optional[str] = None    # дата партії (None = стара без дати)
    age_days: Optional[int] = None      # кількість днів з моменту надходження


class ShopSummaryProductRow(BaseModel):
    product_id: int
    product_name: str
    opening_balance: float
    received: float
    sold: float
    current_balance: float
    price: Optional[float]

class ShopSummary(BaseModel):
    shop_client_id: int
    shop_name: str
    last_reconciliation_id: Optional[int]
    last_reconciliation_from: Optional[str]
    last_reconciliation_to: Optional[str]
    last_closed: int
    products: List[ShopSummaryProductRow]
