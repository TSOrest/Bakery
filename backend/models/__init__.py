"""Імпорт усіх моделей — необхідно для Base.metadata.create_all()."""

from backend.models.references import (
    Unit, Category, Product, Ingredient, ProductIngredient,
    OtherProduct, Route, Client,
)
from backend.models.pricing import Price, ClientPriceOverride
from backend.models.orders import Order
from backend.models.baking import BakingTask, SurplusAllocation, SurplusAllocationLine
from backend.models.invoices import Invoice, InvoiceLine
from backend.models.movements import Movement, DailyBalance
from backend.models.shop import ShopCount, OtherStockIn
from backend.models.finances import Finance
from backend.models.settings import Setting
from backend.models.cancellations import RouteCancellation, CancellationLine

__all__ = [
    "Unit", "Category", "Product", "Ingredient", "ProductIngredient",
    "OtherProduct", "Route", "Client",
    "Price", "ClientPriceOverride",
    "Order",
    "BakingTask", "SurplusAllocation", "SurplusAllocationLine",
    "Invoice", "InvoiceLine",
    "Movement", "DailyBalance",
    "ShopCount", "OtherStockIn",
    "Finance",
    "Setting",
    "RouteCancellation", "CancellationLine",
]
