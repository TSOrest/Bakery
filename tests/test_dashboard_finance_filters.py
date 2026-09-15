"""Регрес-тест: _invoice_filter/_payment_filter (backend/routers/dashboard.py)
раніше довіряли finance_type як OR-fallback до article_id. В імпортованих
з .accdb даних finance_type для касових статей ненадійний — "Оплата з
каси"/"Виведення з каси" мають finance_type='invoice', "Списання
магазину" — finance_type='payment' (той самий import-артефакт, що вже
враховує _dr_section3/_is_invoice_entry у print_views.py). Через
OR-fallback дашборд додавав ці кас-операції до "виручки"/"надходжень",
завищуючи суми на весь обсяг помилково підхоплених операцій.

Виправлено: фільтри тепер звіряються ЛИШЕ з article_id.
"""

from backend.database import SessionLocal
from backend.models.references import Client
from backend.models.invoices import Invoice
from backend.models.finances import Finance, FinanceArticle
from backend.services.finance import create_invoice_finance_entry


def _mk_client(db, name="Клієнт"):
    c = Client(full_name=name, client_kind="customer", is_active=1)
    db.add(c); db.flush()
    return c


def test_dashboard_revenue_excludes_misfiled_cash_entry(app_client, admin_token):
    """Виставлено 1000 накладною; окремо — 300 "Оплата з каси" (client_id=NULL,
    finance_type='invoice' — як в імпортованих даних). Дашборд має показати
    виручку = 1000, а не 1300 (без подвійного/помилкового підхоплення каси)."""
    db = SessionLocal()
    client = _mk_client(db, "Клієнт-дашборд")
    date = "2027-04-05"
    inv = Invoice(invoice_number="TEST-DASH-1", invoice_date=date,
                  client_id=client.id, status="accepted", total_sum=1000.0)
    db.add(inv); db.flush()
    create_invoice_finance_entry(db, inv)

    cash_article = db.query(FinanceArticle).filter_by(name="Оплата з каси").first()
    db.add(Finance(
        finance_date=date, client_id=None, finance_type="invoice",  # import-артефакт
        article_id=cash_article.id if cash_article else None,
        amount=300.0, sign=-1, notes="Тест-каса", created_by=None,
    ))
    db.commit()
    db.close()

    resp = app_client.get(
        f"/api/v1/dashboard/?date_param={date}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200, resp.text
    revenue = resp.json()["today"]["revenue"]
    assert revenue == 1000.0, f"очікувалось 1000.0 (лише накладна), отримано {revenue}"


def test_dashboard_payments_exclude_misfiled_writeoff_entry(app_client, admin_token):
    """Оплата 500 клієнтом; окремо — 700 "Списання магазину" з
    finance_type='payment' (той самий import-артефакт). Дашборд має
    показати надходження за день = 500, а не 1200."""
    db = SessionLocal()
    client = _mk_client(db, "Клієнт-надходження")
    date = "2027-04-06"
    payment_article = db.query(FinanceArticle).filter_by(name="Оплата").first()
    db.add(Finance(
        finance_date=date, client_id=client.id, finance_type="payment",
        article_id=payment_article.id if payment_article else None,
        amount=500.0, sign=1, notes="Оплата", created_by="operator",
    ))
    writeoff_article = db.query(FinanceArticle).filter_by(name="Списання магазину").first()
    db.add(Finance(
        finance_date=date, client_id=None, finance_type="payment",  # import-артефакт
        article_id=writeoff_article.id if writeoff_article else None,
        amount=700.0, sign=1, notes="Тест-списання", created_by=None,
    ))
    db.commit()
    db.close()

    resp = app_client.get(
        f"/api/v1/dashboard/?date_param={date}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200, resp.text
    payments_sum = resp.json()["today"]["payments_sum"]
    assert payments_sum == 500.0, f"очікувалось 500.0 (лише оплата), отримано {payments_sum}"
