"""Модель аудит-логу змін (тільки UPDATE від користувачів)."""

from datetime import datetime
from sqlalchemy import Column, Integer, Text
from sqlalchemy.orm import Session
from backend.database import Base


class AuditLog(Base):
    __tablename__ = "audit_log"

    id            = Column(Integer, primary_key=True, autoincrement=True)
    entity_table  = Column(Text, nullable=False)
    entity_id     = Column(Integer, nullable=False)
    changed_field = Column(Text, nullable=False)
    old_value     = Column(Text)
    new_value     = Column(Text)
    changed_by    = Column(Text, nullable=False)
    changed_at    = Column(Text)


def write_audit(
    db: Session,
    table: str,
    entity_id: int,
    field: str,
    old_value,
    new_value,
    changed_by: str,
) -> None:
    """Записує одну зміну поля в audit_log. Виклик ПЕРЕД safe_commit."""
    db.add(AuditLog(
        entity_table=table,
        entity_id=entity_id,
        changed_field=field,
        old_value=str(old_value) if old_value is not None else None,
        new_value=str(new_value) if new_value is not None else None,
        changed_by=changed_by,
        changed_at=datetime.now().isoformat(timespec='seconds'),
    ))
