"""Регрес-тест на "низьку" знахідку QA-аудиту (Розділ 3): дати "останньої
накладної"/"останньої оплати" в get_all_balances() рахувались через
ненадійний finance_type замість article_id — той самий клас багу, що вже
виправлений в інших звітах для імпортованих даних (finance_type там не
збігається з реальним типом операції).
"""

from backend.models.references import Client
from backend.models.finances import Finance, FinanceArticle
from backend.services.finance import get_all_balances


def test_last_invoice_and_payment_dates_use_article_id_not_finance_type(db_session):
    """Реалістичний імпорт-сценарій: запис зі статтею "Оплата" (article_id),
    але з "битим" legacy finance_type='invoice' (як буває в імпортованих
    даних) — має все одно розпізнаватись як оплата за датою через
    article_id, а не за finance_type."""
    db = db_session
    client = Client(full_name="Тест-баланс-дати", client_kind="customer", is_active=1)
    db.add(client); db.flush()

    payment_article = db.query(FinanceArticle).filter_by(name="Оплата").first()
    invoice_article = db.query(FinanceArticle).filter_by(name="Накладна").first()
    assert payment_article is not None and invoice_article is not None

    db.add_all([
        # article_id="Оплата", але finance_type навмисно "invoice" (як у імпорті)
        Finance(finance_date="2027-04-05", client_id=client.id, finance_type="invoice",
                 article_id=payment_article.id, amount=100.0, sign=1),
        # article_id="Накладна", finance_type навмисно "payment"
        Finance(finance_date="2027-04-10", client_id=client.id, finance_type="payment",
                 article_id=invoice_article.id, amount=200.0, sign=-1),
    ])
    db.flush()

    balances = get_all_balances(db, as_of="2027-04-30")
    row = next(b for b in balances if b.client_id == client.id)
    assert row.last_payment_date == "2027-04-05", "має орієнтуватись на article_id, не finance_type"
    assert row.last_invoice_date == "2027-04-10", "має орієнтуватись на article_id, не finance_type"
