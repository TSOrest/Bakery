"""Регрес-тести на повторний аудит "Магазин/POS":

1. Критична: майже весь backend/routers/shop.py (27 ендпоінтів) не мав
   жодної auth-залежності — GET/POST/DELETE доступні без токена. Виправлено:
   dependencies=[Depends(require_user)] на рівні роутера (як bot.py/issues.py).
   Заразом закриваючі/видаляючі дії (confirm/delete reconciliation,
   update_opening_cash) заблоковано для ролі seller (_forbid_seller) —
   POS-каса, обмежена на фронтенді лише сторінкою /pos.
2. Високі: qty/price/entered_balance без нижньої межі (schemas/shop.py) —
   від'ємні значення роздували очікувану готівку/залишок; надходження
   заднім числом у вже закритий період мовчки зникало і не видалялось;
   неіснуючий client_id у add_disposal давав необроблений 500.
"""

from backend.database import SessionLocal
from backend.models.references import Client, Product
from backend.models.shop import ShopReconciliation


def _mk_shop_client(db, name="Тест-shop-audit"):
    c = Client(full_name=name, client_kind="shop", is_own_shop=1, is_active=1)
    db.add(c); db.flush()
    return c


def test_shop_summary_requires_auth(app_client):
    resp = app_client.get("/api/v1/shop/summary", params={"date": "2027-01-01"})
    assert resp.status_code == 401


def test_shop_receipts_post_requires_auth(app_client):
    resp = app_client.post("/api/v1/shop/receipts", json={
        "shop_client_id": 1, "receipt_date": "2027-01-01", "product_id": 1, "qty": 5,
    })
    assert resp.status_code == 401


def _make_seller_token(app_client, admin_token, username="audit_seller"):
    app_client.post(
        "/api/v1/auth/users",
        json={"username": username, "password": "sellerpass123", "full_name": "Тест продавець", "role": "seller"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    resp = app_client.post("/api/v1/auth/login", json={"username": username, "password": "sellerpass123"})
    assert resp.status_code == 200, resp.text
    return resp.json()["token"]


def test_seller_cannot_confirm_reconciliation(app_client, admin_token):
    db = SessionLocal()
    shop = _mk_shop_client(db, "Тест-shop-seller-confirm")
    rec = ShopReconciliation(shop_client_id=shop.id, period_from="2027-01-01", period_to="2027-01-01", closed=0)
    db.add(rec); db.commit()
    rec_id = rec.id
    db.close()

    seller_token = _make_seller_token(app_client, admin_token, "audit_seller_confirm")
    resp = app_client.post(
        f"/api/v1/shop/reconciliations/{rec_id}/confirm",
        json={},
        headers={"Authorization": f"Bearer {seller_token}"},
    )
    assert resp.status_code == 403


def test_seller_cannot_delete_reconciliation(app_client, admin_token):
    db = SessionLocal()
    shop = _mk_shop_client(db, "Тест-shop-seller-delete")
    rec = ShopReconciliation(shop_client_id=shop.id, period_from="2027-01-01", period_to="2027-01-01", closed=0)
    db.add(rec); db.commit()
    rec_id = rec.id
    db.close()

    seller_token = _make_seller_token(app_client, admin_token, "audit_seller_delete")
    resp = app_client.delete(
        f"/api/v1/shop/reconciliations/{rec_id}",
        headers={"Authorization": f"Bearer {seller_token}"},
    )
    assert resp.status_code == 403


def test_negative_receipt_qty_rejected(app_client, admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    resp = app_client.post(
        "/api/v1/shop/receipts",
        json={"shop_client_id": 1, "receipt_date": "2027-01-01", "product_id": 1, "qty": -50},
        headers=headers,
    )
    assert resp.status_code == 422


def test_negative_sale_qty_rejected(app_client, admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    resp = app_client.post(
        "/api/v1/shop/sales",
        json={
            "shop_client_id": 1, "sale_date": "2027-01-01",
            "lines": [{"product_id": 1, "qty": -5, "price": 10}],
        },
        headers=headers,
    )
    assert resp.status_code == 422


def test_empty_sale_lines_rejected(app_client, admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    resp = app_client.post(
        "/api/v1/shop/sales",
        json={"shop_client_id": 1, "sale_date": "2027-01-01", "lines": []},
        headers=headers,
    )
    assert resp.status_code == 422


def test_receipt_into_closed_period_rejected(app_client, admin_token):
    db = SessionLocal()
    shop = _mk_shop_client(db, "Тест-shop-closed-period")
    product = Product(name="Тест-продукт-closed-period", is_active=1)
    db.add(product); db.flush()
    rec = ShopReconciliation(shop_client_id=shop.id, period_from="2027-01-01",
                              period_to="2027-01-10", closed=1)
    db.add(rec); db.commit()
    shop_id, product_id = shop.id, product.id
    db.close()

    headers = {"Authorization": f"Bearer {admin_token}"}
    resp = app_client.post(
        "/api/v1/shop/receipts",
        json={"shop_client_id": shop_id, "receipt_date": "2027-01-05",
              "product_id": product_id, "qty": 10},
        headers=headers,
    )
    assert resp.status_code == 409


def test_add_disposal_nonexistent_client_gives_404_not_500(app_client, admin_token):
    from backend.models.shop import ShopReconciliationLine

    db = SessionLocal()
    shop = _mk_shop_client(db, "Тест-shop-disposal-fk")
    product = Product(name="Тест-продукт-disposal-fk", is_active=1)
    db.add(product); db.flush()
    rec = ShopReconciliation(shop_client_id=shop.id, period_from="2027-01-01",
                              period_to="2027-01-01", closed=0)
    db.add(rec); db.flush()
    line = ShopReconciliationLine(reconciliation_id=rec.id, product_id=product.id,
                                   opening_balance=10, received=0)
    db.add(line); db.commit()
    rec_id, line_id = rec.id, line.id
    db.close()

    headers = {"Authorization": f"Bearer {admin_token}"}
    resp = app_client.post(
        f"/api/v1/shop/reconciliations/{rec_id}/lines/{line_id}/disposals",
        json={"disposal_type": "client", "client_id": 9_999_999, "qty": 1},
        headers=headers,
    )
    assert resp.status_code == 404
