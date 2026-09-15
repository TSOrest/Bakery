"""Регрес-тести на баг: борговий запис накладної (finance_type='invoice')
не мав article_id, тому Денний звіт (_dr_section3/_is_invoice_entry,
backend/routers/print_views.py — звіряється саме з article_id, бо в
імпортованих даних касові статті 'Оплата з каси'/'Виведення з каси'
помилково мають finance_type='invoice') не розпізнавав його як борг і
помилково враховував суму як рух готівки в "Залишок в касі" — подвійний
облік боргу клієнтів, що штучно занижувало залишок (аж до від'ємних
значень), хоча реальних грошей ніхто з каси не забирав.

Виправлено: create_invoice_finance_entry() тепер проставляє article_id
('Накладна'), як і create_payment_finance_entry() робить для 'Оплата'.
Міграція 041 backfill-ить існуючі записи без article_id.
"""

import re

from sqlalchemy import func

from backend.models.references import Client
from backend.models.invoices import Invoice
from backend.models.finances import Finance, FinanceArticle
from backend.services.finance import create_invoice_finance_entry, create_payment_finance_entry
from backend.routers.print_views import _dr_section3

# Дата навмисно унікальна (не перетинається з датами інших тестів, що
# комітять фінансові записи напряму через SessionLocal — ті лишаються в
# тестовій БД між тестами) — щоб "Залишок на початок дня" на цю дату не
# залежав від інших тестів.
TEST_DATE = "2027-03-11"


def _mk_client(db, name="Клієнт"):
    c = Client(full_name=name, client_kind="customer", is_active=1)
    db.add(c); db.flush()
    return c


def _prev_balance(db, date: str) -> float:
    """Незалежна копія prev_balance-логіки з _dr_section3 — для звірки в тесті
    без припущень про стан бази (стійко до даних з інших тестів)."""
    invoice_art_ids = {a.id for a in db.query(FinanceArticle).filter_by(name="Накладна").all()}
    q = db.query(func.sum(Finance.amount * Finance.sign)).filter(Finance.finance_date < date)
    if invoice_art_ids:
        q = q.filter((Finance.article_id.is_(None)) | Finance.article_id.notin_(invoice_art_ids))
    return round(q.scalar() or 0.0, 2)


def test_create_invoice_finance_entry_sets_article_id(db_session):
    db = db_session
    client = _mk_client(db)
    inv = Invoice(invoice_number="TEST-041A", invoice_date=TEST_DATE,
                  client_id=client.id, status="accepted", total_sum=1000.0)
    db.add(inv); db.flush()

    create_invoice_finance_entry(db, inv)
    db.flush()

    entry = db.query(Finance).filter_by(finance_type="invoice", notes="TEST-041A").first()
    article = db.query(FinanceArticle).filter_by(name="Накладна").first()
    assert entry is not None
    assert article is not None
    assert entry.article_id == article.id


def test_daily_report_cash_balance_excludes_invoice_debt(db_session):
    """Борг накладної НЕ має враховуватись як рух готівки в "Залишок в касі":
    клієнту виставлено 500 (борг), реально сплачено готівкою лише 300 —
    залишок у касі має вирости рівно на 300 (реальні гроші), а не на
    300−500=−200 (хибний результат при неврахуванні накладної як боргу)."""
    db = db_session
    client = _mk_client(db, "Клієнт-каса")
    expected_prev = _prev_balance(db, TEST_DATE)

    inv = Invoice(invoice_number="TEST-041B", invoice_date=TEST_DATE,
                  client_id=client.id, status="accepted", total_sum=500.0)
    db.add(inv); db.flush()

    create_invoice_finance_entry(db, inv)          # -500, борг (НЕ рух готівки)
    create_payment_finance_entry(db, inv, 300.0)    # +300, часткова оплата (готівка)
    db.flush()

    html = _dr_section3(db, TEST_DATE)
    match = re.search(
        r'Залишок в касі</strong></td>\s*<td[^>]*><strong>([+−])&nbsp;([\d\s]+,\d{2})&nbsp;грн',
        html,
    )
    assert match, "рядок 'Залишок в касі' не знайдено в HTML звіту"
    sign, num = match.groups()
    shown = float(num.replace(" ", "").replace(",", "."))
    actual = shown if sign == "+" else -shown

    expected = round(expected_prev + 300.0, 2)  # лише реальна оплата, накладна виключена
    assert actual == expected, f"очікувалось {expected} (borg накладної не має враховуватись), отримано {actual}"
