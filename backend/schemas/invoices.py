"""Pydantic-схеми для накладних."""

from __future__ import annotations
from enum import Enum
from typing import Optional, List
from pydantic import BaseModel, ConfigDict, Field


class InvoiceStatus(str, Enum):
    draft      = "draft"
    sent       = "sent"
    processing = "processing"
    accepted   = "accepted"
    cancelled  = "cancelled"


class InvoiceLineCreate(BaseModel):
    product_id: int = Field(..., example=7)
    qty: float = Field(..., example=10, ge=0)
    price: float = Field(..., example=25.0, ge=0)
    price_override: Optional[float] = Field(None, example=None)
    is_exchange: int = Field(default=0, ge=0, le=1)
    is_stale: int = Field(default=0, ge=0, le=1)


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
    invoice_date: str = Field(..., example="2026-05-14", description="YYYY-MM-DD")
    client_id: int = Field(..., example=42)
    route_id: Optional[int] = Field(None, example=3)
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
