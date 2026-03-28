"""Моделі випічки: завдання та розподіл надлишків."""

from sqlalchemy import Column, Integer, Text, Float, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship
from backend.database import Base


class BakingTask(Base):
    __tablename__ = "baking_tasks"
    __table_args__ = (UniqueConstraint("task_date", "product_id"),)

    id              = Column(Integer, primary_key=True, autoincrement=True)
    task_date       = Column(Text, nullable=False)
    product_id      = Column(Integer, ForeignKey("products.id"), nullable=False)
    ordered_qty     = Column(Float, default=0)
    recommended_qty = Column(Float, default=0)
    baked_qty       = Column(Float, nullable=True, default=None)  # NULL = не введено, 0 = явно 0
    created_at      = Column(Text)

    product = relationship("Product")


