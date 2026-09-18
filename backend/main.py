"""FastAPI — точка входу застосунку Пекарня."""

import os
import logging
from pathlib import Path

# Рівень у логах backend: повідомлення з backend.* ідуть у stderr із чітким префіксом рівня
# (ERROR: / WARNING: / INFO:). Конвеєр run-server.ps1 додає дату й пише у файл дня
# (bakery-YYYY-MM-DD.log), звідки їх читає переглядач логів (log_viewer.py).
logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(name)s: %(message)s")

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from backend.database import engine, Base, run_migrations
import backend.models  # noqa: F401 — реєструємо всі моделі

from backend.routers import (
    products, categories, clients, routes, client_groups, prices, orders, baking, invoices, shop, print_views,
    auth, settings, finances, finances_articles, ingredients, dashboard, issues, bot, audit, reports,
)
from backend.routers import auth_github, db_editor, backup, import_accdb

# Ініціалізуємо таблиці (якщо не існують) та застосовуємо міграції
Base.metadata.create_all(bind=engine)
run_migrations()


DEFAULT_ROLE_PERMISSIONS = {
    "operator":   ["orders", "baking", "routes", "shop", "reports"],
    "accountant": ["orders", "finances", "reports"],
    "admin":      ["orders", "baking", "routes", "shop", "finances", "admin", "pos", "reports"],
    "owner":      ["orders", "reports"],
    "seller":     ["pos"],
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
    "order_past_days":       ("1",              "Днів назад від сьогодні доступних для редагування замовлень"),
    "work_date_next_day_time": ("18:00",        "Час переходу дати роботи на наступний день"),
    "role_permissions":      ("",               "Права ролей (JSON)"),
    "invoice_exchange_inline": ("0",            "Обмін колонкою в накладній замість окремої секції (0/1)"),
    "enable_invoice_cancel":  ("0",             "Кнопка «Скасувати накладну» для чернеток/відправлених (0/1)"),
    "cash_tracking_start_date": ("",            "Дата з якої відстежується залишок у касі (порожньо = завжди)"),
    "github_repo":           ("TSOrest/Bakery", "GitHub репозиторій (owner/repo)"),
    "github_client_id":      ("",               "GitHub OAuth App Client ID"),
    "github_client_secret":  ("",               "GitHub OAuth App Client Secret"),
    "github_oauth_token":    ("",               "OAuth токен акаунта пекарні на GitHub"),
    "github_login":          ("",               "GitHub логін акаунта пекарні"),
    "github_name":           ("",               "GitHub ім'я акаунта пекарні"),
    "github_avatar_url":     ("",               "GitHub аватар акаунта пекарні"),
    # Бекапи
    "backup_enabled":        ("1",             "Автобекап увімкнений (0/1)"),
    "backup_time":           ("02:00",         "Час щоденного бекапу (HH:MM)"),
    "backup_keep_count":     ("7",             "Кількість локальних бекапів"),
    "backup_local_dir":      ("",              "Папка бекапів (порожньо = backups/ поряд з bakery.db)"),
    "backup_cloud_1_label":  ("",              "Хмара 1: назва (напр. Google Drive)"),
    "backup_cloud_1_path":   ("",              "Хмара 1: шлях до папки синхронізації"),
    "backup_cloud_2_label":  ("",              "Хмара 2: назва"),
    "backup_cloud_2_path":   ("",              "Хмара 2: шлях до папки синхронізації"),
    "backup_cloud_3_label":  ("",              "Хмара 3: назва"),
    "backup_cloud_3_path":   ("",              "Хмара 3: шлях до папки синхронізації"),
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
    from sqlalchemy.exc import IntegrityError
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

        # Користувачі — використовуємо bcrypt через _hash_password з auth.py
        if db.query(User).count() == 0:
            from backend.routers.auth import _hash_password
            for username, password, full_name, role in DEFAULT_USERS:
                salt = secrets.token_hex(16)
                db.add(User(
                    username=username,
                    password_hash=_hash_password(password, salt),
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

        # _seed_initial_data() виконується на рівні МОДУЛЯ — кожен uvicorn-воркер
        # (reloader + child при --reload, або дублікат воркера під час перезапуску)
        # викликає її окремо. "Чи існує?" + вставка вище — TOCTOU-гонка: якщо два
        # процеси пройшли перевірку "не існує" до того, як хтось із них закомітив,
        # обидва вставляють системного клієнта — так у базі накопичувались
        # дублікати "Пайок"/"Списання" (виправлено ретроактивно міграцією 042,
        # яка й відновила PARTIAL UNIQUE INDEX). Тепер, коли індекс активний,
        # програний забіг гонки впаде на commit з IntegrityError — ловимо це тут,
        # а не даємо незловленому винятку зірвати завантаження модуля backend.main
        # (і, відповідно, старт усього воркера).
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            logging.getLogger("backend.main").info(
                "_seed_initial_data: конкурентний воркер уже засіяв ці дані — пропускаємо"
            )


_seed_initial_data()

# Запускаємо Telegram-бота якщо токен задано в налаштуваннях
from backend.services.telegram_bot import init_bot_from_settings
init_bot_from_settings()

def _app_version() -> str:
    """Читає версію з файлу VERSION (utf-8-sig прибирає BOM), fallback — 0.0.0."""
    try:
        return (Path(__file__).parent.parent / "VERSION").read_text(encoding="utf-8-sig").strip() or "0.0.0"
    except OSError:
        return "0.0.0"


app = FastAPI(
    title="Пекарня API",
    version=_app_version(),
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

# Переклад найпоширеніших повідомлень Pydantic-валідації (422) — за
# замовчуванням вони англійською технічним жаргоном ("Input should be
# greater than or equal to 0"), на відміну від кастомних HTTPException
# (404/400/409), які всюди написані українською. Системно для ВСІХ
# ендпоінтів зі стандартною Pydantic-перевіркою полів.
_VALIDATION_MESSAGES = {
    "missing":              "Поле обов'язкове",
    "greater_than_equal":   "Значення має бути не менше {ge}",
    "greater_than":         "Значення має бути більше {gt}",
    "less_than_equal":      "Значення має бути не більше {le}",
    "less_than":            "Значення має бути менше {lt}",
    "string_too_short":     "Занадто короткий текст (мінімум {min_length} символів)",
    "string_too_long":      "Занадто довгий текст (максимум {max_length} символів)",
    "string_type":          "Очікується текст",
    "int_type":              "Очікується ціле число",
    "int_parsing":           "Не вдалося розпізнати як ціле число",
    "float_type":            "Очікується число",
    "float_parsing":         "Не вдалося розпізнати як число",
    "bool_type":             "Очікується так/ні",
    "bool_parsing":          "Не вдалося розпізнати як так/ні",
    "date_from_datetime_parsing": "Не вдалося розпізнати дату (очікується РРРР-ММ-ДД)",
    "enum":                  "Недопустиме значення",
    "value_error":           "Некоректне значення",
}


def _translate_validation_error(err: dict) -> str:
    template = _VALIDATION_MESSAGES.get(err.get("type", ""))
    if not template:
        return err.get("msg", "Некоректне значення")
    try:
        return template.format(**(err.get("ctx") or {}))
    except (KeyError, IndexError):
        return template


@app.exception_handler(RequestValidationError)
async def _validation_exception_handler(request: Request, exc: RequestValidationError):
    detail = [
        {
            "loc": err.get("loc"),
            "type": err.get("type"),
            "msg": _translate_validation_error(err),
        }
        for err in exc.errors()
    ]
    return JSONResponse(status_code=422, content={"detail": detail})


# Підключаємо роутери
PREFIX = "/api/v1"
app.include_router(products.router,   prefix=PREFIX)
app.include_router(categories.router, prefix=PREFIX)
app.include_router(clients.router,    prefix=PREFIX)
app.include_router(routes.router,     prefix=PREFIX)
app.include_router(client_groups.router, prefix=PREFIX)
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
app.include_router(backup.router,        prefix=PREFIX)
app.include_router(import_accdb.router,  prefix=PREFIX)
app.include_router(audit.router,         prefix=PREFIX)
app.include_router(reports.router,       prefix=PREFIX)


@app.get("/api/health")
def health():
    return {"status": "ok", "app": "Пекарня"}


# ── Статичний фронтенд (production) ──────────────────────────────────────────
# Якщо frontend/dist існує — роздаємо його. Vite dev server не потрібен.

_DIST   = Path(__file__).parent.parent / "frontend" / "dist"
_ASSETS = _DIST / "assets"
_INDEX  = _DIST / "index.html"

# Монтуємо ресурси лише якщо вони реально існують — інакше сервер падав би під час
# перезбірки фронтенду (vite очищає dist на початку `build`, тож є вікно без assets)
# та у dev-режимі (Vite окремо на 5173). Перевіряємо КОНКРЕТНІ шляхи, не лише папку dist.
if _ASSETS.is_dir():
    # Статичні ресурси (js, css, assets)
    app.mount("/assets", StaticFiles(directory=_ASSETS), name="assets")

if _INDEX.is_file():
    # POS-додаток: /pos та /pos/ отримують pos.html (окремий PWA маніфест)
    _POS_HTML = _DIST / "pos.html"
    @app.get("/pos", include_in_schema=False)
    @app.get("/pos/", include_in_schema=False)
    async def pos_app():
        return FileResponse(_POS_HTML if _POS_HTML.exists() else _INDEX)

    # SPA fallback: будь-який невідомий шлях → index.html (React Router).
    # ЗАХИСТ ВІД PATH TRAVERSAL: резолвимо шлях і віддаємо файл лише якщо він
    # реально лежить усередині dist. Без цього `GET /../../bakery.db` (чи
    # URL-кодований `..%2f`) міг би прочитати БД, .fernet_key чи код.
    _DIST_RESOLVED = _DIST.resolve()

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str):
        try:
            candidate = (_DIST / full_path).resolve()
        except (OSError, ValueError):
            return FileResponse(_INDEX)
        if candidate.is_file() and candidate.is_relative_to(_DIST_RESOLVED):
            return FileResponse(candidate)
        return FileResponse(_INDEX)
else:
    logging.getLogger("backend.main").warning(
        "frontend/dist не зібрано (немає index.html) — SPA не роздається, працює лише API. "
        "Якщо це не dev-режим — виконайте npm run build."
    )
