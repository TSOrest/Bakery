"""Pydantic-схеми для API."""

from backend.schemas.references import (
    UnitOut, CategoryOut,
    ProductCreate, ProductUpdate, ProductOut,
    IngredientCreate, IngredientOut,
    OtherProductCreate, OtherProductOut,
    RouteCreate, RouteOut,
    ClientCreate, ClientUpdate, ClientOut,
)
from backend.schemas.pricing import (
    PriceCreate, PriceOut,
    ClientPriceOverrideCreate, ClientPriceOverrideOut,
)
from backend.schemas.orders import (
    OrderCreate, OrderUpdate, OrderOut,
)
from backend.schemas.baking import (
    BakingTaskOut, BakingTaskUpdate,
)
from backend.schemas.invoices import (
    InvoiceCreate, InvoiceOut, InvoiceLineCreate,
)

__all__ = [
    "UnitOut", "CategoryOut",
    "ProductCreate", "ProductUpdate", "ProductOut",
    "IngredientCreate", "IngredientOut",
    "OtherProductCreate", "OtherProductOut",
    "RouteCreate", "RouteOut",
    "ClientCreate", "ClientUpdate", "ClientOut",
    "PriceCreate", "PriceOut",
    "ClientPriceOverrideCreate", "ClientPriceOverrideOut",
    "OrderCreate", "OrderUpdate", "OrderOut",
    "BakingTaskOut", "BakingTaskUpdate",
    "InvoiceCreate", "InvoiceOut", "InvoiceLineCreate",
]
