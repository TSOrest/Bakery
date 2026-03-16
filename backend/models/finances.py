"""Модель фінансових операцій."""

from sqlalchemy import Column, Integer, Text, Real, ForeignKey
from sqlalchemy.orm import relationship
from backend.database import Base


class Finance(Base):
    __tablename__ = "finances"

    id           = Column(Integer, primary_key=True, autoincrement=True)
    finance_date = Column(Text, nullable=False)
    client_id    = Column(Integer, ForeignKey("clients.id"))
    finance_type = Column(Text, nullable=False)
    amount       = Column(Real, nullable=False)
    sign         = Column(Integer, nullable=False)  # +1 або -1
    notes        = Column(Text)
    created_at   = Column(Text)
    created_by   = Column(Text)

    client = relationship("Client")
