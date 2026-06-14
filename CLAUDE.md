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
│   ├── install-service.ps1  ← реєстрація Task Scheduler задач + firewall
│   ├── update.ps1           ← оновлення через GitHub tag
│   ├── rollback.ps1         ← відкат до попередньої версії
│   ├── run-tray.ps1         ← dev-версія watchdog (prod генерується в ProgramData)
│   └── notify.ps1           ← WinRT toast через PowerShell
├── dev/                     ← dev-інструменти, gitignored, не потрапляють клієнту
│   ├── release.ps1          ← автоматизований реліз на GitHub
│   ├── create-installer.ps1 ← генерує Bakery-Setup.ps1 з вбудованими токенами
│   └── generate_demo_db.py  ← генерація демо-бази даних
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
    created_at TEXT DEFAULT (datetime('now')),
    -- Поля Фази 3.5 (реалізовані)
    is_own_shop INTEGER DEFAULT 0,        -- власний магазин пекарні
    print_invoice INTEGER DEFAULT 1,
    receiver_name TEXT,                   -- ПІБ того хто приймає товар
    delivery_agent TEXT,                  -- "ВідпЧерез"
    delivery_note_number TEXT,
    delivery_note_date TEXT,
    client_group TEXT,                    -- legacy текстова підгрупа (з .accdb імпорту)
    -- v1.1.7: нормалізоване поле — FK на client_groups
    client_group_id INTEGER REFERENCES client_groups(id) ON DELETE SET NULL,
    client_kind TEXT DEFAULT 'customer',  -- customer|shop|writeoff|ration|underbaked
    bot_chat_id TEXT,
    bot_phones TEXT
);

-- Групи клієнтів (v1.1.7) — об'єднання клієнтів у межах маршруту
-- для друку Сортування / Маршрутного / Адресного листів.
CREATE TABLE client_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    route_id INTEGER NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);
-- Cascade: видалення маршруту → видалення груп → клієнти стають "Без групи"
-- (clients.client_group_id = NULL). PUT /clients зі зміною route_id скидає
-- client_group_id якщо група належить іншому маршруту.
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

```sql
-- Переміщення товару між накладними на стадії Маршрутів (v1.2.0).
-- Замінює механізм коригуючих накладних: корекція = пряме редагування рядків
-- накладної + запис тут (для анотацій "куди пішло / звідки прийшло").
CREATE TABLE invoice_transfers (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    transfer_date     TEXT NOT NULL,
    source_invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    target_invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    product_id        INTEGER NOT NULL REFERENCES products(id),
    qty               REAL NOT NULL,
    notes             TEXT,
    created_at        TEXT DEFAULT (datetime('now')),
    created_by        TEXT
);
```

**Корекція накладної (v1.2.0) — уніфіковане переміщення замість коригуючих:**
- `POST /invoices/{id}/transfer {product_id, qty, to_client_id}` — переносить товар
  з рядка цієї накладної на іншого клієнта / магазин / системного клієнта.
- Джерело: рядок `qty ↓`, `total_sum ↓`. Ціль: накладна на ту ж дату (створюється
  якщо нема) — рядок `qty ↑/створюється`, ціна через `get_price`, `total_sum ↑`.
- Магазин-ціль (`client_kind='shop'`/`is_own_shop=1`): ціль-накладна стає `accepted`
  → товар одразу у POS (`compute_current_stock`), борг магазину НЕ створюється.
- Фінанси обох накладних синхронізуються `recompute_invoice_finance` (працює і
  для вже accepted — оновлює борг-запис; для shop/writeoff/ration борг не ведеться).
- `PUT /invoices/{id}/lines` розширено: редагування у draft/sent/processing/accepted
  + перерахунок фінансів. `create_corrective_invoice` лишається лише для перегляду
  старих коригуючих (новий UI його не викликає).
