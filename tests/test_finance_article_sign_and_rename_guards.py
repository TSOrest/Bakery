"""Регрес-тести на дві "високі" знахідки QA-аудиту (Розділ 3 — Фінанси):

1. POST /finances/ не перевіряв, що sign відповідає article.direction —
   можна було створити "дохід" з sign=-1 (чи навпаки), спотворюючи всі суми,
   що групуються за напрямком статті (баланси, звіти).
2. PUT /finances/articles/{id} дозволяв перейменувати системну статтю
   (is_system=1) — назва системних статей звіряється буквально в кількох
   місцях коду (backend/services/finance.py, print_views.py), перейменування
   мовчки ламало би їх. Заразом заблоковано дублікат назви для БУДЬ-ЯКОЇ
   статті (раніше унікальність перевірялась лише для системних, БД-індексом).

Виправлено: backend/routers/finances.py (create_finance),
backend/routers/finances_articles.py (create_article, update_article).
"""

from backend.database import SessionLocal
from backend.models.finances import FinanceArticle


def test_sign_mismatch_with_income_article_rejected(app_client, admin_token):
    db = SessionLocal()
    article = FinanceArticle(name="Тест-дохід-sign", direction="income", is_system=0)
    db.add(article); db.commit(); db.refresh(article)
    article_id = article.id
    db.close()

    resp = app_client.post(
        "/api/v1/finances/",
        json={
            "finance_date": "2026-09-18", "finance_type": "deposit",
            "article_id": article_id, "amount": 100, "sign": -1,
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 422
    assert "напрямку" in resp.json()["detail"]


def test_sign_matching_direction_accepted(app_client, admin_token):
    db = SessionLocal()
    article = FinanceArticle(name="Тест-витрата-sign", direction="expense", is_system=0)
    db.add(article); db.commit(); db.refresh(article)
    article_id = article.id
    db.close()

    resp = app_client.post(
        "/api/v1/finances/",
        json={
            "finance_date": "2026-09-18", "finance_type": "writeoff",
            "article_id": article_id, "amount": 100, "sign": -1,
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 201


def test_system_article_rename_blocked(app_client, admin_token):
    db = SessionLocal()
    article = db.query(FinanceArticle).filter_by(name="Оплата", is_system=1).first()
    assert article is not None
    article_id = article.id
    db.close()

    resp = app_client.put(
        f"/api/v1/finances/articles/{article_id}",
        json={"name": "Оплата-перейменована"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 400


def test_system_article_direction_still_editable(app_client, admin_token):
    """Тип (direction) системної статті лишається редагованим — заблоковано
    лише назву."""
    db = SessionLocal()
    article = FinanceArticle(name="Тест-системна-тип", direction="income", is_system=1)
    db.add(article); db.commit(); db.refresh(article)
    article_id = article.id
    db.close()

    resp = app_client.put(
        f"/api/v1/finances/articles/{article_id}",
        json={"editable": 1},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["editable"] == 1


def test_duplicate_article_name_rejected_on_create(app_client, admin_token):
    resp1 = app_client.post(
        "/api/v1/finances/articles/",
        json={"name": "Тест-дублікат-статті", "direction": "income"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp1.status_code == 201

    resp2 = app_client.post(
        "/api/v1/finances/articles/",
        json={"name": "Тест-дублікат-статті", "direction": "expense"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp2.status_code == 409


def test_duplicate_article_name_rejected_on_rename(app_client, admin_token):
    db = SessionLocal()
    a1 = FinanceArticle(name="Тест-перейм-1", direction="income", is_system=0)
    a2 = FinanceArticle(name="Тест-перейм-2", direction="income", is_system=0)
    db.add_all([a1, a2]); db.commit(); db.refresh(a1); db.refresh(a2)
    a2_id = a2.id
    db.close()

    resp = app_client.put(
        f"/api/v1/finances/articles/{a2_id}",
        json={"name": "Тест-перейм-1"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 409
