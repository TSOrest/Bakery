"""Регрес-тест: борг клієнта в Telegram-боті (/report, /debts) не мав
враховувати накладну, виставлену СЬОГОДНІ — на прохання користувача
("поточні накладні, виставлені сьогодні — це ще не борг, а поточні
операції", машина ще в рейсі, оплата очікується того ж дня).

backend/services/finance.py: get_all_balances()/get_summary() отримали
параметр exclude_invoice_dates — виключає з розрахунку балансу фінансові
записи статті "Накладна" за перелічені дати. Оплати та решта операцій за
ті самі дати рахуються як завжди (виключення стосується ЛИШЕ статті
"Накладна"). backend/services/telegram_bot.py: _report_debts() і
_report_finance() тепер передають exclude_invoice_dates=[сьогодні].

Не торкається сайту (FinancesPage, дашборд власника) — там параметр не
передається, поведінка без змін.
"""

from datetime import date

from backend.models.references import Client
from backend.models.finances import Finance, FinanceArticle
from backend.services.finance import get_all_balances, get_summary


def test_todays_invoice_excluded_from_debt_but_old_debt_and_todays_payment_count(db_session):
    db = db_session
    today = date.today().isoformat()

    invoice_article = db.query(FinanceArticle).filter_by(name="Накладна").first()
    payment_article = db.query(FinanceArticle).filter_by(name="Оплата").first()
    assert invoice_article is not None and payment_article is not None

    client = Client(full_name="Тест-fin-exclude-today", client_kind="customer", is_active=1)
    db.add(client)
    db.flush()

    db.add_all([
        # Старий борг (позаминулого разу) — має рахуватись завжди.
        Finance(finance_date="2020-01-01", client_id=client.id, finance_type="invoice",
                 article_id=invoice_article.id, amount=100.0, sign=-1),
        # Накладна, виставлена сьогодні — НЕ має рахуватись як борг.
        Finance(finance_date=today, client_id=client.id, finance_type="invoice",
                 article_id=invoice_article.id, amount=50.0, sign=-1),
        # Оплата сьогодні — має рахуватись як завжди (не стосується виключення).
        Finance(finance_date=today, client_id=client.id, finance_type="payment",
                 article_id=payment_article.id, amount=30.0, sign=1),
    ])
    db.commit()

    balances_excluded = get_all_balances(db, exclude_invoice_dates=[today])
    balances_plain     = get_all_balances(db)

    b_excluded = next(b for b in balances_excluded if b.client_id == client.id)
    b_plain    = next(b for b in balances_plain if b.client_id == client.id)

    # -100 (старий борг) + 30 (оплата сьогодні) = -70; сьогоднішня накладна (-50) виключена.
    assert b_excluded.balance == -70.0, "борг мав рахуватись без сьогоднішньої накладної"
    # Без виключення — усі три записи рахуються: -100 - 50 + 30 = -120.
    assert b_plain.balance == -120.0, "без параметра поведінка має лишитись незмінною (сайт)"


def test_get_summary_exclude_invoice_dates_matches_get_all_balances(db_session):
    db = db_session
    today = date.today().isoformat()

    invoice_article = db.query(FinanceArticle).filter_by(name="Накладна").first()
    assert invoice_article is not None

    before_excl  = get_summary(db, exclude_invoice_dates=[today])
    before_plain = get_summary(db)

    client = Client(full_name="Тест-fin-exclude-today-summary", client_kind="customer", is_active=1)
    db.add(client)
    db.flush()
    db.add(Finance(finance_date=today, client_id=client.id, finance_type="invoice",
                    article_id=invoice_article.id, amount=42.0, sign=-1))
    db.commit()

    after_excl  = get_summary(db, exclude_invoice_dates=[today])
    after_plain = get_summary(db)

    # З виключенням сьогоднішньої накладної — сумарний борг і кількість боржників не змінюються.
    assert after_excl.total_debt == before_excl.total_debt
    assert after_excl.clients_in_debt == before_excl.clients_in_debt
    # Без виключення (як і досі рахує сайт) — нова накладна одразу стає боргом.
    assert round(after_plain.total_debt - before_plain.total_debt, 2) == 42.0
    assert after_plain.clients_in_debt - before_plain.clients_in_debt == 1
