"""Моделі цін: базові ціни та індивідуальні ціни клієнтів."""

from sqlalchemy import Column, Integer, Text, Float, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship
from backend.database import Base


class Price(Base):
    __tablename__ = "prices"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    product_id  = Column(Integer, ForeignKey("products.id"), nullable=False)
    category_id = Column(Integer, ForeignKey("categories.id"))
    price       = Column(Float, nullable=False)
    valid_from  = Column(Text, nullable=False)
    valid_to    = Column(Text)
    is_active   = Column(Integer, default=1)
    created_at  = Column(Text)
    created_by  = Column(Text)

    product  = relationship("Product")
    category = relationship("Category")


class ClientPriceOverride(Base):
    __tablename__ = "client_price_overrides"
    __table_args__ = (UniqueConstraint("client_id", "product_id", "valid_from"),)

    id         = Column(Integer, primary_key=True, autoincrement=True)
    client_id  = Column(Integer, ForeignKey("clients.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    price      = Column(Float, nullable=False)
    valid_from = Column(Text, nullable=False)
    valid_to   = Column(Text)

    client  = relationship("Client")
    product = relationship("Product")
