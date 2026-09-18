"""Регрес-тест на "високу" знахідку QA-аудиту: друкована "Боргова відомість"
(GET /print/debts) показувала системні рахунки (Списання/Пайок/Недопечено/
Магазин) як звичайних боржників, якщо у них накопичився ненульовий баланс —
хоча це внутрішні бухгалтерські рахунки, не реальні клієнти.

Виправлено: backend/routers/print_views.py, debts_report() тепер фільтрує
Client.client_kind == 'customer' (як усі інші звіти з тим самим фільтром).
"""

from backend.database import SessionLocal
from backend.models.references import Client
from backend.models.finances import Finance, FinanceArticle


def test_writeoff_system_client_not_listed_as_debtor(app_client):
    db = SessionLocal()
    writeoff = db.query(Client).filter_by(client_kind="writeoff").first()
    assert writeoff is not None, "системний клієнт 'Списання' має бути в посіяних даних"
    writeoff_label = writeoff.short_name or writeoff.full_name

    real_client = Client(full_name="Реальний боржник ЗвітТест", client_kind="customer", is_active=1)
    db.add(real_client); db.flush()

    invoice_article = db.query(FinanceArticle).filter_by(name="Накладна").first()
    db.add_all([
        Finance(finance_date="2020-01-01", client_id=writeoff.id, finance_type="invoice",
                 article_id=invoice_article.id if invoice_article else None,
                 amount=5000.0, sign=-1, notes="списання-тест"),
        Finance(finance_date="2020-01-01", client_id=real_client.id, finance_type="invoice",
                 article_id=invoice_article.id if invoice_article else None,
                 amount=300.0, sign=-1, notes="реальний-борг-тест"),
    ])
    db.commit()
    db.close()

    resp = app_client.get("/api/v1/print/debts", params={"date": "2020-01-02"})
    assert resp.status_code == 200
    html = resp.text
    assert "Реальний боржник ЗвітТест" in html
    assert writeoff_label not in html
