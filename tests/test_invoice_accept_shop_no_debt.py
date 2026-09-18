"""Регрес-тест на "високу" знахідку QA-аудиту: борговий запис для
магазину/системного клієнта міг з'явитись у момент САМОГО ПРИЙНЯТТЯ
накладної (PUT /invoices/{id}/status?status=accepted) — перевірка
client_kind/is_own_shop існувала лише в recompute_invoice_finance()
(подальші корекції), а не в create_invoice_finance_entry(), яку
update_invoice_status викликає напряму. Якщо після прийняття жодної
корекції не відбувалось — фіктивний борг лишався назавжди.

Виправлено: create_invoice_finance_entry() тепер сама перевіряє
client_kind і нічого не створює для shop/writeoff/ration.
"""

from backend.database import SessionLocal
from backend.models.references import Client, Product
from backend.models.invoices import Invoice, InvoiceLine
from backend.models.finances import Finance


def test_accepting_shop_invoice_does_not_create_debt(app_client, admin_token):
    db = SessionLocal()
    shop = Client(full_name="Тест-shop-no-debt", client_kind="shop", is_own_shop=1, is_active=1)
    product = Product(name="Тест-shop-no-debt-product", is_active=1)
    db.add_all([shop, product]); db.flush()
    inv = Invoice(invoice_number="TEST-SHOP-NODEBT", invoice_date="2027-08-10",
                  client_id=shop.id, status="sent", total_sum=100.0)
    db.add(inv); db.flush()
    db.add(InvoiceLine(invoice_id=inv.id, product_id=product.id, qty=4, price=25.0, sum=100.0))
    db.commit()
    inv_id, shop_id = inv.id, shop.id
    db.close()

    headers = {"Authorization": f"Bearer {admin_token}"}
    resp = app_client.put(
        f"/api/v1/invoices/{inv_id}/status?status=accepted",
        json={},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text

    db = SessionLocal()
    debt_entries = db.query(Finance).filter_by(client_id=shop_id, finance_type="invoice").all()
    assert debt_entries == [], "прийняття накладної магазину не мало створювати борг"
    db.close()
