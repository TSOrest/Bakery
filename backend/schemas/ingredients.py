"""Pydantic-схеми для інгредієнтів і складу виробів."""

from __future__ import annotations
from typing import Optional, List
from pydantic import BaseModel, ConfigDict


class IngredientCreate(BaseModel):
    name:          str
    unit_id:       Optional[int] = None
    price_per_unit: float = 0.0


class IngredientUpdate(BaseModel):
    name:           Optional[str]   = None
    unit_id:        Optional[int]   = None
    price_per_unit: Optional[float] = None


class IngredientOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id:               int
    name:             str
    unit_id:          Optional[int]
    price_per_unit:   float
    price_updated_at: Optional[str]


# ── Склад виробу ──────────────────────────────────────────────────────────────

class ProductIngredientCreate(BaseModel):
    ingredient_id: int
    qty_per_unit:  float   # кількість інгредієнта на одиницю виробу


class ProductIngredientOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id:              int
    product_id:      int
    ingredient_id:   int
    qty_per_unit:    float
    ingredient_name: str = ""
    unit_name:       str = ""
    price_per_unit:  float = 0.0
    line_cost:       float = 0.0   # qty_per_unit * price_per_unit


# ── Звіт маржі ────────────────────────────────────────────────────────────────

class MarginRow(BaseModel):
    product_id:    int
    product_name:  str
    cost_per_unit: float
    price:         float   # поточна активна ціна (0 якщо не задана)
    margin_grn:    float   # price - cost
    margin_pct:    float   # margin / price * 100  (0 якщо price=0)


class MarginReport(BaseModel):
    rows: List[MarginRow]
