"""Pydantic-схеми для цін."""

from __future__ import annotations
from typing import Optional, List
from pydantic import BaseModel, ConfigDict, field_validator


class PriceCreate(BaseModel):
    product_id:  int
    category_id: Optional[int] = None
    price:       float
    valid_from:  str        # YYYY-MM-DD
    valid_to:    Optional[str] = None


class PriceReplaceRequest(BaseModel):
    """Закриває стару ціну і відкриває нову з effective_date."""
    old_price_id:   int
    price:          float
    effective_date: str     # YYYY-MM-DD

    @field_validator("price")
    @classmethod
    def positive(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("Ціна має бути > 0")
        return round(v, 4)


class BulkChangeRequest(BaseModel):
    """Масова % зміна всіх активних цін."""
    pct:                  float          # +10 або -5
    effective_date:       str            # YYYY-MM-DD — з якої дати нові ціни
    excluded_product_ids: List[int] = [] # вироби, які виключити зі зміни


class BulkChangePreviewItem(BaseModel):
    product_id:     int
    product_name:   str
    old_price:      float
    new_price:      float
    valid_from:     str             # дата початку поточної ціни
    has_collision:  bool = False    # вже є ціна з valid_from >= effective_date
    collision_date: Optional[str] = None  # дата конфліктної ціни


class BulkChangePreview(BaseModel):
    items: List[BulkChangePreviewItem]


class PriceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id:          int
    product_id:  int
    category_id: Optional[int]
    price:       float
    valid_from:  str
    valid_to:    Optional[str]
    is_active:   int


class ClientPriceOverrideCreate(BaseModel):
    client_id:   int
    product_id:  int
    price:       float
    valid_from:  str
    valid_to:    Optional[str] = None


class ClientPriceOverrideOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id:          int
    client_id:   int
    product_id:  int
    price:       float
    valid_from:  str
    valid_to:    Optional[str]
