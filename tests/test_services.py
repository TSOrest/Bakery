"""Тести бізнес-сервісів: пріоритет цін, нумерація накладних, ретрай номера."""

from backend.models.references import Client, Product
from backend.models.pricing import Price, ClientPriceOverride
from backend.models.invoices import Invoice
from backend.services.prices import get_price
from backend.services.invoices import generate_invoice_number, create_invoice_row


def _mk_client(db, name="Клієнт", discount=0.0):
    c = Client(full_name=name, client_kind="customer", is_active=1, discount_pct=discount)
    db.add(c); db.flush()
    return c


def _mk_product(db, name="Хліб"):
    p = Product(name=name, is_active=1)
    db.add(p); db.flush()
    return p


# ── get_price: 4-рівневий пріоритет ────────────────────────────────────────────

def test_get_price_base(db_session):
    db = db_session
    p = _mk_product(db); c = _mk_client(db)
    db.add(Price(product_id=p.id, price=10.0, valid_from="2026-01-01", is_active=1))
    db.flush()
    assert get_price(db, p.id, c.id, "2026-07-06") == 10.0


def test_get_price_discount(db_session):
    db = db_session
    p = _mk_product(db); c = _mk_client(db, discount=10.0)  # -10%
    db.add(Price(product_id=p.id, price=10.0, valid_from="2026-01-01", is_active=1))
    db.flush()
    assert get_price(db, p.id, c.id, "2026-07-06") == 9.0


def test_get_price_individual_override_beats_base(db_session):
    db = db_session
    p = _mk_product(db); c = _mk_client(db, discount=10.0)
    db.add(Price(product_id=p.id, price=10.0, valid_from="2026-01-01", is_active=1))
    db.add(ClientPriceOverride(client_id=c.id, product_id=p.id, price=7.5, valid_from="2026-01-01"))
    db.flush()
    # Індивідуальна ціна має пріоритет над базовою+знижкою
    assert get_price(db, p.id, c.id, "2026-07-06") == 7.5


def test_get_price_explicit_override_beats_all(db_session):
    db = db_session
    p = _mk_product(db); c = _mk_client(db)
    db.add(Price(product_id=p.id, price=10.0, valid_from="2026-01-01", is_active=1))
    db.flush()
    assert get_price(db, p.id, c.id, "2026-07-06", price_override=3.33) == 3.33


def test_get_price_no_price_returns_zero(db_session):
    db = db_session
    p = _mk_product(db); c = _mk_client(db)
    assert get_price(db, p.id, c.id, "2026-07-06") == 0.0


# ── Нумерація накладних ────────────────────────────────────────────────────────

def test_invoice_number_format_and_sequence(db_session):
    db = db_session
    c = _mk_client(db)
    date = "2026-09-15"
    n1 = generate_invoice_number(db, date)
    assert n1 == "20260915-001"
    db.add(Invoice(invoice_number=n1, invoice_date=date, client_id=c.id, status="draft"))
    db.flush()
    assert generate_invoice_number(db, date) == "20260915-002"


def test_create_invoice_row_retries_on_number_collision(db_session):
    """Симулюємо гонитву: номер -001 вже зайнятий → helper має піти на -002."""
    db = db_session
    c = _mk_client(db)
    date = "2026-10-20"
    taken = generate_invoice_number(db, date)  # 20261020-001
    db.add(Invoice(invoice_number=taken, invoice_date=date, client_id=c.id, status="draft"))
    db.flush()

    inv = create_invoice_row(db, invoice_date=date, client_id=c.id, status="draft")
    assert inv.invoice_number == "20261020-002"
    assert inv.id is not None

    inv2 = create_invoice_row(db, invoice_date=date, client_id=c.id, status="draft")
    assert inv2.invoice_number == "20261020-003"
