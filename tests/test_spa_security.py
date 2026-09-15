"""Регрес-тест захисту SPA-fallback від path traversal.

Актуальний лише коли frontend/dist зібрано (є index.html) — інакше fallback
не змонтований і тест пропускається.
"""

from pathlib import Path

import pytest

_DIST = Path(__file__).parent.parent / "frontend" / "dist"
_HAS_DIST = (_DIST / "index.html").is_file()

pytestmark = pytest.mark.skipif(not _HAS_DIST, reason="frontend/dist не зібрано")

# Шляхи-спроби виходу за межі dist — жоден не має віддати файл поза dist.
TRAVERSAL_PATHS = [
    "/../../bakery.db",
    "/../../backend/database.py",
    "/../../.fernet_key",
    "/..%2f..%2fbakery.db",
    "/%2e%2e/%2e%2e/bakery.db",
]


@pytest.mark.parametrize("path", TRAVERSAL_PATHS)
def test_spa_fallback_blocks_traversal(app_client, path):
    resp = app_client.get(path)
    # Дозволено лише: 200 з HTML SPA (index.html) або 404 — але НЕ вміст БД/коду.
    body = resp.content
    assert b"SQLite format 3" not in body, f"{path} злив вміст БД!"
    assert b"DATABASE_URL" not in body, f"{path} злив вихідний код!"
    assert b"cryptography.fernet" not in body


def test_spa_fallback_serves_index_for_unknown_route(app_client):
    resp = app_client.get("/some/spa/route")
    assert resp.status_code == 200
    assert b"<!doctype html" in resp.content.lower() or b"<html" in resp.content.lower()
