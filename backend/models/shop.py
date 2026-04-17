"""Моделі магазину: звірки, надходження ззовні."""

from sqlalchemy import Column, Integer, Text, Float, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship
from backend.database import Base


class ShopCount(Base):
    """Стара щоденна звірка (залишається для сумісності з наявними даними)."""
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
    """Стара таблиця надходжень для other_products (залишається для сумісності)."""
    __tablename__ = "other_stock_in"

    id               = Column(Integer, primary_key=True, autoincrement=True)
    stock_date       = Column(Text, nullable=False)
    other_product_id = Column(Integer, ForeignKey("other_products.id"), nullable=False)
    qty              = Column(Float, nullable=False)
    purchase_price   = Column(Float)
    notes            = Column(Text)
    created_at       = Column(Text)

    other_product = relationship("OtherProduct")


class ShopReconciliation(Base):
    """Звірка магазину за гнучкий період (денна / тижнева / місячна)."""
    __tablename__ = "shop_reconciliations"

    id              = Column(Integer, primary_key=True, autoincrement=True)
    shop_client_id  = Column(Integer, ForeignKey("clients.id"), nullable=False)
    period_from     = Column(Text, nullable=False)
    period_to       = Column(Text, nullable=False)
    cash_expected   = Column(Float, default=0)   # авто: сума (sold * price)
    cash_actual     = Column(Float)              # введено оператором
    cash_diff       = Column(Float)              # cash_actual - cash_expected
    notes           = Column(Text)
    closed          = Column(Integer, default=0)
    closed_at       = Column(Text)
    closed_by       = Column(Text)
    created_at      = Column(Text)
    rec_type        = Column(Text, default='regular')  # 'regular' | 'opening' | 'archive'

    lines = relationship(
        "ShopReconciliationLine",
        back_populates="reconciliation",
        cascade="all, delete-orphan",
        order_by="ShopReconciliationLine.product_id, ShopReconciliationLine.batch_date",
    )
    shop = relationship("Client", foreign_keys=[shop_client_id])


class ShopReconciliationLine(Base):
    """Рядок звірки магазину (один виріб / одна партія)."""
    __tablename__ = "shop_reconciliation_lines"
    # Uniqueness забезпечується partial indexes у БД (batch_date=NULL і batch_date IS NOT NULL)

    id                = Column(Integer, primary_key=True, autoincrement=True)
    reconciliation_id = Column(Integer, ForeignKey("shop_reconciliations.id"), nullable=False)
    product_id        = Column(Integer, ForeignKey("products.id"), nullable=False)
    batch_date        = Column(Text)               # дата надходження/випічки; None = залишок з попередньої звірки
    opening_balance   = Column(Float, default=0)   # залишок на початок (тільки для batch_date=None)
    received          = Column(Float, default=0)   # авто: надходження за batch_date
    entered_balance   = Column(Float)              # введено оператором (фактичний залишок партії)
    written_off       = Column(Float, default=0)   # авто: SUM(disposal_lines.qty)
    calculated_sold   = Column(Float)              # авто: opening + received - entered - written_off
    price             = Column(Float)              # ціна продажу
    expected_cash     = Column(Float)              # авто: calculated_sold * price

    reconciliation = relationship("ShopReconciliation", back_populates="lines")
    product        = relationship("Product")
    disposal_lines = relationship(
        "ShopDisposalLine",
        back_populates="line",
        cascade="all, delete-orphan",
        order_by="ShopDisposalLine.id",
    )


class ShopDisposalLine(Base):
    """Рядок розподілу списань у звірці магазину (списання / пайок / передача клієнту)."""
    __tablename__ = "shop_disposal_lines"

    id                     = Column(Integer, primary_key=True, autoincrement=True)
    reconciliation_line_id = Column(Integer, ForeignKey("shop_reconciliation_lines.id"), nullable=False)
    disposal_type          = Column(Text, nullable=False)  # writeoff | ration | client
    client_id              = Column(Integer, ForeignKey("clients.id"))
    qty                    = Column(Float, nullable=False)
    notes                  = Column(Text)
    created_at             = Column(Text)

    line   = relationship("ShopReconciliationLine", back_populates="disposal_lines")
    client = relationship("Client", foreign_keys=[client_id])


class ShopReceipt(Base):
    """Надходження товарів ззовні для магазину (куплені, не з власного виробництва)."""
    __tablename__ = "shop_receipts"

    id              = Column(Integer, primary_key=True, autoincrement=True)
    shop_client_id  = Column(Integer, ForeignKey("clients.id"), nullable=False)
    receipt_date    = Column(Text, nullable=False)
    product_id      = Column(Integer, ForeignKey("products.id"), nullable=False)
    qty             = Column(Float, nullable=False)
    purchase_price  = Column(Float, default=0)
    notes           = Column(Text)
    created_at      = Column(Text)

    shop    = relationship("Client", foreign_keys=[shop_client_id])
    product = relationship("Product")


class ShopSale(Base):
    """Продаж товару через POS-інтерфейс продавця."""
    __tablename__ = "shop_sales"

    id              = Column(Integer, primary_key=True, autoincrement=True)
    shop_client_id  = Column(Integer, ForeignKey("clients.id"), nullable=False)
    sale_date       = Column(Text, nullable=False)  # YYYY-MM-DD
    product_id      = Column(Integer, ForeignKey("products.id"), nullable=False)
    qty             = Column(Float, nullable=False)
    price           = Column(Float, nullable=False)
    amount          = Column(Float, nullable=False)  # qty * price
    session_id      = Column(Text)                   # UUID: об'єднує позиції одного чека
    notes           = Column(Text)
    created_at      = Column(Text)
    created_by      = Column(Text)                   # username продавця

    shop    = relationship("Client", foreign_keys=[shop_client_id])
    product = relationship("Product")
