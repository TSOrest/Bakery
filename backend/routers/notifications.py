"""API сповіщень у програмі (дзвоник у Layout.tsx). Однакові для всіх
ролей — без audience-фільтра. Немає internal write-ендпоінта для tray.py:
сервер слухає 0.0.0.0 (мережа пекарні), тож незахищений POST був би
доступний будь-якому пристрою в мережі — tray.py натомість пише сповіщення
напряму в bakery.db (той самий рівень довіри, що вже є для читання
налаштувань, backup.py)."""

from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.database import get_db, safe_commit
from backend.models.auth import User
from backend.models.notifications import Notification
from backend.routers.auth import require_user
from backend.schemas.notifications import NotificationOut, UnreadCount

router = APIRouter(prefix="/notifications", tags=["Сповіщення"])

MAX_LIST = 50


@router.get("", response_model=List[NotificationOut])
def list_notifications(db: Session = Depends(get_db), _: User = Depends(require_user)):
    """Останні сповіщення, найновіші перші."""
    return (
        db.query(Notification)
        .order_by(Notification.id.desc())
        .limit(MAX_LIST)
        .all()
    )


@router.get("/unread-count", response_model=UnreadCount)
def unread_count(db: Session = Depends(get_db), _: User = Depends(require_user)):
    count = db.query(Notification).filter(Notification.read_at.is_(None)).count()
    return {"count": count}


@router.post("/{notification_id}/read")
def mark_read(notification_id: int, db: Session = Depends(get_db), _: User = Depends(require_user)):
    n = db.get(Notification, notification_id)
    if n and not n.read_at:
        n.read_at = datetime.now().isoformat(timespec="seconds")
        safe_commit(db)
    return {"status": "ok"}


@router.post("/read-all")
def mark_all_read(db: Session = Depends(get_db), _: User = Depends(require_user)):
    now = datetime.now().isoformat(timespec="seconds")
    db.query(Notification).filter(Notification.read_at.is_(None)).update({"read_at": now})
    safe_commit(db)
    return {"status": "ok"}
