# Пекарня — Project Context for Claude Code

## Що це за проект
Система управління пекарнею. Замінює застарілу базу Access (.accdb).
Повне ТЗ узгоджено, розробка починається з Фази 1 (MVP).

## Технічний стек
- **Backend:** Python 3.11+ + FastAPI + SQLAlchemy 2.0
- **Database:** SQLite (один файл `bakery.db`)
- **Frontend:** React 18 + Vite + TypeScript (роздається самим FastAPI у продакшні)
- **Друк:** PDF через браузер (weasyprint)
- **Розгортання:** Windows, повністю офлайн, localhost
  - Task Scheduler — автозапуск при вході в систему
  - `tray.py` (pystray + Pillow) — системний трей
  - Оновлення через GitHub API + git tags

## Структура проекту
```
bakery/
├── CLAUDE.md              ← цей файл
├── backend/
│   ├── main.py            ← FastAPI app entry point
│   ├── database.py        ← SQLite connection, session
│   ├── models/            ← SQLAlchemy models
│   ├── routers/           ← API endpoints по модулях
│   ├── schemas/           ← Pydantic schemas
│   ├── services/          ← бізнес-логіка
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── pages/         ← сторінки по вкладках
│   │   ├── components/    ← спільні компоненти
│   │   ├── api/           ← fetch-обгортки
│   │   └── types/         ← TypeScript типи
│   ├── package.json
│   └── vite.config.ts
├── database/
│   ├── schema.sql         ← повна схема SQLite
│   └── migrations/        ← зміни схеми
├── scripts/
│   ├── install.sh         ← одна команда встановлення
│   └── migrate_accdb.py   ← міграція зі старої бази
└── tests/
    ├── test_api.py
    └── test_services.py
```

## Ролі користувачів
| Роль | Доступ |
|------|--------|
| operator | замовлення, випічка, маршрути, накладні, магазин |
| accountant | фінанси, баланси, перегляд всього |
| admin | довідники, ціни, налаштування, повний доступ |
| owner | read-only дашборд (мобільний через HTTPS) |

---

## База даних — повна схема SQLite

### Довідники
```sql
-- Одиниці виміру
CREATE TABLE units (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE  -- кг, шт, буханка
);

-- Категорії виробів
CREATE TABLE categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE  -- Булки, Хліб, Магазин, Інше
);

-- Вироби
CREATE TABLE products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    short_name TEXT,
    type TEXT NOT NULL CHECK(type IN ('bread', 'bun', 'other')),
    weight REAL,
    unit_id INTEGER REFERENCES units(id),
    category_id INTEGER REFERENCES categories(id),
    cost_per_unit REAL DEFAULT 0,  -- розрахункова собівартість
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Компоненти / інгредієнти
CREATE TABLE ingredients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    unit_id INTEGER REFERENCES units(id),
    price_per_unit REAL DEFAULT 0,
    price_updated_at TEXT
);

-- Склад виробу
CREATE TABLE product_ingredients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id),
    ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
    qty_per_unit REAL NOT NULL,
    UNIQUE(product_id, ingredient_id)
);

-- Товари групи ІНШЕ (не власного виробництва)
CREATE TABLE other_products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    unit_id INTEGER REFERENCES units(id),
    purchase_price REAL DEFAULT 0,
    sell_price REAL DEFAULT 0,
    is_active INTEGER DEFAULT 1
);

-- Маршрути
CREATE TABLE routes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1
);

-- Клієнти
CREATE TABLE clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    short_name TEXT,
    address TEXT,
    phone TEXT,
    director TEXT,
    accountant TEXT,
    route_id INTEGER REFERENCES routes(id),
    discount_pct REAL DEFAULT 0,  -- % знижки
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);
```

### Ціни
```sql
-- Базові ціни (з датами дії)
CREATE TABLE prices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id),
    category_id INTEGER REFERENCES categories(id),  -- NULL = для всіх категорій
    price REAL NOT NULL,
    valid_from TEXT NOT NULL,   -- дата початку дії
    valid_to TEXT,              -- NULL = безстроково
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    created_by TEXT
);

-- Індивідуальні ціни клієнтів
CREATE TABLE client_price_overrides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL REFERENCES clients(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    price REAL NOT NULL,
    valid_from TEXT NOT NULL,
    valid_to TEXT,
    UNIQUE(client_id, product_id, valid_from)
);

-- Ціна несвіжого товару при обміні (per product)
-- зберігається як окремий запис у prices з category_id = 'stale'
-- або як поле в products.stale_price
```

**Пріоритет застосування ціни:**
1. `invoice_lines.price_override` — найвищий пріоритет (брак, акція)
2. `client_price_overrides` — індивідуальна ціна клієнта
3. базова ціна × (1 - clients.discount_pct/100)
4. базова ціна з `prices` за category_id і датою

