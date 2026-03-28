"""Ендпоінти налаштувань системи."""

import json
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models.settings import Setting
from backend.services import telegram_bot as tg

router = APIRouter(prefix="/settings", tags=["Налаштування"])


class SettingUpdate(BaseModel):
    value: str
    description: Optional[str] = None


@router.get("/")
def get_settings(db: Session = Depends(get_db)):
    rows = db.query(Setting).order_by(Setting.key).all()
    return {r.key: {"value": r.value or "", "description": r.description or ""} for r in rows}


@router.put("/{key}")
def update_setting(key: str, body: SettingUpdate, db: Session = Depends(get_db)):
    row = db.get(Setting, key)
    if row:
        row.value = body.value
        row.updated_at = datetime.now().isoformat()
        if body.description is not None:
            row.description = body.description
    else:
        row = Setting(key=key, value=body.value, description=body.description or "", updated_at=datetime.now().isoformat())
        db.add(row)
    db.commit()
    return {"key": key, "value": body.value}


@router.put("/")
def update_many_settings(body: dict[str, str], db: Session = Depends(get_db)):
    """Оновлює кілька налаштувань одночасно."""
    for key, value in body.items():
        row = db.get(Setting, key)
        if row:
            row.value = value
            row.updated_at = datetime.now().isoformat()
        else:
            db.add(Setting(key=key, value=value, updated_at=datetime.now().isoformat()))
    db.commit()
    return {"updated": len(body)}


# ── Telegram бот ──────────────────────────────────────────────────────────────

@router.get("/telegram/status")
def telegram_status():
    """Стан бота: запущений чи ні."""
    return {"running": tg.bot_is_running()}


@router.post("/telegram/restart")
def telegram_restart(db: Session = Depends(get_db)):
    """Перезапускає бота з поточним токеном з БД."""
    row = db.get(Setting, "telegram_bot_token")
    token = row.value if row and row.value else ""
    tg.restart_bot(token)
    return {"running": tg.bot_is_running(), "has_token": bool(token)}


@router.post("/telegram/stop")
def telegram_stop():
    """Зупиняє бота."""
    tg.stop_bot()
    return {"running": False}


@router.get("/telegram/authorized")
def telegram_authorized(db: Session = Depends(get_db)):
    """Список авторизованих чатів."""
    raw = db.get(Setting, "telegram_authorized_chats")
    chats: dict[str, str] = {}
    try:
        chats = json.loads(raw.value) if raw and raw.value else {}
    except Exception:
        pass
    return {"chats": [{"chat_id": k, "phone": v} for k, v in chats.items()]}


@router.delete("/telegram/authorized/{chat_id}")
def telegram_revoke(chat_id: str, db: Session = Depends(get_db)):
    """Відкликає доступ у конкретного чату."""
    row = db.get(Setting, "telegram_authorized_chats")
    chats: dict[str, str] = {}
    try:
        chats = json.loads(row.value) if row and row.value else {}
    except Exception:
        pass
    chats.pop(chat_id, None)
    if row:
        row.value = json.dumps(chats, ensure_ascii=False)
        row.updated_at = datetime.now().isoformat()
    db.commit()
    return {"revoked": chat_id}
