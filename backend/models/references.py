"""Моделі довідників: одиниці, категорії, вироби, інгредієнти, маршрути, клієнти."""

from sqlalchemy import Column, Integer, Text, Float, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship
from backend.database import Base


class Unit(Base):
    __tablename__ = "units"

    id        = Column(Integer, primary_key=True, autoincrement=True)
    name      = Column(Text, nullable=False, unique=True)
    is_active = Column(Integer, default=1)


class Category(Base):
    __tablename__ = "categories"

    id        = Column(Integer, primary_key=True, autoincrement=True)
    name      = Column(Text, nullable=False, unique=True)
    is_active = Column(Integer, default=1)


class Product(Base):
    __tablename__ = "products"

    id            = Column(Integer, primary_key=True, autoincrement=True)
    name          = Column(Text, nullable=False)
    short_name    = Column(Text)
    type          = Column(Text, nullable=False)   # bread | bun | other
    weight        = Column(Float)
    unit_id       = Column(Integer, ForeignKey("units.id"))
    category_id   = Column(Integer, ForeignKey("categories.id"))
    cost_per_unit = Column(Float, default=0)
    is_active     = Column(Integer, default=1)
    created_at    = Column(Text)
    initial_stock = Column(Float, default=0)       # початковий залишок для першої звірки

    unit     = relationship("Unit")
    category = relationship("Category")
    ingredients = relationship("ProductIngredient", back_populates="product")


class Ingredient(Base):
    __tablename__ = "ingredients"

    id               = Column(Integer, primary_key=True, autoincrement=True)
    name             = Column(Text, nullable=False)
    unit_id          = Column(Integer, ForeignKey("units.id"))
    price_per_unit   = Column(Float, default=0)
    price_updated_at = Column(Text)

    unit = relationship("Unit")


class ProductIngredient(Base):
    __tablename__ = "product_ingredients"
    __table_args__ = (UniqueConstraint("product_id", "ingredient_id"),)

    id            = Column(Integer, primary_key=True, autoincrement=True)
    product_id    = Column(Integer, ForeignKey("products.id"), nullable=False)
    ingredient_id = Column(Integer, ForeignKey("ingredients.id"), nullable=False)
    qty_per_unit  = Column(Float, nullable=False)

    product    = relationship("Product", back_populates="ingredients")
    ingredient = relationship("Ingredient")


class OtherProduct(Base):
    __tablename__ = "other_products"

    id             = Column(Integer, primary_key=True, autoincrement=True)
    name           = Column(Text, nullable=False)
    unit_id        = Column(Integer, ForeignKey("units.id"))
    purchase_price = Column(Float, default=0)
    sell_price     = Column(Float, default=0)
    is_active      = Column(Integer, default=1)

    unit = relationship("Unit")


class Route(Base):
    __tablename__ = "routes"

    id         = Column(Integer, primary_key=True, autoincrement=True)
    name       = Column(Text, nullable=False)
    sort_order = Column(Integer, default=0)
    is_active  = Column(Integer, default=1)

    clients = relationship("Client", back_populates="route")


class Client(Base):
    __tablename__ = "clients"

    id                   = Column(Integer, primary_key=True, autoincrement=True)
    full_name            = Column(Text, nullable=False)
    short_name           = Column(Text)
    address              = Column(Text)
    phone                = Column(Text)
    director             = Column(Text)
    accountant           = Column(Text)
    route_id             = Column(Integer, ForeignKey("routes.id"))
    discount_pct         = Column(Float, default=0)
    is_active            = Column(Integer, default=1)
    created_at           = Column(Text)
    # Нові поля фази 3.5
    is_own_shop          = Column(Integer, default=0)   # 1 = власний магазин пекарні
    print_invoice        = Column(Integer, default=1)   # 1 = друкувати накладну
    receiver_name        = Column(Text)                 # ПІБ того хто приймає товар
    delivery_agent       = Column(Text)                 # через кого відправляється
    delivery_note_number = Column(Text)                 # номер доручення
    delivery_note_date   = Column(Text)                 # дата доручення
    client_group         = Column(Text)                 # підгрупа в маршруті
    # customer=звичайний, shop=власний магазин, writeoff=списання, ration=пайок
    client_kind          = Column(Text, default='customer')
    bot_chat_id          = Column(Text)                     # Telegram chat ID клієнта

    route = relationship("Route", back_populates="clients")
