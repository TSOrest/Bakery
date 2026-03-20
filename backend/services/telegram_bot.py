"""
Telegram-бот для моніторингу пекарні.

Архітектура:
- Простий long-polling через requests (без asyncio, без конфліктів з uvicorn)
- Запускається у окремому daemon-потоці при старті сервера
- Два режими авторизації:
    1. Персонал пекарні — телефон у telegram_allowed_phones → staff-меню
    2. Клієнт пекарні   — телефон у clients.phone → прив'язується bot_chat_id

Команди (персонал):
  /start   — авторизація через контакт
  /звіт    — фінансовий підсумок
  /борги   — топ боржники
  /замовлення — замовлення сьогодні
  /випічка — стан випічки сьогодні
  /допомога — список команд

Клієнт (після авторизації):
  /старт / /start — головне меню
  📋 Моє замовлення — замовлення на завтра
  ✏️ Оформити замовлення — покроковий ввід кількостей
  ❓ Допомога
"""

import json
import logging
import threading
from datetime import date, timedelta
from typing import Optional

import requests as rq
from sqlalchemy.orm import Session

from backend.database import SessionLocal
from backend.models.settings import Setting
from backend.models.orders import Order
from backend.models.baking import BakingTask
from backend.models.references import Client, Product
from backend.services.finance import get_summary, get_all_balances
from backend.services.prices import get_price

log = logging.getLogger("bakery.telegram")

# ── Глобальний стан потоку бота ──────────────────────────────────────────────
_bot_thread: Optional[threading.Thread] = None
_stop_event = threading.Event()

# Стан діалогу при оформленні замовлення клієнтом:
# {chat_id: {"step": "awaiting_qty", "product_ids": [...], "idx": 0, "order_date": "...", "inputs": {}}}
_client_state: dict[int, dict] = {}
_state_lock = threading.Lock()


# ── Допоміжні функції роботи з Settings ──────────────────────────────────────

def _get_setting(db: Session, key: str, default: str = "") -> str:
    row = db.get(Setting, key)
    return row.value if row and row.value else default


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
    return phones


def _get_authorized_chats() -> dict[str, str]:
    """Повертає {str(chat_id): phone} — авторизований персонал."""
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


def _is_staff(chat_id: int) -> bool:
    return str(chat_id) in _get_authorized_chats()


def _find_client_by_phone(db: Session, phone: str) -> Optional[Client]:
    """Шукає клієнта у БД за номером телефону (нормалізований)."""
    phone_clean = phone.strip().replace(" ", "").replace("-", "")
    if not phone_clean.startswith("+"):
        phone_clean = "+" + phone_clean
    all_clients = db.query(Client).filter(Client.is_active == 1).all()
    for c in all_clients:
        if not c.phone:
            continue
        cp = c.phone.strip().replace(" ", "").replace("-", "")
        if not cp.startswith("+"):
            cp = "+" + cp
        if cp == phone_clean:
            return c
    return None


def _get_client_by_chat(db: Session, chat_id: int) -> Optional[Client]:
    return db.query(Client).filter(Client.bot_chat_id == str(chat_id)).first()


def _link_client_chat(db: Session, client: Client, chat_id: int) -> None:
    client.bot_chat_id = str(chat_id)
    db.commit()


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


def send_to_chat(chat_id: int, text: str) -> None:
    """Публічна функція: надіслати повідомлення клієнту (викликається з routers/bot.py)."""
    token = _get_token()
    if token:
        _send(token, chat_id, text)


def _request_contact_keyboard() -> dict:
    return {
        "keyboard": [[{
            "text": "📱 Поділитись номером телефону",
            "request_contact": True,
        }]],
        "one_time_keyboard": True,
        "resize_keyboard": True,
    }


def _staff_keyboard() -> dict:
    return {
        "keyboard": [
            ["💰 Звіт",      "📉 Борги"],
            ["📋 Замовлення", "🍞 Випічка"],
            ["❓ Допомога"],
        ],
        "resize_keyboard": True,
        "persistent": True,
    }


