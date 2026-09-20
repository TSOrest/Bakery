"""Тест опціонального QR-коду Telegram-бота на друкованій накладній
(invoice_bot_qr_enabled, вимкнено за замовчуванням — пропозиція з
QA-аудиту). QR веде на t.me/<юзернейм>, контент однаковий для будь-якої
накладної (не залежить від даних конкретного рахунку)."""

from backend.models.references import Client, Product
from backend.models.invoices import Invoice, InvoiceLine
from backend.routers.print_views import render_invoice_block


def _mk_client(db, name="Клієнт-QR"):
    c = Client(full_name=name, client_kind="customer", is_active=1)
    db.add(c); db.flush()
    return c


def _mk_invoice(db, client_id, date="2026-09-20"):
    inv = Invoice(invoice_number=f"TEST-QR-{client_id}-{date}", invoice_date=date,
                  client_id=client_id, status="draft", total_sum=0)
    db.add(inv); db.flush()
    return inv


def _mk_basic_invoice(db):
    c = _mk_client(db)
    p = Product(name="Тест-Виріб-QR", is_active=1)
    db.add(p); db.flush()
    inv = _mk_invoice(db, c.id)
    db.add(InvoiceLine(invoice_id=inv.id, product_id=p.id, qty=1, price=10.0, sum=10.0))
    db.flush(); db.refresh(inv)
    return inv


def test_qr_absent_by_default(db_session):
    db = db_session
    inv = _mk_basic_invoice(db)
    html = render_invoice_block(inv, {}, db)
    assert "bot-qr" not in html


def test_qr_absent_when_enabled_but_no_username(db_session):
    db = db_session
    inv = _mk_basic_invoice(db)
    html = render_invoice_block(inv, {"invoice_bot_qr_enabled": "1"}, db)
    assert "bot-qr" not in html


def test_qr_present_when_enabled_and_username_set(db_session):
    db = db_session
    inv = _mk_basic_invoice(db)
    html = render_invoice_block(
        inv, {"invoice_bot_qr_enabled": "1", "telegram_bot_username": "MyBakeryTestBot"}, db,
    )
    assert "bot-qr" in html
    assert "data:image/png;base64," in html


def test_qr_username_strips_leading_at(db_session):
    """Юзернейм може бути введений з '@' — не повинно ламати генерацію."""
    db = db_session
    inv = _mk_basic_invoice(db)
    html = render_invoice_block(
        inv, {"invoice_bot_qr_enabled": "1", "telegram_bot_username": "@MyBakeryTestBot"}, db,
    )
    assert "bot-qr" in html
