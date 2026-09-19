"""Регрес-тести на систему сповіщень у програмі (дзвоник у Layout.tsx) —
пропозиція з QA-аудиту (ідея №12), суттєво розширена користувачем.
"""

from backend.models.notifications import Notification, create_notification


def test_create_and_list_notification(db_session, app_client, admin_token):
    db = db_session
    n = create_notification(db, "bot_order", "Тест-сповіщення", "тіло")
    db.commit()

    r = app_client.get("/api/v1/notifications", headers={"Authorization": f"Bearer {admin_token}"})
    assert r.status_code == 200
    ids = [x["id"] for x in r.json()]
    assert n.id in ids

    r = app_client.get("/api/v1/notifications/unread-count", headers={"Authorization": f"Bearer {admin_token}"})
    assert r.status_code == 200
    assert r.json()["count"] >= 1


def test_mark_read_and_read_all(db_session, app_client, admin_token):
    db = db_session
    n1 = create_notification(db, "bot_order", "Непрочитане 1")
    n2 = create_notification(db, "bot_order", "Непрочитане 2")
    db.commit()

    headers = {"Authorization": f"Bearer {admin_token}"}
    r = app_client.post(f"/api/v1/notifications/{n1.id}/read", headers=headers)
    assert r.status_code == 200

    r = app_client.get("/api/v1/notifications", headers=headers)
    by_id = {x["id"]: x for x in r.json()}
    assert by_id[n1.id]["read_at"] is not None
    assert by_id[n2.id]["read_at"] is None

    r = app_client.post("/api/v1/notifications/read-all", headers=headers)
    assert r.status_code == 200
    r = app_client.get("/api/v1/notifications/unread-count", headers=headers)
    assert r.json()["count"] == 0


def test_request_update_denied_without_permission(app_client, operator_token):
    """Оператор без дозволу can_install_update не може ініціювати оновлення."""
    r = app_client.post(
        "/api/v1/settings/request-update",
        json={"version": "v9.9.9", "changelog": ""},
        headers={"Authorization": f"Bearer {operator_token}"},
    )
    assert r.status_code == 403


def test_request_update_delays_when_other_session_active(app_client, admin_token, operator_token):
    """Адмін завжди має дозвіл. operator_token гарантує наявність іншої
    щойно активної сесії (last_used_at виставляється при логіні) — тож
    відповідь має бути delayed=True і створити сповіщення-попередження
    БЕЗ негайного запису прапора UPDATE_REQUESTED (пише 60с потому)."""
    from backend.routers import settings as settings_router

    if settings_router.UPDATE_REQUESTED.exists():
        settings_router.UPDATE_REQUESTED.unlink()

    r = app_client.post(
        "/api/v1/settings/request-update",
        json={"version": "v9.9.9", "changelog": "тестовий опис"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["delayed"] is True
    assert data["other_sessions"] >= 1
    assert not settings_router.UPDATE_REQUESTED.exists()

    r2 = app_client.get("/api/v1/notifications", headers={"Authorization": f"Bearer {admin_token}"})
    warnings = [n for n in r2.json() if n["type"] == "update_warning"]
    assert any("v9.9.9" in (n["body"] or "") for n in warnings)
