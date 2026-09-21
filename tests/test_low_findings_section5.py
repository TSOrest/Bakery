"""Регрес-тест на "низьку" знахідку QA-аудиту (Розділ 5 — Telegram/звернення):
- STAFF_HELP тепер згадує кириличні альтернативи команд (раніше були
  задокументовані лише в module docstring, невидимому персоналу).
- CLIENT_HELP тепер згадує кнопку "📦 Накладна сьогодні".
"""

import re

from backend.services.telegram_bot import _staff_help_text, CLIENT_HELP


def test_staff_help_mentions_cyrillic_alternatives():
    staff_help = _staff_help_text()
    assert "/звіт" in staff_help
    assert "/борги" in staff_help
    assert "/замовлення" in staff_help
    assert "/випічка" in staff_help
    assert "/деньзвіт" in staff_help


def test_client_help_mentions_invoice_button():
    assert "Накладна сьогодні" in CLIENT_HELP


def test_staff_help_mentions_app_version():
    """/help персоналу (використовується власниками для перевірки, яка
    версія встановлена) показує версію з кореневого файлу VERSION."""
    from backend.services.telegram_bot import _read_version

    version = _read_version()
    assert version != "?"
    assert re.match(r"v\d+\.\d+\.\d+", version)
    assert version in _staff_help_text()