- Оплата приймається за фінальною (скоригованою) сумою; фінанси відображають її.
- Різниця з `/orders/{id}/transfer`: той — стадія чернеток (до накладної, дочірні
  orders); `/invoices/{id}/transfer` — стадія сформованих накладних.

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
-- Статті фінансових операцій (реалізовано у Фазі 3.5).
-- Системні статті (is_system=1) видаляти не можна, лише редагувати.
-- editable (v1.1.7) дозволяє ✏ редагування суми операції поточного дня
-- через PATCH /finances/{id} замість видалення.
CREATE TABLE finance_articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    direction TEXT NOT NULL CHECK(direction IN ('income','expense')),
    is_system INTEGER DEFAULT 0,
    needs_client INTEGER DEFAULT 0,  -- 1 = операція потребує прив'язки до клієнта
    editable INTEGER DEFAULT 0       -- 1 = PATCH amount/notes дозволено (поточний день)
);
-- PARTIAL UNIQUE INDEX: системні статті унікальні за (name, direction).
-- За замовчуванням editable=1: Оплата, Внесення в касу, Виплата з каси,
-- Готівка водія, Списання.

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
    article_id INTEGER REFERENCES finance_articles(id),  -- замінює finance_type у відображенні
    amount REAL NOT NULL,  -- завжди позитивне число
    sign INTEGER NOT NULL CHECK(sign IN (1,-1)),  -- +1 або -1
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    created_by TEXT       -- 'system' для автоматичних записів (не редагуються)
);
```

### Telegram Bot
```sql
-- Авторизовані користувачі бота (кілька акаунтів на клієнта)
CREATE TABLE client_bot_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL REFERENCES clients(id),
    chat_id TEXT NOT NULL UNIQUE,
    phone TEXT,
    first_name TEXT,
    authorized_at TEXT,
    is_active INTEGER DEFAULT 1
);
```

Bot-поля в існуючих таблицях:
```sql
-- orders
ALTER TABLE orders ADD COLUMN source TEXT DEFAULT 'phone' CHECK(source IN ('phone','paper','bot'));
ALTER TABLE orders ADD COLUMN bot_status TEXT CHECK(bot_status IN ('pending','confirmed','rejected','modified'));
ALTER TABLE orders ADD COLUMN bot_rejection_reason TEXT;
ALTER TABLE orders ADD COLUMN bot_original_qty REAL;   -- qty до зміни оператором
ALTER TABLE orders ADD COLUMN placed_by_chat_id TEXT;  -- хто подав замовлення

-- clients
ALTER TABLE clients ADD COLUMN bot_phones TEXT;        -- телефони для авторизації (через кому)
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
    ('copy_order_days', '14', 'Кількість днів для функції копіювати з дати'),
    -- Telegram Bot
    ('telegram_bot_token', '', 'Токен Telegram-бота'),
    ('bot_order_start_time', '08:00', 'Час початку прийому замовлень'),
    ('bot_orders_closed_until', '', 'Бот не приймає замовлення до цього часу (ISO datetime)'),
    ('bot_tpl_confirmed', '✅ {product} × {qty} шт на {date} підтверджено.', 'Шаблон: підтвердження'),
    ('bot_tpl_rejected', '❌ {product} × {qty} шт на {date} відхилено. Причина: {reason}', 'Шаблон: відхилення'),
    ('bot_tpl_modified', '✏️ {product}: замовлено {qty} → змінено на {new_qty} шт на {date}.', 'Шаблон: зміна кількості'),
    ('bot_tpl_reminder', 'Нагадування: ви ще не подали замовлення на {date}.', 'Шаблон: нагадування'),
    ('bot_tpl_deadline', 'Прийом замовлень через бота на {date} завершено.', 'Шаблон: закриття прийому');
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
    /client-groups     GET, POST, PUT, DELETE          ← v1.1.7
        /{id}/members  GET, PUT — призначення клієнтів до групи
    /prices            GET, POST, PUT — з логікою дат
    /orders            GET, POST, PUT, DELETE — з копіюванням
        /grid          GET — матриця клієнти×вироби для Зведеного виду (v1.1.4)
        /bulk-upsert   POST — масове збереження з atomic locked-check (v1.1.4)
    /baking            GET, POST — завдання + результат + розподіл
    /invoices          GET, POST, PUT — з автонумерацією
    /movements         GET — журнал
    /balances          GET — daily_balances з перерахунком
    /shop              GET, POST — shop_counts + other_stock
    /finances          GET, POST, PATCH /{id} (v1.1.7), DELETE
        articles       GET, POST, PUT, DELETE (з прапором editable)
    /cancellations     GET, POST — скасування рейсів
    /reports           GET — різні звіти
    /settings          GET, PUT
    /issues            GET / (список client-report) · POST / (нове звернення → GitHub)
    /bot/
        pending-orders              GET — замовлення зі статусом pending
        orders/{id}/verify          PUT — підтвердити/відхилити/змінити кількість
        broadcast-reminder          POST — розсилка нагадувань
        broadcast-deadline          POST — розсилка закриття прийому
        order-status                GET — чи приймає бот замовлення
        order-status/stop           POST — зупинити до ранку наступного дня
        order-status/resume         POST — відновити негайно
        clients/{id}/bot-users      GET — список авторизованих Telegram-юзерів
        clients/{id}/bot-users/{uid} DELETE — відкликати авторизацію
    /invoices/locked-clients        GET — client_ids з наявними накладними на дату
    /print/                                            ← друковані форми
        invoice/{id}                GET — одна накладна
        invoices                    GET — пакет накладних (2 на A4)
        baking                      GET — завдання пекарям
        daily-report                GET — денний звіт
        debts                       GET — боргова відомість
        monthly-sales               GET — місячний звіт продажів
        client-statement            GET — виписка клієнта
        group-sort                  GET — Сортування товару за групами (v1.1.7)
        route-sheet                 GET — Маршрутний лист водія (v1.1.7)
        address-sheet               GET — Адресний лист клієнтів (v1.1.7)
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
  - задача `BakeryTray`, тригер AtLogon — трей стартує автоматично
  - `run-server.ps1` вбиває orphan-процеси перед стартом (fix port 8000 conflict)
  - лог сервера → `logs/bakery.log`
