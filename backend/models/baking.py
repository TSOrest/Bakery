"""Моделі випічки: завдання та розподіл надлишків."""

from sqlalchemy import Column, Integer, Text, Real, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship
from backend.database import Base


class BakingTask(Base):
    __tablename__ = "baking_tasks"
    __table_args__ = (UniqueConstraint("task_date", "product_id"),)

    id              = Column(Integer, primary_key=True, autoincrement=True)
    task_date       = Column(Text, nullable=False)
    product_id      = Column(Integer, ForeignKey("products.id"), nullable=False)
    ordered_qty     = Column(Real, default=0)
    recommended_qty = Column(Real, default=0)
    baked_qty       = Column(Real, default=0)
    created_at      = Column(Text)

    product = relationship("Product")


class SurplusAllocation(Base):
    __tablename__ = "surplus_allocations"
    __table_args__ = (UniqueConstraint("alloc_date", "product_id"),)

    id          = Column(Integer, primary_key=True, autoincrement=True)
    alloc_date  = Column(Text, nullable=False)
    product_id  = Column(Integer, ForeignKey("products.id"), nullable=False)
    to_shop     = Column(Real, default=0)
    to_route    = Column(Real, default=0)
    ration_qty  = Column(Real, default=0)
    written_off = Column(Real, default=0)
    notes       = Column(Text)

    product = relationship("Product")
