"""Ендпоінти налаштувань системи."""

import json
import logging
import os
import threading
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.database import get_db, safe_commit
from backend.models.auth import User, UserSession
from backend.models.notifications import create_notification
from backend.models.settings import Setting
from backend.routers.auth import require_user, require_perm, require_install_update_perm
from backend.schemas.notifications import RequestUpdateIn
from backend.services import telegram_bot as tg

log = logging.getLogger(__name__)

router = APIRouter(prefix="/settings", tags=["Налаштування"])

# Прапор для tray.py (те саме "flag-файл" мовлення, що RESTORE_REQUESTED/
# DEMO_*_REQUESTED, backend/routers/backup.py) — записується ЛИШЕ після
# перевірки дозволу і активних сесій нижче, tray.py's _poll_flags() виконує
# фактичне встановлення (той самий шлях, що ручна кнопка в меню треї).
_ROOT_DIR         = Path(__file__).parent.parent.parent
_SETTINGS_DATA_DIR = Path(os.environ.get("BAKERY_DATA_DIR", _ROOT_DIR))
UPDATE_REQUESTED  = _SETTINGS_DATA_DIR / "UPDATE_REQUESTED"

# Активною вважається сесія з last_used_at у межах цього вікна.
_ACTIVE_SESSION_WINDOW_MIN = 10

# Секрети, які ніколи не віддаються у браузер (їх читає лише backend).
# ⚠ github_issues_token (виправлено): не було в цьому списку — GET /settings/
# віддавав його у відкритому тексті БУДЬ-ЯКІЙ авторизованій ролі, включно з
# seller (POS-каса). Токен, ймовірно, мертвий код (жоден файл backend його
# не читає — заміщений github_oauth_token/device-flow), але сам факт
# видачі робочого GitHub-токена найнижчій ролі — критична дірка незалежно
# від того, чи його ще використовує код.
_ALWAYS_STRIP = {"github_client_secret", "github_oauth_token", "github_issues_token"}
# Секрети, доступні лише адміну (SettingsTab префілить поле токена бота).
_ADMIN_ONLY = {"telegram_bot_token"}
# Значення шифруються (Fernet) перед записом у БД — на відміну від
# github_oauth_token (шифрується явним викликом у auth_github.py в момент
# отримання через OAuth Device Flow), ці ключі вводяться прямо через форму
# налаштувань (загальні PUT-ендпоінти нижче), тож шифрування має бути тут.
_ENCRYPTED_KEYS = {"github_client_secret"}


def _maybe_encrypt(key: str, value: str) -> str:
    if key not in _ENCRYPTED_KEYS or not value:
        return value
    from backend.services.crypto import encrypt_setting
    return encrypt_setting(value)


class SettingUpdate(BaseModel):
    value: str
    description: Optional[str] = None


@router.get("/")
def get_settings(user: User = Depends(require_user), db: Session = Depends(get_db)):
    """Повертає налаштування. Секрети виключаються: github-секрети — завжди,
    токен бота — лише для адміна."""
    is_admin = user.role == "admin"
    rows = db.query(Setting).order_by(Setting.key).all()
    out: dict[str, dict] = {}
    for r in rows:
        if r.key in _ALWAYS_STRIP:
            continue
        if r.key in _ADMIN_ONLY and not is_admin:
            continue
        out[r.key] = {"value": r.value or "", "description": r.description or ""}
    return out


@router.put("/{key}")
def update_setting(key: str, body: SettingUpdate, user: User = Depends(require_perm("admin_org.settings")), db: Session = Depends(get_db)):
    # role_permissions — жорстко лише буквальний admin, незалежно від
    # admin_org.settings: інакше роль з делегованим дозволом могла б сама
    # собі дописати будь-який інший дозвіл через цей самий ендпоінт.
    if key == "role_permissions" and user.role != "admin":
        raise HTTPException(status_code=403, detail="Лише адміністратор може редагувати права ролей")
    value = _maybe_encrypt(key, body.value)
    row = db.get(Setting, key)
    if row:
        row.value = value
        row.updated_at = datetime.now().isoformat()
        if body.description is not None:
            row.description = body.description
    else:
        row = Setting(key=key, value=value, description=body.description or "", updated_at=datetime.now().isoformat())
        db.add(row)
    safe_commit(db)
    return {"key": key, "value": body.value}


