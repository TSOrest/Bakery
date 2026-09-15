"""Тест на регрес міграції 040: виправлення бага міграції 032.

Міграція 032 мала зробити editable=1 для типових операторських кас-статей,
але звірялась з неправильними назвами ('Виплата з каси' замість справжньої
'Виведення з каси') і не включала кілька канонічних статей взагалі
('Кредит обміну', 'Виручка магазину', 'Списання магазину'). Через це
оператор не міг відредагувати суму, введену тим самим днем, для цих статей
через PATCH /finances/{id} (заблоковано `article.editable != 1` у
backend/routers/finances.py) — саме на це поскаржився користувач.
"""

from backend.models.finances import FinanceArticle

EXPECTED_EDITABLE = [
    "Оплата",
    "Внесення в касу",
    "Виведення з каси",
    "Оплата з каси",
    "Готівка водія",
    "Списання боргу",
    "Кредит обміну",
    "Виручка магазину",
    "Списання магазину",
]

# Автогенеровані системою — мають лишатись НЕ editable.
EXPECTED_PROTECTED = [
    "Накладна",
]


def test_operator_cash_articles_are_editable(db_session):
    db = db_session
    for name in EXPECTED_EDITABLE:
        article = db.query(FinanceArticle).filter_by(name=name).first()
        assert article is not None, f"стаття {name!r} не знайдена (мала бути створена міграцією 020)"
        assert article.editable == 1, f"стаття {name!r} має бути editable=1 (міграція 040)"


def test_system_debt_article_stays_protected(db_session):
    db = db_session
    for name in EXPECTED_PROTECTED:
        article = db.query(FinanceArticle).filter_by(name=name).first()
        assert article is not None
        assert article.editable != 1, f"стаття {name!r} НЕ має бути editable — її суму синхронізує recompute_invoice_finance"