def _client_keyboard() -> dict:
    return {
        "keyboard": [
            ["📋 Моє замовлення"],
            ["✏️ Оформити замовлення"],
            ["❓ Допомога"],
        ],
        "resize_keyboard": True,
        "persistent": True,
    }


def _remove_keyboard() -> dict:
    return {"remove_keyboard": True}


# ── Бізнес-логіка — персонал ─────────────────────────────────────────────────

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


STAFF_HELP = """\
📌 <b>Команди бота Пекарня:</b>

/report — 💰 Фінансовий підсумок + топ боржники
/debts  — 📉 Повний список боржників
/orders — 📋 Замовлення на сьогодні
/baking — 🍞 Стан випічки сьогодні
/help   — ❓ Ця підказка
"""

CLIENT_HELP = """\
📌 <b>Що я вмію:</b>

📋 <b>Моє замовлення</b> — переглянути замовлення на завтра
✏️ <b>Оформити замовлення</b> — подати нове замовлення на завтра

Замовлення, подані через бота, потребують підтвердження оператора. \
Ви отримаєте повідомлення після перевірки.
"""

BOT_COMMANDS = [
    {"command": "report",  "description": "💰 Фінансовий підсумок"},
    {"command": "debts",   "description": "📉 Борги клієнтів"},
    {"command": "orders",  "description": "📋 Замовлення сьогодні"},
    {"command": "baking",  "description": "🍞 Стан випічки"},
    {"command": "help",    "description": "❓ Список команд"},
]


def _set_my_commands(token: str) -> None:
    _api(token, "setMyCommands", commands=BOT_COMMANDS)


# ── Бізнес-логіка — клієнт ───────────────────────────────────────────────────

def _client_orders_text(db: Session, client: Client, order_date: str) -> str:
    orders = (
        db.query(Order)
        .filter(
            Order.client_id == client.id,
            Order.order_date == order_date,
            Order.parent_order_id.is_(None),
            Order.qty > 0,
        )
        .all()
    )
    products = {p.id: p for p in db.query(Product).all()}

    if not orders:
        return f"📋 Замовлень на {order_date} немає."

    lines = [f"📋 <b>Замовлення на {order_date}</b>"]
    total = 0.0
    for o in orders:
        p = products.get(o.product_id)
        price = get_price(db, o.product_id, client.id, order_date) or 0
        s = o.qty * price
        total += s
        src = " 🤖" if o.source == "bot" else ""
        status = ""
        if o.bot_status == "pending":
            status = " ⏳ (очікує підтвердження)"
        elif o.bot_status == "rejected":
            status = " ❌ (відхилено)"
        elif o.bot_status in ("confirmed", "modified"):
            status = " ✅"
        name = p.name if p else f"#{o.product_id}"
        lines.append(f"• {name}: {o.qty:.0f} шт × {price:.2f} = {s:.2f} грн{src}{status}")

    lines.append(f"\n💰 <b>Разом: {total:.2f} грн</b>")
    return "\n".join(lines)


def _start_order_dialog(token: str, chat_id: int, client: Client) -> None:
    """Починає діалог прийому замовлення від клієнта."""
    tomorrow = (date.today() + timedelta(days=1)).isoformat()

    with SessionLocal() as db:
        # Активні вироби для замовлення (хліб + булки)
        products = db.query(Product).filter(
            Product.is_active == 1,
            Product.type.in_(["bread", "bun"]),
        ).order_by(Product.name).all()
        product_list = [(p.id, p.name, p.weight) for p in products]

    if not product_list:
        _send(token, chat_id, "Немає активних виробів для замовлення.", _client_keyboard())
        return

    with _state_lock:
        _client_state[chat_id] = {
            "step": "awaiting_qty",
            "product_ids": [pid for pid, _, _ in product_list],
            "product_names": {pid: name for pid, name, _ in product_list},
            "product_weights": {pid: w for pid, name, w in product_list},
            "idx": 0,
            "order_date": tomorrow,
            "client_id": client.id,
            "inputs": {},
        }

    _ask_product_qty(token, chat_id)


