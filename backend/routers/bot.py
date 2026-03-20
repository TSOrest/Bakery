"""
API для роботи з Telegram-ботом:
- Список замовлень від бота на верифікацію
- Підтвердження / відхилення / зміна кількості
- Масова розсилка (нагадування, стоп-прийом)
"""

from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models.orders import Order
from backend.models.references import Client, Product
from backend.models.settings import Setting
from backend.services.prices import get_price

router = APIRouter(prefix="/bot", tags=["bot"])


# ── Схеми ────────────────────────────────────────────────────────────────────

class VerifyRequest(BaseModel):
    action: str          # confirm | reject | modify
    new_qty: Optional[float] = None
    reason: Optional[str] = None


class BroadcastResponse(BaseModel):
    sent: int
    skipped: int         # клієнти без bot_chat_id


# ── Допоміжні ─────────────────────────────────────────────────────────────────

def _get_setting(db: Session, key: str, default: str = "") -> str:
    row = db.get(Setting, key)
    return row.value if row and row.value else default


def _fmt(n: float) -> str:
    return f"{n:,.2f} грн".replace(",", "\u202f")


def _send_to_client(chat_id: str, text: str) -> None:
    """Надсилає повідомлення клієнту через бота."""
    from backend.services.telegram_bot import send_to_chat
    try:
        send_to_chat(int(chat_id), text)
    except Exception:
        pass


def _order_sum(db: Session, order_date: str, client_id: int) -> float:
    orders = (
        db.query(Order)
        .filter(
            Order.order_date == order_date,
            Order.client_id == client_id,
            Order.parent_order_id.is_(None),
            Order.source == "bot",
        )
        .all()
    )
    total = 0.0
    for o in orders:
        price = get_price(db, o.product_id, client_id, order_date) or 0
        total += o.qty * price
    return total


# ── Ендпоінти ─────────────────────────────────────────────────────────────────

@router.get("/pending-orders")
def get_pending_orders(order_date: Optional[str] = None, db: Session = Depends(get_db)):
    """Список замовлень від бота зі статусом pending."""
    target = order_date or date.today().isoformat()
    orders = (
        db.query(Order)
        .filter(
            Order.order_date == target,
            Order.source == "bot",
            Order.bot_status == "pending",
            Order.parent_order_id.is_(None),
        )
        .all()
    )
    clients  = {c.id: c for c in db.query(Client).all()}
    products = {p.id: p for p in db.query(Product).all()}

    result = []
    for o in orders:
        c = clients.get(o.client_id)
        p = products.get(o.product_id)
        price = get_price(db, o.product_id, o.client_id, target) or 0
        result.append({
            "id": o.id,
            "client_id": o.client_id,
            "client_name": (c.short_name or c.full_name) if c else "—",
            "product_id": o.product_id,
            "product_name": p.name if p else "—",
            "qty": o.qty,
            "price": price,
            "sum": o.qty * price,
            "order_date": o.order_date,
        })
    return result


@router.put("/orders/{order_id}/verify")
def verify_order(order_id: int, req: VerifyRequest, db: Session = Depends(get_db)):
    """Підтвердити / відхилити / змінити кількість у bot-замовленні."""
    order = db.get(Order, order_id)
    if not order or order.source != "bot":
        raise HTTPException(404, "Замовлення не знайдено")
    if order.bot_status != "pending":
        raise HTTPException(400, "Замовлення вже оброблено")

    client = db.get(Client, order.client_id)
    chat_id = client.bot_chat_id if client else None
    order_date = order.order_date

    if req.action == "confirm":
        order.bot_status = "confirmed"
        if chat_id:
            tpl = _get_setting(db, "bot_tpl_confirmed",
                               "✅ Ваше замовлення на {date} підтверджено. Сума: {sum}.")
            total = _order_sum(db, order_date, order.client_id)
            _send_to_client(chat_id, tpl.format(date=order_date, sum=_fmt(total), reason=""))

    elif req.action == "reject":
        order.bot_status = "rejected"
        order.bot_rejection_reason = req.reason or ""
        if chat_id:
            tpl = _get_setting(db, "bot_tpl_rejected",
                               "❌ Ваше замовлення на {date} відхилено. Причина: {reason}")
            _send_to_client(chat_id, tpl.format(
                date=order_date, reason=req.reason or "не вказана", sum=""))

    elif req.action == "modify":
        if req.new_qty is None or req.new_qty <= 0:
            raise HTTPException(400, "Потрібно вказати new_qty > 0")
        order.qty = req.new_qty
        order.bot_status = "modified"
        order.bot_rejection_reason = req.reason or ""
        if chat_id:
            tpl = _get_setting(db, "bot_tpl_modified",
                               "✏️ Ваше замовлення на {date} підтверджено зі змінами.\n"
                               "Нова сума: {sum}. Примітка: {reason}")
            total = _order_sum(db, order_date, order.client_id)
            _send_to_client(chat_id, tpl.format(
                date=order_date, sum=_fmt(total), reason=req.reason or ""))
    else:
        raise HTTPException(400, "Невідома дія")

    db.commit()
    return {"ok": True, "status": order.bot_status}


@router.post("/broadcast-reminder")
def broadcast_reminder(order_date: Optional[str] = None, db: Session = Depends(get_db)):
    """Розсилка нагадувань клієнтам, що ще не подали замовлення на {order_date}."""
    tomorrow = (date.today() + timedelta(days=1)).isoformat()
    target = order_date or tomorrow

    # Клієнти з bot_chat_id
    all_clients = db.query(Client).filter(
        Client.is_active == 1,
        Client.bot_chat_id.isnot(None),
        Client.client_kind == "customer",
    ).all()

    # Хто вже подав замовлення (будь-яким чином)
    submitted_ids = set(
        o.client_id for o in
        db.query(Order.client_id)
        .filter(Order.order_date == target, Order.parent_order_id.is_(None), Order.qty > 0)
        .distinct()
    )

    tpl = _get_setting(db, "bot_tpl_reminder",
                       "Нагадування: ви ще не подали замовлення на {date}.")

    sent, skipped = 0, 0
    for c in all_clients:
        if c.id in submitted_ids:
            skipped += 1
            continue
        _send_to_client(c.bot_chat_id, tpl.format(date=target, sum="", reason=""))
        sent += 1

    return BroadcastResponse(sent=sent, skipped=skipped)


@router.post("/broadcast-deadline")
def broadcast_deadline(order_date: Optional[str] = None, db: Session = Depends(get_db)):
    """Розсилка повідомлення про закриття прийому замовлень через бота."""
    tomorrow = (date.today() + timedelta(days=1)).isoformat()
    target = order_date or tomorrow

    clients_no_order = db.query(Client).filter(
        Client.is_active == 1,
        Client.bot_chat_id.isnot(None),
        Client.client_kind == "customer",
    ).all()

    submitted_ids = set(
        o.client_id for o in
        db.query(Order.client_id)
        .filter(Order.order_date == target, Order.parent_order_id.is_(None), Order.qty > 0)
        .distinct()
    )

    tpl = _get_setting(db, "bot_tpl_deadline",
                       "Прийом замовлень через бота на {date} завершено.")

    sent, skipped = 0, 0
    for c in clients_no_order:
        if c.id in submitted_ids:
            skipped += 1
            continue
        _send_to_client(c.bot_chat_id, tpl.format(date=target, sum="", reason=""))
        sent += 1

    return BroadcastResponse(sent=sent, skipped=skipped)
