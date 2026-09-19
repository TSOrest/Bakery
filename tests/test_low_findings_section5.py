"""Регрес-тест на "низьку" знахідку QA-аудиту (Розділ 5 — Telegram/звернення):
- STAFF_HELP тепер згадує кириличні альтернативи команд (раніше були
  задокументовані лише в module docstring, невидимому персоналу).
- CLIENT_HELP тепер згадує кнопку "📦 Накладна сьогодні".
"""

from backend.services.telegram_bot import STAFF_HELP, CLIENT_HELP


def test_staff_help_mentions_cyrillic_alternatives():
    assert "/звіт" in STAFF_HELP
    assert "/борги" in STAFF_HELP
    assert "/замовлення" in STAFF_HELP
    assert "/випічка" in STAFF_HELP
    assert "/деньзвіт" in STAFF_HELP


def test_client_help_mentions_invoice_button():
    assert "Накладна сьогодні" in CLIENT_HELP
