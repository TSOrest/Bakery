"""Юніт-тести сервісів без HTTP."""

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.database import Base
from backend.models.references import Product, Client, Route
from backend.models.pricing import Price, ClientPriceOverride
from backend.models.orders import Order
from backend.services.prices import get_price
from backend.services.invoices import generate_invoice_number
from backend.services.orders import copy_orders


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()


def make_product(db, name="Хліб", ptype="bread") -> Product:
    p = Product(name=name, type=ptype)
    db.add(p)
    db.flush()
    return p


def make_client(db, discount=0.0) -> Client:
    r = Route(name="Маршрут")
    db.add(r)
    db.flush()
    c = Client(full_name="Клієнт", route_id=r.id, discount_pct=discount)
    db.add(c)
    db.flush()
    return c


# ---------------------------------------------------------------
# get_price
# ---------------------------------------------------------------

def test_get_price_base(db):
    p = make_product(db)
    c = make_client(db)
    price = Price(product_id=p.id, price=20.0, valid_from="2026-01-01", is_active=1)
    db.add(price)
    db.flush()

    result = get_price(db, p.id, c.id, "2026-03-16")
    assert result == 20.0


def test_get_price_with_discount(db):
    p = make_product(db)
    c = make_client(db, discount=10)
    price = Price(product_id=p.id, price=20.0, valid_from="2026-01-01", is_active=1)
    db.add(price)
    db.flush()

    result = get_price(db, p.id, c.id, "2026-03-16")
    assert result == pytest.approx(18.0)


def test_get_price_client_override(db):
    p = make_product(db)
    c = make_client(db, discount=10)
    price = Price(product_id=p.id, price=20.0, valid_from="2026-01-01", is_active=1)
    override = ClientPriceOverride(
        client_id=c.id, product_id=p.id, price=15.0, valid_from="2026-01-01"
    )
    db.add_all([price, override])
    db.flush()

    # Індивідуальна ціна має пріоритет над базовою зі знижкою
    result = get_price(db, p.id, c.id, "2026-03-16")
    assert result == 15.0


def test_get_price_explicit_override(db):
    p = make_product(db)
    c = make_client(db)
    result = get_price(db, p.id, c.id, "2026-03-16", price_override=9.99)
    assert result == 9.99


def test_get_price_no_price(db):
    p = make_product(db)
    c = make_client(db)
    assert get_price(db, p.id, c.id, "2026-03-16") == 0.0


# ---------------------------------------------------------------
# generate_invoice_number
# ---------------------------------------------------------------

def test_invoice_number_first(db):
    num = generate_invoice_number(db, "2026-03-16")
    assert num == "20260316-001"


def test_invoice_number_sequence(db):
    from backend.models.invoices import Invoice
    inv = Invoice(
        invoice_number="20260316-001",
        invoice_date="2026-03-16",
        client_id=1,
    )
    db.add(inv)
    db.flush()

    num = generate_invoice_number(db, "2026-03-16")
    assert num == "20260316-002"


def test_invoice_number_resets_per_day(db):
    from backend.models.invoices import Invoice
    inv = Invoice(
        invoice_number="20260315-005",
        invoice_date="2026-03-15",
        client_id=1,
    )
    db.add(inv)
    db.flush()

    num = generate_invoice_number(db, "2026-03-16")
    assert num == "20260316-001"


# ---------------------------------------------------------------
# copy_orders
# ---------------------------------------------------------------

def test_copy_orders(db):
    p = make_product(db)
    c = make_client(db)

    order = Order(
        client_id=c.id,
        product_id=p.id,
        qty=5,
        order_date="2026-03-15",
        status="draft",
    )
    db.add(order)
    db.commit()

    count = copy_orders(db, "2026-03-15", "2026-03-16")
    assert count == 1

    copied = db.query(Order).filter(Order.order_date == "2026-03-16").first()
    assert copied is not None
    assert copied.qty == 5


def test_copy_orders_no_duplicate(db):
    p = make_product(db)
    c = make_client(db)

    for date in ("2026-03-15", "2026-03-16"):
        db.add(Order(client_id=c.id, product_id=p.id, qty=5, order_date=date))
    db.commit()

    count = copy_orders(db, "2026-03-15", "2026-03-16")
    assert count == 0  # вже існує, не дублюємо
