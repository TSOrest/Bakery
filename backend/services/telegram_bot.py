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
  📋 Моє замовлення — замовлення на завтра
  ➕ Додати товар   — вибір типу → вибір товару → кількість
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
from backend.models.references import Client, Product, ClientBotUser
from backend.services.finance import get_summary, get_all_balances, get_client_balance
from backend.services.prices import get_price

log = logging.getLogger("bakery.telegram")

# ── Глобальний стан потоку бота ──────────────────────────────────────────────
_bot_thread: Optional[threading.Thread] = None
_stop_event = threading.Event()

# Стан діалогу клієнта:
# {chat_id: {
#   "step": "awaiting_qty",
#   "product_id": int,
#   "product_name": str,
#   "order_date": str,
#   "client_id": int,
#   "msg_id": int,           ← id повідомлення з inline-клавіатурою (для редагування)
#   "products": [...],       ← список товарів при виборі (для пагінації)
#   "page": int,
# }}
_client_state: dict[int, dict] = {}
_state_lock = threading.Lock()

PAGE_SIZE = 8  # товарів на сторінку


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


def _normalize_phone(phone: str) -> str:
    p = phone.strip().replace(" ", "").replace("-", "")
    if not p.startswith("+"):
        p = "+" + p
    return p


def _find_client_by_phone(db: Session, phone: str) -> Optional[Client]:
    """Шукає клієнта у БД за номером телефону.
    Перевіряє поле bot_phones (через кому), або основний phone."""
    phone_clean = _normalize_phone(phone)
    for c in db.query(Client).filter(Client.is_active == 1).all():
        # Перевіряємо bot_phones (список через кому)
        if c.bot_phones:
            for p in c.bot_phones.split(","):
                if _normalize_phone(p) == phone_clean:
                    return c
        # Запасний варіант — основний phone
        if c.phone and _normalize_phone(c.phone) == phone_clean:
            return c
    return None


def _get_client_by_chat(db: Session, chat_id: int) -> Optional[Client]:
    """Знаходить клієнта за chat_id через таблицю client_bot_users."""
    bu = db.query(ClientBotUser).filter(
        ClientBotUser.chat_id == str(chat_id),
        ClientBotUser.is_active == 1,
    ).first()
    return db.get(Client, bu.client_id) if bu else None


def _link_client_chat(db: Session, client: Client, chat_id: int, phone: str = "", first_name: str = "") -> None:
    """Створює або оновлює запис авторизованого користувача бота."""
    from datetime import datetime
    now = datetime.now().isoformat(timespec="seconds")
    bu = db.query(ClientBotUser).filter(ClientBotUser.chat_id == str(chat_id)).first()
    if bu:
        bu.client_id  = client.id
        bu.is_active  = 1
        bu.authorized_at = now
    else:
        db.add(ClientBotUser(
            client_id=client.id,
            chat_id=str(chat_id),
            phone=phone,
            first_name=first_name or None,
            authorized_at=now,
        ))
    db.commit()


def _get_all_chat_ids_for_client(db: Session, client_id: int) -> list[str]:
    """Повертає всі активні chat_id користувачів для клієнта (для розсилки)."""
    return [
        bu.chat_id for bu in
        db.query(ClientBotUser).filter(
            ClientBotUser.client_id == client_id,
            ClientBotUser.is_active == 1,
        ).all()
    ]


# ── Telegram API ─────────────────────────────────────────────────────────────

def _api(token: str, method: str, **kwargs) -> dict:
    url = f"https://api.telegram.org/bot{token}/{method}"
    try:
        r = rq.post(url, json=kwargs, timeout=10)
        return r.json()
    except Exception as e:
        log.warning("Telegram API error: %s", e)
        return {}


def _send(token: str, chat_id: int, text: str, reply_markup=None) -> dict:
    params: dict = {"chat_id": chat_id, "text": text, "parse_mode": "HTML"}
    if reply_markup:
        params["reply_markup"] = reply_markup
    return _api(token, "sendMessage", **params)


def _edit_inline(token: str, chat_id: int, msg_id: int, text: str, inline_kb: dict) -> None:
    """Редагує існуюче повідомлення — замінює текст і inline-клавіатуру."""
    _api(token, "editMessageText",
         chat_id=chat_id,
         message_id=msg_id,
         text=text,
         parse_mode="HTML",
         reply_markup=inline_kb)


