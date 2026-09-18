"""Регрес-тест на критичну знахідку QA-аудиту: редактор бази даних
(/db-editor, лише роль admin) віддавав user_sessions.token і
users.password_hash/salt у відкритому, повністю робочому вигляді —
скопіювавши токен сесії з відповіді, можна увійти під тим користувачем
без пароля; одна скомпрометована admin-сесія перетворювалась на
компрометацію ВСІХ активних сесій.

Виправлено: ці поля маскуються у відповіді GET .../data (_mask_row) і
НЕ приймаються на запис через PUT .../row/{pk} (щоб бездумне "відкрити
рядок → зберегти" в UI не перезаписало реальний токен/хеш буквальним
текстом маски).
"""

from backend.database import SessionLocal
from backend.models.auth import User, UserSession
from datetime import datetime


def test_user_sessions_token_is_masked_in_data_response(app_client, admin_token):
    db = SessionLocal()
    user = db.query(User).filter_by(username="admin").first()
    user_id = user.id
    real_token = "test-db-editor-masking-real-token-value"
    db.add(UserSession(token=real_token, user_id=user_id,
                        created_at=datetime.now().isoformat(),
                        last_used_at=datetime.now().isoformat()))
    db.commit()
    db.close()

    headers = {"Authorization": f"Bearer {admin_token}"}
    resp = app_client.get(
        "/api/v1/db-editor/tables/user_sessions/data?page=0&page_size=200",
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    rows = resp.json()["rows"]
    assert not any(r.get("token") == real_token for r in rows), \
        "справжній bearer-токен не мав з'являтись у відповіді редактора бази"


def test_password_hash_and_salt_are_masked(app_client, admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    resp = app_client.get(
        "/api/v1/db-editor/tables/users/data?page=0&page_size=50",
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    rows = resp.json()["rows"]
    admin_row = next(r for r in rows if r.get("username") == "admin")
    assert not str(admin_row["password_hash"]).startswith("$2b$"), \
        "справжній bcrypt-хеш не мав з'являтись у відповіді редактора бази"


def test_blind_resave_does_not_overwrite_real_token(app_client, admin_token):
    """Типовий сценарій UI: відкрити рядок (отримати маску), зберегти назад
    без зміни цього поля — реальний токен має лишитись працездатним."""
    db = SessionLocal()
    user = db.query(User).filter_by(username="admin").first()
    user_id = user.id
    real_token = "test-db-editor-blind-resave-token"
    db.add(UserSession(token=real_token, user_id=user_id,
                        created_at=datetime.now().isoformat(),
                        last_used_at=datetime.now().isoformat()))
    db.commit()
    db.close()

    headers = {"Authorization": f"Bearer {admin_token}"}
    get_resp = app_client.get(
        "/api/v1/db-editor/tables/user_sessions/data?page=0&page_size=200",
        headers=headers,
    )
    rows = get_resp.json()["rows"]
    row = next(r for r in rows if r.get("user_id") == user_id and r.get("token") != real_token)
    masked_value = row["token"]

    put_resp = app_client.put(
        f"/api/v1/db-editor/tables/user_sessions/row/{real_token}",
        json={"token": masked_value, "user_id": user_id},
        headers=headers,
    )
    assert put_resp.status_code == 200, put_resp.text

    # Реальний токен і далі має існувати незмінним і працювати для авторизації.
    me_resp = app_client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {real_token}"})
    assert me_resp.status_code == 200, "справжній токен не мав зіпсуватись через маску"
