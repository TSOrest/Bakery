"""Регрес-тести на "середні" знахідки QA-аудиту (Розділ 4 — Довідники/адмін):

1. POST /prices/ не перевіряв перетин діапазонів дат, коли задані ОБИДВІ
   valid_from і valid_to (перевірка була лише для безстрокових цін).
2. Кнопка "Відновити" маршруту не працювала — PUT /routes/{id} приймав
   RouteCreate (без is_active) і використовував model_dump() без
   exclude_unset (будь-яке часткове збереження скидало sort_order на 0).
3. Однакову назву маршруту можна було створити двічі (conflict_msg існував
   у коді, але без unique-індексу ніколи не спрацьовував).
"""

from backend.database import SessionLocal
from backend.models.references import Product, Route
from backend.models.pricing import Price


def _mk_product(db, name="Тест-продукт-ціни"):
    p = Product(name=name, is_active=1)
    db.add(p); db.commit(); db.refresh(p)
    return p


def test_bounded_price_overlap_rejected(app_client, admin_token):
    db = SessionLocal()
    product = _mk_product(db)
    product_id = product.id
    db.close()

    headers = {"Authorization": f"Bearer {admin_token}"}
    resp1 = app_client.post(
        "/api/v1/prices/",
        json={"product_id": product_id, "price": 10, "valid_from": "2027-01-01", "valid_to": "2027-12-31"},
        headers=headers,
    )
    assert resp1.status_code == 201

    resp2 = app_client.post(
        "/api/v1/prices/",
        json={"product_id": product_id, "price": 20, "valid_from": "2027-06-01", "valid_to": "2027-08-31"},
        headers=headers,
    )
    assert resp2.status_code == 409


def test_bounded_price_non_overlapping_accepted(app_client, admin_token):
    db = SessionLocal()
    product = _mk_product(db, "Тест-продукт-ціни-2")
    product_id = product.id
    db.close()

    headers = {"Authorization": f"Bearer {admin_token}"}
    resp1 = app_client.post(
        "/api/v1/prices/",
        json={"product_id": product_id, "price": 10, "valid_from": "2027-01-01", "valid_to": "2027-06-30"},
        headers=headers,
    )
    assert resp1.status_code == 201

    resp2 = app_client.post(
        "/api/v1/prices/",
        json={"product_id": product_id, "price": 20, "valid_from": "2027-07-01", "valid_to": "2027-12-31"},
        headers=headers,
    )
    assert resp2.status_code == 201


def test_route_restore_sets_is_active(app_client, admin_token):
    db = SessionLocal()
    r = Route(name="Тест-маршрут-restore", sort_order=7, is_active=0)
    db.add(r); db.commit(); db.refresh(r)
    route_id = r.id
    db.close()

    headers = {"Authorization": f"Bearer {admin_token}"}
    resp = app_client.put(
        f"/api/v1/routes/{route_id}",
        json={"is_active": 1},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["is_active"] == 1
    assert resp.json()["sort_order"] == 7, "часткове оновлення не мало скидати sort_order"


def test_duplicate_route_name_rejected(app_client, admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    resp1 = app_client.post(
        "/api/v1/routes/",
        json={"name": "Тест-дублікат-маршруту", "sort_order": 0},
        headers=headers,
    )
    assert resp1.status_code == 201

    resp2 = app_client.post(
        "/api/v1/routes/",
        json={"name": "Тест-дублікат-маршруту", "sort_order": 1},
        headers=headers,
    )
    assert resp2.status_code == 409