def _remove_inline(token: str, chat_id: int, msg_id: int) -> None:
    """Прибирає inline-клавіатуру з повідомлення."""
    _api(token, "editMessageReplyMarkup",
         chat_id=chat_id,
         message_id=msg_id,
         reply_markup={"inline_keyboard": []})


def _answer_callback(token: str, callback_id: str, text: str = "") -> None:
    """Відповідає на callback_query (прибирає 'годинник' на кнопці)."""
    _api(token, "answerCallbackQuery", callback_query_id=callback_id, text=text)


def send_to_chat(chat_id: int, text: str) -> None:
    """Публічна функція: надіслати повідомлення клієнту (викликається з routers/bot.py)."""
    token = _get_token()
    if token:
        _send(token, chat_id, text)


# ── Клавіатури ────────────────────────────────────────────────────────────────

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
            ["💰 Звіт",       "📉 Борги"],
            ["📋 Замовлення", "🍞 Випічка"],
            ["❓ Допомога"],
        ],
        "resize_keyboard": True,
        "persistent": True,
    }


def _client_keyboard() -> dict:
    return {
        "keyboard": [
            ["📋 Моє замовлення", "➕ Додати товар"],
            ["📦 Накладна сьогодні"],
            ["❓ Допомога"],
        ],
        "resize_keyboard": True,
        "persistent": True,
    }


def _remove_keyboard() -> dict:
    return {"remove_keyboard": True}


def _type_inline_kb() -> dict:
    """Inline-клавіатура для вибору типу товару."""
    return {
        "inline_keyboard": [
            [{"text": "🍞 Хліб",  "callback_data": "type:bread"}],
            [{"text": "🥐 Булки", "callback_data": "type:bun"}],
            [{"text": "🛍 Інше",  "callback_data": "type:other"}],
            [{"text": "❌ Скасувати", "callback_data": "cancel"}],
        ]
    }


def _products_inline_kb(products: list, page: int) -> dict:
    """Inline-клавіатура зі списком товарів (з пагінацією)."""
    start = page * PAGE_SIZE
    chunk = products[start: start + PAGE_SIZE]

    rows = []
    # По 2 товари в рядку
    for i in range(0, len(chunk), 2):
        row = []
        for p in chunk[i: i + 2]:
            label = p["name"]
            if p.get("price") is not None:
                label += f" — {p['price']:.0f} грн"
            row.append({"text": label, "callback_data": f"prod:{p['id']}"})
        rows.append(row)

    # Навігація
    nav = []
    if page > 0:
        nav.append({"text": "◀ Назад", "callback_data": f"page:{page - 1}"})
    if start + PAGE_SIZE < len(products):
        nav.append({"text": "Далі ▶", "callback_data": f"page:{page + 1}"})
    if nav:
        rows.append(nav)

    rows.append([{"text": "🔙 До типів", "callback_data": "back:types"}])

    return {"inline_keyboard": rows}


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
➕ <b>Додати товар</b> — додати позицію до замовлення на завтра

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
        return f"📋 Замовлень на {order_date} поки немає.\n\nНатисніть ➕ <b>Додати товар</b> щоб оформити замовлення."

    lines = [f"📋 <b>Замовлення на {order_date}</b>"]
    total = 0.0
    for o in orders:
        p = products.get(o.product_id)
        price = get_price(db, o.product_id, client.id, order_date) or 0
        s = o.qty * price
        total += s
        if o.source == "bot":
            if o.bot_status == "pending":
                icon = "⏳"
            elif o.bot_status == "rejected":
                icon = "❌"
            elif o.bot_status in ("confirmed", "modified"):
                icon = "✅"
            else:
                icon = "🤖"
        else:
            icon = "👤"
        name = p.name if p else f"#{o.product_id}"
        lines.append(f"{icon} {name}: {o.qty:.0f} шт")

    lines.append(f"\n💰 <b>Разом: {total:.2f} грн</b>")
    return "\n".join(lines)


