"""Регрес-тест: клієнт бота бачив у "/"-меню Telegram службові команди
персоналу (💰 Стан фінансів, 📉 Борги, 🍞 Випічка тощо) — setMyCommands
викликався без scope, а це застосовує список команд ГЛОБАЛЬНО, для будь-
кого, хто відкриє бота. Сам виклик команди й так захищений _is_staff()
(клієнт не отримає реальні дані), але сама видимість службових команд у
меню клієнта — небажана (розкриває внутрішній функціонал, плутає клієнта).

Виправлено: глобальний (дефолтний) scope тепер завжди порожній; список
команд персоналу встановлюється лише для конкретного chat_id через
scope={"type": "chat", "chat_id": ...} — і лише авторизованому персоналу.
"""

from unittest.mock import patch

from backend.services.telegram_bot import (
    BOT_COMMANDS,
    _clear_default_commands,
    _set_staff_commands,
)


def test_clear_default_commands_sets_empty_global_list():
    with patch("backend.services.telegram_bot._api") as api:
        _clear_default_commands("TOKEN")
    api.assert_called_once_with("TOKEN", "setMyCommands", commands=[])


def test_staff_commands_are_scoped_to_one_chat_only():
    with patch("backend.services.telegram_bot._api") as api:
        _set_staff_commands("TOKEN", 12345)
    api.assert_called_once_with(
        "TOKEN", "setMyCommands",
        commands=BOT_COMMANDS,
        scope={"type": "chat", "chat_id": 12345},
    )
