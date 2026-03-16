"""Моделі магазину: щоденна звірка та надходження товарів групи ІНШЕ."""

from sqlalchemy import Column, Integer, Text, Float, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship
from backend.database import Base


class ShopCount(Base):
    __tablename__ = "shop_counts"
    __table_args__ = (UniqueConstraint("count_date", "product_id", "product_type"),)

    id                  = Column(Integer, primary_key=True, autoincrement=True)
    count_date          = Column(Text, nullable=False)
    product_id          = Column(Integer, ForeignKey("products.id"), nullable=False)
    product_type        = Column(Text, default="bread")  # bread | stale | other
    yesterday_balance   = Column(Float, default=0)
    received_today      = Column(Float, default=0)
    entered_balance     = Column(Float)
    written_off_entered = Column(Float, default=0)
    calculated_sold     = Column(Float)
    price               = Column(Float)
    saved               = Column(Integer, default=0)

    product = relationship("Product")


class OtherStockIn(Base):
    __tablename__ = "other_stock_in"

    id               = Column(Integer, primary_key=True, autoincrement=True)
    stock_date       = Column(Text, nullable=False)
    other_product_id = Column(Integer, ForeignKey("other_products.id"), nullable=False)
    qty              = Column(Float, nullable=False)
    purchase_price   = Column(Float)
    notes            = Column(Text)
    created_at       = Column(Text)

    other_product = relationship("OtherProduct")
