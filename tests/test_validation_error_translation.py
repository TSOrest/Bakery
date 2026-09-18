"""Регрес-тест на "високу" знахідку QA-аудиту: помилки перевірки полів
(422, стандартна Pydantic-валідація) видавались англійською технічним
жаргоном ("Input should be greater than or equal to 0"), на відміну від
кастомних HTTPException (404/400/409), написаних українською.

Виправлено: глобальний exception_handler(RequestValidationError) у
backend/main.py перекладає найпоширеніші типи помилок.
"""


def test_negative_qty_gives_ukrainian_validation_message(app_client, admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    resp = app_client.post(
        "/api/v1/orders/",
        json={"client_id": 1, "product_id": 1, "qty": -5, "order_date": "2027-08-11"},
        headers=headers,
    )
    assert resp.status_code == 422
    detail = resp.json()["detail"]
    assert isinstance(detail, list) and detail
    msg = detail[0]["msg"]
    assert "Input should be" not in msg, "повідомлення мало бути перекладене українською"
    assert "не менше" in msg


def test_missing_required_field_gives_ukrainian_message(app_client, admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    resp = app_client.post(
        "/api/v1/orders/",
        json={"product_id": 1, "qty": 5, "order_date": "2027-08-12"},  # client_id відсутній
        headers=headers,
    )
    assert resp.status_code == 422
    detail = resp.json()["detail"]
    msg = detail[0]["msg"]
    assert msg == "Поле обов'язкове"
