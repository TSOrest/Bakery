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
    baked_qty: Optional[float] = None  # NULL = не введено, 0 = явно нуль


class BakingTaskUpdate(BaseModel):
    baked_qty: Optional[float] = None
    recommended_qty: Optional[float] = None


