"""Pydantic-схеми для замовлень."""

from __future__ import annotations
from enum import Enum
from typing import List, Optional
from pydantic import BaseModel, ConfigDict


class OrderSource(str, Enum):
    phone = "phone"
    paper = "paper"


class ExchangeType(str, Enum):
    none          = "none"
    pre_order     = "pre_order"
    post_delivery = "post_delivery"


class OrderCreate(BaseModel):
    model_config = ConfigDict(use_enum_values=True)
    client_id: int
    product_id: int
    qty: float
    order_date: str                         # YYYY-MM-DD
    source: OrderSource = OrderSource.phone
    exchange_type: ExchangeType = ExchangeType.none
    exchange_qty: float = 0
    exchange_price: Optional[float] = None
    exchange_notes: Optional[str] = None
    price_override: Optional[float] = None
    notes: Optional[str] = None
    parent_order_id: Optional[int] = None
    delivered_qty: Optional[float] = None
    origin_id: Optional[int] = None


class OrderUpdate(BaseModel):
    model_config = ConfigDict(use_enum_values=True)
    qty: Optional[float] = None
    exchange_type: Optional[ExchangeType] = None
    exchange_qty: Optional[float] = None
    exchange_price: Optional[float] = None
    exchange_notes: Optional[str] = None
    price_override: Optional[float] = None
    notes: Optional[str] = None
    delivered_qty: Optional[float] = None


class OrderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    client_id: int
    product_id: int
    qty: float
    order_date: str
    source: str
    exchange_type: str
    exchange_qty: float
    exchange_price: Optional[float]
    exchange_notes: Optional[str]
    price_override: Optional[float]
    notes: Optional[str]
    created_at: Optional[str]
    parent_order_id: Optional[int]
    delivered_qty: Optional[float]
    origin_id: Optional[int]
    bot_status: Optional[str]
    bot_rejection_reason: Optional[str]
    bot_original_qty: Optional[float]


class TransferRequest(BaseModel):
    to_client_id: int
    qty: float
    notes: Optional[str] = None


class OrderWithChildrenOut(OrderOut):
    children: List[OrderOut] = []
