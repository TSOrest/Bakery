"""Ендпоінти налаштувань системи."""

from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models.settings import Setting

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