def _client_invoice_text(db: Session, client: Client, delivery_date: str) -> str:
    """Імпровізована накладна на delivery_date: товари + попередній борг = до сплати."""
    orders = (
        db.query(Order)
        .filter(
            Order.client_id == client.id,
            Order.order_date == delivery_date,
            Order.parent_order_id.is_(None),
            Order.qty > 0,
        )
        # Виключаємо відхилені бот-замовлення
        .filter(~((Order.source == "bot") & (Order.bot_status == "rejected")))
        .all()
    )
    products = {p.id: p for p in db.query(Product).all()}

    if not orders:
        return (
            f"📦 <b>Накладна на {delivery_date}</b>\n\n"
            f"Замовлень на сьогодні немає."
        )

    SEP = "─" * 28
    lines = [f"📦 <b>Накладна на {delivery_date}</b>", f"<code>{SEP}</code>"]

    order_sum = 0.0
    for o in orders:
        p = products.get(o.product_id)
        price = get_price(db, o.product_id, client.id, delivery_date) or 0
        s = o.qty * price
        order_sum += s
        name = (p.name if p else f"#{o.product_id}")[:22]
        qty_str  = f"{o.qty:.0f} шт"
        sum_str  = f"{s:.2f}"
        # pending bot-замовлення позначаємо
        pending = o.source == "bot" and o.bot_status == "pending"
        flag = " ⏳" if pending else ""
        lines.append(f"<code>{name:<22} {qty_str:>6}  {sum_str:>8}</code>{flag}")

    lines.append(f"<code>{SEP}</code>")
    lines.append(f"<code>{'За товар:':<22} {'':>6}  {order_sum:>8.2f}</code>")

    # Попередній борг / переплата (баланс БЕЗ сьогоднішніх накладних)
    prev_balance = get_client_balance(db, client.id)
    if prev_balance < 0:
        lines.append(f"<code>{'Попередній борг:':<22} {'':>6}  {prev_balance:>8.2f}</code>")
    elif prev_balance > 0:
        lines.append(f"<code>{'Переплата:':<22} {'':>6}  +{prev_balance:>7.2f}</code>")

    total_due = order_sum - prev_balance  # борг від'ємний → збільшує суму; переплата → зменшує
    lines.append(f"<code>{SEP}</code>")
    if total_due > 0:
        lines.append(f"<code>{'💰 До сплати:':<22} {'':>6}  {total_due:>8.2f}</code>")
    elif total_due < 0:
        lines.append(f"<code>{'✅ Ваша переплата:':<22} {'':>6}  {abs(total_due):>8.2f}</code>")
    else:
        lines.append("<code>✅ Рахунок нульовий</code>")

    if any(o.source == "bot" and o.bot_status == "pending" for o in orders):
        lines.append("\n<i>⏳ — позиції очікують підтвердження оператора</i>")

    return "\n".join(lines)


def _get_products_by_type(product_type: str, client_id: int, order_date: str) -> list[dict]:
    """Повертає активні вироби заданого типу з ціною для клієнта."""
    with SessionLocal() as db:
        products = (
            db.query(Product)
            .filter(Product.is_active == 1, Product.type == product_type)
            .order_by(Product.name)
            .all()
        )
        return [
            {
                "id": p.id,
                "name": p.name,
                "price": get_price(db, p.id, client_id, order_date),
            }
            for p in products
        ]


def _start_add_product(token: str, chat_id: int, client_id: int) -> None:
    """Починає flow додавання товару: показує вибір типу."""
    tomorrow = (date.today() + timedelta(days=1)).isoformat()
    result = _send(token, chat_id,
                   "Оберіть тип товару:",
                   _type_inline_kb())

    msg_id = result.get("result", {}).get("message_id")
    with _state_lock:
        _client_state[chat_id] = {
            "step": "selecting_type",
            "client_id": client_id,
            "order_date": tomorrow,
            "msg_id": msg_id,
        }


