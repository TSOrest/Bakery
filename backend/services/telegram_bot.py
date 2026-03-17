"""
Telegram-бот для моніторингу пекарні.

Архітектура:
- Простий long-polling через requests (без asyncio, без конфліктів з uvicorn)
- Запускається у окремому daemon-потоці при старті сервера
- Зупиняється / перезапускається при зміні токена в Налаштуваннях
- Авторизація: власник надсилає свій номер телефону, бот перевіряє
  чи є він у списку telegram_allowed_phones

Команди:
  /start   — авторизація через контакт (кнопка "Поділитись номером")
  /звіт    — фінансовий підсумок
  /борги   — топ боржники
  /замовлення — замовлення сьогодні
  /випічка — стан випічки сьогодні
  /допомога — список команд
"""

import json
import logging
import threading
import time
from datetime import date, timedelta
from typing import Optional

import requests as rq
from sqlalchemy.orm import Session

from backend.database import SessionLocal
from backend.models.settings import Setting
from backend.models.orders import Order
from backend.models.baking import BakingTask
from backend.models.finances import Finance
from backend.models.references import Client
from backend.services.finance import get_summary, get_all_balances

log = logging.getLogger("bakery.telegram")

# ── Глобальний стан потоку бота ──────────────────────────────────────────────
_bot_thread: Optional[threading.Thread] = None
_stop_event = threading.Event()


# ── Допоміжні функції роботи з Settings ──────────────────────────────────────

def _get_setting(db: Session, key: str) -> str:
    row = db.get(Setting, key)
    return row.value if row and row.value else ""


def _set_setting(db: Session, key: str, value: str) -> None:
    row = db.get(Setting, key)
    if row:
        row.value = value
    else:
        db.add(Setting(key=key, value=value, description=""))
    db.commit()


def _get_token() -> str:
    with SessionLocal() as db:
        return _get_setting(db, "telegram_bot_token")


def _get_allowed_phones() -> list[str]:
    with SessionLocal() as db:
        raw = _get_setting(db, "telegram_allowed_phones")
    phones = [p.strip().replace(" ", "") for p in raw.split(",") if p.strip()]
    # Нормалізуємо: +380501234567
    return phones


def _get_authorized_chats() -> dict[str, str]:
    """Повертає {str(chat_id): phone}."""
    with SessionLocal() as db:
        raw = _get_setting(db, "telegram_authorized_chats")
    try:
        return json.loads(raw) if raw else {}
    except Exception:
        return {}


def _authorize_chat(chat_id: int, phone: str) -> None:
    chats = _get_authorized_chats()
    chats[str(chat_id)] = phone
    with SessionLocal() as db:
        _set_setting(db, "telegram_authorized_chats", json.dumps(chats, ensure_ascii=False))


def _revoke_chat(chat_id: int) -> None:
    chats = _get_authorized_chats()
    chats.pop(str(chat_id), None)
    with SessionLocal() as db:
        _set_setting(db, "telegram_authorized_chats", json.dumps(chats, ensure_ascii=False))


def _is_authorized(chat_id: int) -> bool:
    return str(chat_id) in _get_authorized_chats()


# ── Telegram API ─────────────────────────────────────────────────────────────

def _api(token: str, method: str, **kwargs) -> dict:
    url = f"https://api.telegram.org/bot{token}/{method}"
    try:
        r = rq.post(url, json=kwargs, timeout=10)
        return r.json()
    except Exception as e:
        log.warning("Telegram API error: %s", e)
        return {}


def _send(token: str, chat_id: int, text: str, reply_markup=None) -> None:
    params: dict = {"chat_id": chat_id, "text": text, "parse_mode": "HTML"}
    if reply_markup:
        params["reply_markup"] = reply_markup
    _api(token, "sendMessage", **params)


def _request_contact_keyboard() -> dict:
    return {
        "keyboard": [[{
            "text": "📱 Поділитись номером телефону",
            "request_contact": True,
        }]],
        "one_time_keyboard": True,
        "resize_keyboard": True,
    }


def _main_keyboard() -> dict:
    """Постійне меню кнопок після авторизації."""
    return {
        "keyboard": [
            ["💰 Звіт",      "📉 Борги"],
            ["📋 Замовлення", "🍞 Випічка"],
            ["❓ Допомога"],
        ],
        "resize_keyboard": True,
        "persistent": True,
    }


def _remove_keyboard() -> dict:
    return {"remove_keyboard": True}


# ── Бізнес-логіка повідомлень ─────────────────────────────────────────────────

def _fmt(n: float) -> str:
    return f"{n:,.2f}".replace(",", " ")


