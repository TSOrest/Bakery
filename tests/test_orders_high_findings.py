"""Регрес-тести на "високі" знахідки QA-аудиту, розділ "Замовлення →
Маршрути → Випічка" (backend/routers/orders.py).
"""

from backend.database import SessionLocal
from backend.models.references import Client, Product
from backend.models.orders import Order


def _mk_client(db, name="Клієнт"):
    c = Client(full_name=name, client_kind="customer", is_active=1)
    db.add(c); db.flush()
    return c


def _mk_product(db, name="Виріб"):
    p = Product(name=name, is_active=1)
    db.add(p); db.flush()
    return p


# ── 1. Самопереміщення в /orders/{id}/transfer ──────────────────────────────

def test_transfer_order_to_self_is_blocked(app_client, admin_token):
    db = SessionLocal()
    client = _mk_client(db, "Тест-order-transfer-self")
    product = _mk_product(db, "Тест-order-transfer-product")
    order = Order(client_id=client.id, product_id=product.id, qty=10.0, order_date="2027-08-01")
    db.add(order); db.commit()
    order_id, client_id = order.id, client.id
    db.close()

    headers = {"Authorization": f"Bearer {admin_token}"}
    resp = app_client.post(
        f"/api/v1/orders/{order_id}/transfer",
        json={"to_client_id": client_id, "qty": 2},
        headers=headers,
    )
    assert resp.status_code == 400, resp.text

    db = SessionLocal()
    children = db.query(Order).filter_by(parent_order_id=order_id).all()
    assert children == [], "самопереміщення не мало створити дочірній рядок"
    db.close()


def test_transfer_order_to_nonexistent_client_gives_404(app_client, admin_token):
    db = SessionLocal()
    client = _mk_client(db, "Тест-order-transfer-fk")
    product = _mk_product(db, "Тест-order-transfer-fk-product")
    order = Order(client_id=client.id, product_id=product.id, qty=10.0, order_date="2027-08-02")
    db.add(order); db.commit()
    order_id = order.id
    db.close()

    headers = {"Authorization": f"Bearer {admin_token}"}
    resp = app_client.post(
        f"/api/v1/orders/{order_id}/transfer",
        json={"to_client_id": 999999999, "qty": 2},
        headers=headers,
    )
    assert resp.status_code == 404, resp.text
    assert "не знайдено" in resp.json()["detail"].lower()


def test_transfer_order_to_other_client_still_works(app_client, admin_token):
    """Регрес: звичайне (не самопереміщення) переміщення й далі працює."""
    db = SessionLocal()
    client_a = _mk_client(db, "Тест-order-transfer-A")
    client_b = _mk_client(db, "Тест-order-transfer-B")
    product = _mk_product(db, "Тест-order-transfer-ok-product")
    order = Order(client_id=client_a.id, product_id=product.id, qty=10.0, order_date="2027-08-03")
    db.add(order); db.commit()
    order_id, client_b_id = order.id, client_b.id
    db.close()

    headers = {"Authorization": f"Bearer {admin_token}"}
    resp = app_client.post(
        f"/api/v1/orders/{order_id}/transfer",
        json={"to_client_id": client_b_id, "qty": 3},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text


# ── 2. FK-перевірка при створенні замовлення ────────────────────────────────

def test_create_order_with_nonexistent_client_gives_clear_404(app_client, admin_token):
    db = SessionLocal()
    product = _mk_product(db, "Тест-create-order-fk-product")
    product_id = product.id
    db.commit(); db.close()

    headers = {"Authorization": f"Bearer {admin_token}"}
    resp = app_client.post(
        "/api/v1/orders/",
        json={"client_id": 999999999, "product_id": product_id, "qty": 5, "order_date": "2027-08-04"},
        headers=headers,
    )
    assert resp.status_code == 404, resp.text
    assert "клієнт" in resp.json()["detail"].lower()


def test_create_order_with_nonexistent_product_gives_clear_404(app_client, admin_token):
    db = SessionLocal()
    client = _mk_client(db, "Тест-create-order-fk-client")
    client_id = client.id
    db.commit(); db.close()

    headers = {"Authorization": f"Bearer {admin_token}"}
    resp = app_client.post(
        "/api/v1/orders/",
        json={"client_id": client_id, "product_id": 999999999, "qty": 5, "order_date": "2027-08-05"},
        headers=headers,
    )
    assert resp.status_code == 404, resp.text
    assert "виріб" in resp.json()["detail"].lower()


# ── 5. PUT /orders/{id} має скидати nullable-поля в null ────────────────────

def test_update_order_can_clear_price_override_to_null(app_client, admin_token):
    db = SessionLocal()
    client = _mk_client(db, "Тест-order-clear-null")
    product = _mk_product(db, "Тест-order-clear-null-product")
    order = Order(client_id=client.id, product_id=product.id, qty=5.0,
                  order_date="2027-08-06", price_override=-100.0)
    db.add(order); db.commit()
    order_id = order.id
    db.close()

    headers = {"Authorization": f"Bearer {admin_token}"}
    resp = app_client.put(
        f"/api/v1/orders/{order_id}",
        json={"price_override": None},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text

    db = SessionLocal()
    order = db.get(Order, order_id)
    assert order.price_override is None, "явний null мав очистити price_override"
    db.close()


def test_update_order_partial_payload_does_not_touch_other_fields(app_client, admin_token):
    db = SessionLocal()
    client = _mk_client(db, "Тест-order-partial-update")
    product = _mk_product(db, "Тест-order-partial-update-product")
    order = Order(client_id=client.id, product_id=product.id, qty=5.0,
                  order_date="2027-08-07", notes="важлива примітка")
    db.add(order); db.commit()
    order_id = order.id
    db.close()

    headers = {"Authorization": f"Bearer {admin_token}"}
    resp = app_client.put(
        f"/api/v1/orders/{order_id}",
        json={"qty": 8},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text

    db = SessionLocal()
    order = db.get(Order, order_id)
    assert order.qty == 8.0
    assert order.notes == "важлива примітка", "поля, не вказані в патчі, не мали змінюватись"
    db.close()
