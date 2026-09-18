"""Регрес-тест на критичну знахідку QA-аудиту: PUT /invoices/{id}/lines не
перевіряв кількість на нижню межу. Від'ємна кількість + від'ємна ціна
(price_override) давали позитивну суму (мінус на мінус) — можливість
довільно роздути total_sum накладної без жодної помітної помилки.

Відтворено до фіксу: PUT /invoices/243577/lines {"lines":[{"id":175721,
"qty":-50}]} → 200 OK, рядок з ціною -100 і кількістю -50 дав суму 5000.0.

Виправлено: InvoiceLineQtyUpdate.qty отримав Field(..., ge=0) —
FastAPI/Pydantic тепер відхиляє запит з 422 ДО того, як він дійде до
update_invoice_lines().
"""

from backend.database import SessionLocal
from backend.models.references import Client, Product
from backend.models.invoices import Invoice, InvoiceLine


def _mk_invoice_with_line(db, qty=3.0, price=25.5):
    client = Client(full_name="Тест-qty-валідація", client_kind="customer", is_active=1)
    product = Product(name="Тест-виріб-qty", is_active=1)
    db.add_all([client, product]); db.flush()
    inv = Invoice(invoice_number=f"TEST-QTY-{client.id}", invoice_date="2027-09-20",
                  client_id=client.id, status="draft", total_sum=qty * price)
    db.add(inv); db.flush()
    line = InvoiceLine(invoice_id=inv.id, product_id=product.id, qty=qty, price=price,
                        sum=round(qty * price, 2))
    db.add(line); db.flush()
    return inv.id, line.id


def test_negative_qty_rejected_with_422(app_client, admin_token):
    db = SessionLocal()
    inv_id, line_id = _mk_invoice_with_line(db)
    db.commit()
    db.close()

    headers = {"Authorization": f"Bearer {admin_token}"}
    resp = app_client.put(
        f"/api/v1/invoices/{inv_id}/lines",
        json={"lines": [{"id": line_id, "qty": -50, "price_override": -100}]},
        headers=headers,
    )
    assert resp.status_code == 422, resp.text

    db = SessionLocal()
    line = db.get(InvoiceLine, line_id)
    assert line.qty == 3.0, "негативний qty не мав дійти до бізнес-логіки і змінити рядок"
    db.close()


def test_positive_qty_still_works(app_client, admin_token):
    """Регрес: перевірка ge=0 не повинна блокувати звичайне (позитивне) редагування."""
    db = SessionLocal()
    inv_id, line_id = _mk_invoice_with_line(db)
    db.commit()
    db.close()

    headers = {"Authorization": f"Bearer {admin_token}"}
    resp = app_client.put(
        f"/api/v1/invoices/{inv_id}/lines",
        json={"lines": [{"id": line_id, "qty": 5}]},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text

    db = SessionLocal()
    line = db.get(InvoiceLine, line_id)
    assert line.qty == 5.0
    db.close()


def test_zero_qty_is_allowed(app_client, admin_token):
    """qty=0 — легітимний випадок (напр. клієнта повністю виключили з рядка), ge=0 включно."""
    db = SessionLocal()
    inv_id, line_id = _mk_invoice_with_line(db)
    db.commit()
    db.close()

    headers = {"Authorization": f"Bearer {admin_token}"}
    resp = app_client.put(
        f"/api/v1/invoices/{inv_id}/lines",
        json={"lines": [{"id": line_id, "qty": 0}]},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