def _report_finance() -> str:
    with SessionLocal() as db:
        s = get_summary(db)
        balances = get_all_balances(db)

    sign = "+" if s.net_balance >= 0 else ""
    lines = [
        "💰 <b>Фінансовий звіт</b>",
        f"Нетто-баланс: <b>{sign}{_fmt(s.net_balance)} грн</b>",
        f"Загальний борг: {_fmt(s.total_debt)} грн ({s.clients_in_debt} кл.)",
        f"Аванси: {_fmt(s.total_credit)} грн ({s.clients_with_credit} кл.)",
        "",
        "📉 <b>Топ боржники:</b>",
    ]
    debtors = sorted([b for b in balances if b.balance < 0], key=lambda b: b.balance)[:5]
    if debtors:
        for b in debtors:
            name = b.short_name or b.client_name
            lines.append(f"  • {name}: {_fmt(b.balance)} грн")
    else:
        lines.append("  Боргів немає ✅")
    return "\n".join(lines)


def _report_orders() -> str:
    today = date.today().isoformat()
    with SessionLocal() as db:
        orders = (
            db.query(Order)
            .filter(Order.order_date == today, Order.status != "closed")
            .all()
        )
        clients = {c.id: (c.short_name or c.full_name) for c in db.query(Client).all()}

    if not orders:
        return f"📋 Замовлень на {today} немає"

    total_qty = sum(o.qty for o in orders)
    client_ids = set(o.client_id for o in orders)
    lines = [
        f"📋 <b>Замовлення на {today}</b>",
        f"Клієнтів: {len(client_ids)}, одиниць: {total_qty:.0f}",
    ]
    return "\n".join(lines)


def _report_baking() -> str:
    today = date.today().isoformat()
    with SessionLocal() as db:
        tasks = db.query(BakingTask).filter(BakingTask.task_date == today).all()
        from backend.models.references import Product
        products = {p.id: p.name for p in db.query(Product).all()}

    if not tasks:
        return f"🍞 Завдань на випічку {today} немає"

    ordered = sum(t.ordered_qty for t in tasks)
    baked   = sum(t.baked_qty for t in tasks)
    pct     = round(baked / ordered * 100, 1) if ordered else 0
    bar_filled = int(pct / 10)
    bar = "█" * bar_filled + "░" * (10 - bar_filled)

    lines = [
        f"🍞 <b>Випічка {today}</b>",
        f"Замовлено: {ordered:.0f} / Спечено: {baked:.0f}",
        f"[{bar}] {pct}%",
        "",
    ]
    for t in tasks:
        status = "✅" if t.baked_qty >= t.ordered_qty else "⏳"
        lines.append(f"{status} {products.get(t.product_id, '?')}: {t.baked_qty:.0f}/{t.ordered_qty:.0f}")
    return "\n".join(lines)


def _report_debts() -> str:
    with SessionLocal() as db:
        balances = get_all_balances(db)

    debtors = sorted([b for b in balances if b.balance < 0], key=lambda b: b.balance)
    if not debtors:
        return "✅ Боргів немає!"

    lines = ["📉 <b>Борги клієнтів</b>"]
    for b in debtors:
        name = b.short_name or b.client_name
        lines.append(f"• {name}: <b>{_fmt(b.balance)} грн</b>")
    lines.append(f"\nВсього: {_fmt(sum(b.balance for b in debtors))} грн")
    return "\n".join(lines)


HELP_TEXT = """\
📌 <b>Команди бота Пекарня:</b>

/report — 💰 Фінансовий підсумок + топ боржники
/debts — 📉 Повний список боржників
/orders — 📋 Замовлення на сьогодні
/baking — 🍞 Стан випічки сьогодні
/help — ❓ Ця підказка
"""

# Команди які реєструються в меню Telegram (тільки латиниця)
BOT_COMMANDS = [
    {"command": "report",  "description": "💰 Фінансовий підсумок + топ боржники"},
    {"command": "debts",   "description": "📉 Повний список боржників"},
    {"command": "orders",  "description": "📋 Замовлення на сьогодні"},
    {"command": "baking",  "description": "🍞 Стан випічки сьогодні"},
    {"command": "help",    "description": "❓ Список команд"},
]


def _set_my_commands(token: str) -> None:
    """Реєструє команди в меню бота (кнопка '/' у чаті)."""
    _api(token, "setMyCommands", commands=BOT_COMMANDS)


# ── Обробка оновлень ─────────────────────────────────────────────────────────

