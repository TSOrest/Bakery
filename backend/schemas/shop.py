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

class ShopReconciliationLineOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    reconciliation_id: int
    product_id: int
    opening_balance: float
    received: float
    entered_balance: Optional[float]
    written_off: float
    calculated_sold: Optional[float]
    price: Optional[float]
    expected_cash: Optional[float]


class ShopReconciliationLineUpdate(BaseModel):
    entered_balance: Optional[float] = None
    written_off: Optional[float] = None
    price: Optional[float] = None


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
    lines: List[ShopReconciliationLineOut] = []


class ShopReconciliationCreate(BaseModel):
    shop_client_id: int
    period_from: str
    period_to: str


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
