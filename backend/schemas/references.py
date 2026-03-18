"""Pydantic-схеми для довідників."""

from __future__ import annotations
from enum import Enum
from typing import Optional
from pydantic import BaseModel, ConfigDict


class ProductType(str, Enum):
    bread = "bread"
    bun   = "bun"
    other = "other"


# --- Units ---

class UnitUpdate(BaseModel):
    name: Optional[str] = None
    is_active: Optional[int] = None


class UnitOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    is_active: int


# --- Categories ---

class CategoryUpdate(BaseModel):
    name: Optional[str] = None
    is_active: Optional[int] = None


class CategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    is_active: int


# --- Products ---

class ProductCreate(BaseModel):
    model_config = ConfigDict(use_enum_values=True)
    name: str
    short_name: Optional[str] = None
    type: ProductType
    weight: Optional[float] = None
    unit_id: Optional[int] = None
    category_id: Optional[int] = None
    is_active: int = 1
    initial_stock: float = 0


class ProductUpdate(BaseModel):
    model_config = ConfigDict(use_enum_values=True)
    name: Optional[str] = None
    short_name: Optional[str] = None
    type: Optional[ProductType] = None
    weight: Optional[float] = None
    unit_id: Optional[int] = None
    category_id: Optional[int] = None
    cost_per_unit: Optional[float] = None
    is_active: Optional[int] = None
    initial_stock: Optional[float] = None


class ProductOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    short_name: Optional[str]
    type: str
    weight: Optional[float]
    unit_id: Optional[int]
    category_id: Optional[int]
    cost_per_unit: float
    is_active: int
    initial_stock: float


# --- Ingredients ---

class IngredientCreate(BaseModel):
    name: str
    unit_id: Optional[int] = None
    price_per_unit: float = 0


class IngredientOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    unit_id: Optional[int]
    price_per_unit: float
    price_updated_at: Optional[str]


# --- OtherProducts ---

class OtherProductCreate(BaseModel):
    name: str
    unit_id: Optional[int] = None
    purchase_price: float = 0
    sell_price: float = 0


class OtherProductOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    unit_id: Optional[int]
    purchase_price: float
    sell_price: float
    is_active: int


# --- Routes ---

class RouteCreate(BaseModel):
    name: str
    sort_order: int = 0


class RouteOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    sort_order: int
    is_active: int


# --- Clients ---

class ClientCreate(BaseModel):
    full_name: str
    short_name: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    director: Optional[str] = None
    accountant: Optional[str] = None
    route_id: Optional[int] = None
    discount_pct: float = 0
    is_own_shop: int = 0
    print_invoice: int = 1
    receiver_name: Optional[str] = None
    delivery_agent: Optional[str] = None
    delivery_note_number: Optional[str] = None
    delivery_note_date: Optional[str] = None
    client_group: Optional[str] = None
    client_kind: str = 'customer'


class ClientUpdate(BaseModel):
    full_name: Optional[str] = None
    short_name: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    director: Optional[str] = None
    accountant: Optional[str] = None
    route_id: Optional[int] = None
    discount_pct: Optional[float] = None
    is_active: Optional[int] = None
    is_own_shop: Optional[int] = None
    print_invoice: Optional[int] = None
    receiver_name: Optional[str] = None
    delivery_agent: Optional[str] = None
    delivery_note_number: Optional[str] = None
    delivery_note_date: Optional[str] = None
    client_group: Optional[str] = None
    client_kind: Optional[str] = None


class ClientOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    full_name: str
    short_name: Optional[str]
    address: Optional[str]
    phone: Optional[str]
    route_id: Optional[int]
    discount_pct: float
    is_active: int
    is_own_shop: int
    print_invoice: int
    receiver_name: Optional[str]
    delivery_agent: Optional[str]
    delivery_note_number: Optional[str]
    delivery_note_date: Optional[str]
    client_group: Optional[str]
    client_kind: str = 'customer'
