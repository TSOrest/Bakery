"""Регрес-тест на "середню" знахідку QA-аудиту: order_date приймав будь-який
текст — підтверджено на реальній базі рядками з "not-a-date" і неіснуючою
датою "2028-02-30". Виправлено: backend/schemas/orders.py, OrderCreate
отримав field_validator на формат РРРР-ММ-ДД (через date.fromisoformat,
що заразом відкидає і неіснуючі календарні дати).
"""


def test_garbage_order_date_rejected(app_client, admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    resp = app_client.post(
        "/api/v1/orders/",
        json={"client_id": 1, "product_id": 1, "qty": 5, "order_date": "not-a-date"},
        headers=headers,
    )
    assert resp.status_code == 422


def test_nonexistent_calendar_date_rejected(app_client, admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    resp = app_client.post(
        "/api/v1/orders/",
        json={"client_id": 1, "product_id": 1, "qty": 5, "order_date": "2028-02-30"},
        headers=headers,
    )
    assert resp.status_code == 422


def test_valid_order_date_accepted(app_client, admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    resp = app_client.post(
        "/api/v1/orders/",
        json={"client_id": 1, "product_id": 1, "qty": 5, "order_date": "2027-06-15"},
        headers=headers,
    )
    assert resp.status_code == 201