def _ask_product_qty(token: str, chat_id: int) -> None:
    """Просить ввести кількість для поточного виробу."""
    with _state_lock:
        state = _client_state.get(chat_id)
    if not state:
        return

    idx = state["idx"]
    pids = state["product_ids"]
    if idx >= len(pids):
        _finish_order_dialog(token, chat_id)
        return

    pid = pids[idx]
    name = state["product_names"][pid]
    w = state["product_weights"].get(pid)
    weight_str = f" ({w} кг)" if w else ""
    total = len(pids)

    skip_kb = {
        "keyboard": [["0 (пропустити)"], ["❌ Скасувати замовлення"]],
        "one_time_keyboard": True,
        "resize_keyboard": True,
    }
    _send(token, chat_id,
          f"[{idx+1}/{total}] <b>{name}</b>{weight_str}\nВведіть кількість (0 — не замовляти):",
          skip_kb)


def _finish_order_dialog(token: str, chat_id: int) -> None:
    """Зберігає введені замовлення і повідомляє клієнта."""
    with _state_lock:
        state = _client_state.pop(chat_id, None)
    if not state:
        return

    inputs = {k: v for k, v in state["inputs"].items() if v > 0}
    order_date = state["order_date"]
    client_id  = state["client_id"]

    if not inputs:
        _send(token, chat_id, "Замовлення не оформлено — кількість не вказана.",
              _client_keyboard())
        return

    with SessionLocal() as db:
        from datetime import datetime
        now = datetime.now().isoformat(timespec="seconds")
        # Видаляємо старі bot-pending замовлення на цю дату від цього клієнта
        db.query(Order).filter(
            Order.client_id == client_id,
            Order.order_date == order_date,
            Order.source == "bot",
            Order.bot_status == "pending",
        ).delete()

        for pid, qty in inputs.items():
            db.add(Order(
                client_id=client_id,
                product_id=pid,
                qty=qty,
                order_date=order_date,
                status="draft",
                source="bot",
                bot_status="pending",
                created_at=now,
                created_by="bot",
            ))
        db.commit()

    product_lines = "\n".join(
        f"• {state['product_names'][pid]}: {qty:.0f} шт"
        for pid, qty in inputs.items()
    )
    _send(token, chat_id,
          f"✅ Замовлення на {order_date} прийнято!\n\n{product_lines}\n\n"
          f"⏳ Очікуйте підтвердження оператора.",
          _client_keyboard())


# ── Обробка оновлень ─────────────────────────────────────────────────────────