@router.put("/")
def update_many_settings(body: dict[str, str], user: User = Depends(require_perm("admin_org.settings")), db: Session = Depends(get_db)):
    """Оновлює кілька налаштувань одночасно."""
    if "role_permissions" in body and user.role != "admin":
        raise HTTPException(status_code=403, detail="Лише адміністратор може редагувати права ролей")
    for key, value in body.items():
        stored_value = _maybe_encrypt(key, value)
        row = db.get(Setting, key)
        if row:
            row.value = stored_value
            row.updated_at = datetime.now().isoformat()
        else:
            db.add(Setting(key=key, value=stored_value, updated_at=datetime.now().isoformat()))
    safe_commit(db)
    return {"updated": len(body)}


# ── Telegram бот ──────────────────────────────────────────────────────────────

@router.get("/telegram/status")
def telegram_status(_: User = Depends(require_user)):
    """Стан бота: запущений чи ні."""
    return {"running": tg.bot_is_running()}


@router.post("/telegram/restart")
def telegram_restart(_: User = Depends(require_perm("admin_org.settings")), db: Session = Depends(get_db)):
    """Перезапускає бота з поточним токеном з БД."""
    row = db.get(Setting, "telegram_bot_token")
    token = row.value if row and row.value else ""
    tg.restart_bot(token)
    return {"running": tg.bot_is_running(), "has_token": bool(token)}


@router.post("/telegram/stop")
def telegram_stop(_: User = Depends(require_perm("admin_org.settings"))):
    """Зупиняє бота."""
    tg.stop_bot()
    return {"running": False}


@router.get("/telegram/authorized")
def telegram_authorized(_: User = Depends(require_user), db: Session = Depends(get_db)):
    """Список авторизованих чатів."""
    raw = db.get(Setting, "telegram_authorized_chats")
    chats: dict[str, str] = {}
    try:
        chats = json.loads(raw.value) if raw and raw.value else {}
    except Exception as exc:
        log.warning("Invalid telegram_authorized_chats JSON: %s", exc)
    return {"chats": [{"chat_id": k, "phone": v} for k, v in chats.items()]}


# ── Встановлення оновлення (з дзвоника сповіщень) ───────────────────────────────

@router.post("/request-update")
def request_update(
    body: RequestUpdateIn,
    authorization: Optional[str] = Header(default=None),
    user: User = Depends(require_install_update_perm),
    db: Session = Depends(get_db),
):
    """Запускає встановлення версії, обраної в сповіщенні "Нова версія".

    Якщо є ІНШІ активні сесії (last_used_at у межах останніх 10 хв, не
    рахуючи сесію ініціатора) — розсилає попередження і чекає 60 сек
    перед стартом (щоб встигли завершити зміни); інакше стартує одразу.
    Фактичне встановлення виконує tray.py (окремий процес) через прапор
    UPDATE_REQUESTED — той самий міст, що вже є для відновлення бекапу.
    """
    my_token = (authorization or "").removeprefix("Bearer ").strip()
    cutoff = (datetime.now() - timedelta(minutes=_ACTIVE_SESSION_WINDOW_MIN)).isoformat()
    other_sessions = (
        db.query(UserSession)
        .filter(UserSession.token != my_token, UserSession.last_used_at >= cutoff)
        .count()
    )

    def _write_flag() -> None:
        UPDATE_REQUESTED.write_text(
            json.dumps({"version": body.version, "requested_by": user.username}),
            encoding="utf-8",
        )

    if other_sessions > 0:
        create_notification(
            db, "update_warning",
            "Оновлення розпочнеться через 1 хвилину",
            f"Версія {body.version}. Збережіть незбережені зміни — сервер тимчасово зупиниться.",
            {"version": body.version},
        )
        safe_commit(db)
        threading.Timer(60.0, _write_flag).start()
        return {"status": "scheduled", "delayed": True, "other_sessions": other_sessions}

    _write_flag()
    return {"status": "scheduled", "delayed": False, "other_sessions": 0}


# ── Скидання бази даних ───────────────────────────────────────────────────────

