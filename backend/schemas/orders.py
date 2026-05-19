"""Pydantic-схеми для замовлень."""

from __future__ import annotations
from enum import Enum
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, ConfigDict, Field


class OrderSource(str, Enum):
    phone = "phone"
    paper = "paper"


class ExchangeType(str, Enum):
    none          = "none"
    pre_order     = "pre_order"
    post_delivery = "post_delivery"


class OrderCreate(BaseModel):
    model_config = ConfigDict(use_enum_values=True)
    client_id: int = Field(..., example=42)
    product_id: int = Field(..., example=7)
    qty: float = Field(..., example=10, ge=0)
    order_date: str = Field(..., example="2026-05-14", description="YYYY-MM-DD")
    source: OrderSource = OrderSource.phone
    exchange_type: ExchangeType = ExchangeType.none
    exchange_qty: float = Field(default=0, example=0)
    exchange_price: Optional[float] = Field(None, example=None)
    exchange_notes: Optional[str] = None
    price_override: Optional[float] = Field(None, example=None)
    notes: Optional[str] = Field(None, example=None)
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


# ─── Зведений вид (pivot grid) ────────────────────────────────────────────────


class GridExtraLine(BaseModel):
    """Опис «не-базового» рядка для tooltip клітинки сітки."""
    kind: str = Field(..., description="exchange | discount | transfer_out | transfer_in | surplus")
    qty: float
    price: Optional[float] = None


class GridCell(BaseModel):
    """Одна клітинка сітки клієнти×вироби на конкретну дату."""
    qty: float = 0
    base_order_id: Optional[int] = None
    extra_qty: float = 0
    extra_count: int = 0
    extra_lines: List[GridExtraLine] = []
    has_pending_bot: bool = False


class GridResponse(BaseModel):
    """Матриця замовлень для зведеного виду."""
    order_date: str
    locked_client_ids: List[int] = []
    cells: Dict[int, Dict[int, GridCell]] = Field(
        default_factory=dict,
        description="cells[client_id][product_id] → GridCell",
    )


class BulkUpsertItem(BaseModel):
    """Одна зміна у bulk-операції зведеного виду."""
    client_id: int
    product_id: int
    qty: float = Field(..., ge=0, description="0 → DELETE базового рядка")


class BulkOrderUpsertRequest(BaseModel):
    """Масове збереження замовлень із зведеного виду."""
    order_date: str = Field(..., example="2026-05-19")
    items: List[BulkUpsertItem] = Field(default_factory=list)


class BulkOrderUpsertResponse(BaseModel):
    """Підсумок bulk-апдейту."""
    created: int = 0
    updated: int = 0
    deleted: int = 0