def _handle_update(token: str, update: dict) -> None:
    msg = update.get("message") or update.get("edited_message")
    if not msg:
        return

    chat_id: int = msg["chat"]["id"]
    text: str    = (msg.get("text") or "").strip()
    contact      = msg.get("contact")

    # ── Авторизація через контакт ──
    if contact:
        phone = contact.get("phone_number", "").replace(" ", "")
        if not phone.startswith("+"):
            phone = "+" + phone
        allowed = _get_allowed_phones()
        if phone in allowed:
            _authorize_chat(chat_id, phone)
            _send(token, chat_id,
                  "✅ Доступ дозволено! Оберіть дію:",
                  _main_keyboard())
        else:
            _send(token, chat_id,
                  "⛔ Ваш номер не у списку дозволених. Зверніться до адміністратора.",
                  _remove_keyboard())
        return

    # ── /start ──
    cmd_base = (text.lower().split()[0] if text else "").split("@")[0]
    if cmd_base == "/start":
        if _is_authorized(chat_id):
            _send(token, chat_id, "Оберіть дію:", _main_keyboard())
        else:
            _send(token, chat_id,
                  "👋 Вітаю! Для доступу до даних пекарні підтвердіть номер телефону.",
                  _request_contact_keyboard())
        return

    # ── Всі інші команди — тільки для авторизованих ──
    if not _is_authorized(chat_id):
        _send(token, chat_id,
              "⛔ Спочатку авторизуйтесь. Натисніть /start",
              _request_contact_keyboard())
        return

    kb = _main_keyboard()

    if cmd_base in ("/report", "/звіт") or text == "💰 Звіт":
        _send(token, chat_id, _report_finance(), kb)
    elif cmd_base in ("/debts", "/борги") or text == "📉 Борги":
        _send(token, chat_id, _report_debts(), kb)
    elif cmd_base in ("/orders", "/замовлення") or text == "📋 Замовлення":
        _send(token, chat_id, _report_orders(), kb)
    elif cmd_base in ("/baking", "/випічка") or text == "🍞 Випічка":
        _send(token, chat_id, _report_baking(), kb)
    elif cmd_base in ("/help", "/допомога") or text == "❓ Допомога":
        _send(token, chat_id, HELP_TEXT, kb)
    elif text:
        _send(token, chat_id, f"Невідома команда.\n\n" + HELP_TEXT, kb)


# ── Polling loop ──────────────────────────────────────────────────────────────

def _polling_loop(token: str, stop: threading.Event) -> None:
    log.info("Telegram bot started (polling)")
    _set_my_commands(token)
    offset = 0
    while not stop.is_set():
        try:
            r = rq.get(
                f"https://api.telegram.org/bot{token}/getUpdates",
                params={"offset": offset, "timeout": 25},
                timeout=30,
            )
            data = r.json()
            if not data.get("ok"):
                log.warning("getUpdates not ok: %s", data.get("description"))
                stop.wait(10)
                continue

            for upd in data.get("result", []):
                try:
                    _handle_update(token, upd)
                except Exception as e:
                    log.exception("Error handling update %s: %s", upd.get("update_id"), e)
                offset = upd["update_id"] + 1

        except rq.exceptions.Timeout:
            pass  # нормальна ситуація при long-polling
        except Exception as e:
            log.warning("Polling error: %s — retry in 10s", e)
            stop.wait(10)

    log.info("Telegram bot stopped")


# ── Публічний API: запуск / зупинка / перезапуск ─────────────────────────────

def start_bot(token: str) -> None:
    """Запускає бота у фоновому потоці. Якщо вже запущений — нічого не робить."""
    global _bot_thread, _stop_event
    if _bot_thread and _bot_thread.is_alive():
        return
    _stop_event = threading.Event()
    _bot_thread = threading.Thread(
        target=_polling_loop,
        args=(token, _stop_event),
        daemon=True,
        name="telegram-bot",
    )
    _bot_thread.start()


def stop_bot() -> None:
    """Зупиняє бота."""
    global _bot_thread
    _stop_event.set()
    if _bot_thread:
        _bot_thread.join(timeout=5)
        _bot_thread = None


def restart_bot(token: str) -> None:
    """Зупиняє старий і запускає новий потік з новим токеном."""
    stop_bot()
    if token:
        start_bot(token)


def bot_is_running() -> bool:
    return bool(_bot_thread and _bot_thread.is_alive())


def init_bot_from_settings() -> None:
    """Викликається при старті FastAPI — запускає бота якщо токен задано."""
    token = _get_token()
    if token:
        start_bot(token)
    else:
        log.info("Telegram bot token not set — bot disabled")
