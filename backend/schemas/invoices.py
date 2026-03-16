"""Pydantic-схеми для накладних."""

from __future__ import annotations
from typing import Optional, List
from pydantic import BaseModel, ConfigDict


class InvoiceLineCreate(BaseModel):
    product_id: int
    qty: float
    price: float
    price_override: Optional[float] = None
    is_exchange: int = 0
    is_stale: int = 0


class InvoiceLineOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    product_id: int
    qty: float
    price: float
    price_override: Optional[float]
    is_exchange: int
    is_stale: int
    sum: float


class InvoiceCreate(BaseModel):
    invoice_date: str
    client_id: int
    route_id: Optional[int] = None
    notes: Optional[str] = None
    lines: List[InvoiceLineCreate] = []


class InvoiceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    invoice_number: str
    invoice_date: str
    client_id: int
    route_id: Optional[int]
    status: str
    total_sum: float
    notes: Optional[str]
    lines: List[InvoiceLineOut] = []
