"""Регрес-тест на "середню" знахідку QA-аудиту: кнопка «Сформувати накладні»
у вкладці «Внутрішні» (клієнти без маршруту) показує лічильник лише
внутрішніх клієнтів, але сама дія (POST /invoices/generate-drafts) без
route_id формує накладні для клієнтів УСІХ маршрутів одразу.

Виправлено: route_id=0 — сентинел «без маршруту» (реальні route_id завжди
autoincrement >=1). backend/routers/invoices.py, generate_drafts() тепер
фільтрує Client.route_id IS NULL для route_id=0.
frontend/src/pages/RoutesPage.tsx (generateInvoices) відправляє route_id=0
коли обрано вкладку «Внутрішні» (activeRouteId===-1).
"""

from backend.database import SessionLocal
from backend.models.references import Client, Product, Route
from backend.models.orders import Order


def test_route_id_zero_creates_only_for_clients_without_route(app_client, admin_token):
    db = SessionLocal()
    route = Route(name="Тест-маршрут-сентинел", is_active=1)
    internal_client = Client(full_name="Тест-внутрішній-клієнт", client_kind="customer",
                              is_active=1, route_id=None)
    routed_client = Client(full_name="Тест-клієнт-на-маршруті", client_kind="customer", is_active=1)
    product = Product(name="Тест-продукт-сентинел", is_active=1)
    db.add_all([route, internal_client, routed_client, product]); db.flush()
    routed_client.route_id = route.id
    db.add_all([
        Order(client_id=internal_client.id, product_id=product.id, qty=5, order_date="2027-09-01"),
        Order(client_id=routed_client.id, product_id=product.id, qty=7, order_date="2027-09-01"),
    ])
    db.commit()
    internal_id, routed_id = internal_client.id, routed_client.id
    db.close()

    headers = {"Authorization": f"Bearer {admin_token}"}
    resp = app_client.post(
        "/api/v1/invoices/generate-drafts?date=2027-09-01&route_id=0",
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["created"] == 1

    db = SessionLocal()
    from backend.models.invoices import Invoice
    assert db.query(Invoice).filter_by(client_id=internal_id, invoice_date="2027-09-01").first() is not None
    assert db.query(Invoice).filter_by(client_id=routed_id, invoice_date="2027-09-01").first() is None
    db.close()
