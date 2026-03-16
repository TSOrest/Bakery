"""Моделі скасування рейсів."""

from sqlalchemy import Column, Integer, Text, Real, ForeignKey
from sqlalchemy.orm import relationship
from backend.database import Base


class RouteCancellation(Base):
    __tablename__ = "route_cancellations"

    id           = Column(Integer, primary_key=True, autoincrement=True)
    route_id     = Column(Integer, ForeignKey("routes.id"), nullable=False)
    cancel_date  = Column(Text, nullable=False)
    reason       = Column(Text)
    cancelled_by = Column(Text)
    created_at   = Column(Text)

    route = relationship("Route")
    lines = relationship("CancellationLine", back_populates="cancellation", cascade="all, delete-orphan")


class CancellationLine(Base):
    __tablename__ = "cancellation_lines"

    id                      = Column(Integer, primary_key=True, autoincrement=True)
    cancellation_id         = Column(Integer, ForeignKey("route_cancellations.id"), nullable=False)
    product_id              = Column(Integer, ForeignKey("products.id"), nullable=False)
    qty                     = Column(Real, nullable=False)
    disposition             = Column(Text, nullable=False)  # to_shop | to_next_day | writeoff
    next_day_price_override = Column(Real)

    cancellation = relationship("RouteCancellation", back_populates="lines")
    product      = relationship("Product")
