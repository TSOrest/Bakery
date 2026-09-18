"""Регрес-тест на "середню" знахідку QA-аудиту: помилка форматування
адмін-редагованого шаблону бота (Налаштування → Бот → Шаблони) ламала ВСІ
підтвердження/відхилення/зміни кількості через бота — `tpl.format(...)`
кидав виняток ДО `safe_commit`, тож сама зміна статусу замовлення взагалі
не зберігалась.

Виправлено: backend/routers/bot.py, _safe_notify() — форматування і
надсилання обгорнуті в try/except; помилка лише логується, статус
замовлення все одно зберігається.
"""

from backend.database import SessionLocal
from backend.models.references import Client, Product
from backend.models.orders import Order
from backend.models.settings import Setting


def test_verify_order_confirm_survives_broken_template(app_client, admin_token):
    db = SessionLocal()
    # Биту плейсхолдер-дужку — {product без закриття
    setting = db.get(Setting, "bot_tpl_confirmed")
    if setting:
        setting.value = "✅ {product НЕ ЗАКРИТА дужка"
    else:
        db.add(Setting(key="bot_tpl_confirmed", value="✅ {product НЕ ЗАКРИТА дужка"))

    client = Client(full_name="Тест-bot-template", client_kind="customer", is_active=1)
    product = Product(name="Тест-bot-template-продукт", is_active=1)
    db.add_all([client, product]); db.flush()
    order = Order(
        client_id=client.id, product_id=product.id, qty=3, order_date="2027-10-01",
        source="bot", bot_status="pending", placed_by_chat_id="123456789",
    )
    db.add(order); db.commit()
    order_id = order.id
    db.close()

    headers = {"Authorization": f"Bearer {admin_token}"}
    resp = app_client.put(
        f"/api/v1/bot/orders/{order_id}/verify",
        json={"action": "confirm"},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "confirmed"

    db = SessionLocal()
    refreshed = db.get(Order, order_id)
    db.close()
    assert refreshed.bot_status == "confirmed", "статус мав зберегтись навіть якщо шаблон биий"
