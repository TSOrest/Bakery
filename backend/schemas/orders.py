"""Pydantic-схеми для замовлень."""

from __future__ import annotations
from typing import Optional
from pydantic import BaseModel, ConfigDict


class OrderCreate(BaseModel):
    client_id: int
    product_id: int
    qty: float
    order_date: str                     # YYYY-MM-DD
    source: str = "phone"
    exchange_type: str = "none"
    exchange_qty: float = 0
    exchange_price: Optional[float] = None
    exchange_notes: Optional[str] = None
    price_override: Optional[float] = None
    notes: Optional[str] = None


class OrderUpdate(BaseModel):
    qty: Optional[float] = None
    status: Optional[str] = None
    exchange_type: Optional[str] = None
    exchange_qty: Optional[float] = None
    exchange_price: Optional[float] = None
    exchange_notes: Optional[str] = None
    price_override: Optional[float] = None
    notes: Optional[str] = None


class OrderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    client_id: int
    product_id: int
    qty: float
    order_date: str
    status: str
    source: str
    exchange_type: str
    exchange_qty: float
    exchange_price: Optional[float]
    exchange_notes: Optional[str]
    price_override: Optional[float]
    notes: Optional[str]
    created_at: Optional[str]
