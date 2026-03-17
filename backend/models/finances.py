"""Модель фінансових операцій."""

from sqlalchemy import Column, Integer, Text, Float, ForeignKey
from sqlalchemy.orm import relationship
from backend.database import Base


class FinanceArticle(Base):
    """Стаття фінансових операцій (редагована користувачем)."""
    __tablename__ = "finance_articles"

    id        = Column(Integer, primary_key=True, autoincrement=True)
    name      = Column(Text, nullable=False)
    direction = Column(Text, nullable=False)   # 'income' | 'expense'
    is_system = Column(Integer, default=0)     # 1 = системна (не видаляється)


class Finance(Base):
    __tablename__ = "finances"

    id           = Column(Integer, primary_key=True, autoincrement=True)
    finance_date = Column(Text, nullable=False)
    client_id    = Column(Integer, ForeignKey("clients.id"))
    finance_type = Column(Text, nullable=False)   # залишається для сумісності
    article_id   = Column(Integer, ForeignKey("finance_articles.id"))
    amount       = Column(Float, nullable=False)
    sign         = Column(Integer, nullable=False)  # +1 або -1
    notes        = Column(Text)
    created_at   = Column(Text)
    created_by   = Column(Text)

    client  = relationship("Client")
    article = relationship("FinanceArticle")
