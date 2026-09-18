"""Тести дозволу редагування фінансових записів (PATCH /finances/{id}).

Раніше блокувалось за `created_by == 'system'`, що виключало ОБИДВІ категорії
автоматичних записів: борг накладної (finance_type='invoice') і оплату при
прийнятті накладної (finance_type='payment'). Тепер захищений лишається лише
'invoice' (його суму підтримує recompute_invoice_finance — ручна правка
розсинхронізувала б журнал із самою накладною). Записи оплат — включно з
created_by='system' — тепер редаговні: потрібно було виправити ситуацію коли
оператор помилково прийняв накладну із сумою оплати, якої фактично не було.
"""

from backend.database import SessionLocal
from backend.models.references import Client
from backend.models.finances import Finance, FinanceArticle
from backend.routers.finances import _current_work_dates


def _mk_client(db, name="Клієнт"):
    c = Client(full_name=name, client_kind="customer", is_active=1)
    db.add(c); db.flush()
    return c


def _work_date(db) -> str:
    """Дата, яку сервер визнає поточною робочою — щоб тести PATCH не залежали
    від того, о котрій годині вони фактично запускаються."""
    return sorted(_current_work_dates(db))[-1]


def test_system_payment_entry_is_editable(app_client, admin_token):
    """Автоматичний запис оплати (created_by='system', finance_type='payment')
    тепер можна відредагувати — саме той кейс, що й запросив користувач."""
    db = SessionLocal()
    wd = _work_date(db)
    c = _mk_client(db, "Клієнт-оплата")
    article = db.query(FinanceArticle).filter_by(name="Оплата").first()
    entry = Finance(
        finance_date=wd, client_id=c.id, finance_type="payment",
        article_id=article.id if article else None, amount=500.0, sign=1,
        notes="Оплата по 20260915-001", created_at=f"{wd}T10:00:00",
        created_by="system",
    )
    db.add(entry); db.commit(); db.refresh(entry)
    entry_id = entry.id
    db.close()

    resp = app_client.patch(
        f"/api/v1/finances/{entry_id}",
        json={"amount": 0, "notes": "Помилково прийнято з оплатою — оплати не було"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["amount"] == 0


def test_invoice_debt_entry_stays_protected(app_client, admin_token):
    """Борговий запис накладної (finance_type='invoice') і далі захищений
    незалежно від created_by — його суму синхронізує recompute_invoice_finance."""
    db = SessionLocal()
    c = _mk_client(db, "Клієнт-борг")
    entry = Finance(
        finance_date="2026-09-15", client_id=c.id, finance_type="invoice",
        amount=750.0, sign=-1, notes="20260915-002",
        created_at="2026-09-15T10:00:00", created_by="system",
    )
    db.add(entry); db.commit(); db.refresh(entry)
    entry_id = entry.id
    db.close()

    resp = app_client.patch(
        f"/api/v1/finances/{entry_id}",
        json={"amount": 0},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 400


def test_non_editable_article_stays_protected(app_client, admin_token):
    """Стаття без editable=1 і далі не редагується — незалежно від created_by."""
    db = SessionLocal()
    c = _mk_client(db, "Клієнт-неред")
    article = FinanceArticle(name="Тестова нередагована", direction="income",
                              is_system=0, editable=0)
    db.add(article); db.flush()
    entry = Finance(
        finance_date="2026-09-15", client_id=c.id, finance_type="payment",
        article_id=article.id, amount=100.0, sign=1, notes="test",
        created_at="2026-09-15T10:00:00", created_by="operator",
    )
    db.add(entry); db.commit(); db.refresh(entry)
    entry_id = entry.id
    db.close()

    resp = app_client.patch(
        f"/api/v1/finances/{entry_id}",
        json={"amount": 0},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 400


def test_manual_payment_entry_still_editable(app_client, admin_token):
    """Регрес-запобіжник: вручну внесена оплата (created_by != 'system')
    і далі редагується, як і до цієї зміни."""
    db = SessionLocal()
    wd = _work_date(db)
    c = _mk_client(db, "Клієнт-ручна-оплата")
    article = db.query(FinanceArticle).filter_by(name="Оплата").first()
    entry = Finance(
        finance_date=wd, client_id=c.id, finance_type="payment",
        article_id=article.id if article else None, amount=300.0, sign=1,
        notes="Готівка", created_at=f"{wd}T10:00:00", created_by="admin",
    )
    db.add(entry); db.commit(); db.refresh(entry)
    entry_id = entry.id
    db.close()

    resp = app_client.patch(
        f"/api/v1/finances/{entry_id}",
        json={"amount": 250},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["amount"] == 250
