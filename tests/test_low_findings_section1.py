"""Регрес-тест на "низьку" знахідку QA-аудиту (Розділ 1): price_override
без нижньої межі — можна було ввести від'ємну ціну в "% Знижка" напряму
через API (клієнтський min={0} не заважає прямому виклику).
Виправлено: Field(None, ge=0) в OrderCreate/OrderUpdate.
"""


def test_negative_price_override_rejected(app_client, admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    resp = app_client.post(
        "/api/v1/orders/",
        json={
            "client_id": 1, "product_id": 1, "qty": 5,
            "order_date": "2027-11-01", "price_override": -50,
        },
        headers=headers,
    )
    assert resp.status_code == 422


def test_positive_price_override_accepted(app_client, admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    resp = app_client.post(
        "/api/v1/orders/",
        json={
            "client_id": 1, "product_id": 1, "qty": 5,
            "order_date": "2027-11-02", "price_override": 12.5,
        },
        headers=headers,
    )
    assert resp.status_code == 201
