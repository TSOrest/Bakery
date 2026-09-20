"""Регрес-тест на нову команду /ціна (/price) Telegram-бота — пропозиція з
QA-аудиту: персонал шукає базову ціну виробу за назвою, без переходу в
застосунок. Пошук регістронезалежний по Python-стороні (не SQL LIKE — той
не гарантує регістронезалежність для кирилиці в SQLite)."""

from backend.models.references import Product
from backend.models.pricing import Price
from backend.services.telegram_bot import _report_price


def test_report_price_finds_by_case_insensitive_substring(db_session):
    db = db_session
    p = Product(name="Тест-Хліб Бородинський", is_active=1)
    db.add(p); db.flush()
    db.add(Price(product_id=p.id, price=32.5, valid_from="2020-01-01", valid_to=None))
    db.commit()

    text = _report_price("бородинський")  # нижній регістр, кирилиця

    assert "Тест-Хліб Бородинський" in text
    assert "32" in text


def test_report_price_no_match():
    text = _report_price("Немає-Такого-Товару-XYZ-999")
    assert "не знайдено" in text


def test_report_price_empty_query():
    text = _report_price("   ")
    assert "Введіть назву товару" in text
