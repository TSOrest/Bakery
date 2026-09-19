"""Регрес-тести на "низькі" знахідки QA-аудиту (Розділ 4 — Довідники/адмін):

1. Створення категорії/одиниці не працювало через Swagger (name як бар
   query-параметр, не JSON-тіло) — виправлено: NameCreate схема.
2. Оманливий 409 замість 404 на неіснуючі FK у create_ingredient (unit_id),
   create_override (client_id/product_id), create_price (product_id).
3. GitHub client secret тепер шифрується (Fernet) при збереженні через
   PUT /settings/, як і сусідній github_oauth_token.
4. Деактивація виробу/клієнта повертає інформаційне попередження
   (не блокує дію) якщо є нещодавня активність/ненульовий баланс.
"""

from backend.database import SessionLocal
from backend.models.references import Client, Product
from backend.models.orders import Order
from backend.models.finances import Finance, FinanceArticle
from backend.models.settings import Setting


def test_create_category_accepts_json_body(app_client, admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    resp = app_client.post(
        "/api/v1/categories",
        json={"name": "Тест-категорія-json-body"},
        headers=headers,
    )
    assert resp.status_code == 201
    assert resp.json()["name"] == "Тест-категорія-json-body"


def test_create_unit_accepts_json_body(app_client, admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    resp = app_client.post(
        "/api/v1/units",
        json={"name": "Тест-одиниця-json-body"},
        headers=headers,
    )
    assert resp.status_code == 201


def test_create_ingredient_nonexistent_unit_gives_404(app_client, admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    resp = app_client.post(
        "/api/v1/ingredients/",
        json={"name": "Тест-інгредієнт-fk", "unit_id": 9_999_999},
        headers=headers,
    )
    assert resp.status_code == 404


def test_create_price_override_nonexistent_client_gives_404(app_client, admin_token):
    db = SessionLocal()
    product = Product(name="Тест-продукт-override-fk", is_active=1)
    db.add(product); db.commit(); db.refresh(product)
    product_id = product.id
    db.close()

    headers = {"Authorization": f"Bearer {admin_token}"}
    resp = app_client.post(
        "/api/v1/prices/overrides",
        json={"client_id": 9_999_999, "product_id": product_id, "price": 10, "valid_from": "2027-01-01"},
        headers=headers,
    )
    assert resp.status_code == 404


def test_create_price_nonexistent_product_gives_404(app_client, admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    resp = app_client.post(
        "/api/v1/prices/",
        json={"product_id": 9_999_999, "price": 10, "valid_from": "2027-01-01"},
        headers=headers,
    )
    assert resp.status_code == 404


def test_github_client_secret_encrypted_on_save(app_client, admin_token):
    from backend.services.crypto import is_encrypted

    headers = {"Authorization": f"Bearer {admin_token}"}
    resp = app_client.put(
        "/api/v1/settings/github_client_secret",
        json={"value": "plaintext-secret-abc123"},
        headers=headers,
    )
    assert resp.status_code == 200

    db = SessionLocal()
    row = db.get(Setting, "github_client_secret")
    stored = row.value
    db.close()
    assert stored != "plaintext-secret-abc123"
    assert is_encrypted(stored)


def test_deactivate_product_returns_warning_when_recently_ordered(app_client, admin_token):
    db = SessionLocal()
    client = Client(full_name="Тест-деактивація-продукт", client_kind="customer", is_active=1)
    product = Product(name="Тест-продукт-деактивація", is_active=1)
    db.add_all([client, product]); db.flush()
    from datetime import date
    db.add(Order(client_id=client.id, product_id=product.id, qty=3, order_date=date.today().isoformat()))
    db.commit()
    product_id = product.id
    db.close()

    headers = {"Authorization": f"Bearer {admin_token}"}
    resp = app_client.delete(f"/api/v1/products/{product_id}", headers=headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["deactivated"] is True
    assert body["warning"] is not None


def test_deactivate_client_returns_warning_when_balance_nonzero(app_client, admin_token):
    db = SessionLocal()
    client = Client(full_name="Тест-деактивація-клієнт-борг", client_kind="customer", is_active=1)
    db.add(client); db.flush()
    invoice_article = db.query(FinanceArticle).filter_by(name="Накладна").first()
    db.add(Finance(finance_date="2027-01-01", client_id=client.id, finance_type="invoice",
                    article_id=invoice_article.id if invoice_article else None,
                    amount=500.0, sign=-1))
    db.commit()
    client_id = client.id
    db.close()

    headers = {"Authorization": f"Bearer {admin_token}"}
    resp = app_client.delete(f"/api/v1/clients/{client_id}", headers=headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["deactivated"] is True
    assert "борг" in body["warning"]
