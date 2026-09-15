"""Спільні фікстури тестів.

ВАЖЛИВО: DATABASE_URL і BAKERY_DATA_DIR встановлюються ДО імпорту backend.*,
бо backend.database читає DATABASE_URL на етапі імпорту модуля. Тести працюють
на ізольованій тимчасовій БД — реальна bakery.db не зачіпається.
"""

import os
import tempfile

_TMP = tempfile.mkdtemp(prefix="bakery_test_")
os.environ["DATABASE_URL"] = f"sqlite:///{os.path.join(_TMP, 'test.db')}"
os.environ["BAKERY_DATA_DIR"] = _TMP
# Fernet-ключ шифрування — у тимчасову папку, щоб не чіпати проектний .fernet_key
os.environ.setdefault("BAKERY_DATA_DIR", _TMP)

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(scope="session")
def app_client():
    """TestClient проти застосунку на тимчасовій БД (з посіяними дефолтними користувачами)."""
    from backend.main import app
    with TestClient(app) as c:
        yield c


def _login(client, username, password):
    r = client.post("/api/v1/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, f"login {username} failed: {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="session")
def admin_token(app_client):
    return _login(app_client, "admin", "admin")


@pytest.fixture(scope="session")
def operator_token(app_client):
    return _login(app_client, "operator", "operator")


@pytest.fixture
def db_session():
    """Пряма сесія БД для тестів сервісів."""
    from backend.database import SessionLocal
    db = SessionLocal()
    try:
        yield db
    finally:
        db.rollback()
        db.close()
