"""Моделі руху товару та щоденних залишків."""

from sqlalchemy import Column, Integer, Text, Real, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship
from backend.database import Base


class Movement(Base):
    __tablename__ = "movements"

    id           = Column(Integer, primary_key=True, autoincrement=True)
    move_date    = Column(Text, nullable=False)
    product_id   = Column(Integer, ForeignKey("products.id"), nullable=False)
    move_type    = Column(Text, nullable=False)
    qty          = Column(Real, nullable=False)
    is_stale     = Column(Integer, default=0)
    price        = Column(Real)
    source_table = Column(Text)
    source_id    = Column(Integer)
    route_id     = Column(Integer, ForeignKey("routes.id"))
    client_id    = Column(Integer, ForeignKey("clients.id"))
    notes        = Column(Text)
    created_at   = Column(Text)

    product = relationship("Product")


class DailyBalance(Base):
    __tablename__ = "daily_balances"
    __table_args__ = (UniqueConstraint("balance_date", "product_id", "is_stale"),)

    id            = Column(Integer, primary_key=True, autoincrement=True)
    balance_date  = Column(Text, nullable=False)
    product_id    = Column(Integer, ForeignKey("products.id"), nullable=False)
    is_stale      = Column(Integer, default=0)
    start_balance = Column(Real, default=0)
    received      = Column(Real, default=0)
    sold          = Column(Real, default=0)
    written_off   = Column(Real, default=0)
    end_balance   = Column(Real, default=0)
    computed_at   = Column(Text)

    product = relationship("Product")
