"""Модель замовлень."""

from sqlalchemy import Column, Integer, Text, Float, ForeignKey
from sqlalchemy.orm import relationship, backref
from backend.database import Base


class Order(Base):
    __tablename__ = "orders"

    id               = Column(Integer, primary_key=True, autoincrement=True)
    client_id        = Column(Integer, ForeignKey("clients.id"), nullable=False)
    product_id       = Column(Integer, ForeignKey("products.id"), nullable=False)
    qty              = Column(Float, nullable=False, default=0)
    order_date       = Column(Text, nullable=False)
    status           = Column(Text, default="draft")
    source           = Column(Text, default="phone")
    exchange_type    = Column(Text, default="none")
    exchange_qty     = Column(Float, default=0)
    exchange_price   = Column(Float)
    exchange_notes   = Column(Text)
    price_override   = Column(Float)
    notes            = Column(Text)
    created_at       = Column(Text)
    created_by       = Column(Text)
    # Split-замовлення: дочірній рядок посилається на батьківський
    parent_order_id      = Column(Integer, ForeignKey("orders.id"), nullable=True)
    delivered_qty        = Column(Float, nullable=True)
    bot_status           = Column(Text, nullable=True)   # pending|confirmed|rejected|modified
    bot_rejection_reason = Column(Text, nullable=True)
    bot_original_qty     = Column(Float, nullable=True)  # кількість до модифікації оператором
    placed_by_chat_id    = Column(Text, nullable=True)   # chat_id користувача який подав через бота

    client   = relationship("Client")
    product  = relationship("Product")
    children = relationship(
        "Order",
        backref=backref("parent", remote_side="Order.id"),
        foreign_keys="Order.parent_order_id",
    )
