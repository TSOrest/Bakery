"""Модель налаштувань системи."""

from sqlalchemy import Column, Text
from backend.database import Base


class Setting(Base):
    __tablename__ = "settings"

    key         = Column(Text, primary_key=True)
    value       = Column(Text)
    description = Column(Text)
    updated_at  = Column(Text)
