"""Моделі накладних."""

from sqlalchemy import Column, Integer, Text, Float, ForeignKey
from sqlalchemy.orm import relationship
from backend.database import Base


class Invoice(Base):
    __tablename__ = "invoices"

    id                = Column(Integer, primary_key=True, autoincrement=True)
    invoice_number    = Column(Text, nullable=False, unique=True)
    invoice_date      = Column(Text, nullable=False)
    route_id          = Column(Integer, ForeignKey("routes.id"))
    client_id         = Column(Integer, ForeignKey("clients.id"), nullable=False)
    status            = Column(Text, default="draft")   # draft|sent|processing|accepted|cancelled
    corrective_for_id = Column(Integer, ForeignKey("invoices.id"), nullable=True)
    total_sum         = Column(Float, default=0)
    notes             = Column(Text)
    created_at        = Column(Text)

    client         = relationship("Client")
    route          = relationship("Route")
    lines          = relationship("InvoiceLine", back_populates="invoice", cascade="all, delete-orphan")
    corrective_for = relationship(
        "Invoice",
        remote_side="Invoice.id",
        foreign_keys=[corrective_for_id],
        backref="correctives",
    )


class InvoiceLine(Base):
    __tablename__ = "invoice_lines"

    id             = Column(Integer, primary_key=True, autoincrement=True)
    invoice_id     = Column(Integer, ForeignKey("invoices.id", ondelete="CASCADE"), nullable=False)
    product_id     = Column(Integer, ForeignKey("products.id"), nullable=False)
    qty            = Column(Float, nullable=False)
    price          = Column(Float, nullable=False)
    price_override = Column(Float)
    is_exchange    = Column(Integer, default=0)
    is_stale       = Column(Integer, default=0)
    sum            = Column(Float, nullable=False)

    invoice = relationship("Invoice", back_populates="lines")
    product = relationship("Product")


class InvoiceTransfer(Base):
    """Запис переміщення товару між накладними (стадія Маршрутів).

    Корекція накладної = пряме редагування рядків + запис тут.
    Дає анотації "куди пішло / звідки прийшло" на обох накладних.
    """
    __tablename__ = "invoice_transfers"

    id                = Column(Integer, primary_key=True, autoincrement=True)
    transfer_date     = Column(Text, nullable=False)
    source_invoice_id = Column(Integer, ForeignKey("invoices.id", ondelete="CASCADE"), nullable=False)
    target_invoice_id = Column(Integer, ForeignKey("invoices.id", ondelete="CASCADE"), nullable=False)
    product_id        = Column(Integer, ForeignKey("products.id"), nullable=False)
    qty               = Column(Float, nullable=False)
    notes             = Column(Text)
    created_at        = Column(Text)
    created_by        = Column(Text)

    source_invoice = relationship("Invoice", foreign_keys=[source_invoice_id])
    target_invoice = relationship("Invoice", foreign_keys=[target_invoice_id])
    product        = relationship("Product")
