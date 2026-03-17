"""FastAPI — точка входу застосунку Пекарня."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.database import engine, Base
import backend.models  # noqa: F401 — реєструємо всі моделі

from backend.routers import (
    products, categories, clients, routes, prices, orders, baking, invoices, shop, print_views,
    auth, cancellations,
)

# Ініціалізуємо таблиці (якщо не існують)
Base.metadata.create_all(bind=engine)


def _seed_default_admin() -> None:
    """Створює дефолтного адміна admin/admin якщо користувачів ще немає."""
    import hashlib, secrets
    from sqlalchemy.orm import Session as OrmSession
    from backend.models.auth import User
    with OrmSession(engine) as db:
        if db.query(User).count() == 0:
            salt = secrets.token_hex(16)
            password_hash = hashlib.sha256(f"{salt}admin".encode()).hexdigest()
            db.add(User(
                username="admin",
                password_hash=password_hash,
                salt=salt,
                full_name="Адміністратор",
                role="admin",
            ))
            db.commit()


_seed_default_admin()

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
app.include_router(cancellations.router, prefix=PREFIX)


@app.get("/api/health")
def health():
    return {"status": "ok", "app": "Пекарня"}
