"""Моделі накладних."""

from sqlalchemy import Column, Integer, Text, Real, ForeignKey
from sqlalchemy.orm import relationship
from backend.database import Base


class Invoice(Base):
    __tablename__ = "invoices"

    id             = Column(Integer, primary_key=True, autoincrement=True)
    invoice_number = Column(Text, nullable=False, unique=True)
    invoice_date   = Column(Text, nullable=False)
    route_id       = Column(Integer, ForeignKey("routes.id"))
    client_id      = Column(Integer, ForeignKey("clients.id"), nullable=False)
    status         = Column(Text, default="draft")
    total_sum      = Column(Real, default=0)
    notes          = Column(Text)
    created_at     = Column(Text)

    client = relationship("Client")
    route  = relationship("Route")
    lines  = relationship("InvoiceLine", back_populates="invoice", cascade="all, delete-orphan")


class InvoiceLine(Base):
    __tablename__ = "invoice_lines"

    id             = Column(Integer, primary_key=True, autoincrement=True)
    invoice_id     = Column(Integer, ForeignKey("invoices.id", ondelete="CASCADE"), nullable=False)
    product_id     = Column(Integer, ForeignKey("products.id"), nullable=False)
    qty            = Column(Real, nullable=False)
    price          = Column(Real, nullable=False)
    price_override = Column(Real)
    is_exchange    = Column(Integer, default=0)
    is_stale       = Column(Integer, default=0)
    sum            = Column(Real, nullable=False)

    invoice = relationship("Invoice", back_populates="lines")
    product = relationship("Product")
