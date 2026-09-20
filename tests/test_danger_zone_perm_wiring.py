"""Регрес-тести на Крок 3 "Гранульованих прав ролей": точкові прапорці
для небезпечних/некрудних дій (backup, DB Editor, GitHub OAuth, .accdb
імпорт, generic-запис налаштувань), і hard-rule захист поля
role_permissions (редагується ЛИШЕ буквальним admin, незалежно від
делегованого admin_org.settings).

Смоук по одному представнику на кожен прапорець — reset_db свідомо НЕ
тестується тут (лише 403-заборона, вже покрита test_auth_protection.py);
щасливий шлях reset-db — окремий, ізольований test_zz_reset_db.py
(навмисно останній за алфавітом — знищує робочі дані спільної тестової БД).
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


def test_backup_list_denied_then_allowed(app_client):
    role = "тест_danger_backup"
    _set_role_keys(role, [])
    token = _mk_user_token(app_client, role, "тест-danger-backup-user")
    headers = {"Authorization": f"Bearer {token}"}

    r = app_client.get("/api/v1/backup/list", headers=headers)
    assert r.status_code == 403

    _set_role_keys(role, ["admin_system.backup"])
    r = app_client.get("/api/v1/backup/list", headers=headers)
    assert r.status_code == 200, r.text


def test_db_editor_denied_then_allowed(app_client):
    role = "тест_danger_dbeditor"
    _set_role_keys(role, [])
    token = _mk_user_token(app_client, role, "тест-danger-dbeditor-user")
    headers = {"Authorization": f"Bearer {token}"}

    r = app_client.get("/api/v1/db-editor/tables", headers=headers)
    assert r.status_code == 403

    _set_role_keys(role, ["admin_system.db_editor"])
    r = app_client.get("/api/v1/db-editor/tables", headers=headers)
    assert r.status_code == 200, r.text


def test_auth_github_denied_then_allowed(app_client):
    role = "тест_danger_github"
    _set_role_keys(role, [])
    token = _mk_user_token(app_client, role, "тест-danger-github-user")
    headers = {"Authorization": f"Bearer {token}"}

    r = app_client.get("/api/v1/auth/github/status", headers=headers)
    assert r.status_code == 403

    _set_role_keys(role, ["admin_system.github"])
    r = app_client.get("/api/v1/auth/github/status", headers=headers)
    assert r.status_code == 200, r.text


def test_import_accdb_denied_then_allowed(app_client):
    role = "тест_danger_import"
    _set_role_keys(role, [])
    token = _mk_user_token(app_client, role, "тест-danger-import-user")
    headers = {"Authorization": f"Bearer {token}"}

    r = app_client.get("/api/v1/import/db-status", headers=headers)
    assert r.status_code == 403

    _set_role_keys(role, ["admin_system.import"])
    r = app_client.get("/api/v1/import/db-status", headers=headers)
    assert r.status_code == 200, r.text


def test_settings_write_denied_then_allowed(app_client):
    role = "тест_danger_org_settings"
    _set_role_keys(role, [])
    token = _mk_user_token(app_client, role, "тест-danger-org-settings-user")
    headers = {"Authorization": f"Bearer {token}"}

    r = app_client.put("/api/v1/settings/director", json={"value": "Тест Директор"}, headers=headers)
    assert r.status_code == 403

    _set_role_keys(role, ["admin_org.settings"])
    r = app_client.put("/api/v1/settings/director", json={"value": "Тест Директор"}, headers=headers)
    assert r.status_code == 200, r.text


def test_role_permissions_key_requires_true_admin(app_client):
    """Делегований admin_org.settings НЕ дає редагувати саме role_permissions
    — ані через одиничний PUT /settings/{key}, ані через масовий PUT /settings/
    з ключем у тілі. Захист від самопризначення довільних дозволів."""
    role = "тест_danger_role_perms_escalation"
    _set_role_keys(role, ["admin_org.settings"])
    token = _mk_user_token(app_client, role, "тест-danger-role-perms-user")
    headers = {"Authorization": f"Bearer {token}"}

    r1 = app_client.put(
        "/api/v1/settings/role_permissions",
        json={"value": json.dumps({role: ["admin_system.reset_db"]})},
        headers=headers,
    )
    assert r1.status_code == 403

    r2 = app_client.put(
        "/api/v1/settings/",
        json={"role_permissions": json.dumps({role: ["admin_system.reset_db"]})},
        headers=headers,
    )
    assert r2.status_code == 403

    # інший, звичайний ключ у тому самому масовому запиті — все ще дозволено
    r3 = app_client.put("/api/v1/settings/", json={"director": "Тест Директор 2"}, headers=headers)
    assert r3.status_code == 200, r3.text
