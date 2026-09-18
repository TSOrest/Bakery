"""Регрес-тест на "середню" знахідку QA-аудиту: пароль не мав мінімальної
довжини — користувач з паролем "1" створювався і одразу успішно входив.
Виправлено: backend/routers/auth.py, UserCreate/UserUpdate отримали
field_validator (мінімум 6 символів, MIN_PASSWORD_LENGTH).
"""


def test_short_password_rejected_on_create(app_client, admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    resp = app_client.post(
        "/api/v1/auth/users",
        json={"username": "audit_shortpass", "password": "1", "full_name": "x", "role": "operator"},
        headers=headers,
    )
    assert resp.status_code == 422


def test_long_enough_password_accepted_on_create(app_client, admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    resp = app_client.post(
        "/api/v1/auth/users",
        json={"username": "audit_okpass", "password": "123456", "full_name": "x", "role": "operator"},
        headers=headers,
    )
    assert resp.status_code == 201


def test_short_password_rejected_on_update(app_client, admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    create = app_client.post(
        "/api/v1/auth/users",
        json={"username": "audit_updatepass", "password": "123456", "full_name": "x", "role": "operator"},
        headers=headers,
    )
    assert create.status_code == 201
    user_id = create.json()["id"]

    resp = app_client.put(
        f"/api/v1/auth/users/{user_id}",
        json={"password": "abc"},
        headers=headers,
    )
    assert resp.status_code == 422