### Замовлення
```sql
CREATE TABLE orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL REFERENCES clients(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    qty REAL NOT NULL DEFAULT 0,
    order_date TEXT NOT NULL,   -- 'YYYY-MM-DD'
    status TEXT DEFAULT 'draft' CHECK(status IN ('draft','confirmed','closed')),
    source TEXT DEFAULT 'phone' CHECK(source IN ('phone','paper')),
    -- Обмін
    exchange_type TEXT DEFAULT 'none' CHECK(exchange_type IN ('none','pre_order','post_delivery')),
    exchange_qty REAL DEFAULT 0,
    exchange_price REAL,        -- ціна несвіжого товару
    exchange_notes TEXT,        -- нотатка про умови (обов'язкова для post_delivery)
    -- Ціна рядка
    price_override REAL,        -- якщо NULL — береться автоматично
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    created_by TEXT
);
```

**Два типи обміну:**
- `pre_order` — клієнт заздалегідь просить замінити черствий хліб. Свіжий іде безкоштовно, черствий забирається і виставляється на магазин за `exchange_price`.
- `post_delivery` — водій повертається з поверненнями. Оператор вносить `exchange_notes`, розподіляє товар: магазин / інший клієнт / списати. Товар отримує `is_stale=1`.

### Випічка
```sql
CREATE TABLE baking_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_date TEXT NOT NULL,
    product_id INTEGER NOT NULL REFERENCES products(id),
    ordered_qty REAL DEFAULT 0,
    recommended_qty REAL DEFAULT 0,  -- ordered + резерв %
    baked_qty REAL DEFAULT 0,        -- фактично спечено
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(task_date, product_id)
);

CREATE TABLE surplus_allocations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    alloc_date TEXT NOT NULL,
    product_id INTEGER NOT NULL REFERENCES products(id),
    to_shop REAL DEFAULT 0,
    to_route REAL DEFAULT 0,
    ration_qty REAL DEFAULT 0,   -- пайок (вводиться вручну)
    written_off REAL DEFAULT 0,
    notes TEXT,
    UNIQUE(alloc_date, product_id)
);
-- Контроль: baked_qty = ordered + to_shop + to_route + ration + written_off
```

### Накладні
```sql
CREATE TABLE invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_number TEXT NOT NULL UNIQUE,  -- формат: YYYYMMDD-NNN
    invoice_date TEXT NOT NULL,
    route_id INTEGER REFERENCES routes(id),
    client_id INTEGER NOT NULL REFERENCES clients(id),
    status TEXT DEFAULT 'draft' CHECK(status IN ('draft','printed','delivered','cancelled')),
    total_sum REAL DEFAULT 0,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE invoice_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    qty REAL NOT NULL,
    price REAL NOT NULL,
    price_override REAL,    -- NULL = використовується price
    is_exchange INTEGER DEFAULT 0,  -- 1 = рядок обміну
    is_stale INTEGER DEFAULT 0,     -- 1 = несвіжий товар
    sum REAL NOT NULL       -- qty * COALESCE(price_override, price)
);
```

**Нумерація накладних:** автоматична відносно дати, формат `YYYYMMDD-NNN`.
Приклад: перша накладна 15 березня 2026 = `20260315-001`.

### Скасування рейсу
```sql
CREATE TABLE route_cancellations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    route_id INTEGER NOT NULL REFERENCES routes(id),
    cancel_date TEXT NOT NULL,
    reason TEXT,
    cancelled_by TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE cancellation_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cancellation_id INTEGER NOT NULL REFERENCES route_cancellations(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    qty REAL NOT NULL,
    disposition TEXT NOT NULL CHECK(disposition IN ('to_shop','to_next_day','writeoff')),
    next_day_price_override REAL  -- знижка при перенесенні
);
```

### Рухи та залишки
```sql
CREATE TABLE movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    move_date TEXT NOT NULL,
    product_id INTEGER NOT NULL REFERENCES products(id),
    move_type TEXT NOT NULL CHECK(move_type IN (
        'in',           -- надходження з випічки
        'sold',         -- продаж
        'writeoff',     -- списання
        'ration',       -- пайок персоналу
        'return_stale', -- повернення несвіжого
        'exchange_out', -- відправлено в обмін (свіжий)
        'exchange_in',  -- отримано в обмін (черствий на магазин)
        'cancel_to_shop' -- після скасування рейсу
    )),
    qty REAL NOT NULL,
    is_stale INTEGER DEFAULT 0,  -- 1 = несвіжий товар
    price REAL,
    source_table TEXT,  -- 'orders', 'invoices', 'baking_tasks' тощо
    source_id INTEGER,
    route_id INTEGER REFERENCES routes(id),
    client_id INTEGER REFERENCES clients(id),
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE daily_balances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    balance_date TEXT NOT NULL,
    product_id INTEGER NOT NULL REFERENCES products(id),
    is_stale INTEGER DEFAULT 0,
    start_balance REAL DEFAULT 0,
    received REAL DEFAULT 0,
    sold REAL DEFAULT 0,
    written_off REAL DEFAULT 0,
    end_balance REAL DEFAULT 0,  -- розраховується: start + received - sold - written_off
    computed_at TEXT,
    UNIQUE(balance_date, product_id, is_stale)
);
-- Каскадний перерахунок з дати зміни — тільки для змінених продуктів
```

