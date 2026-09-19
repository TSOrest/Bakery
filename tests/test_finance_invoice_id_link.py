"""Регрес-тест на пропозицію з QA-аудиту: прив'язка боргового запису
фінансів до накладної через справжній invoice_id (міграція 047) замість
пошуку за notes/(client_id, дата). Пряма адреса кореня Критичної знахідки
№3 — invoice_id однозначний незалежно від того, що написано в notes.
"""

from backend.database import SessionLocal
from backend.models.references import Client
from backend.models.invoices import Invoice
from backend.models.finances import Finance, FinanceArticle
from backend.services.finance import (
    create_invoice_finance_entry, recompute_invoice_finance, get_client_balance,
)


def _mk_client(db, name="Клієнт"):
    c = Client(full_name=name, client_kind="customer", is_active=1)
    db.add(c); db.flush()
    return c


def test_create_invoice_finance_entry_sets_invoice_id(db_session):
    db = db_session
    client = _mk_client(db, "Тест-invoice-id-A")
    inv = Invoice(invoice_number="TEST-INVID-A", invoice_date="2027-07-01",
                   client_id=client.id, status="accepted", total_sum=200.0)
    db.add(inv); db.flush()

    create_invoice_finance_entry(db, inv)
    db.flush()

    entry = db.query(Finance).filter_by(client_id=client.id, finance_type="invoice").first()
    assert entry is not None
    assert entry.invoice_id == inv.id


def test_recompute_finds_entry_via_invoice_id_even_with_garbage_notes(db_session):
    """Запис з abo-яким текстом у notes (не invoice_number, і навіть не
    unique-by-date） все одно знаходиться коректно через invoice_id."""
    db = db_session
    client = _mk_client(db, "Тест-invoice-id-B")
    date = "2027-07-02"
    inv1 = Invoice(invoice_number="TEST-INVID-B1", invoice_date=date,
                    client_id=client.id, status="accepted", total_sum=50.0)
    inv2 = Invoice(invoice_number="TEST-INVID-B2", invoice_date=date,
                    client_id=client.id, status="accepted", total_sum=30.0)
    db.add_all([inv1, inv2]); db.flush()

    # entry1 явно прив'язаний до inv1 через invoice_id, notes — сміття,
    # і дата неоднозначна для клієнта (2 накладні тієї ж дати) — раніше
    # (без invoice_id) fallback НЕ зміг би однозначно знайти цей запис.
    entry1 = Finance(finance_date=date, client_id=client.id, finance_type="invoice",
                      invoice_id=inv1.id, amount=50.0, sign=-1, notes="випадковий текст")
    db.add(entry1); db.commit()

    inv1.total_sum = 42.0
    recompute_invoice_finance(db, inv1)
    db.commit()

    entries = db.query(Finance).filter_by(client_id=client.id, finance_type="invoice").all()
    assert len(entries) == 1, "invoice_id мав однозначно знайти запис навіть з неоднозначною датою"
    assert entries[0].amount == 42.0
    assert get_client_balance(db, client.id) == -42.0


def test_recompute_self_heals_missing_invoice_id(db_session):
    """Старий запис (до міграції 047, без invoice_id) знайдений через
    notes-fallback — recompute має заразом проставити invoice_id."""
    db = db_session
    client = _mk_client(db, "Тест-invoice-id-C")
    invoice_article = db.query(FinanceArticle).filter_by(name="Накладна").first()
    date = "2027-07-03"
    inv = Invoice(invoice_number="TEST-INVID-C", invoice_date=date,
                   client_id=client.id, status="accepted", total_sum=10.0)
    db.add(inv); db.flush()

    entry = Finance(finance_date=date, client_id=client.id, finance_type="invoice",
                     article_id=invoice_article.id if invoice_article else None,
                     invoice_id=None, amount=10.0, sign=-1, notes=inv.invoice_number)
    db.add(entry); db.commit()
    assert entry.invoice_id is None

    inv.total_sum = 8.0
    recompute_invoice_finance(db, inv)
    db.commit()
    db.refresh(entry)

    assert entry.invoice_id == inv.id, "recompute мав самозагоїти відсутній invoice_id"
    assert entry.amount == 8.0
