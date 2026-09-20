"""Регрес-тести на Крок 1 "Гранульованих прав ролей": генеричний
dependency-фабрикатор `require_perm()` (auth.py) і одноразова міграція
`role_permissions` (main.py, `_migrate_role_permissions_granular`).

Тести на міграцію додають ІЗОЛЬОВАНУ фейкову роль у спільний JSON-рядок
`role_permissions` (а не чіпають operator/accountant/admin/owner/seller) —
щоб не зачепити інші тести, які покладаються на реальні дефолтні права.
"""

import json

from fastapi import HTTPException
import pytest

from backend.database import SessionLocal
from backend.models.auth import User
from backend.models.settings import Setting
from backend.routers.auth import require_perm
from backend.main import _migrate_role_permissions_granular


def _set_role_keys(db, role: str, keys: list) -> None:
    row = db.get(Setting, "role_permissions")
    perms = json.loads(row.value) if row and row.value else {}
    perms[role] = keys
    row.value = json.dumps(perms, ensure_ascii=False)
    db.commit()


def _get_role_keys(role: str) -> list:
    with SessionLocal() as db:
        row = db.get(Setting, "role_permissions")
        perms = json.loads(row.value) if row and row.value else {}
        return perms.get(role, [])


def _mk_user(db, role: str, username: str) -> User:
    u = User(username=username, password_hash="x", salt="x", role=role, is_active=1)
    db.add(u); db.flush()
    return u


# ── require_perm() ──────────────────────────────────────────────────────────

def test_require_perm_always_allows_admin(db_session):
    db = db_session
    admin = _mk_user(db, "admin", "тест-require-perm-admin")
    dep = require_perm("admin_clients.delete")
    assert dep(user=admin, db=db) is admin


def test_require_perm_allows_role_with_key(db_session):
    db = db_session
    _set_role_keys(db, "тест_require_perm_role_1", ["admin_clients.edit"])
    user = _mk_user(db, "тест_require_perm_role_1", "тест-require-perm-op1")
    dep = require_perm("admin_clients.edit")
    assert dep(user=user, db=db) is user


def test_require_perm_denies_role_without_key(db_session):
    db = db_session
    _set_role_keys(db, "тест_require_perm_role_2", ["admin_clients.view"])
    user = _mk_user(db, "тест_require_perm_role_2", "тест-require-perm-op2")
    dep = require_perm("admin_clients.delete")
    with pytest.raises(HTTPException) as exc:
        dep(user=user, db=db)
    assert exc.value.status_code == 403


# ── _migrate_role_permissions_granular() ────────────────────────────────────

def test_migrate_expands_group_key_to_view_only(db_session):
    role = "тест_migration_group"
    _set_role_keys(db_session, role, ["admin_clients", "orders"])

    _migrate_role_permissions_granular()

    keys = _get_role_keys(role)
    assert "admin_clients" not in keys
    assert "admin_clients.view" in keys
    assert "orders" in keys  # сторінковий ключ не чіпається
    # create/edit/delete НЕ виставляються — ці дії ніколи не працювали
    # для non-admin (require_admin блокував завжди).
    for action in ("create", "edit", "delete"):
        assert f"admin_clients.{action}" not in keys


def test_migrate_all_five_groups(db_session):
    role = "тест_migration_all_groups"
    _set_role_keys(db_session, role, [
        "admin_goods", "admin_clients", "admin_prices", "admin_org", "admin_system",
    ])

    _migrate_role_permissions_granular()

    keys = set(_get_role_keys(role))
    for group in ("admin_goods", "admin_clients", "admin_prices", "admin_org", "admin_system"):
        assert group not in keys
        assert f"{group}.view" in keys


@pytest.mark.parametrize("visibility_key", ["finances", "reports", "dashboard"])
def test_migrate_preserves_finance_mutate_via_any_visibility_source(db_session, visibility_key):
    """Підтверджено користувачем: статус-кво зберігається для ВСІХ трьох
    джерел видимості Фінансів (включно з тим, як owner потрапляє туди
    лише через 'reports'/'dashboard', не буквальний 'finances')."""
    role = f"тест_migration_fin_{visibility_key}"
    _set_role_keys(db_session, role, [visibility_key])

    _migrate_role_permissions_granular()

    keys = set(_get_role_keys(role))
    assert "finances.create" in keys
    assert "finances.edit" in keys
    assert "finances.delete" in keys


def test_migrate_does_not_grant_finances_without_visibility(db_session):
    role = "тест_migration_no_finances"
    _set_role_keys(db_session, role, ["baking", "shop"])

    _migrate_role_permissions_granular()

    keys = set(_get_role_keys(role))
    assert "finances.create" not in keys
    assert "finances.edit" not in keys
    assert "finances.delete" not in keys


def test_migrate_is_idempotent(db_session):
    role = "тест_migration_idempotent"
    _set_role_keys(db_session, role, ["admin_org", "reports"])

    _migrate_role_permissions_granular()
    first = sorted(_get_role_keys(role))
    _migrate_role_permissions_granular()
    second = sorted(_get_role_keys(role))

    assert first == second