### Магазин
```sql
CREATE TABLE shop_counts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    count_date TEXT NOT NULL,
    product_id INTEGER NOT NULL REFERENCES products(id),
    product_type TEXT DEFAULT 'bread' CHECK(product_type IN ('bread','stale','other')),
    yesterday_balance REAL DEFAULT 0,
    received_today REAL DEFAULT 0,   -- авто з baking_tasks + повернення
    entered_balance REAL,            -- фактичний залишок (вводить оператор)
    written_off_entered REAL DEFAULT 0,
    calculated_sold REAL,            -- авто: yesterday + received - entered - writeoff
    price REAL,
    saved INTEGER DEFAULT 0,         -- 1 = підтверджено, заблоковано редагування
    UNIQUE(count_date, product_id, product_type)
);

CREATE TABLE other_stock_in (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stock_date TEXT NOT NULL,
    other_product_id INTEGER NOT NULL REFERENCES other_products(id),
    qty REAL NOT NULL,
    purchase_price REAL,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);
```

### Фінанси
```sql
CREATE TABLE finances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    finance_date TEXT NOT NULL,
    client_id INTEGER REFERENCES clients(id),  -- NULL = загальна операція
    finance_type TEXT NOT NULL CHECK(finance_type IN (
        'invoice',         -- накладна виставлена (мінус баланс клієнта)
        'payment',         -- оплата від клієнта (плюс)
        'writeoff',        -- списання боргу
        'deposit',         -- внесення в касу
        'route_cash',      -- готівка від водія
        'exchange_credit'  -- кредит при pre_order обміні
    )),
    amount REAL NOT NULL,  -- завжди позитивне число
    sign INTEGER NOT NULL CHECK(sign IN (1,-1)),  -- +1 або -1
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    created_by TEXT
);
```

### Налаштування
```sql
CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    description TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Дефолтні налаштування
INSERT INTO settings VALUES
    ('bakery_name', 'Пекарня', 'Назва пекарні'),
    ('director', '', 'ПІБ директора'),
    ('accountant', '', 'ПІБ бухгалтера'),
    ('address', '', 'Адреса пекарні'),
    ('phone', '', 'Телефон'),
    ('order_lock_time', '22:00', 'Час блокування замовлень'),
    ('bun_reserve_pct', '5', 'Резерв для булок, %'),
    ('bread_reserve_pct', '5', 'Резерв для хліба, %'),
    ('archive_months', '1', 'Місяців зберігати в активній БД'),
    ('cancel_discount_pct', '10', 'Знижка при перенесенні скасованого рейсу, %'),
    ('invoice_number_format', 'YYYYMMDD-NNN', 'Формат номера накладної'),
    ('copy_order_days', '14', 'Кількість днів для функції копіювати з дати');
```

---

## API структура (FastAPI)

### Роутери
```
/api/v1/
    /products          GET, POST, PUT, DELETE
    /categories        GET, POST
    /ingredients       GET, POST, PUT
    /clients           GET, POST, PUT, DELETE
    /routes            GET, POST, PUT
    /prices            GET, POST, PUT — з логікою дат
    /orders            GET, POST, PUT, DELETE — з копіюванням
    /baking            GET, POST — завдання + результат + розподіл
    /invoices          GET, POST, PUT — з автонумерацією
    /movements         GET — журнал
    /balances          GET — daily_balances з перерахунком
    /shop              GET, POST — shop_counts + other_stock
    /finances          GET, POST — з каскадним перерахунком
    /cancellations     GET, POST — скасування рейсів
    /reports           GET — різні звіти
    /settings          GET, PUT
```

### Ключові бізнес-правила для сервісів
- `get_price(product_id, client_id, date)` — повертає ціну по пріоритету
- `generate_invoice_number(date)` — `YYYYMMDD-NNN`, NNN скидається щодня
- `recalculate_balances(product_id, from_date)` — каскадний перерахунок
- `copy_orders(source_date, target_date, client_ids)` — копіювання замовлень
- `commit_reconciliation(date)` — підтвердження звірки магазину → рухи
- `process_exchange(order_id)` — обробка обміну → рух товару

---

## Frontend — вкладки (React pages)

