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
from backend.models.references import Client, ClientBotUser, Product
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


def _all_chat_ids_for_client(db: Session, client_id: int) -> list[str]:
    """Повертає всі активні chat_id авторизованих користувачів клієнта."""
    rows = (
        db.query(ClientBotUser)
        .filter(ClientBotUser.client_id == client_id, ClientBotUser.is_active == 1)
        .all()
    )
    return [r.chat_id for r in rows]


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

    order_date = order.order_date
    # Відповідь йде тому хто подав замовлення (або fallback на будь-який chat клієнта)
    placer_chat = order.placed_by_chat_id
    if not placer_chat:
        ids = _all_chat_ids_for_client(db, order.client_id)
        placer_chat = ids[0] if ids else None

    product = db.get(Product, order.product_id)
    product_name = product.name if product else f"#{order.product_id}"

    if req.action == "confirm":
        order.bot_status = "confirmed"
        if placer_chat:
            tpl = _get_setting(db, "bot_tpl_confirmed",
                               "✅ {product} × {qty} шт на {date} підтверджено.")
            total = _order_sum(db, order_date, order.client_id)
            _send_to_client(placer_chat, tpl.format(
                date=order_date, sum=_fmt(total), reason="",
                product=product_name, qty=int(order.qty)))

    elif req.action == "reject":
        order.bot_status = "rejected"
        order.bot_rejection_reason = req.reason or ""
        if placer_chat:
            tpl = _get_setting(db, "bot_tpl_rejected",
                               "❌ {product} × {qty} шт на {date} відхилено. Причина: {reason}")
            _send_to_client(placer_chat, tpl.format(
                date=order_date, reason=req.reason or "не вказана", sum="",
                product=product_name, qty=int(order.qty)))

    elif req.action == "modify":
        if req.new_qty is None or req.new_qty <= 0:
            raise HTTPException(400, "Потрібно вказати new_qty > 0")
        old_qty = order.qty
        order.qty = req.new_qty
        order.bot_status = "modified"
        order.bot_rejection_reason = req.reason or ""
        if placer_chat:
            tpl = _get_setting(db, "bot_tpl_modified",
                               "✏️ {product}: замовлено {qty} шт → змінено на {new_qty} шт на {date}.")
            total = _order_sum(db, order_date, order.client_id)
            _send_to_client(placer_chat, tpl.format(
                date=order_date, sum=_fmt(total), reason=req.reason or "",
                product=product_name, qty=int(old_qty), new_qty=int(req.new_qty)))
    else:
        raise HTTPException(400, "Невідома дія")

    db.commit()
    return {"ok": True, "status": order.bot_status}


@router.post("/broadcast-reminder")
def broadcast_reminder(order_date: Optional[str] = None, db: Session = Depends(get_db)):
    """Розсилка нагадувань клієнтам, що ще не подали замовлення на {order_date}."""
    tomorrow = (date.today() + timedelta(days=1)).isoformat()
    target = order_date or tomorrow

    # Клієнти, у яких є хоча б один авторизований користувач бота
    bot_user_client_ids = set(
        r.client_id for r in
        db.query(ClientBotUser.client_id)
        .filter(ClientBotUser.is_active == 1)
        .distinct()
    )
    all_clients = db.query(Client).filter(
        Client.is_active == 1,
        Client.id.in_(bot_user_client_ids),
        Client.client_kind == "customer",
    ).all()

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
        for chat_id in _all_chat_ids_for_client(db, c.id):
            _send_to_client(chat_id, tpl.format(date=target, sum="", reason=""))
            sent += 1

    return BroadcastResponse(sent=sent, skipped=skipped)


@router.post("/broadcast-deadline")
def broadcast_deadline(order_date: Optional[str] = None, db: Session = Depends(get_db)):
    """Розсилка повідомлення про закриття прийому замовлень через бота."""
    tomorrow = (date.today() + timedelta(days=1)).isoformat()
    target = order_date or tomorrow

    bot_user_client_ids = set(
        r.client_id for r in
        db.query(ClientBotUser.client_id)
        .filter(ClientBotUser.is_active == 1)
        .distinct()
    )
    all_clients = db.query(Client).filter(
        Client.is_active == 1,
        Client.id.in_(bot_user_client_ids),
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
    for c in all_clients:
        if c.id in submitted_ids:
            skipped += 1
            continue
        for chat_id in _all_chat_ids_for_client(db, c.id):
            _send_to_client(chat_id, tpl.format(date=target, sum="", reason=""))
            sent += 1

    return BroadcastResponse(sent=sent, skipped=skipped)


# ── Управління авторизованими користувачами бота ──────────────────────────────

@router.get("/clients/{client_id}/bot-users")
def get_bot_users(client_id: int, db: Session = Depends(get_db)):
    """Список авторизованих користувачів бота для клієнта."""
    rows = (
        db.query(ClientBotUser)
        .filter(ClientBotUser.client_id == client_id)
        .order_by(ClientBotUser.authorized_at.desc())
        .all()
    )
    return [
        {
            "id": r.id,
            "chat_id": r.chat_id,
            "phone": r.phone,
            "first_name": r.first_name,
            "authorized_at": r.authorized_at,
            "is_active": r.is_active,
        }
        for r in rows
    ]


@router.delete("/clients/{client_id}/bot-users/{user_id}")
def revoke_bot_user(client_id: int, user_id: int, db: Session = Depends(get_db)):
    """Відкликати авторизацію користувача бота."""
    row = db.get(ClientBotUser, user_id)
    if not row or row.client_id != client_id:
        raise HTTPException(404, "Не знайдено")
    db.delete(row)
    db.commit()
    return {"ok": True}
