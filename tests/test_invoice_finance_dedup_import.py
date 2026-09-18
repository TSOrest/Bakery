"""Регрес-тест на критичну знахідку QA-аудиту: корекція вже прийнятої
ІМПОРТОВАНОЇ накладної дублювала борг клієнта.

create_invoice_finance_entry()/recompute_invoice_finance()
(backend/services/finance.py) шукали існуючий борговий запис через
Finance.notes == Invoice.invoice_number. Для 99.7% імпортованих накладних
notes містить вільний текст замість номера — recompute_invoice_finance()
(викликається при POST /invoices/{id}/transfer, PUT /invoices/{id}/lines)
не знаходила існуючий запис і мовчки створювала ДРУГИЙ, дублюючи борг.

Виправлено: _find_invoice_finance_entry() — fallback за (client_id,
finance_date), коли для цієї пари існує РІВНО ОДНА накладна (та сама
відповідність, за якою й сам імпорт групував замовлення в накладні).
Міграція 045 — backfill notes для однозначних історичних випадків.
"""

from backend.database import SessionLocal
from backend.models.references import Client
from backend.models.invoices import Invoice
from backend.models.finances import Finance, FinanceArticle
from backend.services.finance import recompute_invoice_finance, get_client_balance


def _mk_client(db, name="Клієнт"):
    c = Client(full_name=name, client_kind="customer", is_active=1)
    db.add(c); db.flush()
    return c


def test_recompute_updates_mismatched_notes_entry_instead_of_duplicating(db_session):
    """Типовий імпортований запис: notes — вільний текст, не номер накладної."""
    db = db_session
    client = _mk_client(db, "Тест-import-debt-A")
    invoice_article = db.query(FinanceArticle).filter_by(name="Накладна").first()
    assert invoice_article is not None

    date = "2027-06-01"
    inv = Invoice(invoice_number=f"TEST-IMPORT-{client.id}", invoice_date=date,
                   client_id=client.id, status="accepted", total_sum=100.0)
    db.add(inv); db.flush()

    # Імітуємо реальний імпортований запис — notes НЕ дорівнює invoice_number.
    old_entry = Finance(finance_date=date, client_id=client.id, finance_type="invoice",
                         article_id=invoice_article.id, amount=100.0, sign=-1,
                         notes="внесення початкового боргу")
    db.add(old_entry); db.commit()

    # Накладну скоригували (сума змінилась) — recompute_invoice_finance викликається
    # так само, як з POST /invoices/{id}/transfer чи PUT /invoices/{id}/lines.
    inv.total_sum = 70.0
    recompute_invoice_finance(db, inv)
    db.commit()

    entries = db.query(Finance).filter_by(client_id=client.id, finance_type="invoice").all()
    assert len(entries) == 1, "мав оновитись існуючий запис, а не з'явитись другий"
    assert entries[0].amount == 70.0
    assert entries[0].notes == "внесення початкового боргу", "notes існуючого запису не мали перезаписуватись"
    assert get_client_balance(db, client.id) == -70.0


def test_recompute_does_not_guess_when_client_has_two_invoices_same_date(db_session):
    """Неоднозначний випадок (2 накладні тієї ж дати) — fallback НЕ спрацьовує,
    поведінка лишається як була (можливий 2й запис, а не ризик оновити чужий)."""
    db = db_session
    client = _mk_client(db, "Тест-import-debt-B")
    invoice_article = db.query(FinanceArticle).filter_by(name="Накладна").first()

    date = "2027-06-02"
    inv1 = Invoice(invoice_number=f"TEST-AMBIG-1-{client.id}", invoice_date=date,
                    client_id=client.id, status="accepted", total_sum=50.0)
    inv2 = Invoice(invoice_number=f"TEST-AMBIG-2-{client.id}", invoice_date=date,
                    client_id=client.id, status="accepted", total_sum=30.0)
    db.add_all([inv1, inv2]); db.flush()

    entry1 = Finance(finance_date=date, client_id=client.id, finance_type="invoice",
                      article_id=invoice_article.id, amount=50.0, sign=-1, notes="випадковий текст 1")
    db.add(entry1); db.commit()

    # Коригуємо inv1 — fallback має НЕ зачепити entry1 (бо дата неоднозначна для
    # цього клієнта), тож recompute для inv1 створить ОКРЕМИЙ новий запис.
    inv1.total_sum = 45.0
    recompute_invoice_finance(db, inv1)
    db.commit()

    entries = db.query(Finance).filter_by(client_id=client.id, finance_type="invoice").all()
    assert len(entries) == 2, "неоднозначний випадок не мав автоматично зливатись в один запис"


def test_new_invoice_still_matches_by_notes_as_before(db_session):
    """Регрес: записи, створені самим застосунком (notes == invoice_number),
    і далі коректно знаходяться напряму, без потреби у fallback."""
    db = db_session
    client = _mk_client(db, "Тест-import-debt-C")
    invoice_article = db.query(FinanceArticle).filter_by(name="Накладна").first()

    date = "2027-06-03"
    inv = Invoice(invoice_number=f"TEST-NORMAL-{client.id}", invoice_date=date,
                   client_id=client.id, status="accepted", total_sum=20.0)
    db.add(inv); db.flush()

    entry = Finance(finance_date=date, client_id=client.id, finance_type="invoice",
                     article_id=invoice_article.id, amount=20.0, sign=-1, notes=inv.invoice_number)
    db.add(entry); db.commit()

    inv.total_sum = 15.0
    recompute_invoice_finance(db, inv)
    db.commit()

    entries = db.query(Finance).filter_by(client_id=client.id, finance_type="invoice").all()
    assert len(entries) == 1
    assert entries[0].amount == 15.0
