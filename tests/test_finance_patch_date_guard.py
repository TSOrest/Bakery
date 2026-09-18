"""Регрес-тест на "високу" знахідку QA-аудиту: PATCH /finances/{id} не
перевіряв дату запису на бекенді — лише фронтенд показував кнопку ✏ тільки
для finance_date == workDate, але прямий виклик API міг відредагувати
БУДЬ-ЯКИЙ історичний запис редагованої статті.

Виправлено: backend/routers/finances.py, _current_work_dates() рахує ту саму
"поточну робочу дату" (і попередній день — легітимна "робота за вчора"), що
й фронтенд (Layout.tsx, computeEffectiveDate), і update_finance() відхиляє
редагування записів поза цим вікном.
"""

from backend.database import SessionLocal
from backend.models.references import Client
from backend.models.finances import Finance, FinanceArticle
from backend.routers.finances import _current_work_dates


def test_old_finance_entry_cannot_be_edited(app_client, admin_token):
    db = SessionLocal()
    c = Client(full_name="Клієнт-старий-запис", client_kind="customer", is_active=1)
    db.add(c); db.flush()
    article = db.query(FinanceArticle).filter_by(name="Внесення в касу").first()
    entry = Finance(
        finance_date="2020-01-01", client_id=None, finance_type="deposit",
        article_id=article.id if article else None, amount=100.0, sign=1,
        notes="стара операція", created_at="2020-01-01T10:00:00", created_by="admin",
    )
    db.add(entry); db.commit(); db.refresh(entry)
    entry_id = entry.id
    db.close()

    resp = app_client.patch(
        f"/api/v1/finances/{entry_id}",
        json={"amount": 999},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 400
    assert "робочої дати" in resp.json()["detail"]


def test_current_work_date_entry_can_be_edited(app_client, admin_token):
    db = SessionLocal()
    wd = sorted(_current_work_dates(db))[-1]
    c = Client(full_name="Клієнт-поточний-запис", client_kind="customer", is_active=1)
    db.add(c); db.flush()
    article = db.query(FinanceArticle).filter_by(name="Внесення в касу").first()
    entry = Finance(
        finance_date=wd, client_id=None, finance_type="deposit",
        article_id=article.id if article else None, amount=100.0, sign=1,
        notes="сьогоднішня операція", created_at=f"{wd}T10:00:00", created_by="admin",
    )
    db.add(entry); db.commit(); db.refresh(entry)
    entry_id = entry.id
    db.close()

    resp = app_client.patch(
        f"/api/v1/finances/{entry_id}",
        json={"amount": 150},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["amount"] == 150
