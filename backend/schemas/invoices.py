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
    line_kind: str = Field(default="normal", example="normal")  # normal|exchange|stale|surplus


class InvoiceLineQtyUpdate(BaseModel):
    """Оновлення кількості рядка накладної."""
    id: int
    qty: float
    price_override: Optional[float] = None


class InvoiceLinesUpdate(BaseModel):
    lines: List[InvoiceLineQtyUpdate]


class InvoiceTransferCreate(BaseModel):
    """Переміщення товару з цієї накладної на іншого клієнта/магазин/систему."""
    product_id: int
    qty: float = Field(..., gt=0)
    to_client_id: int
    notes: Optional[str] = None


class SetSurplusBody(BaseModel):
    """Долити/змінити/видалити надлишок випічки у накладну магазину (line_kind='surplus').

    qty = абсолютна кількість надлишку цього виробу в накладній магазину; 0 = видалити рядок.
    """
    shop_client_id: int
    product_id: int
    qty: float = Field(..., ge=0)
    date: str
    notes: Optional[str] = None


class InvoiceTransferOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    transfer_date: str
    source_invoice_id: int
    target_invoice_id: int
    product_id: int
    qty: float
    notes: Optional[str] = None
    # Збагачені поля (заповнюються у роутері)
    direction: Optional[str] = None          # 'out' | 'in' відносно запитаної накладної
    counterparty_name: Optional[str] = None  # назва клієнта-контрагента
    counterparty_kind: Optional[str] = None  # client_kind контрагента (для виноски «Знято недопечене»)


class InvoiceLineOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    product_id: int
    qty: float
    price: float
    price_override: Optional[float]
    line_kind: str
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
    # Переміщення товару (для анотацій "куди/звідки"); заповнюється у GET /{id}
    transfers: List[InvoiceTransferOut] = []
