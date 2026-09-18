"""Регрес-тести авторизації: чутливі ендпоінти мають вимагати токен.

Зокрема закриває аудит-регрес, коли settings/backup/import/dashboard/bot були
доступні без авторизації (reset-db, зміна налаштувань, відновлення БД тощо).
"""

import pytest

# (method, path[, json]) — виклик БЕЗ токена має повертати 401.
UNAUTH_MUST_401 = [
    ("post",   "/api/v1/settings/reset-db",        None),
    ("put",    "/api/v1/settings/bakery_name",     {"value": "x"}),
    ("post",   "/api/v1/settings/telegram/stop",   None),
    ("post",   "/api/v1/backup/now",               None),
    ("get",    "/api/v1/backup/list",              None),
    ("delete", "/api/v1/backup/whatever.db",       None),
    ("post",   "/api/v1/backup/restore/x.db",      None),
    ("get",    "/api/v1/import/db-status",         None),
    ("get",    "/api/v1/dashboard/",               None),
    ("get",    "/api/v1/bot/order-status",         None),
    # Розділ 4 — GET довідників раніше читались без входу взагалі.
    ("get",    "/api/v1/products/",                None),
    ("get",    "/api/v1/clients/",                 None),
    ("get",    "/api/v1/prices/",                  None),
    ("get",    "/api/v1/routes/",                  None),
    ("get",    "/api/v1/categories",               None),
    ("get",    "/api/v1/units",                     None),
    ("get",    "/api/v1/client-groups/",           None),
    ("get",    "/api/v1/ingredients/",             None),
    ("get",    "/api/v1/margin-report",            None),
    ("post",   "/api/v1/auth/github/start",        None),
    ("get",    "/api/v1/auth/github/status",       None),
]


@pytest.mark.parametrize("method,path,body", UNAUTH_MUST_401)
def test_endpoint_requires_auth(app_client, method, path, body):
    resp = getattr(app_client, method)(path, json=body) if body is not None else getattr(app_client, method)(path)
    assert resp.status_code == 401, f"{method.upper()} {path} → {resp.status_code} (очікувалось 401)"


def test_reset_db_forbidden_for_operator(app_client, operator_token):
    """Оператор не адмін — reset-db має бути 403."""
    resp = app_client.post(
        "/api/v1/settings/reset-db",
        headers={"Authorization": f"Bearer {operator_token}"},
    )
    assert resp.status_code == 403


def test_settings_put_forbidden_for_operator(app_client, operator_token):
    resp = app_client.put(
        "/api/v1/settings/bakery_name",
        json={"value": "Хакнуто"},
        headers={"Authorization": f"Bearer {operator_token}"},
    )
    assert resp.status_code == 403


def test_settings_hides_secrets_from_operator(app_client, admin_token, operator_token):
    # Адмін задає секрети
    app_client.put("/api/v1/settings/github_client_secret",
                   json={"value": "SECRET_XYZ"},
                   headers={"Authorization": f"Bearer {admin_token}"})
    app_client.put("/api/v1/settings/github_issues_token",
                   json={"value": "ghp_ISSUES_TOKEN_XYZ"},
                   headers={"Authorization": f"Bearer {admin_token}"})
    app_client.put("/api/v1/settings/telegram_bot_token",
                   json={"value": "BOTTOKEN_123"},
                   headers={"Authorization": f"Bearer {admin_token}"})

    # Оператор НЕ бачить жодного секрету
    # (⚠ QA-аудит: github_issues_token раніше НЕ був у списку прихованих —
    # GET /settings/ віддавав його у відкритому тексті будь-якій ролі.)
    r_op = app_client.get("/api/v1/settings/",
                          headers={"Authorization": f"Bearer {operator_token}"})
    assert r_op.status_code == 200
    op = r_op.json()
    assert "github_client_secret" not in op
    assert "github_oauth_token" not in op
    assert "github_issues_token" not in op
    assert "telegram_bot_token" not in op

    # Адмін бачить токен бота (потрібен для редагування), але не github-секрети
    r_admin = app_client.get("/api/v1/settings/",
                             headers={"Authorization": f"Bearer {admin_token}"})
    adm = r_admin.json()
    assert adm.get("telegram_bot_token", {}).get("value") == "BOTTOKEN_123"
    assert "github_client_secret" not in adm
    assert "github_oauth_token" not in adm
    assert "github_issues_token" not in adm


def test_settings_get_requires_auth(app_client):
    assert app_client.get("/api/v1/settings/").status_code == 401


# ── Розділ 4: GET довідників доступні будь-якій автентифікованій ролі ──────────

REFERENCE_GET_ENDPOINTS = [
    "/api/v1/products/",
    "/api/v1/clients/",
    "/api/v1/prices/",
    "/api/v1/routes/",
    "/api/v1/categories",
    "/api/v1/units",
    "/api/v1/client-groups/",
    "/api/v1/ingredients/",
]


@pytest.mark.parametrize("path", REFERENCE_GET_ENDPOINTS)
def test_reference_get_allowed_for_any_authenticated_role(app_client, operator_token, path):
    """require_user (не require_admin) — довідники читає будь-яка роль,
    без прив'язки до конкретної (гранульовані права ролей — окрема,
    відкладена задача)."""
    resp = app_client.get(path, headers={"Authorization": f"Bearer {operator_token}"})
    assert resp.status_code == 200


def test_github_oauth_start_forbidden_for_operator(app_client, operator_token):
    resp = app_client.post(
        "/api/v1/auth/github/start",
        headers={"Authorization": f"Bearer {operator_token}"},
    )
    assert resp.status_code == 403


def test_github_oauth_status_forbidden_for_operator(app_client, operator_token):
    resp = app_client.get(
        "/api/v1/auth/github/status",
        headers={"Authorization": f"Bearer {operator_token}"},
    )
    assert resp.status_code == 403
