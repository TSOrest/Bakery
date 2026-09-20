"""Регрес-тест на пропозицію з QA-аудиту: /debts у Telegram-боті групує
боржників за маршрутом замість єдиного плоского списку — на великих
списках персоналу зручніше знаходити боржників по рейсу."""

from datetime import date, timedelta

from backend.models.references import Client, Route
from backend.models.finances import Finance, FinanceArticle
from backend.services.telegram_bot import _report_debts

# У минулому — виключення "накладна сьогодні" (exclude_invoice_dates)
# не повинно зачепити цей тестовий борг.
PAST_DATE = (date.today() - timedelta(days=5)).isoformat()


def _mk_debtor(db, name, route=None):
    c = Client(full_name=name, client_kind="customer", is_active=1,
               route_id=route.id if route else None)
    db.add(c); db.flush()
    article = db.query(FinanceArticle).filter_by(name="Накладна").first()
    db.add(Finance(
        finance_date=PAST_DATE, client_id=c.id, finance_type="invoice",
        article_id=article.id if article else None, amount=123.45, sign=-1,
    ))
    return c


def test_report_debts_groups_by_route(db_session):
    db = db_session
    route = Route(name="Тест-Маршрут-Debts-A")
    db.add(route); db.flush()

    _mk_debtor(db, "Тест-Боржник-Маршрут", route=route)
    _mk_debtor(db, "Тест-Боржник-БезМаршруту", route=None)
    db.commit()

    text = _report_debts()

    header = "🚚 <b>Тест-Маршрут-Debts-A</b>"
    assert header in text
    assert "Тест-Боржник-Маршрут" in text
    assert "Без маршруту" in text
    assert "Тест-Боржник-БезМаршруту" in text

    # Клієнт має опинитись під заголовком СВОГО маршруту (до наступного "🚚"),
    # не десь-інде у списку.
    header_idx = text.index(header)
    client_idx = text.index("Тест-Боржник-Маршрут")
    next_header_idx = text.find("🚚", header_idx + 1)
    assert header_idx < client_idx
    if next_header_idx != -1:
        assert client_idx < next_header_idx
