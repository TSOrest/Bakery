"""Ендпоінти налаштувань системи."""

import json
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import text
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


# ── Скидання бази даних ───────────────────────────────────────────────────────

@router.post("/reset-db")
def reset_database(db: Session = Depends(get_db)):
    """
    Очищає всі робочі дані.
    Залишає: системних клієнтів (client_kind != 'customer'), користувачів,
    налаштування, статті фінансів.
    """
    conn = db.connection()

    # Таблиці що реально існують у цій БД
    existing = {r[0] for r in conn.execute(
        text("SELECT name FROM sqlite_master WHERE type='table'")
    )}

    def _del(tbl: str) -> None:
        if tbl in existing:
            conn.execute(text(f"DELETE FROM {tbl}"))  # noqa: S608

    conn.execute(text("PRAGMA foreign_keys = OFF"))
    try:
        # Дочірні таблиці — спочатку
        for tbl in (
            "shop_disposal_lines",
            "shop_reconciliation_lines",
            "shop_reconciliations",
            "shop_receipts",
            "shop_sales",
            "shop_counts",
            "other_stock_in",
            "invoice_lines",
            "cancellation_lines",
            "route_cancellations",
            "surplus_allocations",
            "baking_tasks",
            "finances",
            "movements",
            "daily_balances",
            "client_price_overrides",
            "client_bot_users",
            "prices",
            "product_ingredients",
            "other_products",
            "ingredients",
        ):
            _del(tbl)

        # Самопосилання у invoices
        if "invoices" in existing:
            conn.execute(text("UPDATE invoices SET corrective_for_id = NULL"))
            conn.execute(text("DELETE FROM invoices"))

        # Замовлення — self-referential FK
        if "orders" in existing:
            conn.execute(text("UPDATE orders SET parent_order_id = NULL"))
            conn.execute(text("DELETE FROM orders"))

        # Клієнтів: видаляємо customer + всіх не-системних що виникли під час імпорту.
        # Системні визначаємо за client_kind: writeoff, ration, underbaked, shop.
        # При цьому дозволяємо лише ОДИН запис кожного системного kind —
        # дублі від попередніх імпортів (is_active=0) також видаляємо.
        # Алгоритм: зберегти MIN(id) для кожного системного kind, решту видалити.
        if "clients" in existing:
            # 1. Видалити всіх customer
            conn.execute(text("DELETE FROM clients WHERE client_kind = 'customer'"))
            # 2. Для кожного системного kind зберегти лише перший (найменший id)
            for kind in ("writeoff", "ration", "underbaked", "shop"):
                conn.execute(text(
                    "DELETE FROM clients WHERE client_kind = :kind "
                    "AND id NOT IN (SELECT MIN(id) FROM clients WHERE client_kind = :kind)"
                ), {"kind": kind})
            # 3. Видалити будь-яких інших не-системних (наприклад kind='customer' вже видалено,
            #    але на випадок невідомих kind від імпорту)
            conn.execute(text(
                "DELETE FROM clients WHERE client_kind NOT IN "
                "('writeoff','ration','underbaked','shop')"
            ))

        # Довідники
        for tbl in ("products", "categories", "units", "routes"):
            _del(tbl)

    finally:
        conn.execute(text("PRAGMA foreign_keys = ON"))

    db.commit()
    return {"status": "ok"}


@router.get("/server-info")
def server_info():
    """Повертає локальну IP-адресу сервера та порт для формування POS URL."""
    import socket
    import os
    ip = "127.0.0.1"
    try:
        # Надійний спосіб отримати IP локальної мережі (без реального пакету)
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
    except Exception:
        try:
            ip = socket.gethostbyname(socket.gethostname())
        except Exception:
            pass
    port = int(os.environ.get("BAKERY_PORT", 8000))
    return {"local_ip": ip, "port": port}


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
