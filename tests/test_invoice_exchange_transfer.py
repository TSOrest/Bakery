"""Тести корекції обмінного хліба в накладній (POST /invoices/{id}/transfer,
поле source_line_kind).

Раніше transfer_invoice_line повністю виключав рядки line_kind='exchange' — і
як джерело, і як ціль (не можна було ані перемістити обмінний хліб на
магазин/списання, ані "перетворити" його на платний, якщо клієнт фактично
продав, а не обміняв). source_line_kind='exchange' відкриває обидва шляхи:
- інший клієнт (магазин/списання/клієнт) — як і сьогодні для звичайних рядків;
- ТОЙ САМИЙ клієнт (raніше заборонено як "не можна переміщати самому собі") —
  сценарій "обмін продано як звичайний": кількість переходить з безкоштовного
  обмінного рядка в платний звичайний рядок.

source_line_kind='normal' (default) — поведінка 1:1 як до цієї зміни.
"""

from backend.database import SessionLocal
from backend.models.references import Client, Product
from backend.models.pricing import Price
from backend.models.invoices import Invoice, InvoiceLine, InvoiceTransfer


def _mk_client(db, name="Клієнт", client_kind="customer", is_own_shop=0):
    c = Client(full_name=name, client_kind=client_kind, is_active=1, is_own_shop=is_own_shop)
    db.add(c); db.flush()
    return c


def _mk_product(db, name="Батон"):
    p = Product(name=name, is_active=1)
    db.add(p); db.flush()
    return p


def _mk_invoice(db, client_id, date="2026-09-16"):
    inv = Invoice(invoice_number=f"TEST-{client_id}-{date}", invoice_date=date,
                  client_id=client_id, status="sent", total_sum=0)
    db.add(inv); db.flush()
    return inv


