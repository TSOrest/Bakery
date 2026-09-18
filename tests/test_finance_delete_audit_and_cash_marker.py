"""Регрес-тести на дві "середні" знахідки QA-аудиту (Розділ 3 — Фінанси):

1. Видалення фінансового запису (DELETE /finances/{id}) не лишало сліду в
   audit_log — навіть для автоматичних записів оплат. Виправлено:
   write_audit() перед видаленням у backend/routers/finances.py.
2. "Залишок у касі" показував 0,00 для дат до реального переходу на нову
   систему без жодної позначки — виглядало як порахований нуль, а не як
   "дані не відстежувались". Виправлено: налаштування cash_tracking_start_date
   + видима примітка замість суми в Денному звіті (_dr_section3).
"""

from backend.database import SessionLocal
from backend.models.references import Client
from backend.models.finances import Finance, FinanceArticle
from backend.models.audit import AuditLog
from backend.routers.print_views import _dr_section3


def test_delete_finance_writes_audit_log(app_client, admin_token):
    db = SessionLocal()
    c = Client(full_name="Клієнт-delete-audit", client_kind="customer", is_active=1)
    db.add(c); db.flush()
    article = db.query(FinanceArticle).filter_by(name="Внесення в касу").first()
    entry = Finance(
        finance_date="2027-05-01", client_id=None, finance_type="deposit",
        article_id=article.id if article else None, amount=250.0, sign=1,
        notes="тест-видалення", created_at="2027-05-01T10:00:00", created_by="admin",
    )
    db.add(entry); db.commit(); db.refresh(entry)
    entry_id = entry.id
    db.close()

    resp = app_client.delete(
        f"/api/v1/finances/{entry_id}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 204

    db = SessionLocal()
    logs = db.query(AuditLog).filter_by(entity_table="finances", entity_id=entry_id).all()
    db.close()
    assert len(logs) == 1
    assert logs[0].changed_field == "deleted"
    assert "250.0" in logs[0].old_value


def test_cash_balance_marker_shown_before_tracking_start_date(db_session):
    db = db_session
    from backend.models.settings import Setting
    setting = db.get(Setting, "cash_tracking_start_date")
    if setting:
        setting.value = "2027-08-01"
    else:
        db.add(Setting(key="cash_tracking_start_date", value="2027-08-01"))
    db.flush()

    html = _dr_section3(db, "2027-07-15")
    assert "не відстежувались окремо" in html
    assert "1 серпня 2027" in html  # ua_date(cash_tracking_start_date) у тексті примітки


def test_cash_balance_shown_normally_after_tracking_start_date(db_session):
    db = db_session
    from backend.models.settings import Setting
    setting = db.get(Setting, "cash_tracking_start_date")
    if setting:
        setting.value = "2027-08-01"
    else:
        db.add(Setting(key="cash_tracking_start_date", value="2027-08-01"))
    db.flush()

    html = _dr_section3(db, "2027-09-01")
    assert "не відстежувались окремо" not in html
