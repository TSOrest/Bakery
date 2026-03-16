"""Pydantic-схеми для цін."""

from __future__ import annotations
from typing import Optional
from pydantic import BaseModel, ConfigDict


class PriceCreate(BaseModel):
    product_id: int
    category_id: Optional[int] = None
    price: float
    valid_from: str        # YYYY-MM-DD
    valid_to: Optional[str] = None


class PriceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    product_id: int
    category_id: Optional[int]
    price: float
    valid_from: str
    valid_to: Optional[str]
    is_active: int


class ClientPriceOverrideCreate(BaseModel):
    client_id: int
    product_id: int
    price: float
    valid_from: str
    valid_to: Optional[str] = None


class ClientPriceOverrideOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    client_id: int
    product_id: int
    price: float
    valid_from: str
    valid_to: Optional[str]
