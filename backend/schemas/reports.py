"""Схеми для звітних JSON-ендпоінтів (баланси виробів тощо)."""

from typing import List, Optional
from pydantic import BaseModel


class ProductBalanceClientRow(BaseModel):
    client_id: int
    client_name: str
    client_kind: str
    ordered_qty: float = 0       # з orders (для системних клієнтів завжди 0)
    invoiced_qty: float = 0
    invoiced_sum: float = 0
    other_qty: float = 0         # списання+пайок+інше, об'єднано (див. tags)
    other_sum: float = 0
    tags: List[str] = []         # 'exchange'/'stale'/'surplus'/'writeoff'/'ration'/'other'


class ProductBalanceProduct(BaseModel):
    product_id: int
    name: str
    short_name: Optional[str] = None
    # ── Report-parity (ідентично Секції 1 денного звіту) ──
    ordered_qty: float
    baked_qty: float
    baked_entered: bool
    exchange_qty: float
    shop_qty: float
    # ── Розширення дашборду ──
    invoiced_qty: float
    invoiced_sum: float
    writeoff_qty: float
    writeoff_sum: float
    ration_qty: float
    ration_sum: float
    other_qty: float
    other_sum: float
    diff_qty: Optional[float] = None
    clients: List[ProductBalanceClientRow] = []


class ProductBalanceCategory(BaseModel):
    category_id: int
    category_name: str
    ordered_qty: float
    baked_qty: float
    baked_entered: bool
    exchange_qty: float
    shop_qty: float
    invoiced_qty: float
    invoiced_sum: float
    writeoff_qty: float
    writeoff_sum: float
    ration_qty: float
    ration_sum: float
    other_qty: float
    other_sum: float
    diff_qty: Optional[float] = None
    products: List[ProductBalanceProduct] = []


class ProductBalancesOut(BaseModel):
    date: str
    categories: List[ProductBalanceCategory] = []
