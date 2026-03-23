"""FastAPI — точка входу застосунку Пекарня."""

import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from backend.database import engine, Base
import backend.models  # noqa: F401 — реєструємо всі моделі

from backend.routers import (
    products, categories, clients, routes, prices, orders, baking, invoices, shop, print_views,
    auth, settings, finances, finances_articles, ingredients, dashboard, issues, bot,
)
from backend.routers import auth_github, db_editor

# Ініціалізуємо таблиці (якщо не існують)
Base.metadata.create_all(bind=engine)


DEFAULT_ROLE_PERMISSIONS = {
    "operator":   ["orders", "baking", "routes", "shop"],
    "accountant": ["orders", "finances"],
    "admin":      ["orders", "baking", "routes", "shop", "finances", "admin"],
    "owner":      ["orders"],
}

DEFAULT_USERS = [
    ("admin",       "admin",       "Адміністратор", "admin"),
    ("operator",    "operator",    "Оператор",      "operator"),
    ("accountant",  "accountant",  "Бухгалтер",     "accountant"),
    ("owner",       "owner",       "Власник",       "owner"),
]

DEFAULT_SETTINGS = {
    "bakery_name":           ("Пекарня",        "Назва пекарні"),
    "director":              ("",               "ПІБ директора"),
    "accountant_name":       ("",               "ПІБ бухгалтера"),
    "address":               ("",               "Адреса пекарні"),
    "city":                  ("",               "Місто"),
    "phone":                 ("",               "Телефон"),
    "edrpou":                ("",               "Код ЄДРПОУ"),
    "iban":                  ("",               "IBAN рахунок"),
    "bank":                  ("",               "Банк"),
    "order_lock_time":       ("22:00",          "Час блокування замовлень"),
    "role_permissions":      ("",               "Права ролей (JSON)"),
    "github_repo":           ("TSOrest/Bakery", "GitHub репозиторій (owner/repo)"),
    "github_client_id":      ("",               "GitHub OAuth App Client ID"),
    "github_client_secret":  ("",               "GitHub OAuth App Client Secret"),
    "github_oauth_token":    ("",               "OAuth токен акаунта пекарні на GitHub"),
    "github_login":          ("",               "GitHub логін акаунта пекарні"),
    "github_name":           ("",               "GitHub ім'я акаунта пекарні"),
    "github_avatar_url":     ("",               "GitHub аватар акаунта пекарні"),
}


DEFAULT_FINANCE_ARTICLES = [
    ("Накладна",        "expense", 1),
    ("Оплата",          "income",  1),
    ("Списання",        "income",  1),
    ("Внесення в касу", "income",  1),
    ("Готівка водія",   "income",  1),
    ("Кредит обміну",   "expense", 1),
]


def _seed_initial_data() -> None:
    """Заповнює початкові дані якщо БД порожня."""
    import hashlib, secrets, json
    from datetime import datetime as dt
    from sqlalchemy.orm import Session as OrmSession
    from backend.models.auth import User
    from backend.models.settings import Setting
    from backend.models.finances import FinanceArticle
    from backend.models.references import Client

    with OrmSession(engine) as db:
        # Налаштування
        for key, (value, desc) in DEFAULT_SETTINGS.items():
            if not db.get(Setting, key):
                db.add(Setting(key=key, value=value, description=desc,
                               updated_at=dt.now().isoformat()))
        # Права ролей
        perm_row = db.get(Setting, "role_permissions")
        if perm_row and not perm_row.value:
            perm_row.value = json.dumps(DEFAULT_ROLE_PERMISSIONS, ensure_ascii=False)

        # Статті фінансів
        if db.query(FinanceArticle).count() == 0:
            for name, direction, is_system in DEFAULT_FINANCE_ARTICLES:
                db.add(FinanceArticle(name=name, direction=direction, is_system=is_system))

        # Користувачі
        if db.query(User).count() == 0:
            for username, password, full_name, role in DEFAULT_USERS:
                salt = secrets.token_hex(16)
                db.add(User(
                    username=username,
                    password_hash=hashlib.sha256(f"{salt}{password}".encode()).hexdigest(),
                    salt=salt,
                    full_name=full_name,
                    role=role,
                ))

        # Системні клієнти — завжди мають існувати
        for kind, name in [("writeoff", "Списання"), ("ration", "Пайок"), ("underbaked", "Недопечено")]:
            exists = db.query(Client).filter(Client.client_kind == kind).first()
            if not exists:
                db.add(Client(
                    full_name=name, short_name=name,
                    client_kind=kind, is_active=1,
                    discount_pct=0,
                    created_at=dt.now().isoformat(),
                ))

        db.commit()


_seed_initial_data()

# Запускаємо Telegram-бота якщо токен задано в налаштуваннях
from backend.services.telegram_bot import init_bot_from_settings
init_bot_from_settings()

app = FastAPI(
    title="Пекарня API",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)

# CORS — дозволяємо локальний фронтенд
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Підключаємо роутери
PREFIX = "/api/v1"
app.include_router(products.router,   prefix=PREFIX)
app.include_router(categories.router, prefix=PREFIX)
app.include_router(clients.router,    prefix=PREFIX)
app.include_router(routes.router,     prefix=PREFIX)
app.include_router(prices.router,     prefix=PREFIX)
app.include_router(orders.router,     prefix=PREFIX)
app.include_router(baking.router,     prefix=PREFIX)
app.include_router(invoices.router,   prefix=PREFIX)
app.include_router(shop.router,          prefix=PREFIX)
app.include_router(print_views.router,   prefix=PREFIX)
app.include_router(auth.router,          prefix=PREFIX)
app.include_router(settings.router,      prefix=PREFIX)
app.include_router(finances.router,          prefix=PREFIX)
app.include_router(finances_articles.router, prefix=PREFIX)
app.include_router(ingredients.router,       prefix=PREFIX)
app.include_router(dashboard.router,     prefix=PREFIX)
app.include_router(issues.router,        prefix=PREFIX)
app.include_router(auth_github.router,   prefix=PREFIX)
app.include_router(bot.router,           prefix=PREFIX)
app.include_router(db_editor.router,     prefix=PREFIX)


@app.get("/api/health")
def health():
    return {"status": "ok", "app": "Пекарня"}


# ── Статичний фронтенд (production) ──────────────────────────────────────────
# Якщо frontend/dist існує — роздаємо його. Vite dev server не потрібен.

_DIST = Path(__file__).parent.parent / "frontend" / "dist"

if _DIST.exists():
    # Статичні ресурси (js, css, assets)
    app.mount("/assets", StaticFiles(directory=_DIST / "assets"), name="assets")

    # SPA fallback: будь-який невідомий шлях → index.html (React Router)
    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str):
        file = _DIST / full_path
        if file.is_file():
            return FileResponse(file)
        return FileResponse(_DIST / "index.html")