def _show_products_page(token: str, chat_id: int, products: list, page: int, product_type: str) -> None:
    """Показує (або оновлює) сторінку зі списком товарів."""
    type_labels = {"bread": "🍞 Хліб", "bun": "🥐 Булки", "other": "🛍 Інше"}
    label = type_labels.get(product_type, product_type)
    total = len(products)
    start = page * PAGE_SIZE + 1
    end = min((page + 1) * PAGE_SIZE, total)
    text = f"<b>{label}</b> — оберіть товар ({start}–{end} з {total}):"

    with _state_lock:
        state = _client_state.get(chat_id)
    if not state:
        return

    msg_id = state.get("msg_id")
    if msg_id:
        _edit_inline(token, chat_id, msg_id, text, _products_inline_kb(products, page))
    else:
        result = _send(token, chat_id, text, _products_inline_kb(products, page))
        new_msg_id = result.get("result", {}).get("message_id")
        with _state_lock:
            if chat_id in _client_state:
                _client_state[chat_id]["msg_id"] = new_msg_id

    with _state_lock:
        if chat_id in _client_state:
            _client_state[chat_id].update({
                "step": "selecting_product",
                "products": products,
                "page": page,
                "product_type": product_type,
            })


def _ask_quantity(token: str, chat_id: int, product_id: int, product_name: str) -> None:
    """Прибирає inline-клавіатуру і просить ввести кількість."""
    with _state_lock:
        state = _client_state.get(chat_id)
    if not state:
        return

    msg_id = state.get("msg_id")
    if msg_id:
        _remove_inline(token, chat_id, msg_id)

    # Беремо ціну із збереженого списку товарів у стані (вже розрахована для клієнта)
    price_info = ""
    with _state_lock:
        state = _client_state.get(chat_id)
    if state:
        products = state.get("products", [])
        prod_data = next((p for p in products if p["id"] == product_id), None)
        if prod_data and prod_data.get("price") is not None:
            price_info = f" — <b>{prod_data['price']:.0f} грн</b>"

    with _state_lock:
        if chat_id in _client_state:
            _client_state[chat_id].update({
                "step": "awaiting_qty",
                "product_id": product_id,
                "product_name": product_name,
            })

    cancel_kb = {
        "keyboard": [["❌ Скасувати"]],
        "one_time_keyboard": True,
        "resize_keyboard": True,
    }
    _send(token, chat_id,
          f"<b>{product_name}</b>{price_info}\n\nВведіть кількість (шт):",
          cancel_kb)


def _save_order_item(token: str, chat_id: int, qty: float) -> None:
    """Зберігає позицію замовлення і повертає до головного меню."""
    with _state_lock:
        state = _client_state.pop(chat_id, None)
    if not state:
        return

    client_id    = state["client_id"]
    product_id   = state["product_id"]
    product_name = state["product_name"]
    order_date   = state["order_date"]

    with SessionLocal() as db:
        from datetime import datetime
        now = datetime.now().isoformat(timespec="seconds")

        # Якщо вже є pending-запис на цей товар від цього ж користувача — оновлюємо кількість
        existing = db.query(Order).filter(
            Order.client_id == client_id,
            Order.product_id == product_id,
            Order.order_date == order_date,
            Order.source == "bot",
            Order.bot_status == "pending",
            Order.placed_by_chat_id == str(chat_id),
        ).first()

        if existing:
            existing.qty = qty
            existing.created_at = now
        else:
            db.add(Order(
                client_id=client_id,
                product_id=product_id,
                qty=qty,
                order_date=order_date,
                status="draft",
                source="bot",
                bot_status="pending",
                placed_by_chat_id=str(chat_id),
                created_at=now,
                created_by="bot",
            ))
        db.commit()

    _send(token, chat_id,
          f"✅ <b>{product_name}</b> × {qty:.0f} шт додано до замовлення на {order_date}.\n"
          f"⏳ Очікує підтвердження оператора.\n\n"
          f"Натисніть ➕ <b>Додати товар</b> щоб додати ще одну позицію.",
          _client_keyboard())


# ── Обробка оновлень ─────────────────────────────────────────────────────────