- [x] Системний трей `tray.py` (pystray):
  - іконка хліба на кольоровому колі (зелений/червоний/жовтий) замість літери "B"
  - анімація при запуску: жовта іконка блимає поки сервер не відповів
  - бейдж = доступне оновлення; uptime + розмір БД у tooltip
  - меню: Відкрити · підменю розділів (6 сторінок) · Запустити/Перезапустити/Зупинити · Оновлення · Відкат · Логи · Вийти
  - захист від дублювання (lock-файл)
  - task `BakeryTray` (AtLogon) + watchdog `run-tray.ps1` — автозапуск і перезапуск через 5 сек після будь-якого виходу
  - сповіщення при старті трею з поточним станом сервера
  - balloon-сповіщення: зміна стану сервера, нова версія, початок оновлення/відкату, зміна стану інтернету (state-based)
  - `_poll_internet` thread (кожні 30 сек): моніторить з'єднання, нотифікує при втраті/відновленні
  - PowerShell WinRT toast (`scripts/notify.ps1`) — надійний, зберігається у центрі сповіщень
  - `action_logs`: попереджає і пропонує очистити якщо лог > 10 MB
  - `_resolve_data_dir()`: автовизначення DATA_DIR (env → `%ProgramData%\Bakery\bakery.db` → парсинг run-server.ps1 → fallback ROOT); вирішує проблему коли трей запущений без `BAKERY_DATA_DIR`
  - `_poll_flags()` thread (кожні 2 сек): обробляє flag-файли від frontend — `RESTORE_REQUESTED`, `DEMO_ENTER_REQUESTED`, `DEMO_EXIT_REQUESTED`; окремий від `_poll_backup()` (60 сек) для швидкої реакції (≤2 сек)
  - `_notified_version`: balloon про нову версію надсилається лише один раз на версію, не повторюється щогодини
  - `action_install_update` запускається в окремому `threading.Thread` (як `action_rollback`) — інакше `MessageBoxW` блокує pystray event thread і кнопки діалогу не реагують
  - об'єднаний потік оновлення (v1.1.9): "Перевірити оновлення" при знайденій новій версії одразу показує діалог Так/Ні "Встановити зараз?" і запускає встановлення на "Так" — без окремого кроку через меню. Спільний хелпер `_run_install(icon, current, latest)` (бекап → `update.ps1` → `icon.stop()`, без повторного підтвердження) використовується і `_do_check_update`, і `action_install_update` (шлях через balloon → меню)
- [x] Система оновлень та відкату через GitHub:
  - `VERSION` файл + git-теги (`v1.0.0`, `v1.1.0`, …)
  - автоперевірка GitHub API раз на годину (balloon тільки при першому виявленні нової версії)
  - `update.bat` / `rollback.bat` — оновлення з відкатом
  - `update.ps1`: зупинка → git checkout → очищення `logs/` і `dev/` з ROOT → pip + npm build → рестарт → регенерація `run-server.ps1` і `run-tray.ps1` в ProgramData → трей
  - `rollback.ps1`: приймає `-TargetTag`; якщо не вказаний — читає `PREVIOUS_VERSION`
  - вибір версії відкату через PowerShell `Out-GridView` (список локальних git-тегів)
  - автоматичний бекап `bakery.db` перед оновленням і відкатом (`bakery.db.bak-VERSION-TIMESTAMP`)
- [x] Dev-режим: `start-dev.bat` (uvicorn --reload + Vite HMR)
- [x] `dev/release.ps1` — автоматизований реліз: оновлює `VERSION`, комітить, пушить, створює GitHub Release через REST API (gitignored, тільки для розробника)
- [x] `dev/create-installer.ps1` — генерує `Bakery-Setup.ps1` з вбудованими токенами (git clone + install + write ISSUES_TOKEN до БД); файл gitignored щоб токени не потрапили в репо
- [x] Система звернень (Issues): `backend/routers/issues.py` проксує GitHub Issues API; `IssuesWidget.tsx` — плаваюча кнопка 💬 на всіх сторінках; токен зберігається в БД, ніколи не потрапляє у браузер
- [x] Бекап та відновлення бази:
  - автобекап щодня при старті трею (`_poll_backup` thread, 60 сек)
  - ручний бекап і відновлення через UI налаштувань
  - відновлення: API записує `RESTORE_REQUESTED` (JSON з path і параметрами) → `_poll_flags()` підхоплює за ≤2 сек → тре зупиняє сервер, копіює БД через `sqlite3.connect(...).backup()`, перезапускає
  - міграція БД при першому встановленні: якщо в ProgramData немає `bakery.db` — копіюється з ROOT

### ✅ Фаза 3 — Фінанси та аналітика
- [x] Фінансовий модуль (баланси клієнтів, рух коштів, журнал операцій)
- [x] Управління цінами (майбутні дати, % зміна)
- [x] Собівартість і маржинальність
- [x] Мобільний дашборд для власника