| Вкладка | URL | Опис |
|---------|-----|------|
| Замовлення | `/orders` | Список клієнтів по маршрутах, введення кількостей |
| Випічка | `/baking` | Завдання пекарям + внесення результату + розподіл надлишків |
| Маршрути | `/routes` | Накладні + переміщення після повернення водія |
| Магазин | `/shop` | Щоденна звірка, несвіжий товар, група ІНШЕ |
| Фінанси | `/finances` | Баланси клієнтів, рух коштів |
| Довідники | `/admin` | Вироби, клієнти, ціни, маршрути, налаштування |

**Поточна дата** завжди видима у хедері і доступна для зміни (для роботи "за вчора").

---

## Фази розробки

### ✅ Фаза 1 — MVP
- [x] Структура проекту + встановлення (`install.bat`)
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
- [x] Базові тести: pytest + TestClient

### ✅ Фаза 2 — Повний цикл
- [x] Stale-логіка: несвіжий товар по всьому ланцюжку
- [x] Скасування рейсу
- [x] Магазин: щоденна звірка, несвіжий, ІНШЕ
- [x] Переробка вкладки Маршрути (накладні, друк, повернення)
- [x] Авторизація і ролі (JWT, 4 ролі, матриця прав)
- [x] Друк PDF — накладні (2 на A4) + завдання пекарям

### ✅ Розгортання на Windows (виконано паралельно з Фазами 1-2)
- [x] FastAPI роздає зібраний фронтенд (один процес, без окремого Vite в продакшні)
- [x] Task Scheduler автозапуск при вході в систему (`install-service.bat`)
  - задача `BakeryApp`, тригер AtLogon, перезапуск 5×/хв при збої
  - лог сервера → `logs/bakery.log`
- [x] Системний трей `tray.py` (pystray):
  - зелена/червона іконка = стан сервера, оновлення кожні 5 сек
  - бейдж = доступне оновлення
  - меню: Відкрити · Запустити · Перезапустити · Зупинити · Логи · Вийти
  - захист від дублювання (lock-файл)
- [x] Система оновлень через GitHub:
  - `VERSION` файл + git-теги (`v1.0.0`, `v1.1.0`, …)
  - автоперевірка GitHub API раз на годину
  - `update.bat` / `rollback.bat` — оновлення з відкатом
  - `update.ps1`: зупинка → git checkout → pip + npm build → рестарт → трей
- [x] Dev-режим: `start-dev.bat` (uvicorn --reload + Vite HMR, polling для мережевого диску)

### 🔄 Фаза 3 — Фінанси та аналітика
- [x] Фінансовий модуль (баланси клієнтів, рух коштів, журнал операцій)
- [ ] Управління цінами (майбутні дати, % зміна)
- [ ] Собівартість і маржинальність
- [ ] Мобільний дашборд для власника

### ⬜ Фаза 4 — Розширення
- [ ] Міграція з .accdb
- [ ] Розширені звіти
- [ ] Архівування, автобекапи

---

## Важливі деталі

- Мова інтерфейсу: **українська**
- SQLite — один файл, повністю офлайн
- Друк через браузер на лазерний принтер (PDF)
- Кілька операторів одночасно (локальна мережа)
- Windows-середовище, проект може лежати на мережевому диску (Z:)
  - Vite: `usePolling: true` для chokidar на мережевому диску
  - Task Scheduler замість NSSM (NSSM з SYSTEM не бачить мережеві диски)
  - `pythonw.exe` для запуску трею без консольного вікна
- Майбутня підтримка кількох магазинів (архітектурно врахувати)
- Міграція зі старої бази: клієнти, вироби, ціни, замовлення, рухи, фінанси

## Архітектура продакшн-розгортання

```
Windows Task Scheduler → BakeryApp (AtLogon, перезапуск 5×/хв)
    └── scripts/run-server.ps1
            └── uvicorn backend.main:app --host 0.0.0.0 --port 8000
                    ├── /api/v1/...     FastAPI роутери
                    └── /*              frontend/dist (React SPA, StaticFiles)

tray.py (pythonw — без вікна)
    ├── моніторить /api/health кожні 5 сек
    ├── перевіряє GitHub tags раз на годину
    └── керує Task Scheduler задачею
```

**Важливо:** `frontend/dist` будується при `install-service.bat` і `update.bat`.
У git не зберігається (`.gitignore`). При dev-режимі — Vite на порту 5173.

## Стиль коду
- Python: PEP8, type hints скрізь, docstrings для сервісів
- React: TypeScript, функціональні компоненти, hooks
- SQL: явні назви полів, без `SELECT *`
- Коментарі: українською де пояснюється бізнес-логіка

## Git workflow
- Після кожної завершеної функції: commit + push на main
- Commit message формат: `feat: назва функції` / `fix: опис`  
- Перед push — запустити pytest (backend) і npm run build (frontend)
- Гілки: main (стабільний), dev (розробка), feature/* (фічі)
