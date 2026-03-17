# 🍞 Пекарня — Система управління пекарнею

Веб-застосунок для управління пекарнею. Замінює застарілу базу Access (.accdb).
Повністю офлайн, локальне розгортання на Windows.

---

## Технічний стек

| Компонент | Технологія |
|-----------|-----------|
| Backend | Python 3.11+ · FastAPI · SQLAlchemy 2.0 |
| Database | SQLite (один файл `bakery.db`) |
| Frontend | React 18 · Vite · TypeScript |
| Друк | PDF (reportlab / weasyprint) — Фаза 2 |
| Розгортання | localhost, локальна мережа |

---

## Швидкий старт

```bash
# 1. Встановлення (один раз)
bash scripts/install.sh

# 2. Запуск
bash scripts/start.sh
```

| Сервіс | URL |
|--------|-----|
| Frontend | http://localhost:5173 |
| Backend API | http://localhost:8000 |
| Swagger docs | http://localhost:8000/api/docs |

---

## Структура проекту

```
├── backend/
│   ├── main.py            ← FastAPI app
│   ├── database.py        ← SQLite + SQLAlchemy session
│   ├── models/            ← ORM-моделі (10 модулів)
│   ├── routers/           ← API ендпоінти
│   ├── schemas/           ← Pydantic схеми
│   ├── services/          ← бізнес-логіка
│   └── requirements.txt
├── frontend/
│   └── src/
│       ├── pages/         ← 6 вкладок застосунку
│       ├── components/    ← Layout, спільні компоненти
│       ├── api/           ← fetch-обгортки
│       ├── context/       ← DateContext (дата роботи)
│       └── types/         ← TypeScript типи
├── database/
│   ├── schema.sql         ← повна схема SQLite
│   └── migrations/
├── scripts/
│   ├── install.sh
│   ├── start.sh
│   └── run_tests.sh
└── tests/
    ├── test_api.py
    └── test_services.py
```

---

## Вкладки застосунку

| Вкладка | URL | Опис |
|---------|-----|------|
| Замовлення | `/orders` | Таблиця клієнти × вироби, введення кількостей |
| Випічка | `/baking` | Завдання пекарям + внесення результату + розподіл надлишків |
| Маршрути | `/routes` | Накладні + переміщення після повернення водія |
| Магазин | `/shop` | Щоденна звірка, несвіжий товар, група ІНШЕ |
| Фінанси | `/finances` | Баланси клієнтів, рух коштів |
| Довідники | `/admin` | Вироби, клієнти, ціни, маршрути, налаштування |

---

## API

```
/api/v1/
    /products          GET, POST, PUT, DELETE
    /categories        GET, POST
    /clients           GET, POST, PUT, DELETE
    /routes            GET, POST, PUT
    /prices            GET, POST · /resolve · /overrides
    /orders            GET, POST, PUT, DELETE · /copy
    /baking/tasks      GET, POST (generate), PUT
    /baking/surplus    GET, POST
    /invoices          GET, POST, PUT /status
```

---

## Ролі користувачів

| Роль | Доступ |
|------|--------|
| operator | замовлення, випічка, маршрути, накладні, магазин |
| accountant | фінанси, баланси, перегляд всього |
| admin | довідники, ціни, налаштування, повний доступ |
| owner | read-only дашборд (мобільний) |

---

## Фази розробки

### ✅ Фаза 1 — MVP
- [x] Структура проекту + `install.sh`
- [x] SQLite схема (`database/schema.sql`) — всі 18 таблиць
- [x] FastAPI app + database session (WAL, foreign keys)
- [x] SQLAlchemy моделі для всіх таблиць
- [x] Pydantic schemas + CRUD endpoints для довідників
- [x] Логіка замовлень: POST/GET/PUT/DELETE + копіювання з дати
- [x] Сервіс `get_price()` — 4-рівневий пріоритет цін
- [x] Завдання на випічку + внесення результату + розподіл надлишків
- [x] Накладні: генерація + автонумерація `YYYYMMDD-NNN`
- [x] React каркас: навігація по вкладках + дата роботи в хедері
- [x] Вкладка Замовлення (таблиця клієнт × виріб, inline-редагування)
- [x] Вкладка Випічка (завдання + baked_qty)
- [x] Вкладка Довідники (перегляд виробів, клієнтів, маршрутів)
- [x] Базові тести: pytest + TestClient (18 тест-кейсів)

### 🔄 Фаза 2 — Повний цикл
- [x] Stale-логіка: несвіжий товар по всьому ланцюжку
- [x] Скасування рейсу
- [x] Магазин: щоденна звірка (received_today авто з випічки), підтвердження, товари ІНШЕ
- [x] Переробка вкладки Маршрути (двохрівнева панель, друк з галочками, модал повернення)
- [x] Авторизація і ролі
- [x] Друк PDF — накладні (2 на A4, оригінал+копія, маршрут у шапці, групування по типу) + завдання пекарям

### ⬜ Фаза 3 — Фінанси та аналітика
- [ ] Фінансовий модуль
- [ ] Управління цінами (майбутні дати, % зміна)
- [ ] Собівартість і маржинальність
- [ ] Мобільний дашборд для власника

### ⬜ Фаза 4 — Розширення
- [ ] Міграція з .accdb
- [ ] Розширені звіти
- [ ] Архівування, автобекапи

---

## Запуск тестів

```bash
bash scripts/run_tests.sh
```

```
tests/test_services.py   # юніт-тести сервісів (get_price, invoice_number, copy_orders)
tests/test_api.py        # інтеграційні тести API через TestClient
```

---

## Розробка

```bash
# Backend (з hot-reload)
bash scripts/start_backend.sh

# Frontend (Vite dev server)
bash scripts/start_frontend.sh
```

> **Примітка для Windows:** якщо проект знаходиться на мережевому диску (UNC-шлях),
> використовуйте `scripts/start_frontend.sh` — в `vite.config.ts` вже налаштовано
> `optimizeDeps` для коректного резолвингу пакетів.
