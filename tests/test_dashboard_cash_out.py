"""Тест нового поля today.cash_out (backend/routers/dashboard.py, get_dashboard) —
сума виведеного з каси за день ("Виведення з каси" + "Оплата з каси"),
показується на дашборді власника в картці "Виручка і оплати".
"""

from backend.database import SessionLocal
from backend.models.references import Client
from backend.models.finances import Finance, FinanceArticle
from backend.routers.dashboard import get_dashboard


def test_dashboard_cash_out_sums_both_articles(app_client, admin_token):
    db = SessionLocal()
    date = "2027-06-01"
    cash_out_article = db.query(FinanceArticle).filter_by(name="Виведення з каси").first()
    payout_article = db.query(FinanceArticle).filter_by(name="Оплата з каси").first()
    db.add(Finance(finance_date=date, client_id=None, finance_type="expense",
                    article_id=cash_out_article.id if cash_out_article else None,
                    amount=300.0, sign=-1, notes="Тест-виведення", created_by=None))
    db.add(Finance(finance_date=date, client_id=None, finance_type="expense",
                    article_id=payout_article.id if payout_article else None,
                    amount=200.0, sign=-1, notes="Тест-оплата-з-каси", created_by=None))
    db.commit()
    db.close()

    db = SessionLocal()
    result = get_dashboard(date_param=date, db=db)
    db.close()
    assert result["today"]["cash_out"] == 500.0


def test_dashboard_cash_out_zero_when_no_entries(app_client, admin_token):
    db = SessionLocal()
    result = get_dashboard(date_param="2027-06-02", db=db)
    db.close()
    assert result["today"]["cash_out"] == 0.0
