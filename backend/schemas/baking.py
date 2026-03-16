"""Pydantic-схеми для випічки."""

from __future__ import annotations
from typing import Optional
from pydantic import BaseModel, ConfigDict


class BakingTaskOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    task_date: str
    product_id: int
    ordered_qty: float
    recommended_qty: float
    baked_qty: float


class BakingTaskUpdate(BaseModel):
    baked_qty: Optional[float] = None
    recommended_qty: Optional[float] = None


class SurplusAllocationCreate(BaseModel):
    alloc_date: str
    product_id: int
    to_shop: float = 0
    to_route: float = 0
    ration_qty: float = 0
    written_off: float = 0
    notes: Optional[str] = None


class SurplusAllocationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    alloc_date: str
    product_id: int
    to_shop: float
    to_route: float
    ration_qty: float
    written_off: float
    notes: Optional[str]