def test_transfer_exchange_line_to_shop(app_client, admin_token):
    """Обмінний рядок можна перемістити на магазин — ціль отримує звичайний
    рядок за правильною ціною, леджер зберігає line_kind='exchange'."""
    db = SessionLocal()
    client = _mk_client(db, "Клієнт-обмін")
    shop = _mk_client(db, "Магазин", client_kind="shop", is_own_shop=1)
    product = _mk_product(db)
    db.add(Price(product_id=product.id, price=18.5, valid_from="2026-01-01", is_active=1))
    inv = _mk_invoice(db, client.id)
    db.add(InvoiceLine(invoice_id=inv.id, product_id=product.id, qty=2, price=0.0,
                        sum=0.0, line_kind="exchange"))
    db.commit(); db.refresh(inv)
    inv_id, product_id, shop_id = inv.id, product.id, shop.id
    db.close()

    resp = app_client.post(
        f"/api/v1/invoices/{inv_id}/transfer",
        json={"product_id": product_id, "qty": 1, "to_client_id": shop_id, "source_line_kind": "exchange"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200, resp.text

    db = SessionLocal()
    src = db.get(Invoice, inv_id)
    exch_line = next(l for l in src.lines if l.line_kind == "exchange")
    assert exch_line.qty == 1

    shop_inv = (db.query(Invoice).filter(Invoice.client_id == shop_id).first())
    normal_line = next(l for l in shop_inv.lines if l.line_kind == "normal")
    assert normal_line.qty == 1
    assert normal_line.price == 18.5

    transfer = db.query(InvoiceTransfer).filter(InvoiceTransfer.source_invoice_id == inv_id).first()
    assert transfer.line_kind == "exchange"
    db.close()


def test_transfer_exchange_line_to_self_becomes_paid(app_client, admin_token):
    """Сценарій користувача: клієнт продав обмінний хліб як звичайний —
    кількість переходить з обмінного рядка в платний рядок того ж клієнта,
    сума накладної зростає рівно на ціну одиниці."""
    db = SessionLocal()
    client = _mk_client(db, "Болотня")
    product = _mk_product(db, "Батон Прикарпатський-1 різаний")
    db.add(Price(product_id=product.id, price=26.5, valid_from="2026-01-01", is_active=1))
    inv = _mk_invoice(db, client.id)
    db.add(InvoiceLine(invoice_id=inv.id, product_id=product.id, qty=3, price=26.5,
                        sum=79.5, line_kind="normal"))
    db.add(InvoiceLine(invoice_id=inv.id, product_id=product.id, qty=2, price=0.0,
                        sum=0.0, line_kind="exchange"))
    inv.total_sum = 79.5
    db.commit(); db.refresh(inv)
    inv_id, product_id, client_id = inv.id, product.id, client.id
    db.close()

    resp = app_client.post(
        f"/api/v1/invoices/{inv_id}/transfer",
        json={"product_id": product_id, "qty": 1, "to_client_id": client_id, "source_line_kind": "exchange"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200, resp.text

    db = SessionLocal()
    inv = db.get(Invoice, inv_id)
    normal_line = next(l for l in inv.lines if l.line_kind == "normal")
    exch_line = next(l for l in inv.lines if l.line_kind == "exchange")
    assert normal_line.qty == 4      # 3 → 4
    assert exch_line.qty == 1        # 2 → 1
    assert inv.total_sum == 79.5 + 26.5   # +1 одиниця за ціною

    transfer = db.query(InvoiceTransfer).filter(InvoiceTransfer.source_invoice_id == inv_id).first()
    assert transfer.line_kind == "exchange"
    assert transfer.target_invoice_id == inv_id   # self-transfer
    db.close()


def test_transfer_self_normal_line_still_rejected(app_client, admin_token):
    """Регрес: звичайний рядок (source_line_kind='normal', default) і далі не
    можна переміщати самому собі — захист не зламано."""
    db = SessionLocal()
    client = _mk_client(db, "Клієнт-норм")
    product = _mk_product(db)
    inv = _mk_invoice(db, client.id)
    db.add(InvoiceLine(invoice_id=inv.id, product_id=product.id, qty=5, price=10.0,
                        sum=50.0, line_kind="normal"))
    db.commit(); db.refresh(inv)
    inv_id, product_id, client_id = inv.id, product.id, client.id
    db.close()

    resp = app_client.post(
        f"/api/v1/invoices/{inv_id}/transfer",
        json={"product_id": product_id, "qty": 1, "to_client_id": client_id},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 400


def test_transfer_exchange_missing_line_returns_400(app_client, admin_token):
    """Немає рядка обміну для цього виробу — 400, не 500 і не мовчазний no-op."""
    db = SessionLocal()
    client = _mk_client(db, "Клієнт-без-обміну")
    other = _mk_client(db, "Інший клієнт")
    product = _mk_product(db)
    inv = _mk_invoice(db, client.id)
    db.add(InvoiceLine(invoice_id=inv.id, product_id=product.id, qty=5, price=10.0,
                        sum=50.0, line_kind="normal"))
    db.commit(); db.refresh(inv)
    inv_id, product_id, other_id = inv.id, product.id, other.id
    db.close()

    resp = app_client.post(
        f"/api/v1/invoices/{inv_id}/transfer",
        json={"product_id": product_id, "qty": 1, "to_client_id": other_id, "source_line_kind": "exchange"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 400


def test_transfer_default_source_kind_unchanged(app_client, admin_token):
    """source_line_kind не передано → поведінка 1:1 як до зміни: джерело
    шукається серед НЕ-обмінних рядків, ледж записує line_kind='normal'."""
    db = SessionLocal()
    client = _mk_client(db, "Клієнт-дефолт")
    other = _mk_client(db, "Інший-2")
    product = _mk_product(db)
    db.add(Price(product_id=product.id, price=12.0, valid_from="2026-01-01", is_active=1))
    inv = _mk_invoice(db, client.id)
    db.add(InvoiceLine(invoice_id=inv.id, product_id=product.id, qty=5, price=12.0,
                        sum=60.0, line_kind="normal"))
    db.commit(); db.refresh(inv)
    inv_id, product_id, other_id = inv.id, product.id, other.id
    db.close()

    resp = app_client.post(
        f"/api/v1/invoices/{inv_id}/transfer",
        json={"product_id": product_id, "qty": 2, "to_client_id": other_id},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200, resp.text

    db = SessionLocal()
    transfer = db.query(InvoiceTransfer).filter(InvoiceTransfer.source_invoice_id == inv_id).first()
    assert transfer.line_kind == "normal"
    db.close()
