"""Ендпоінт читання аудит-логу змін."""

from typing import List
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models.audit import AuditLog
from backend.schemas.audit import AuditLogOut
from backend.routers.auth import require_user

router = APIRouter(prefix="/audit", tags=["Аудит"])


@router.get("", response_model=List[AuditLogOut])
def get_audit_log(
    entity_table: str = Query(...),
    entity_id: int = Query(...),
    db: Session = Depends(get_db),
    _=Depends(require_user),
):
    """Повертає историю змін для конкретного запису. Тільки читання."""
    return (
        db.query(AuditLog)
        .filter(
            AuditLog.entity_table == entity_table,
            AuditLog.entity_id == entity_id,
        )
        .order_by(AuditLog.changed_at.desc())
        .all()
    )