### ✅ Telegram Bot
- [x] Авторизація через номер телефону (`/start` → контакт → прив'язка до клієнта)
- [x] Мульти-юзер: кілька Telegram-акаунтів на одного клієнта (`client_bot_users`)
- [x] `bot_phones` — список телефонів клієнта для авторизації в боті (через кому)
- [x] Подача замовлення через бота: вибір типу → вибір товару → кількість
  - показує ціну клієнта з урахуванням знижок (не вагу)
  - сторінкова навігація по товарах
- [x] Статус замовлення: значок на початку рядка (⏳/✅/✏️/❌/👤 для оператора)
- [x] Верифікація оператором: підтвердити / відхилити / змінити кількість
  - відповідь надсилається тому хто подав замовлення (`placed_by_chat_id`)
  - fallback на перший активний chat_id клієнта
  - зберігає `bot_original_qty` при зміні кількості
- [x] Розсилки: нагадування клієнтам без замовлення, повідомлення про закриття прийому
- [x] Кнопка "📦 Накладна сьогодні" — дані з таблиці `invoices` + баланс клієнта
- [x] Контроль прийому замовлень: стоп (до ранку наступного дня) / відновлення
  - налаштування `bot_orders_closed_until` (ISO datetime)
  - налаштування `bot_order_start_time` (час відновлення, default "08:00")
- [x] Блокування замовлень коли накладна вже сформована (як у UI оператора)
- [x] Шаблони повідомлень у налаштуваннях (`bot_tpl_confirmed/rejected/modified/reminder/deadline`)
- [x] UI оператора (OrdersPage): індикатор стану прийому (зелений/червоний), кнопка стоп/відновлення
- [x] UI оператора: блокування рядків клієнта при наявності накладної (🔒)
- [x] UI оператора: автооновлення pending-замовлень кожні 30 сек
- [x] UI оператора: жовтий фон для pending, сірий disabled-вигляд для rejected
- [x] UI оператора: розширений tooltip з примітками та оригінальною кількістю
- [x] AdminPage: поле `bot_phones` + таблиця авторизованих користувачів з кнопкою відкликання
- [x] BakingPage: попередження про непідтверджені bot-замовлення перед формуванням/друком
- [x] Pending bot-замовлення виключені з агрегату для випічки

### ⬜ Фаза 3.5 — Уточнення (на основі аналізу старої системи)

#### Модель даних — зміни

**Замовлення (`orders`) — Split-логіка:**
- Додати поле `parent_order_id INTEGER REFERENCES orders(id)` — посилання на батьківський рядок
- Оригінальний рядок — основа (parent_order_id IS NULL)
- Дочірні рядки (`parent_order_id = X`) — списання частини на інші потреби (переміщення, повернення, інший клієнт)
- Приклад: замовлено 10 хот-догів клієнту А → частина 3 шт переміщується клієнту Б → додається дочірній рядок з `client_id = Б`, `qty = 3`, `parent_order_id = id оригінального рядка`
- UI показує оригінал і дочірні рядки разом → видно "замовлено 10, передано 3, залишилось 7"
- Поле `delivered_qty REAL` — фактично передана кількість (може відрізнятись від qty)

**Клієнти (`clients`) — додаткові поля:**
- `is_own_shop INTEGER DEFAULT 0` — власний магазин пекарні (клієнт серед клієнтів, але товар туди передається, а не продається). Впливає на логіку "Магазину" і фінансів
- `print_invoice INTEGER DEFAULT 1` — чи друкувати накладну для цього клієнта
- `receiver_name TEXT` — ПІБ того хто приймає товар ("Прийняв" зі старої системи)
- `delivery_agent TEXT` — через кого відправляється ("ВідпЧерез")
- `delivery_note_number TEXT` — номер доручення
- `delivery_note_date TEXT` — дата доручення
- `client_group TEXT` — підгрупа в межах маршруту (напр. назва населеного пункту); використовується для сортування накладних і розміщення в машину

**Вироби (`products`) — початковий залишок:**
- Додати поле `initial_stock REAL DEFAULT 0` — використовується одноразово при першому запуску для внесення початкових залишків у магазині (не поточний залишок, лише seed-значення)

**Фінансові статті — зробити редагованими:**
- Створити таблицю `finance_articles` (id, name, direction CHECK IN ('income','expense'), is_system INT DEFAULT 0)
- `finances.finance_type` замінити на `article_id INTEGER REFERENCES finance_articles(id)`
- Системні статті (is_system=1) не можна видалити, лише редагувати назву
- Оператор може додавати власні статті (is_system=0)
- Початкові системні статті: "Накладна" (expense), "Оплата" (income), "Списання боргу" (expense), "Внесення в касу" (income), "Готівка від водія" (income), "Кредит при обміні" (expense)

#### UX — потокові операції

**Вкладка Замовлення:**
- Ліворуч: дерево Маршрут → (Група) → Клієнт з індикатором "є замовлення сьогодні"
- Правоуч при виборі клієнта: список виробів з полем кількості + підказка "середнє за 30 днів"
- Швидкий перехід до наступного клієнта (кнопка / Enter після останнього поля)
- Вироби впорядковані за частотою замовлень (часто замовлені — зверху)
- Дочірні рядки (переміщення) відображаються під основним рядком у тій же таблиці, відступом
- Перевірка дублів: якщо той самий виріб+клієнт+дата вже є — попереджати, не дублювати

**Вкладка Випічка:**
- Потокове внесення: оператор іде по списку виробів і вносить Спечено + Пайок в один рядок
- Пайок (`ration_qty`) відображається прямо в рядку виробу, не у окремому діалозі
- Після введення — Enter переходить до наступного рядка
- Кнопка "Закрити день" — фіксує результат і переводить статус

**Вкладка Маршрути (робота з водієм):**
- Акцент на внесення **суми від водія** для конкретного клієнта з поточного маршруту
- Список клієнтів маршруту + поле "Сума від водія" поруч (мінімізація помилки "не той клієнт")
- Клієнт з активним замовленням на сьогодні — підсвічений, решта — приглушені
- При кліку на клієнта — розгортається деталь: список виробів замовлення + поле "переміщено/повернено"
- Звідси ж можна ввести дочірній рядок замовлення (переміщення до іншого клієнта або повернення)

**Вкладка Магазин:**
- Верхній блок: **поточний стан продукції на екрані без прокручування** — компактна таблиця/сітка з назвою, типом, ціною, залишком, продано/списано
- Нижній блок або окрема панель: **потокове внесення залишків** — список виробів з полем "Введений залишок" і "Списано", Enter → наступний рядок
- Кнопка підтвердження звірки — тільки після підтвердження дані зберігаються і рахунок закривається

#### Фінанси — покращення інформативності
- Головний екран: картки з підсумками (загальний борг, аванси, нетто, надходження за тиждень/місяць)
- Інтерактивна деталізація: клік на клієнта → розгортається журнал операцій по ньому
- Фільтр по статтях (редаговані статті відображаються в фільтрі)
- Групування по маршрутах в списку клієнтів-боржників

- [x] Додати `parent_order_id` і `delivered_qty` до orders
- [x] Додати поля до clients (is_own_shop, print_invoice, receiver_name, delivery_agent, delivery_note_number, delivery_note_date, client_group)
- [x] Додати `initial_stock` до products
- [x] Замінити finance_type enum на таблицю `finance_articles`
- [x] UX вкладки Замовлення: дерево маршрут→клієнт, підказка середнього, швидка навігація
- [x] UX вкладки Випічка: пайок у рядку, Enter-навігація
- [x] UX вкладки Маршрути: акцент на "сума від водія", розгортання деталі замовлення
- [x] UX вкладки Магазин: картки магазинів + модальна звірка з гнучким періодом, потоковим вводом і касою
- [x] UX Фінанси: картки + інтерактивна деталізація + редаговані статті
- [ ] Резерв для маршруту у розподілі надлишків (`baking_route_reserve`):
  - Опція вже є в dropdown (вмикається в Налаштуваннях → Параметри пекарні)
  - Потрібно реалізувати: вибір конкретного маршруту, автододавання рядка до замовлень або рух у `movements` (тип `in`, route_id заповнений)
  - Узгодити з `daily_balances` і відображенням у вкладці Маршрути

### ✅ Денний звіт пекарні (PDF A4)
- [x] `GET /api/v1/print/daily-report?date=YYYY-MM-DD` → HTML (HTMLResponse, без авторизації як усі `/print/`)
- [x] Секція 1 — Продукція: хліб і булки окремо; колонки Замовлено / Спечено / Обмін / Магазин
  - Спечено: fallback на Замовлено якщо baking_tasks відсутні
  - Обмін: береться з `orders.qty` де `exchange_type != 'none'` (не з `exchange_qty` — у імпортованих даних він завжди 0)
- [x] Секція 2 — Маршрути: по кожному маршруту хліб/булки/обмін/сума; обмін з `orders`, не з `invoice_lines.is_exchange`
- [x] Секція 3 — Фінанси: 3.1 Залишок на початок дня (накопичений з попередніх днів) → 3.2 Клієнтські операції (Накладна першою) → 3.3 Касові операції → 3.4 Залишок в касі
  - `_is_invoice_entry()`: перевіряє тільки назву статті "Накладна" (не `finance_type` — у імпортованих даних касові статті мають `finance_type='invoice'`)
- [x] Вкладка "Звіти" (`/reports`, `ReportsPage.tsx`): датепікер + кнопка "Відкрити звіт PDF" → нова вкладка

### ✅ Міграція з .accdb
- [x] `backend/routers/import_accdb.py` — ендпоінти: upload, preview, context, run, status, result
- [x] `backend/services/import_accdb.py` (~1500 рядків) — повний імпорт:
  - читання .accdb через PowerShell 32-bit OleDb (ACE driver) або pyodbc як fallback
  - preview: перші N рядків кожної таблиці, автовизначення маппінгу колонок
  - import: одиниці → маршрути → вироби → клієнти → фінансові статті → ціни → замовлення → накладні → фінансові операції → звірка балансів → залишки магазину
  - прогрес в реальному часі (SSE або polling `/import/status`)
  - файл зберігається в `DATA_DIR/tmp/` і автовидаляється через 24 год
- [x] `frontend/src/api/importAccdb.ts` + UI сторінка імпорту в AdminPage

### ⬜ Фаза 4 — Розширення
- [ ] Розширені звіти (аналітика, порівняння по тижнях/місяцях)
- [x] Архівування, автобекапи (реалізовано в tray.py + UI налаштувань)

---

## Важливі деталі

- Мова інтерфейсу: **українська**
- SQLite — один файл, повністю офлайн
- Друк через браузер на лазерний принтер (PDF)
- Кілька операторів одночасно (локальна мережа)
- Windows-середовище, проект на локальному диску
  - Task Scheduler (AtLogon) для автозапуску сервера і трею
  - `pythonw.exe` для запуску трею без консольного вікна
- Майбутня підтримка кількох магазинів (архітектурно врахувати)
- Міграція зі старої бази: клієнти, вироби, ціни, замовлення, рухи, фінанси

## Архітектура продакшн-розгортання

### Дві папки PROD

| Папка | Призначення |
|-------|-------------|
| `C:\Program Files\Bakery\` | Код застосунку (git clone) |
| `C:\ProgramData\Bakery\` | Дані: `bakery.db`, `logs/`, `scripts/` |

**Змінна оточення** `BAKERY_DATA_DIR=C:\ProgramData\Bakery` встановлюється в згенерованих скриптах і читається backend та tray.py для визначення де шукати БД і логи.

**Згенеровані скрипти** (НЕ в git, створюються `install-service.ps1` і `update.ps1`):
- `C:\ProgramData\Bakery\scripts\run-server.ps1` — запуск uvicorn з hardcoded шляхами
- `C:\ProgramData\Bakery\scripts\run-tray.ps1` — watchdog для tray.py

`scripts/run-tray.ps1` у репо — статична dev-версія (без `BAKERY_DATA_DIR`), tray.py знаходить DATA_DIR через `_resolve_data_dir()`.

```
C:\Program Files\Bakery\          ← git clone, код
C:\ProgramData\Bakery\
    ├── bakery.db                  ← база даних
    ├── logs/bakery.log            ← лог сервера
    └── scripts/
            ├── run-server.ps1    ← згенерований install/update
            └── run-tray.ps1      ← згенерований install/update

Windows Task Scheduler → BakeryApp (AtLogon, перезапуск 5×/хв)
    └── C:\ProgramData\Bakery\scripts\run-server.ps1
            ├── встановлює BAKERY_DATA_DIR
            ├── вбиває orphan-процеси uvicorn (fix порту 8000)
            └── uvicorn backend.main:app --host 0.0.0.0 --port 8000
                    ├── /api/v1/...     FastAPI роутери
                    └── /*              frontend/dist (React SPA, StaticFiles)

Windows Task Scheduler → BakeryTray (AtLogon)
    └── C:\ProgramData\Bakery\scripts\run-tray.ps1  (watchdog)
            └── pythonw C:\Program Files\Bakery\tray.py
                    ├── _resolve_data_dir() → C:\ProgramData\Bakery
                    ├── моніторить /api/health кожні 5 сек
                    ├── _poll_flags() кожні 2 сек — RESTORE/DEMO flags
                    ├── перевіряє GitHub tags раз на годину
                    └── керує Task Scheduler задачами (BakeryApp, BakeryTray)
```

**Важливо:** `frontend/dist` будується при `install-service.bat` і `update.bat`.
У git не зберігається (`.gitignore`). При dev-режимі — Vite на порту 5173.

**Dev-інструменти** (`dev/`, gitignored, не потрапляють клієнту):
- `dev/release.ps1` — реліз на GitHub
- `dev/create-installer.ps1` — генерує інсталятор з токенами
- `dev/generate_demo_db.py` — демо-база
- `Bakery-Setup.ps1` / `scripts/Bakery-Setup.ps1` — gitignored (містять OAuth токени)

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

## Відомі обмеження

- **SQLite WAL mode**: один файл, обмеження на конкурентні writes (~50/сек). Для пекарні з кількома операторами на локальній мережі — більш ніж достатньо.
- **Telegram бот**: один токен на одну пекарню. Якщо потрібно кілька пекарень з ботами — окремий токен у налаштуваннях кожної.
- **Архівування**: ручне через UI (Налаштування → Бекапи → Архівувати). Автоматичне за розкладом не реалізоване — додати у наступних версіях.
- **Cloud-бекап (Google Drive/OneDrive/Dropbox)**: працює через локальну папку синхронізації. Якщо клієнт-додаток хмари не запущений — копія залишиться лише локально.
- **Шифрування БД**: SQLite БД не шифрована. Захист — через права Windows (`C:\ProgramData\Bakery` доступний лише адміну машини).
- **Архітектура для одного магазину**: код підтримує кілька магазинів через `client_kind='shop'`, але UI оптимізовано під 1-3 точки.

## Безпека (стан на v1.1.x)

- **Паролі**: bcrypt (cost=12) з прозорим апгрейдом legacy SHA256 при login
- **API auth**: усі мутації (POST/PUT/PATCH/DELETE) на роутерах вимагають Bearer токен через `require_user`/`require_admin`
- **Rate-limiting**: на `/auth/login` — in-memory dict `{ip: attempts}`, >5 спроб за 5 хв → 429 Too Many Requests з `Retry-After` header (cleanup кожні 10 хв)
- **Сесії**: таймаут **30 днів неактивності** через `UserSession.last_used_at` — оновлюється при кожному `get_current_user`, прострочені сесії видаляються автоматично (міграція 028)
- **OAuth токени**: зберігаються відкритим текстом у налаштуваннях БД (запланований Batch 4.2 — шифрування Fernet з ключем у `BAKERY_DATA_DIR/.fernet_key`)
- **Frontend API token (v1.1.7)**: усі raw `fetch()` у `frontend/src/api/*.ts` переведено на централізований `api/client.ts` що додає `Authorization: Bearer <token>` з `localStorage.bakery_token`. Для FormData-upload (`importAccdb`, `issues/assets`) — окрема обгортка з ручним додаванням headers.

## Аудит-фікси v0.9.36-v1.0.4

**v0.9.36-v0.9.39:**
- **B1-B7 (блокери)**: бекап з WAL checkpoint, ідемпотентні міграції, SQL injection захист, bcrypt, авторизація на роутерах, dashboard NULL fixes
- **V1-V10 (важливі)**: safe_commit helper, логування пригнічених винятків, Toast/ConfirmDialog компоненти, sanitize помилок, orphan-checks, atomic update.ps1
- **N5+N6+N7** (пост-реліз): synchronous=FULL, cache_size=-32768 (32MB), retry на release upload, try/finally для токенів installer

**v1.0.0-v1.0.4:**
- **Магазин/POS**: `compute_current_stock()` — lazy-обчислення стоку без потреби у відкритій звірці; POS-валідація стоку (HTTP 422 коли продаж перевищує залишок); атомарна перевірка cart у `setCart` callback (без race при швидких кліках); секція "📦 Залишки магазину" з пропорційним горизонтальним grid; кнопки Звірка ↔ Початковий залишок — взаємовиключні
- **БД (міграції 029-031)**:
  - 029: `shop_disposal_lines.price` + перебудова orphan FK (`_v2` → правильна таблиця); CHECK розширено до `'sale'`
  - 030: PARTIAL UNIQUE INDEX на `clients(client_kind)` WHERE writeoff/ration/underbaked — захист від дублів системних клієнтів
  - 031: PARTIAL UNIQUE INDEX на `finance_articles(name, direction)` WHERE is_system=1
- **schema.sql sync (B1)**: повна синхронізація з моделями SQLAlchemy — 29 таблиць, 24 індекси, 24 default settings; видалено застарілі `surplus_*`, `route_cancellations`, `cancellation_lines`
- **safe_commit() поширено** на категорії, магазин, auth, bot (~34 місця разом)
- **Frontend stability**: останні `alert()` → toast у BakingPage і ImportPage; fix race у `ReconciliationCalendar` (`selectedRec.lines.length` падав при slim-об'єкті); fix кирилиці у трей-діалогах; update.ps1 без credential helper

## Релізи v1.1.x

**v1.1.0-v1.1.2** — Pivot Grid (зведений вид замовлень):
- Альтернативний UI у вкладці Замовлення: кнопка **❖ Зведений вид** відкриває fullscreen-модалку з сіткою клієнти × вироби × дата.
- Ексклюзивні акордеони у кутовій клітинці шапки: категорії (Хліб / Булка) — горизонтально top-right; рейси — вертикально bottom-left.
- Sticky-кути: лівий стовпчик (клієнт), правий (Σ по клієнту), верхня шапка (виріб з vertical-text), нижній footer (Σ по виробу).
- Двоетапне вимірювання ширин колонок через `useLayoutEffect` — точна ширина за реальною шириною label (без `max-content` пастки для vertical-text).
- Бейджі `+N↩` для extra-рядків (обмін/знижка/переміщення), оранжева крапка для pending bot-замовлень.
- Етап 3: bulk-flush (POST `/orders/bulk-upsert` коли N≥2 змін за 600 мс) + paste TSV з Excel (`onPaste` handler, заповнення від anchor вправо/вниз, пропускає locked-клієнтів).
- Backend: GET `/orders/grid?order_date=...` + POST `/orders/bulk-upsert` з atomic locked-check (409 з `locked_client_ids` у detail).

**v1.1.3** — fix update.ps1:
- `npm install --no-audit --no-fund` перед `npm run build` — install уже не падає на машинах з застарілим `node_modules`.
- `Start-Process npm` тепер з `-RedirectStandardOutput`/`-RedirectStandardError` у `C:\ProgramData\Bakery\logs\update-npm-{install,build}.log{,.err}` — є що дивитись при падінні.
- Явні рядки в логу про причину fallback на npm (нема OAuth токена / release не має `frontend-dist.zip` / exception download з повідомленням).
- Sidecar `scripts/manual-upgrade-v1.1.3.ps1` (закомічений) для клієнтів які застрягли на v1.0.x через self-update race (PowerShell кешує старий скрипт у пам'яті). Обходить GCM-popup через `git remote set-url` з embedded токеном, PS 5.1 NativeCommandError (через `$ErrorActionPreference='Continue'` для git-блоку + `--quiet`), кирилицю у username (system-wide `C:\Windows\Temp` замість `$env:TEMP`).

**v1.1.5** — wheel-blur:
- Глобальний listener у `main.tsx`: при `wheel` на focused `<input type="number">` робимо `blur()` → значення не змінюється при прокручуванні сторінки колесом миші. Покриває всі форми з number-inputs одним патчем (Orders, OrderModal, GridOrderModal, BakingPage, FinancesPage, RoutesPage, ShopPage, ImportPage, admin tabs).

**v1.1.6** — bulk-send fix:
- Масова відправка чернеток у Маршрутах: `Promise.all` → послідовний `for...await`. `generate_invoice_number` не atomic — паралельні запити брали однаковий номер → 409 на одному з них → `Promise.all` rejects → UI зависав з "..." і не оновлювався.
- Per-item `try/catch` + загальний `try/finally` — UI завжди розблоковує + `load()` refetch. Toast про результат. Чекбокси з невдалих залишаються виділеними.

**v1.1.7** — фінанси (auth + edit) + групи клієнтів + друковані форми:
- **Auth-fix**: `frontend/src/api/finances.ts`, `importAccdb.ts`, `issues.ts` — усі raw `fetch()` переведено на `api/client.ts` (виправляє "Не авторизовано" при збереженні оплат і копіюванні цін).
- **Edit фінансових сум**: міграція **032** + поле `editable` у `finance_articles` + `PATCH /finances/{id}` (схема `FinanceUpdate`). UI: кнопка ✏ замість 🗑 у FinancesPage (показується тільки для `finance_date == workDate` + `article.editable=1` + `created_by != 'system'`). Чекбокс "Редаг. суми" у Довіднику фінансових статей. Default editable=1 для: Оплата, Внесення в касу, Виплата з каси, Готівка водія, Списання.
- **Групи клієнтів**: міграція **033** + таблиця `client_groups` + `clients.client_group_id` (FK з `ON DELETE SET NULL`). Модель `ClientGroup` (route_id, name, sort_order). Роутер `/client-groups` CRUD + `GET/PUT /{id}/members`. Cascade у `update_client`: при зміні `route_id` група старого маршруту скидається у NULL. Нова вкладка AdminPage "Групи клієнтів" + dropdown у формі клієнта (фільтр за поточним route_id). У формі ClientGroupsTab — multi-select клієнтів для призначення.
- **Друковані форми у Маршрутах** (sticky-секція `printFormsBar` внизу панелі списку, `flex-shrink: 0`):
  - GET `/print/group-sort` — Сортування товару по групах клієнтів (агрегація orders за route → group → product, для завантаження машини).
  - GET `/print/route-sheet` — Маршрутний лист водія. Дані з `invoice_lines` (status != cancelled, не is_exchange). Кожен маршрут на окремій сторінці. Колонки: Виріб | К-сть | Ціна | Брак | Ціна браку | Сума. Шапка з підсумками маршруту, темно-синя смуга-заголовок групи з назвою маршруту (щоб не загубитися при розриві сторінки).
  - GET `/print/address-sheet` — Адресний лист (Клієнт | Адреса | Телефон | Сума зам.). Дані з `invoices`, окрема сторінка на маршрут, групи всередині.
- **Сортування orders у вкладці Замовлення**: у межах клієнта вироби сортуються за `order.id` (порядок внесення) замість алфавіту — відповідає паперовим бланкам.

## Memory і agent-context

Розробник-агент Claude Code зберігає персональну пам'ять у `C:\Users\<user>\.claude\projects\c--Bakery\memory\` (поза репо). Це позаконтекстна тримана знання про:
- Дозволи (PowerShell/CMD без підтверджень)
- Workflow (релізи тільки за підтвердженням користувача)
- Конвенції (без AI-атрибуції у git/PR/release notes)
- Project-specific факти (пароль до .accdb, активний клієнт у проді)

Файл `MEMORY.md` — індекс. Окремі факти зберігаються як `feedback_*.md`, `project_*.md`, `reference_*.md`. Не зачіпайте при cleanup репозиторію.
