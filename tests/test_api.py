"""Базові тести API через TestClient FastAPI."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.database import Base, get_db
from backend.main import app

# Окрема in-memory БД для тестів
TEST_DB = "sqlite:///:memory:"
engine = create_engine(TEST_DB, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base.metadata.create_all(bind=engine)


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = override_get_db
client = TestClient(app)


# ---------------------------------------------------------------
# Health
# ---------------------------------------------------------------

def test_health():
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


# ---------------------------------------------------------------
# Довідники
# ---------------------------------------------------------------

def test_create_and_list_route():
    resp = client.post("/api/v1/routes/", json={"name": "Маршрут 1", "sort_order": 1})
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "Маршрут 1"

    resp2 = client.get("/api/v1/routes/")
    assert resp2.status_code == 200
    assert any(r["name"] == "Маршрут 1" for r in resp2.json())


def test_create_and_list_client():
    # Спочатку створюємо маршрут
    r = client.post("/api/v1/routes/", json={"name": "Маршрут А"}).json()

    resp = client.post("/api/v1/clients/", json={
        "full_name": "ТОВ Тест",
        "short_name": "Тест",
        "route_id": r["id"],
        "discount_pct": 5,
    })
    assert resp.status_code == 201
    assert resp.json()["full_name"] == "ТОВ Тест"


def test_create_product():
    resp = client.post("/api/v1/products/", json={
        "name": "Батон нарізний",
        "short_name": "Батон",
        "type": "bread",
        "weight": 0.5,
    })
    assert resp.status_code == 201
    assert resp.json()["type"] == "bread"


# ---------------------------------------------------------------
# Ціни
# ---------------------------------------------------------------

def test_create_price_and_resolve():
    product = client.post("/api/v1/products/", json={
        "name": "Хліб білий",
        "type": "bread",
    }).json()

    route = client.post("/api/v1/routes/", json={"name": "Маршрут Б"}).json()
    c = client.post("/api/v1/clients/", json={
        "full_name": "Клієнт Б",
        "route_id": route["id"],
    }).json()

    client.post("/api/v1/prices/", json={
        "product_id": product["id"],
        "price": 25.0,
        "valid_from": "2026-01-01",
    })

    resp = client.get(
        f"/api/v1/prices/resolve?product_id={product['id']}&client_id={c['id']}&date=2026-03-16"
    )
    assert resp.status_code == 200
    assert resp.json()["price"] == 25.0


# ---------------------------------------------------------------
# Замовлення
# ---------------------------------------------------------------

def test_create_and_copy_order():
    product = client.post("/api/v1/products/", json={"name": "Рогалик", "type": "bun"}).json()
    route = client.post("/api/v1/routes/", json={"name": "Маршрут В"}).json()
    c = client.post("/api/v1/clients/", json={
        "full_name": "Клієнт В",
        "route_id": route["id"],
    }).json()

    resp = client.post("/api/v1/orders/", json={
        "client_id": c["id"],
        "product_id": product["id"],
        "qty": 10,
        "order_date": "2026-03-15",
    })
    assert resp.status_code == 201

    copy_resp = client.post(
        "/api/v1/orders/copy?source_date=2026-03-15&target_date=2026-03-16"
    )
    assert copy_resp.status_code == 200
    assert copy_resp.json()["copied"] == 1


# ---------------------------------------------------------------
# Накладні (автонумерація)
# ---------------------------------------------------------------

def test_invoice_autonumber():
    product = client.post("/api/v1/products/", json={"name": "Коровай", "type": "bread"}).json()
    route = client.post("/api/v1/routes/", json={"name": "Маршрут Г"}).json()
    c = client.post("/api/v1/clients/", json={
        "full_name": "Клієнт Г",
        "route_id": route["id"],
    }).json()

    client.post("/api/v1/prices/", json={
        "product_id": product["id"],
        "price": 30.0,
        "valid_from": "2026-01-01",
    })

    resp = client.post("/api/v1/invoices/", json={
        "invoice_date": "2026-03-16",
        "client_id": c["id"],
        "lines": [{"product_id": product["id"], "qty": 5, "price": 30.0}],
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["invoice_number"].startswith("20260316-")
    assert data["total_sum"] == 150.0
