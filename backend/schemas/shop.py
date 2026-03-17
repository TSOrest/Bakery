"""Pydantic-схеми для магазину."""

from __future__ import annotations
from typing import Optional
from pydantic import BaseModel, ConfigDict


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
