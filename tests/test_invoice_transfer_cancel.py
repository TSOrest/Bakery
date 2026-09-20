"""Тести скасування помилково внесеного переміщення
(POST /invoices/transfers/{transfer_id}/cancel).

Оператор хоче виправити помилково внесене списання/пайок без ручного
редагування рядків: кнопка "✕" біля виноски "передано → ..." у перегляді
накладної скасовує рух — повертає кількість у джерело, знімає її з цілі.
"""

from backend.database import SessionLocal
from backend.models.references import Client, Product
from backend.models.pricing import Price
from backend.models.invoices import Invoice, InvoiceLine, InvoiceTransfer


def _mk_client(db, name="Клієнт", client_kind="customer"):
    c = Client(full_name=name, client_kind=client_kind, is_active=1)
    db.add(c); db.flush()
    return c


def _system_client(db, client_kind):
    """writeoff/ration/underbaked — системні клієнти-синглтони (partial unique
    index на client_kind, міграція 030) — уже засіяні `_seed_initial_data()`,
    новий не створити."""
    c = db.query(Client).filter(Client.client_kind == client_kind).first()
    assert c is not None, f"системний клієнт {client_kind} має бути засіяний при старті"
    return c


def _mk_product(db, name="Батон"):
    p = Product(name=name, is_active=1)
    db.add(p); db.flush()
    return p


def _mk_invoice(db, client_id, date="2026-09-16", status="sent"):
    inv = Invoice(invoice_number=f"TEST-{client_id}-{date}-{status}", invoice_date=date,
                  client_id=client_id, status=status, total_sum=0)
    db.add(inv); db.flush()
    return inv


def test_cancel_normal_transfer_restores_source_and_removes_target(app_client, admin_token):
    db = SessionLocal()
    client = _mk_client(db, "Городок Колодій")
    writeoff = _system_client(db, "writeoff")
    product = _mk_product(db, "Батон Прикарпатський-1")
    db.add(Price(product_id=product.id, price=25.5, valid_from="2026-01-01", is_active=1))
    inv = _mk_invoice(db, client.id, date="2026-09-16")
    db.add(InvoiceLine(invoice_id=inv.id, product_id=product.id, qty=4, price=25.5,
                        sum=102.0, line_kind="normal"))
    inv.total_sum = 102.0
    db.commit(); db.refresh(inv)
    inv_id, product_id, writeoff_id = inv.id, product.id, writeoff.id
    db.close()

    resp = app_client.post(
        f"/api/v1/invoices/{inv_id}/transfer",
        json={"product_id": product_id, "qty": 1, "to_client_id": writeoff_id},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200, resp.text

    db = SessionLocal()
    src = db.get(Invoice, inv_id)
    assert next(l for l in src.lines if l.product_id == product_id).qty == 3
    assert src.total_sum == 76.5
    transfer = db.query(InvoiceTransfer).filter(InvoiceTransfer.source_invoice_id == inv_id).first()
    transfer_id = transfer.id
    writeoff_inv = db.query(Invoice).filter(
        Invoice.client_id == writeoff_id, Invoice.invoice_date == "2026-09-16"
    ).first()
    writeoff_inv_id = writeoff_inv.id
    db.close()

    resp = app_client.post(
        f"/api/v1/invoices/transfers/{transfer_id}/cancel",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200, resp.text

    db = SessionLocal()
    src = db.get(Invoice, inv_id)
    line = next(l for l in src.lines if l.product_id == product_id)
    assert line.qty == 4          # повернуто назад
    assert src.total_sum == 102.0

    writeoff_inv = db.get(Invoice, writeoff_inv_id)
    assert not any(l.product_id == product_id for l in writeoff_inv.lines)  # рядок цілі видалено

    assert db.get(InvoiceTransfer, transfer_id) is None   # запис переміщення прибрано
    db.close()


def test_cancel_transfer_rejects_when_source_accepted(app_client, admin_token):
    db = SessionLocal()
    client = _mk_client(db, "Клієнт-прийнято")
    writeoff = _system_client(db, "writeoff")
    product = _mk_product(db, "Хліб Гречаний")
    inv = _mk_invoice(db, client.id, date="2026-09-17", status="sent")
    db.add(InvoiceLine(invoice_id=inv.id, product_id=product.id, qty=5, price=32.0,
                        sum=160.0, line_kind="normal"))
    inv.total_sum = 160.0
    db.commit(); db.refresh(inv)
    inv_id, product_id, writeoff_id = inv.id, product.id, writeoff.id
    db.close()

    resp = app_client.post(
        f"/api/v1/invoices/{inv_id}/transfer",
        json={"product_id": product_id, "qty": 1, "to_client_id": writeoff_id},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200, resp.text
    transfer_id_resp = app_client.get(
        f"/api/v1/invoices/{inv_id}", headers={"Authorization": f"Bearer {admin_token}"}
    ).json()
    transfer_id = transfer_id_resp["transfers"][0]["id"]

    # Приймаємо накладну-джерело — скасування має стати недоступним
    db = SessionLocal()
    src = db.get(Invoice, inv_id)
    src.status = "accepted"
    db.commit()
    db.close()

    resp = app_client.post(
        f"/api/v1/invoices/transfers/{transfer_id}/cancel",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 400


def test_cancel_transfer_rejects_when_target_qty_already_reduced(app_client, admin_token):
    """Якщо кількість у цільовому рядку вже зменшена іншою дією (напр. ручна
    правка PUT /invoices/{id}/lines) — автоматичне скасування відхиляється,
    а не обнуляє щось довільне."""
    db = SessionLocal()
    client = _mk_client(db, "Клієнт-Х")
    ration = _system_client(db, "ration")
    product = _mk_product(db, "Хліб Карпатський")
    inv = _mk_invoice(db, client.id, date="2026-09-18")
    db.add(InvoiceLine(invoice_id=inv.id, product_id=product.id, qty=10, price=20.0,
                        sum=200.0, line_kind="normal"))
    inv.total_sum = 200.0
    db.commit(); db.refresh(inv)
    inv_id, product_id, ration_id = inv.id, product.id, ration.id
    db.close()

    resp = app_client.post(
        f"/api/v1/invoices/{inv_id}/transfer",
        json={"product_id": product_id, "qty": 3, "to_client_id": ration_id},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200, resp.text

    db = SessionLocal()
    transfer = db.query(InvoiceTransfer).filter(InvoiceTransfer.source_invoice_id == inv_id).first()
    transfer_id = transfer.id
    ration_inv = db.query(Invoice).filter(
        Invoice.client_id == ration_id, Invoice.invoice_date == "2026-09-18"
    ).first()
    ration_line = next(l for l in ration_inv.lines if l.product_id == product_id)
    ration_line.qty = 1     # хтось вручну зменшив цільовий рядок нижче переміщеної кількості
    ration_line.sum = 20.0
    db.commit()
    db.close()

    resp = app_client.post(
        f"/api/v1/invoices/transfers/{transfer_id}/cancel",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 400