@router.post("/reset-db")
def reset_database(_: User = Depends(require_perm("admin_system.reset_db")), db: Session = Depends(get_db)):
    """
    Очищає всі робочі дані.
    Залишає: системних клієнтів (client_kind != 'customer'), користувачів,
    налаштування, статті фінансів.
    """
    conn = db.connection()

    # Таблиці що реально існують у цій БД
    existing = {r[0] for r in conn.execute(
        text("SELECT name FROM sqlite_master WHERE type='table'")
    )}

    def _del(tbl: str) -> None:
        if tbl in existing:
            conn.execute(text(f"DELETE FROM {tbl}"))  # noqa: S608

    conn.execute(text("PRAGMA foreign_keys = OFF"))
    try:
        # Дочірні таблиці — спочатку
        for tbl in (
            "shop_disposal_lines",
            "shop_reconciliation_lines",
            "shop_reconciliations",
            "shop_receipts",
            "shop_sales",
            "shop_counts",
            "other_stock_in",
            "invoice_lines",
            "invoice_transfers",
            "client_groups",
            "audit_log",
            "cancellation_lines",
            "route_cancellations",
            "surplus_allocations",
            "baking_tasks",
            "finances",
            "movements",
            "daily_balances",
            "client_price_overrides",
            "client_bot_users",
            "prices",
            "product_ingredients",
            "other_products",
            "ingredients",
        ):
            _del(tbl)

        # Самопосилання у invoices
        if "invoices" in existing:
            conn.execute(text("UPDATE invoices SET corrective_for_id = NULL"))
            conn.execute(text("DELETE FROM invoices"))

        # Замовлення — self-referential FK
        if "orders" in existing:
            conn.execute(text("UPDATE orders SET parent_order_id = NULL"))
            conn.execute(text("DELETE FROM orders"))

        # Клієнтів: видаляємо customer + всіх не-системних що виникли під час імпорту.
        # Системні визначаємо за client_kind: writeoff, ration, underbaked, shop.
        # При цьому дозволяємо лише ОДИН запис кожного системного kind —
        # дублі від попередніх імпортів (is_active=0) також видаляємо.
        # Алгоритм: зберегти MIN(id) для кожного системного kind, решту видалити.
        if "clients" in existing:
            # 1. Видалити всіх customer
            conn.execute(text("DELETE FROM clients WHERE client_kind = 'customer'"))
            # 2. Для кожного системного kind зберегти лише перший (найменший id)
            for kind in ("writeoff", "ration", "underbaked", "shop"):
                conn.execute(text(
                    "DELETE FROM clients WHERE client_kind = :kind "
                    "AND id NOT IN (SELECT MIN(id) FROM clients WHERE client_kind = :kind)"
                ), {"kind": kind})
            # 3. Видалити будь-яких інших не-системних (наприклад kind='customer' вже видалено,
            #    але на випадок невідомих kind від імпорту)
            conn.execute(text(
                "DELETE FROM clients WHERE client_kind NOT IN "
                "('writeoff','ration','underbaked','shop')"
            ))

        # Довідники
        for tbl in ("products", "categories", "units", "routes"):
            _del(tbl)

        # Клієнти, що лишаються (системні/магазин), могли мати route_id/
        # client_group_id, які щойно вказали в порожнечу (routes і client_groups
        # вище видалені з PRAGMA foreign_keys=OFF — це не падає, але лишає биті
        # посилання). Обнуляємо явно, щоб не повторити баг з invoice_transfers.
        if "clients" in existing:
            conn.execute(text("UPDATE clients SET route_id = NULL, client_group_id = NULL"))

    finally:
        conn.execute(text("PRAGMA foreign_keys = ON"))

    db.commit()
    return {"status": "ok"}


@router.get("/server-info")
def server_info(_: User = Depends(require_user)):
    """Повертає локальну IP-адресу сервера та порт для формування POS URL."""
    import socket
    import os
    ip = "127.0.0.1"
    try:
        # Надійний спосіб отримати IP локальної мережі (без реального пакету)
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
    except Exception as exc:
        log.debug("Primary IP detection failed, trying gethostbyname: %s", exc)
        try:
            ip = socket.gethostbyname(socket.gethostname())
        except Exception as exc2:
            log.warning("Both IP detection methods failed: %s", exc2)
    port = int(os.environ.get("BAKERY_PORT", 8000))
    return {"local_ip": ip, "port": port}


@router.delete("/telegram/authorized/{chat_id}")
def telegram_revoke(chat_id: str, _: User = Depends(require_perm("admin_org.settings")), db: Session = Depends(get_db)):
    """Відкликає доступ у конкретного чату."""
    row = db.get(Setting, "telegram_authorized_chats")
    chats: dict[str, str] = {}
    try:
        chats = json.loads(row.value) if row and row.value else {}
    except Exception as exc:
        log.warning("Invalid telegram_authorized_chats JSON in revoke: %s", exc)
    chats.pop(chat_id, None)
    if row:
        row.value = json.dumps(chats, ensure_ascii=False)
        row.updated_at = datetime.now().isoformat()
    db.commit()
    return {"revoked": chat_id}