def _handle_update(token: str, update: dict) -> None:
    msg = update.get("message") or update.get("edited_message")
    if not msg:
        return

    chat_id: int = msg["chat"]["id"]
    text: str    = (msg.get("text") or "").strip()
    contact      = msg.get("contact")

    # ── Авторизація через контакт (спільний для персоналу і клієнтів) ──
    if contact:
        phone = contact.get("phone_number", "").replace(" ", "")
        if not phone.startswith("+"):
            phone = "+" + phone

        # Спочатку перевіряємо персонал
        allowed = _get_allowed_phones()
        if phone in allowed:
            _authorize_chat(chat_id, phone)
            _send(token, chat_id, "✅ Доступ дозволено! Оберіть дію:", _staff_keyboard())
            return

        # Потім перевіряємо клієнтів
        with SessionLocal() as db:
            client = _find_client_by_phone(db, phone)
            if client:
                _link_client_chat(db, client, chat_id)
                name = client.short_name or client.full_name
                _send(token, chat_id,
                      f"✅ Вітаємо, <b>{name}</b>! Ви авторизовані як клієнт пекарні.",
                      _client_keyboard())
                return

        _send(token, chat_id,
              "⛔ Ваш номер не знайдено. Зверніться до адміністратора.",
              _remove_keyboard())
        return

    cmd_base = (text.lower().split()[0] if text else "").split("@")[0]

    # ── /start ──
    if cmd_base == "/start":
        if _is_staff(chat_id):
            _send(token, chat_id, "Оберіть дію:", _staff_keyboard())
            return
        with SessionLocal() as db:
            client = _get_client_by_chat(db, chat_id)
        if client:
            name = client.short_name or client.full_name
            _send(token, chat_id, f"Вітаємо, <b>{name}</b>! Оберіть дію:", _client_keyboard())
            return
        _send(token, chat_id,
              "👋 Вітаю! Підтвердіть номер телефону для входу.",
              _request_contact_keyboard())
        return

    # ── Перевіряємо чи клієнт у стані діалогу ──
    with _state_lock:
        in_dialog = chat_id in _client_state

    if in_dialog:
        _handle_client_dialog(token, chat_id, text)
        return

    # ── Персонал ──
    if _is_staff(chat_id):
        kb = _staff_keyboard()
        if cmd_base in ("/report", "/звіт") or text == "💰 Звіт":
            _send(token, chat_id, _report_finance(), kb)
        elif cmd_base in ("/debts", "/борги") or text == "📉 Борги":
            _send(token, chat_id, _report_debts(), kb)
        elif cmd_base in ("/orders", "/замовлення") or text == "📋 Замовлення":
            _send(token, chat_id, _report_orders(), kb)
        elif cmd_base in ("/baking", "/випічка") or text == "🍞 Випічка":
            _send(token, chat_id, _report_baking(), kb)
        elif cmd_base in ("/help", "/допомога") or text == "❓ Допомога":
            _send(token, chat_id, STAFF_HELP, kb)
        elif text:
            _send(token, chat_id, "Невідома команда.\n\n" + STAFF_HELP, kb)
        return

    # ── Клієнт ──
    with SessionLocal() as db:
        client = _get_client_by_chat(db, chat_id)

    if client:
        kb = _client_keyboard()
        tomorrow = (date.today() + timedelta(days=1)).isoformat()

        if text == "📋 Моє замовлення":
            with SessionLocal() as db:
                cl = db.get(Client, client.id)
                resp = _client_orders_text(db, cl, tomorrow)
            _send(token, chat_id, resp, kb)

        elif text == "✏️ Оформити замовлення":
            with SessionLocal() as db:
                cl = db.get(Client, client.id)
            _start_order_dialog(token, chat_id, cl)

        elif text == "❓ Допомога" or cmd_base in ("/help",):
            _send(token, chat_id, CLIENT_HELP, kb)

        elif text:
            _send(token, chat_id, "Оберіть дію з меню.", kb)
        return

    # ── Незнайомець ──
    _send(token, chat_id,
          "⛔ Спочатку авторизуйтесь. Натисніть /start",
          _request_contact_keyboard())


def _handle_client_dialog(token: str, chat_id: int, text: str) -> None:
    """Обробляє ввід кількості товару під час оформлення замовлення."""
    if text == "❌ Скасувати замовлення":
        with _state_lock:
            _client_state.pop(chat_id, None)
        _send(token, chat_id, "Замовлення скасовано.", _client_keyboard())
        return

    with _state_lock:
        state = _client_state.get(chat_id)
    if not state:
        return

    # Парсимо число
    raw = text.split()[0]  # "0 (пропустити)" → "0"
    try:
        qty = float(raw)
        if qty < 0:
            raise ValueError
    except ValueError:
        _send(token, chat_id, "Введіть число (0 або більше).")
        return

    pid = state["product_ids"][state["idx"]]
    with _state_lock:
        _client_state[chat_id]["inputs"][pid] = qty
        _client_state[chat_id]["idx"] += 1
        new_idx = _client_state[chat_id]["idx"]

    if new_idx >= len(state["product_ids"]):
        _finish_order_dialog(token, chat_id)
    else:
        _ask_product_qty(token, chat_id)


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
            pass
        except Exception as e:
            log.warning("Polling error: %s — retry in 10s", e)
            stop.wait(10)

    log.info("Telegram bot stopped")


# ── Публічний API ─────────────────────────────────────────────────────────────

def start_bot(token: str) -> None:
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
    global _bot_thread
    _stop_event.set()
    if _bot_thread:
        _bot_thread.join(timeout=5)
        _bot_thread = None


def restart_bot(token: str) -> None:
    stop_bot()
    if token:
        start_bot(token)


def bot_is_running() -> bool:
    return bool(_bot_thread and _bot_thread.is_alive())


def init_bot_from_settings() -> None:
    token = _get_token()
    if token:
        start_bot(token)
    else:
        log.info("Telegram bot token not set — bot disabled")
