"""Тести get_cash_balance() (backend/services/finance.py) — новий "Залишок у
касі" на дашборді фінансів. Той самий концепт, що "Залишок в касі" у
Денному звіті (_dr_section3, backend/routers/print_views.py) — обидва
тепер викликають ЦЮ функцію, а не дублюють запит.

Ключова властивість: борг накладної (finance_type='invoice') НЕ входить у
залишок каси — це дебіторка (борг клієнтів), не готівка. Лише реальні
касові операції (Оплата, Внесення в касу, Оплата/Виведення з каси тощо).
"""

from backend.models.references import Client
from backend.models.invoices import Invoice
from backend.services.finance import (
    get_cash_balance, create_invoice_finance_entry, create_payment_finance_entry,
)


def _mk_client(db, name="Клієнт"):
    c = Client(full_name=name, client_kind="customer", is_active=1)
    db.add(c); db.flush()
    return c


def test_cash_balance_excludes_invoice_debt(db_session):
    db = db_session
    client = _mk_client(db, "Клієнт-каса-баланс")
    date = "2027-05-10"
    before = get_cash_balance(db, as_of=date, exclusive=True)

    inv = Invoice(invoice_number="TEST-CASH-1", invoice_date=date,
                  client_id=client.id, status="accepted", total_sum=800.0)
    db.add(inv); db.flush()
    create_invoice_finance_entry(db, inv)          # -800, борг (НЕ каса)
    create_payment_finance_entry(db, inv, 500.0)    # +500, готівка (каса)
    db.flush()

    after_exclusive = get_cash_balance(db, as_of=date, exclusive=True)
    after_inclusive = get_cash_balance(db, as_of=date, exclusive=False)

    assert after_exclusive == before, "'exclusive' не має враховувати операції ЦЬОГО дня"
    assert round(after_inclusive - before, 2) == 500.0, "лише оплата (500), борг накладної (800) виключено"


def test_cash_balance_default_as_of_today_when_none(db_session):
    """as_of=None не має кидати помилку — рахує станом на сьогодні."""
    db = db_session
    value = get_cash_balance(db)
    assert isinstance(value, float)
