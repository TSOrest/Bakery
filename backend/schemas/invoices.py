"""Pydantic-схеми для накладних."""

from __future__ import annotations
from enum import Enum
from typing import Optional, List
from pydantic import BaseModel, ConfigDict


class InvoiceStatus(str, Enum):
    draft      = "draft"
    sent       = "sent"
    processing = "processing"
    accepted   = "accepted"
    cancelled  = "cancelled"


class InvoiceLineCreate(BaseModel):
    product_id: int
    qty: float
    price: float
    price_override: Optional[float] = None
    is_exchange: int = 0
    is_stale: int = 0


class InvoiceLineQtyUpdate(BaseModel):
    """Оновлення кількості рядка накладної (тільки в статусі draft)."""
    id: int
    qty: float


class InvoiceLinesUpdate(BaseModel):
    lines: List[InvoiceLineQtyUpdate]


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


class CorrectiveLineIn(BaseModel):
    """Рядок для коригуючої накладної: фактична кількість прийнятого."""
    product_id: int
    qty_delivered: float
    price_override: Optional[float] = None


class ProcessingUpdate(BaseModel):
    """Дані при завершенні Опрацювання: фактичні кількості + оплата."""
    payment_amount: float = 0.0   # оплата клієнта (0 = не оплачено)
    cash_received: float = 0.0    # deprecated, залишено для сумісності
    notes: Optional[str] = None
    lines: List[CorrectiveLineIn] = []


class AcceptBody(BaseModel):
    """Тіло для прийняття накладної з сумою оплати."""
    payment_amount: float = 0.0


class InvoiceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    invoice_number: str
    invoice_date: str
    client_id: int
    route_id: Optional[int]
    status: str
    corrective_for_id: Optional[int]
    total_sum: float
    notes: Optional[str]
    lines: List[InvoiceLineOut] = []