def _handle_update(token: str, update: dict) -> None:
    # ── Callback query (натискання inline-кнопок) ──
    callback = update.get("callback_query")
    if callback:
        _handle_callback(token, callback)
        return

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
            _send(token, chat_id, "✅ Доступ дозволено! Оберіть дію:", _staff_keyboard())
            return

        with SessionLocal() as db:
            client = _find_client_by_phone(db, phone)
            if client:
                first_name = msg.get("from", {}).get("first_name", "")
                _link_client_chat(db, client, chat_id, phone=phone, first_name=first_name)
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
        with _state_lock:
            _client_state.pop(chat_id, None)  # скидаємо будь-який стан
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

    # ── Клієнт у стані вводу кількості ──
    with _state_lock:
        state = _client_state.get(chat_id)
        in_qty_step = state and state.get("step") == "awaiting_qty"

    if in_qty_step:
        if text == "❌ Скасувати":
            with _state_lock:
                _client_state.pop(chat_id, None)
            _send(token, chat_id, "Додавання скасовано.", _client_keyboard())
            return

        raw = text.split()[0]
        try:
            qty = float(raw.replace(",", "."))
            if qty <= 0:
                raise ValueError
        except ValueError:
            _send(token, chat_id, "Введіть ціле число більше нуля.")
            return

        _save_order_item(token, chat_id, qty)
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
        tomorrow = (date.today() + timedelta(days=1)).isoformat()

        if text == "📋 Моє замовлення":
            with SessionLocal() as db:
                cl = db.get(Client, client.id)
                resp = _client_orders_text(db, cl, tomorrow)
            _send(token, chat_id, resp, _client_keyboard())

        elif text == "📦 Накладна сьогодні":
            today = date.today().isoformat()
            with SessionLocal() as db:
                cl = db.get(Client, client.id)
                resp = _client_invoice_text(db, cl, today)
            _send(token, chat_id, resp, _client_keyboard())

        elif text == "➕ Додати товар":
            # Скидаємо попередній стан якщо є
            with _state_lock:
                _client_state.pop(chat_id, None)
            _start_add_product(token, chat_id, client.id)

        elif text == "❓ Допомога" or cmd_base == "/help":
            _send(token, chat_id, CLIENT_HELP, _client_keyboard())

        elif text:
            _send(token, chat_id, "Оберіть дію з меню.", _client_keyboard())
        return

    # ── Незнайомець ──
    _send(token, chat_id,
          "⛔ Спочатку авторизуйтесь. Натисніть /start",
          _request_contact_keyboard())


def _handle_callback(token: str, callback: dict) -> None:
    """Обробляє натискання inline-кнопок."""
    cb_id   = callback["id"]
    chat_id = callback["message"]["chat"]["id"]
    data    = callback.get("data", "")

    # Спершу відповідаємо на callback щоб прибрати "годинник" на кнопці
    _answer_callback(token, cb_id)

    with _state_lock:
        state = _client_state.get(chat_id)

    if not state:
        return

    # ── Скасування ──
    if data == "cancel":
        with _state_lock:
            _client_state.pop(chat_id, None)
        msg_id = state.get("msg_id")
        if msg_id:
            _remove_inline(token, chat_id, msg_id)
        _send(token, chat_id, "Скасовано.", _client_keyboard())
        return

    # ── Повернення до вибору типу ──
    if data == "back:types":
        msg_id = state.get("msg_id")
        if msg_id:
            _edit_inline(token, chat_id, msg_id, "Оберіть тип товару:", _type_inline_kb())
        with _state_lock:
            if chat_id in _client_state:
                _client_state[chat_id]["step"] = "selecting_type"
        return

    # ── Вибір типу товару ──
    if data.startswith("type:"):
        product_type = data.split(":", 1)[1]
        products = _get_products_by_type(
            product_type,
            state["client_id"],
            state["order_date"],
        )

        if not products:
            type_labels = {"bread": "Хліб", "bun": "Булки", "other": "Інше"}
            _answer_callback(token, cb_id,
                             f"Немає активних товарів: {type_labels.get(product_type, product_type)}")
            return

        _show_products_page(token, chat_id, products, 0, product_type)
        return

    # ── Пагінація ──
    if data.startswith("page:"):
        page = int(data.split(":", 1)[1])
        products = state.get("products", [])
        product_type = state.get("product_type", "bread")
        _show_products_page(token, chat_id, products, page, product_type)
        return

    # ── Вибір конкретного товару ──
    if data.startswith("prod:"):
        product_id = int(data.split(":", 1)[1])
        # Знаходимо назву в поточному списку
        products = state.get("products", [])
        product_name = next(
            (p["name"] for p in products if p["id"] == product_id),
            f"Товар #{product_id}"
        )
        _ask_quantity(token, chat_id, product_id, product_name)
        return


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
