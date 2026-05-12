"""Pydantic-схеми для довідників."""

from __future__ import annotations
from typing import Optional
from pydantic import BaseModel, ConfigDict, Field


# --- Units ---

class UnitUpdate(BaseModel):
    name: Optional[str] = None
    is_active: Optional[int] = None


class UnitOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    is_active: Optional[int] = 1


# --- Categories ---

class CategoryUpdate(BaseModel):
    name: Optional[str] = None
    is_active: Optional[int] = None
    is_baked: Optional[int] = None
    reserve_pct: Optional[float] = None
    sort_order: Optional[int] = None


class CategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    is_active: Optional[int] = 1
    is_baked: Optional[int] = 1
    reserve_pct: Optional[float] = 5.0
    sort_order: Optional[int] = 0


# --- Products ---

class ProductCreate(BaseModel):
    name: str
    short_name: Optional[str] = None
    weight: Optional[float] = None
    unit_id: Optional[int] = None
    category_id: Optional[int] = None
    is_active: int = 1
    initial_stock: float = 0


class ProductUpdate(BaseModel):
    name: Optional[str] = None
    short_name: Optional[str] = None
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
    weight: Optional[float]
    unit_id: Optional[int]
    category_id: Optional[int]
    cost_per_unit: Optional[float] = 0
    is_active: Optional[int] = 1
    initial_stock: Optional[float] = 0


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
    purchase_price: Optional[float] = 0
    sell_price: Optional[float] = 0
    is_active: Optional[int] = 1


# --- Routes ---

class RouteCreate(BaseModel):
    name: str
    sort_order: int = 0


class RouteOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    sort_order: Optional[int] = 0
    is_active: Optional[int] = 1


# --- Clients ---

class ClientCreate(BaseModel):
    full_name: str = Field(..., example="ФОП Брунько О.І.", max_length=200)
    short_name: Optional[str] = Field(None, example="Брунько", max_length=100)
    address: Optional[str] = Field(None, example="вул. Шевченка 15, м. Львів", max_length=300)
    phone: Optional[str] = Field(None, example="+380501234567", max_length=50)
    director: Optional[str] = Field(None, example="Брунько О.І.", max_length=200)
    accountant: Optional[str] = None
    route_id: Optional[int] = Field(None, example=3)
    discount_pct: float = Field(default=0, example=5.0, ge=0, le=100)
    is_own_shop: int = Field(default=0, ge=0, le=1)
    print_invoice: int = Field(default=1, ge=0, le=1)
    receiver_name: Optional[str] = None
    delivery_agent: Optional[str] = None
    delivery_note_number: Optional[str] = None
    delivery_note_date: Optional[str] = None
    client_group: Optional[str] = None
    client_kind: str = Field(
        default='customer',
        example='customer',
        description="customer | shop | writeoff | ration | underbaked",
    )
    bot_phones: Optional[str] = Field(
        None, example="+380501234567,+380671234567",
        description="Номери для авторизації у боті (через кому)",
    )


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
    bot_phones: Optional[str] = None


class ClientOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    full_name: str
    short_name: Optional[str]
    address: Optional[str]
    phone: Optional[str]
    route_id: Optional[int]
    # Default — float, але з БД може прийти None для legacy-записів
    discount_pct: Optional[float] = 0
    is_active: Optional[int] = 1
    is_own_shop: Optional[int] = 0
    print_invoice: Optional[int] = 1
    receiver_name: Optional[str]
    delivery_agent: Optional[str]
    delivery_note_number: Optional[str]
    delivery_note_date: Optional[str]
    client_group: Optional[str]
    client_kind: str = 'customer'  # customer | shop | writeoff | ration | underbaked
    bot_phones: Optional[str] = None
