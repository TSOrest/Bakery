"""Моделі авторизації: користувачі та сесії."""

from sqlalchemy import Column, Integer, Text, ForeignKey
from sqlalchemy.orm import relationship
from backend.database import Base


class User(Base):
    __tablename__ = "users"

    id            = Column(Integer, primary_key=True, autoincrement=True)
    username      = Column(Text, nullable=False, unique=True)
    password_hash = Column(Text, nullable=False)
    salt          = Column(Text, nullable=False)
    full_name     = Column(Text, default="")
    role          = Column(Text, default="operator")  # operator | accountant | admin | owner
    is_active     = Column(Integer, default=1)

    sessions = relationship("UserSession", back_populates="user", cascade="all, delete-orphan")


class UserSession(Base):
    __tablename__ = "user_sessions"

    token      = Column(Text, primary_key=True)
    user_id    = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(Text)

    user = relationship("User", back_populates="sessions")
