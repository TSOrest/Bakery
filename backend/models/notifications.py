"""Модель сповіщень у програмі (дзвоник у Layout.tsx).

Єдиний список для всіх ролей (без audience-фільтра — узгоджено як
найпростіший достатній варіант). Джерела: нове bot-замовлення (telegram_bot.py),
завершення імпорту з Access (import_accdb.py), нова версія програми і
автобекап (tray.py — прямий запис у bakery.db, БЕЗ HTTP: сервер слухає
0.0.0.0, тож незахищений internal-ендпоінт був би доступний з усієї мережі;
tray.py й так уже читає bakery.db напряму для налаштувань).
"""

import json
from datetime import datetime
from typing import Optional
from sqlalchemy import Column, Integer, Text
from sqlalchemy.orm import Session
from backend.database import Base


class Notification(Base):
    __tablename__ = "notifications"

    id         = Column(Integer, primary_key=True, autoincrement=True)
    type       = Column(Text, nullable=False)   # bot_order | new_version | import_done | backup_done | update_warning
    title      = Column(Text, nullable=False)
    body       = Column(Text)
    meta       = Column(Text)      # JSON-рядок, напр. {"version": "v1.6.0", "changelog": "..."}
    created_at = Column(Text, nullable=False)
    read_at    = Column(Text)      # NULL = непрочитане


def create_notification(
    db: Session, ntype: str, title: str, body: str = "", meta: Optional[dict] = None,
) -> Notification:
    """Додає сповіщення в сесію. Коміт — відповідальність викликача (як
    write_audit(), models/audit.py) — деякі виклики (import_accdb.py)
    навмисно комітять окремо від основної транзакції, щоб помилка запису
    сповіщення ніколи не відкочувала успішно завершену бізнес-операцію."""
    n = Notification(
        type=ntype,
        title=title,
        body=body or None,
        meta=json.dumps(meta, ensure_ascii=False) if meta else None,
        created_at=datetime.now().isoformat(timespec="seconds"),
    )
    db.add(n)
    return n
