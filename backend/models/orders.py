"""Модель замовлень."""

from sqlalchemy import Column, Integer, Text, Real, ForeignKey
from sqlalchemy.orm import relationship
from backend.database import Base


class Order(Base):
    __tablename__ = "orders"

    id             = Column(Integer, primary_key=True, autoincrement=True)
    client_id      = Column(Integer, ForeignKey("clients.id"), nullable=False)
    product_id     = Column(Integer, ForeignKey("products.id"), nullable=False)
    qty            = Column(Real, nullable=False, default=0)
    order_date     = Column(Text, nullable=False)
    status         = Column(Text, default="draft")
    source         = Column(Text, default="phone")
    exchange_type  = Column(Text, default="none")
    exchange_qty   = Column(Real, default=0)
    exchange_price = Column(Real)
    exchange_notes = Column(Text)
    price_override = Column(Real)
    notes          = Column(Text)
    created_at     = Column(Text)
    created_by     = Column(Text)

    client  = relationship("Client")
    product = relationship("Product")
