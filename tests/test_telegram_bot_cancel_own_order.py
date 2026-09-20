"""Регрес-тест на пропозицію з QA-аудиту: клієнт може скасувати власне ще
непідтверджене (bot_status='pending') замовлення через кнопку «🗑
Скасувати» під переліком «Моє замовлення» у Telegram-боті.

Тестує чисту логіку (_try_cancel_own_order, _pending_orders_keyboard)
напряму — без походу в _handle_callback, щоб не чіпати реальний мережевий
виклик Telegram API (_send/_api).
"""

from backend.models.references import Client, Product, ClientBotUser
from backend.models.orders import Order
from backend.services.telegram_bot import _try_cancel_own_order, _pending_orders_keyboard

ORDER_DATE = "2027-11-01"


def _mk_client_with_chat(db, name, chat_id):
    c = Client(full_name=name, client_kind="customer", is_active=1)
    db.add(c); db.flush()
    db.add(ClientBotUser(client_id=c.id, chat_id=str(chat_id), is_active=1))
    db.flush()
    return c


def test_cancel_removes_own_pending_order(db_session):
    db = db_session
    chat_id = 555001
    client = _mk_client_with_chat(db, "Тест-cancel-own-1", chat_id)
    product = Product(name="Тест-cancel-own-продукт-1", is_active=1)
    db.add(product); db.flush()
    order = Order(client_id=client.id, product_id=product.id, qty=4, order_date=ORDER_DATE,
                  source="bot", bot_status="pending", placed_by_chat_id=str(chat_id))
    db.add(order); db.commit()
    order_id = order.id

    result = _try_cancel_own_order(db, chat_id, order_id)

    assert result == ("Тест-cancel-own-продукт-1", 4)
    assert db.get(Order, order_id) is None


def test_cancel_refuses_other_clients_order(db_session):
    """chat_id намагається скасувати замовлення ІНШОГО клієнта — заборонено."""
    db = db_session
    owner_chat = 555002
    attacker_chat = 555003
    owner = _mk_client_with_chat(db, "Тест-cancel-own-owner", owner_chat)
    _mk_client_with_chat(db, "Тест-cancel-own-attacker", attacker_chat)
    product = Product(name="Тест-cancel-own-продукт-2", is_active=1)
    db.add(product); db.flush()
    order = Order(client_id=owner.id, product_id=product.id, qty=2, order_date=ORDER_DATE,
                  source="bot", bot_status="pending", placed_by_chat_id=str(owner_chat))
    db.add(order); db.commit()
    order_id = order.id

    result = _try_cancel_own_order(db, attacker_chat, order_id)

    assert result is None
    assert db.get(Order, order_id) is not None  # замовлення НЕ видалено


def test_cancel_refuses_already_confirmed_order(db_session):
    """Оператор уже підтвердив/відхилив — скасування клієнтом більше не діє."""
    db = db_session
    chat_id = 555004
    client = _mk_client_with_chat(db, "Тест-cancel-own-confirmed", chat_id)
    product = Product(name="Тест-cancel-own-продукт-3", is_active=1)
    db.add(product); db.flush()
    order = Order(client_id=client.id, product_id=product.id, qty=1, order_date=ORDER_DATE,
                  source="bot", bot_status="confirmed", placed_by_chat_id=str(chat_id))
    db.add(order); db.commit()
    order_id = order.id

    result = _try_cancel_own_order(db, chat_id, order_id)

    assert result is None
    assert db.get(Order, order_id) is not None


def test_pending_orders_keyboard_lists_only_pending(db_session):
    db = db_session
    client = Client(full_name="Тест-cancel-own-kb", client_kind="customer", is_active=1)
    db.add(client); db.flush()
    p1 = Product(name="Тест-cancel-own-kb-pending", is_active=1)
    p2 = Product(name="Тест-cancel-own-kb-confirmed", is_active=1)
    db.add_all([p1, p2]); db.flush()
    db.add_all([
        Order(client_id=client.id, product_id=p1.id, qty=3, order_date=ORDER_DATE,
              source="bot", bot_status="pending"),
        Order(client_id=client.id, product_id=p2.id, qty=2, order_date=ORDER_DATE,
              source="bot", bot_status="confirmed"),
    ])
    db.commit()

    kb = _pending_orders_keyboard(db, client.id, ORDER_DATE)

    assert kb is not None
    texts = [row[0]["text"] for row in kb["inline_keyboard"]]
    assert any("Тест-cancel-own-kb-pending" in t for t in texts)
    assert not any("Тест-cancel-own-kb-confirmed" in t for t in texts)


def test_pending_orders_keyboard_none_when_nothing_pending(db_session):
    db = db_session
    client = Client(full_name="Тест-cancel-own-kb-empty", client_kind="customer", is_active=1)
    db.add(client); db.flush()
    db.commit()

    assert _pending_orders_keyboard(db, client.id, ORDER_DATE) is None
