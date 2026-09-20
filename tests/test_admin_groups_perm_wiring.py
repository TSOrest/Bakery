"""Регрес-тести на Крок 2 "Гранульованих прав ролей": підключення
require_perm() до мутацій 5 адмін-розділів Довідників (products, clients,
prices, finances_articles) і до Users CRUD (auth.py), разом з hard-rule
захистом від ескалації прав через делеговані admin_system.create/.edit.

Смоук по одному представнику на групу — сам механізм require_perm() вже
покритий tests/test_role_permissions_granular.py; тут перевіряється лише
що ПРАВИЛЬНИЙ ключ підключено до ПРАВИЛЬНОГО ендпоінта.
"""

import json

from backend.database import SessionLocal
from backend.models.auth import User
from backend.models.settings import Setting
from backend.routers.auth import _hash_password, _make_salt

PASSWORD = "тест-пароль-12345"


def _set_role_keys(role: str, keys: list) -> None:
    with SessionLocal() as db:
        row = db.get(Setting, "role_permissions")
        perms = json.loads(row.value) if row and row.value else {}
        perms[role] = keys
        row.value = json.dumps(perms, ensure_ascii=False)
        db.commit()


def _mk_user_token(app_client, role: str, username: str) -> str:
    with SessionLocal() as db:
        if not db.query(User).filter(User.username == username).first():
            salt = _make_salt()
            db.add(User(username=username, password_hash=_hash_password(PASSWORD, salt),
                        salt=salt, role=role, is_active=1))
            db.commit()
    r = app_client.post("/api/v1/auth/login", json={"username": username, "password": PASSWORD})
    assert r.status_code == 200, r.text
    return r.json()["token"]


def test_create_product_denied_then_allowed(app_client):
    role = "тест_wiring_goods"
    _set_role_keys(role, [])
    token = _mk_user_token(app_client, role, "тест-wiring-goods-user")
    headers = {"Authorization": f"Bearer {token}"}
    body = {"name": "Тест-wiring-Виріб", "unit_id": None, "category_id": None}

    r = app_client.post("/api/v1/products/", json=body, headers=headers)
    assert r.status_code == 403

    _set_role_keys(role, ["admin_goods.create"])
    r = app_client.post("/api/v1/products/", json=body, headers=headers)
    assert r.status_code == 201, r.text


def test_create_client_denied_then_allowed(app_client):
    role = "тест_wiring_clients"
    _set_role_keys(role, [])
    token = _mk_user_token(app_client, role, "тест-wiring-clients-user")
    headers = {"Authorization": f"Bearer {token}"}
    body = {"full_name": "Тест-wiring-Клієнт"}

    r = app_client.post("/api/v1/clients/", json=body, headers=headers)
    assert r.status_code == 403

    _set_role_keys(role, ["admin_clients.create"])
    r = app_client.post("/api/v1/clients/", json=body, headers=headers)
    assert r.status_code == 201, r.text


def test_create_finance_article_denied_then_allowed(app_client):
    role = "тест_wiring_org"
    _set_role_keys(role, [])
    token = _mk_user_token(app_client, role, "тест-wiring-org-user")
    headers = {"Authorization": f"Bearer {token}"}
    body = {"name": "Тест-wiring-Стаття", "direction": "income", "needs_client": 0}

    r = app_client.post("/api/v1/finances/articles/", json=body, headers=headers)
    assert r.status_code == 403

    _set_role_keys(role, ["admin_org.create"])
    r = app_client.post("/api/v1/finances/articles/", json=body, headers=headers)
    assert r.status_code == 201, r.text


def test_recalculate_ingredients_costs_denied_then_allowed(app_client):
    """admin_prices.edit — представник групи Ціни (охоплює prices.py і
    ingredients.py разом)."""
    role = "тест_wiring_prices"
    _set_role_keys(role, [])
    token = _mk_user_token(app_client, role, "тест-wiring-prices-user")
    headers = {"Authorization": f"Bearer {token}"}

    r = app_client.post("/api/v1/ingredients/recalculate-all", headers=headers)
    assert r.status_code == 403

    _set_role_keys(role, ["admin_prices.edit"])
    r = app_client.post("/api/v1/ingredients/recalculate-all", headers=headers)
    assert r.status_code == 200, r.text


def test_create_finance_denied_then_allowed(app_client):
    """finances.create (Крок 3) — не прив'язано до жодного admin_* розділу,
    окрема сторінка (`finances.py`, не tabConfig.ts)."""
    role = "тест_wiring_finances"
    _set_role_keys(role, [])
    token = _mk_user_token(app_client, role, "тест-wiring-finances-user")
    headers = {"Authorization": f"Bearer {token}"}
    body = {"finance_date": "2027-01-01", "finance_type": "deposit", "amount": 10.0, "sign": 1}

    r = app_client.post("/api/v1/finances/", json=body, headers=headers)
    assert r.status_code == 403

    _set_role_keys(role, ["finances.create"])
    r = app_client.post("/api/v1/finances/", json=body, headers=headers)
    assert r.status_code == 201, r.text


def test_admin_system_create_cannot_escalate_to_admin_role(app_client):
    """Роль з делегованим admin_system.create МОЖЕ створювати звичайних
    користувачів, але НЕ може призначити комусь роль admin."""
    role = "тест_wiring_escalate_create"
    _set_role_keys(role, ["admin_system.create"])
    token = _mk_user_token(app_client, role, "тест-wiring-escalate-create-user")
    headers = {"Authorization": f"Bearer {token}"}

    ok = app_client.post(
        "/api/v1/auth/users",
        json={"username": "тест-wiring-escalate-normal", "password": PASSWORD,
              "full_name": "", "role": "operator"},
        headers=headers,
    )
    assert ok.status_code == 201, ok.text

    escalate = app_client.post(
        "/api/v1/auth/users",
        json={"username": "тест-wiring-escalate-admin", "password": PASSWORD,
              "full_name": "", "role": "admin"},
        headers=headers,
    )
    assert escalate.status_code == 403


def test_admin_system_edit_cannot_touch_existing_admin_account(app_client, admin_token):
    """Роль з делегованим admin_system.edit МОЖЕ редагувати звичайних
    користувачів, але НЕ може редагувати вже-адмінський акаунт (пароль,
    статус, роль) — незалежно від дозволу."""
    role = "тест_wiring_escalate_edit"
    _set_role_keys(role, ["admin_system.edit"])
    token = _mk_user_token(app_client, role, "тест-wiring-escalate-edit-user")
    headers = {"Authorization": f"Bearer {token}"}

    target = app_client.post(
        "/api/v1/auth/users",
        json={"username": "тест-wiring-escalate-target", "password": PASSWORD,
              "full_name": "", "role": "operator"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    target_id = target.json()["id"]

    ok = app_client.put(f"/api/v1/auth/users/{target_id}", json={"full_name": "Змінено"}, headers=headers)
    assert ok.status_code == 200, ok.text

    admin_row = app_client.get("/api/v1/auth/users", headers={"Authorization": f"Bearer {admin_token}"})
    admin_id = next(u["id"] for u in admin_row.json() if u["username"] == "admin")

    blocked = app_client.put(f"/api/v1/auth/users/{admin_id}", json={"full_name": "Хакнуто"}, headers=headers)
    assert blocked.status_code == 403

    promote = app_client.put(f"/api/v1/auth/users/{target_id}", json={"role": "admin"}, headers=headers)
    assert promote.status_code == 403
