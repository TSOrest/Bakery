-- =============================================================
-- Пекарня — повна схема SQLite
-- =============================================================

PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

-- -------------------------------------------------------------
-- ДОВІДНИКИ
-- -------------------------------------------------------------

CREATE TABLE IF NOT EXISTS units (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT    NOT NULL UNIQUE  -- кг, шт, буханка
);

CREATE TABLE IF NOT EXISTS categories (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT    NOT NULL UNIQUE  -- Булки, Хліб, Магазин, Інше
);

CREATE TABLE IF NOT EXISTS products (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    name           TEXT    NOT NULL,
    short_name     TEXT,
    type           TEXT    NOT NULL CHECK(type IN ('bread','bun','other')),
    weight         REAL,
    unit_id        INTEGER REFERENCES units(id),
    category_id    INTEGER REFERENCES categories(id),
    cost_per_unit  REAL    DEFAULT 0,
    is_active      INTEGER DEFAULT 1,
    created_at     TEXT    DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ingredients (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    name             TEXT    NOT NULL,
    unit_id          INTEGER REFERENCES units(id),
    price_per_unit   REAL    DEFAULT 0,
    price_updated_at TEXT
);

CREATE TABLE IF NOT EXISTS product_ingredients (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id     INTEGER NOT NULL REFERENCES products(id),
    ingredient_id  INTEGER NOT NULL REFERENCES ingredients(id),
    qty_per_unit   REAL    NOT NULL,
    UNIQUE(product_id, ingredient_id)
);

CREATE TABLE IF NOT EXISTS other_products (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    name           TEXT    NOT NULL,
    unit_id        INTEGER REFERENCES units(id),
    purchase_price REAL    DEFAULT 0,
    sell_price     REAL    DEFAULT 0,
    is_active      INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS routes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    sort_order INTEGER DEFAULT 0,
    is_active  INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS clients (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name    TEXT    NOT NULL,
    short_name   TEXT,
    address      TEXT,
    phone        TEXT,
    director     TEXT,
    accountant   TEXT,
    route_id     INTEGER REFERENCES routes(id),
    discount_pct REAL    DEFAULT 0,
    is_active    INTEGER DEFAULT 1,
    created_at   TEXT    DEFAULT (datetime('now'))
);

-- -------------------------------------------------------------
-- ЦІНИ
-- -------------------------------------------------------------

CREATE TABLE IF NOT EXISTS prices (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id  INTEGER NOT NULL REFERENCES products(id),
    category_id INTEGER REFERENCES categories(id),
    price       REAL    NOT NULL,
    valid_from  TEXT    NOT NULL,
    valid_to    TEXT,
    is_active   INTEGER DEFAULT 1,
    created_at  TEXT    DEFAULT (datetime('now')),
    created_by  TEXT
);

CREATE TABLE IF NOT EXISTS client_price_overrides (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id  INTEGER NOT NULL REFERENCES clients(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    price      REAL    NOT NULL,
    valid_from TEXT    NOT NULL,
    valid_to   TEXT,
    UNIQUE(client_id, product_id, valid_from)
);

-- -------------------------------------------------------------
-- ЗАМОВЛЕННЯ
-- -------------------------------------------------------------

CREATE TABLE IF NOT EXISTS orders (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id       INTEGER NOT NULL REFERENCES clients(id),
    product_id      INTEGER NOT NULL REFERENCES products(id),
    qty             REAL    NOT NULL DEFAULT 0,
    order_date      TEXT    NOT NULL,
    status          TEXT    DEFAULT 'draft'  CHECK(status IN ('draft','confirmed','closed')),
    source          TEXT    DEFAULT 'phone'  CHECK(source IN ('phone','paper')),
    exchange_type   TEXT    DEFAULT 'none'   CHECK(exchange_type IN ('none','pre_order','post_delivery')),
    exchange_qty    REAL    DEFAULT 0,
    exchange_price  REAL,
    exchange_notes  TEXT,
    price_override  REAL,
    notes           TEXT,
    created_at      TEXT    DEFAULT (datetime('now')),
    created_by      TEXT
);

-- -------------------------------------------------------------
-- ВИПІЧКА
-- -------------------------------------------------------------

CREATE TABLE IF NOT EXISTS baking_tasks (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    task_date        TEXT    NOT NULL,
    product_id       INTEGER NOT NULL REFERENCES products(id),
    ordered_qty      REAL    DEFAULT 0,
    recommended_qty  REAL    DEFAULT 0,
    baked_qty        REAL    DEFAULT 0,
    created_at       TEXT    DEFAULT (datetime('now')),
    UNIQUE(task_date, product_id)
);

CREATE TABLE IF NOT EXISTS surplus_allocations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    alloc_date  TEXT    NOT NULL,
    product_id  INTEGER NOT NULL REFERENCES products(id),
    to_shop     REAL    DEFAULT 0,
    to_route    REAL    DEFAULT 0,
    ration_qty  REAL    DEFAULT 0,
    written_off REAL    DEFAULT 0,
    notes       TEXT,
    UNIQUE(alloc_date, product_id)
);

CREATE TABLE IF NOT EXISTS surplus_allocation_lines (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    alloc_date     TEXT    NOT NULL,
    product_id     INTEGER NOT NULL REFERENCES products(id),
    recipient_type TEXT    NOT NULL CHECK(recipient_type IN ('ration','writeoff','route','client')),
    client_id      INTEGER REFERENCES clients(id),
    qty            REAL    NOT NULL,
    notes          TEXT,
    created_at     TEXT    DEFAULT (datetime('now'))
);

-- -------------------------------------------------------------
-- НАКЛАДНІ
-- -------------------------------------------------------------

CREATE TABLE IF NOT EXISTS invoices (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_number  TEXT    NOT NULL UNIQUE,
    invoice_date    TEXT    NOT NULL,
    route_id        INTEGER REFERENCES routes(id),
    client_id       INTEGER NOT NULL REFERENCES clients(id),
    status          TEXT    DEFAULT 'draft' CHECK(status IN ('draft','printed','delivered','cancelled')),
    total_sum       REAL    DEFAULT 0,
    notes           TEXT,
    created_at      TEXT    DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invoice_lines (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id     INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    product_id     INTEGER NOT NULL REFERENCES products(id),
    qty            REAL    NOT NULL,
    price          REAL    NOT NULL,
    price_override REAL,
    is_exchange    INTEGER DEFAULT 0,
    is_stale       INTEGER DEFAULT 0,
    sum            REAL    NOT NULL
);

-- -------------------------------------------------------------
-- СКАСУВАННЯ РЕЙСУ
-- -------------------------------------------------------------

CREATE TABLE IF NOT EXISTS route_cancellations (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    route_id     INTEGER NOT NULL REFERENCES routes(id),
    cancel_date  TEXT    NOT NULL,
    reason       TEXT,
    cancelled_by TEXT,
    created_at   TEXT    DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cancellation_lines (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    cancellation_id         INTEGER NOT NULL REFERENCES route_cancellations(id),
    product_id              INTEGER NOT NULL REFERENCES products(id),
    qty                     REAL    NOT NULL,
    disposition             TEXT    NOT NULL CHECK(disposition IN ('to_shop','to_next_day','writeoff')),
    next_day_price_override REAL
);

-- -------------------------------------------------------------
-- РУХИ ТА ЗАЛИШКИ
-- -------------------------------------------------------------

CREATE TABLE IF NOT EXISTS movements (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    move_date    TEXT    NOT NULL,
    product_id   INTEGER NOT NULL REFERENCES products(id),
    move_type    TEXT    NOT NULL CHECK(move_type IN (
                     'in','sold','writeoff','ration',
                     'return_stale','exchange_out','exchange_in','cancel_to_shop'
                 )),
    qty          REAL    NOT NULL,
    is_stale     INTEGER DEFAULT 0,
    price        REAL,
    source_table TEXT,
    source_id    INTEGER,
    route_id     INTEGER REFERENCES routes(id),
    client_id    INTEGER REFERENCES clients(id),
    notes        TEXT,
    created_at   TEXT    DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS daily_balances (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    balance_date  TEXT    NOT NULL,
    product_id    INTEGER NOT NULL REFERENCES products(id),
    is_stale      INTEGER DEFAULT 0,
    start_balance REAL    DEFAULT 0,
    received      REAL    DEFAULT 0,
    sold          REAL    DEFAULT 0,
    written_off   REAL    DEFAULT 0,
    end_balance   REAL    DEFAULT 0,
    computed_at   TEXT,
    UNIQUE(balance_date, product_id, is_stale)
);

-- -------------------------------------------------------------
-- МАГАЗИН
-- -------------------------------------------------------------

CREATE TABLE IF NOT EXISTS shop_counts (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    count_date          TEXT    NOT NULL,
    product_id          INTEGER NOT NULL REFERENCES products(id),
    product_type        TEXT    DEFAULT 'bread' CHECK(product_type IN ('bread','stale','other')),
    yesterday_balance   REAL    DEFAULT 0,
    received_today      REAL    DEFAULT 0,
    entered_balance     REAL,
    written_off_entered REAL    DEFAULT 0,
    calculated_sold     REAL,
    price               REAL,
    saved               INTEGER DEFAULT 0,
    UNIQUE(count_date, product_id, product_type)
);

CREATE TABLE IF NOT EXISTS other_stock_in (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    stock_date       TEXT    NOT NULL,
    other_product_id INTEGER NOT NULL REFERENCES other_products(id),
    qty              REAL    NOT NULL,
    purchase_price   REAL,
    notes            TEXT,
    created_at       TEXT    DEFAULT (datetime('now'))
);

-- -------------------------------------------------------------
-- ФІНАНСИ
-- -------------------------------------------------------------

CREATE TABLE IF NOT EXISTS finances (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    finance_date TEXT    NOT NULL,
    client_id    INTEGER REFERENCES clients(id),
    finance_type TEXT    NOT NULL CHECK(finance_type IN (
                     'invoice','payment','writeoff',
                     'deposit','route_cash','exchange_credit'
                 )),
    amount       REAL    NOT NULL,
    sign         INTEGER NOT NULL CHECK(sign IN (1,-1)),
    notes        TEXT,
    created_at   TEXT    DEFAULT (datetime('now')),
    created_by   TEXT
);

-- -------------------------------------------------------------
-- НАЛАШТУВАННЯ
-- -------------------------------------------------------------

CREATE TABLE IF NOT EXISTS settings (
    key         TEXT PRIMARY KEY,
    value       TEXT,
    description TEXT,
    updated_at  TEXT DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO settings VALUES
    ('bakery_name',           'Пекарня',       'Назва пекарні'),
    ('director',              '',               'ПІБ директора'),
    ('accountant',            '',               'ПІБ бухгалтера'),
    ('address',               '',               'Адреса пекарні'),
    ('phone',                 '',               'Телефон'),
    ('order_lock_time',       '22:00',          'Час блокування замовлень'),
    ('bun_reserve_pct',       '5',              'Резерв для булок, %'),
    ('bread_reserve_pct',     '5',              'Резерв для хліба, %'),
    ('archive_months',        '1',              'Місяців зберігати в активній БД'),
    ('cancel_discount_pct',   '10',             'Знижка при перенесенні скасованого рейсу, %'),
    ('invoice_number_format', 'YYYYMMDD-NNN',   'Формат номера накладної'),
    ('copy_order_days',       '14',             'Кількість днів для функції копіювати з дати');

-- -------------------------------------------------------------
-- SEED: базові одиниці виміру
-- -------------------------------------------------------------

INSERT OR IGNORE INTO units(name) VALUES ('кг'), ('шт'), ('буханка'), ('л');

INSERT OR IGNORE INTO categories(name) VALUES ('Хліб'), ('Булки'), ('Магазин'), ('Інше');
