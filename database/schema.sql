-- =============================================================
-- Пекарня — повна схема SQLite
-- =============================================================
-- Канонічний DDL що відповідає поточному стану моделей SQLAlchemy
-- (синхронізовано з backend/models/*.py).
--
-- НЕ виконується автоматично — Base.metadata.create_all() створює
-- таблиці з моделей при старті. Цей файл — документація і запасний
-- варіант для seed/initialize свіжої БД руками (sqlite3 db < schema.sql).
--
-- При додаванні нових моделей/полів — оновіть і цей файл, і додайте
-- міграцію у database/migrations/ для існуючих БД.
-- =============================================================

PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

-- -------------------------------------------------------------
-- ДОВІДНИКИ
-- -------------------------------------------------------------

CREATE TABLE IF NOT EXISTS units (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    name      TEXT    NOT NULL UNIQUE,  -- кг, шт, буханка, л
    is_active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS categories (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL UNIQUE,  -- Хліб, Булки, Магазин, Інше
    is_active   INTEGER DEFAULT 1,
    is_baked    INTEGER DEFAULT 1,    -- 0 = магазин/інше (не випікаємі)
    reserve_pct REAL    DEFAULT 0,    -- % резерву для випічки
    sort_order  INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS products (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    name           TEXT    NOT NULL,
    short_name     TEXT,
    weight         REAL,
    unit_id        INTEGER REFERENCES units(id),
    category_id    INTEGER REFERENCES categories(id),
    cost_per_unit  REAL    DEFAULT 0,
    purchase_price REAL    DEFAULT 0,  -- ціна закупівлі (для товарів ззовні)
    initial_stock  REAL    DEFAULT 0,  -- seed-залишок (один раз при першому запуску)
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
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name            TEXT    NOT NULL,
    short_name           TEXT,
    address              TEXT,
    phone                TEXT,
    director             TEXT,
    accountant           TEXT,
    route_id             INTEGER REFERENCES routes(id),
    discount_pct         REAL    DEFAULT 0,
    is_active            INTEGER DEFAULT 1,
    -- Розширення з фази 3.5
    is_own_shop          INTEGER DEFAULT 0,
    print_invoice        INTEGER DEFAULT 1,
    receiver_name        TEXT,
    delivery_agent       TEXT,
    delivery_note_number TEXT,
    delivery_note_date   TEXT,
    client_group         TEXT,    -- підгрупа в межах маршруту
    client_kind          TEXT    DEFAULT 'customer',  -- customer | shop | writeoff | ration | underbaked
    -- Telegram bot
    bot_chat_id          TEXT,
    bot_phones           TEXT,
    created_at           TEXT    DEFAULT (datetime('now'))
);

-- Системні singletons (writeoff/ration/underbaked) — рівно один на kind.
-- shop і customer необмежені (можуть бути множинні).
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_singleton_kind
    ON clients(client_kind)
    WHERE client_kind IN ('writeoff', 'ration', 'underbaked');

-- -------------------------------------------------------------
-- АВТОРИЗАЦІЯ
-- -------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE,
    password_hash TEXT    NOT NULL,    -- bcrypt (legacy SHA256 переходно)
    salt          TEXT    NOT NULL,
    full_name     TEXT,
    role          TEXT,                 -- operator | accountant | admin | owner | seller
    is_active     INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS user_sessions (
    token        TEXT    PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users(id),
    created_at   TEXT,
    last_used_at TEXT     -- для timeout сесій (30 днів)
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
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id            INTEGER NOT NULL REFERENCES clients(id),
    product_id           INTEGER NOT NULL REFERENCES products(id),
    qty                  REAL    NOT NULL DEFAULT 0,
    delivered_qty        REAL,                       -- фактично передана кількість
    parent_order_id      INTEGER REFERENCES orders(id),  -- split-логіка (дочірні переміщення)
    order_date           TEXT    NOT NULL,
    source               TEXT    DEFAULT 'phone'  CHECK(source IN ('phone','paper','bot')),
    -- Обмін
    exchange_type        TEXT    DEFAULT 'none'   CHECK(exchange_type IN ('none','pre_order','post_delivery')),
    exchange_qty         REAL    DEFAULT 0,
    exchange_price       REAL,
    exchange_notes       TEXT,
    -- Переміщення з випічки/іншого замовлення
    origin_id            INTEGER,  -- 0 = надлишок з випічки; >0 = id оригіналу
    -- Bot-інтеграція
    bot_status           TEXT,     -- pending | confirmed | rejected | modified
    bot_rejection_reason TEXT,
    bot_original_qty     REAL,     -- qty до зміни оператором
    placed_by_chat_id    TEXT,     -- хто подав замовлення
    -- Ціна і нотатки
    price_override       REAL,
    notes                TEXT,
    created_at           TEXT    DEFAULT (datetime('now')),
    created_by           TEXT
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

-- -------------------------------------------------------------
-- НАКЛАДНІ
-- -------------------------------------------------------------

CREATE TABLE IF NOT EXISTS invoices (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_number    TEXT    NOT NULL UNIQUE,
    invoice_date      TEXT    NOT NULL,
    route_id          INTEGER REFERENCES routes(id),
    client_id         INTEGER NOT NULL REFERENCES clients(id),
    status            TEXT    DEFAULT 'draft'
                              CHECK(status IN ('draft','sent','processing','accepted','cancelled')),
    corrective_for_id INTEGER REFERENCES invoices(id),
    total_sum         REAL    DEFAULT 0,
    notes             TEXT,
    created_at        TEXT    DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invoice_lines (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id     INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    product_id     INTEGER NOT NULL REFERENCES products(id),
    qty            REAL    NOT NULL,
    price          REAL    NOT NULL,
    price_override REAL,
    line_kind      TEXT    DEFAULT 'normal',  -- normal | exchange | stale | surplus
    sum            REAL    NOT NULL
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

CREATE TABLE IF NOT EXISTS shop_reconciliations (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    shop_client_id  INTEGER NOT NULL REFERENCES clients(id),
    period_from     TEXT    NOT NULL,
    period_to       TEXT    NOT NULL,
    cash_expected   REAL    DEFAULT 0,
    cash_actual     REAL,
    cash_diff       REAL,
    notes           TEXT,
    closed          INTEGER DEFAULT 0,
    closed_at       TEXT,
    closed_by       TEXT,
    created_at      TEXT    DEFAULT (datetime('now')),
    rec_type        TEXT    DEFAULT 'regular'  -- regular | opening | archive
);

-- batch_date — кожне надходження різного дня = окремий рядок;
-- NULL = залишок з попередньої звірки. Уніквальність забезпечується
-- partial indexes нижче (а не table-level UNIQUE).
CREATE TABLE IF NOT EXISTS shop_reconciliation_lines (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    reconciliation_id INTEGER NOT NULL REFERENCES shop_reconciliations(id) ON DELETE CASCADE,
    product_id        INTEGER NOT NULL REFERENCES products(id),
    batch_date        TEXT,
    opening_balance   REAL    DEFAULT 0,
    received          REAL    DEFAULT 0,
    entered_balance   REAL,
    written_off       REAL    DEFAULT 0,
    calculated_sold   REAL,
    price             REAL,
    expected_cash     REAL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_recline_opening
    ON shop_reconciliation_lines(reconciliation_id, product_id)
    WHERE batch_date IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_recline_batch
    ON shop_reconciliation_lines(reconciliation_id, product_id, batch_date)
    WHERE batch_date IS NOT NULL;

CREATE TABLE IF NOT EXISTS shop_disposal_lines (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    reconciliation_line_id INTEGER NOT NULL REFERENCES shop_reconciliation_lines(id) ON DELETE CASCADE,
    disposal_type          TEXT    NOT NULL CHECK(disposal_type IN ('writeoff','ration','client','sale')),
    client_id              INTEGER REFERENCES clients(id),
    qty                    REAL    NOT NULL,
    price                  REAL,    -- ціна продажу (для disposal_type='sale')
    notes                  TEXT,
    created_at             TEXT    DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS shop_receipts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    shop_client_id  INTEGER NOT NULL REFERENCES clients(id),
    receipt_date    TEXT    NOT NULL,
    product_id      INTEGER NOT NULL REFERENCES products(id),
    qty             REAL    NOT NULL,
    purchase_price  REAL    DEFAULT 0,
    notes           TEXT,
    created_at      TEXT    DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS shop_sales (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    shop_client_id INTEGER NOT NULL REFERENCES clients(id),
    sale_date      TEXT    NOT NULL,
    product_id     INTEGER NOT NULL REFERENCES products(id),
    qty            REAL    NOT NULL,
    price          REAL    NOT NULL,
    amount         REAL    NOT NULL,
    session_id     TEXT,    -- один чек = масив рядків
    batch_date     TEXT,    -- з якої партії
    notes          TEXT,
    created_at     TEXT,
    created_by     TEXT
);

-- -------------------------------------------------------------
-- ФІНАНСИ
-- -------------------------------------------------------------

CREATE TABLE IF NOT EXISTS finance_articles (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT    NOT NULL,
    direction    TEXT    NOT NULL CHECK(direction IN ('income','expense')),
    is_system    INTEGER DEFAULT 0,
    needs_client INTEGER DEFAULT 0  -- "Клієнтська" — операція потребує прив'язку
);

-- Системні статті унікальні за (name, direction); користувацькі без обмежень.
CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_articles_system_unique
    ON finance_articles(name, direction)
    WHERE is_system = 1;

CREATE TABLE IF NOT EXISTS finances (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    finance_date TEXT    NOT NULL,
    client_id    INTEGER REFERENCES clients(id),
    finance_type TEXT    NOT NULL,
    article_id   INTEGER REFERENCES finance_articles(id),
    amount       REAL    NOT NULL,
    sign         INTEGER NOT NULL CHECK(sign IN (1,-1)),
    notes        TEXT,
    created_at   TEXT    DEFAULT (datetime('now')),
    created_by   TEXT
);

-- -------------------------------------------------------------
-- TELEGRAM BOT
-- -------------------------------------------------------------

CREATE TABLE IF NOT EXISTS client_bot_users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id     INTEGER NOT NULL REFERENCES clients(id),
    chat_id       TEXT    NOT NULL UNIQUE,
    phone         TEXT,
    first_name    TEXT,
    authorized_at TEXT,
    is_active     INTEGER DEFAULT 1
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

-- -------------------------------------------------------------
-- ІНДЕКСИ ШВИДКОДІЇ (з міграцій 022, 026)
-- -------------------------------------------------------------

-- orders
CREATE INDEX IF NOT EXISTS idx_orders_date          ON orders(order_date);
CREATE INDEX IF NOT EXISTS idx_orders_client_date   ON orders(client_id, order_date);
CREATE INDEX IF NOT EXISTS idx_orders_product       ON orders(product_id, order_date);
CREATE INDEX IF NOT EXISTS idx_orders_parent        ON orders(parent_order_id);

-- prices
CREATE INDEX IF NOT EXISTS idx_prices_product       ON prices(product_id, valid_from DESC);
CREATE INDEX IF NOT EXISTS idx_client_prices        ON client_price_overrides(client_id, product_id, valid_from DESC);

-- finances
CREATE INDEX IF NOT EXISTS idx_finances_date        ON finances(finance_date);
CREATE INDEX IF NOT EXISTS idx_finances_client      ON finances(client_id, finance_date);
CREATE INDEX IF NOT EXISTS idx_finances_article     ON finances(article_id, finance_date);

-- invoices
CREATE INDEX IF NOT EXISTS idx_invoices_date_client ON invoices(invoice_date, client_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status      ON invoices(status, invoice_date);

-- baking
CREATE INDEX IF NOT EXISTS idx_baking_date          ON baking_tasks(task_date);

-- shop
CREATE INDEX IF NOT EXISTS idx_shop_sales_shop_date ON shop_sales(shop_client_id, sale_date);
CREATE INDEX IF NOT EXISTS idx_shop_sales_product   ON shop_sales(product_id, batch_date);
CREATE INDEX IF NOT EXISTS idx_shop_recon_shop_period ON shop_reconciliations(shop_client_id, period_to DESC);
CREATE INDEX IF NOT EXISTS idx_shop_recon_open      ON shop_reconciliations(shop_client_id, closed);
CREATE INDEX IF NOT EXISTS idx_shop_recon_lines_rec ON shop_reconciliation_lines(reconciliation_id);
CREATE INDEX IF NOT EXISTS idx_shop_receipts        ON shop_receipts(shop_client_id, receipt_date);
CREATE INDEX IF NOT EXISTS idx_shop_disposal_line   ON shop_disposal_lines(reconciliation_line_id);

-- movements
CREATE INDEX IF NOT EXISTS idx_movements_date_product ON movements(move_date, product_id);

-- -------------------------------------------------------------
-- SEED: налаштування за замовчуванням
-- -------------------------------------------------------------

INSERT OR IGNORE INTO settings (key, value, description) VALUES
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
    ('copy_order_days',       '14',             'Кількість днів для функції копіювати з дати'),
    ('baking_route_reserve',  '0',              'Резерв для маршруту у розподілі надлишків (0/1, функція в розробці)'),
    ('backup_enabled',        '1',             'Автобекап увімкнений (0/1)'),
    ('backup_time',           '02:00',         'Час щоденного бекапу (HH:MM)'),
    ('backup_keep_count',     '7',             'Кількість локальних бекапів'),
    ('backup_max_disk_mb',    '0',             'Макс. сумарний розмір бекапів у MB (0 = без обмеження)'),
    ('backup_local_dir',      '',              'Папка бекапів (порожньо = backups/ поряд з bakery.db)'),
    ('backup_cloud_1_label',  '',              'Хмара 1: назва (напр. Google Drive)'),
    ('backup_cloud_1_path',   '',              'Хмара 1: шлях до папки синхронізації'),
    ('backup_cloud_2_label',  '',              'Хмара 2: назва'),
    ('backup_cloud_2_path',   '',              'Хмара 2: шлях до папки синхронізації'),
    ('backup_cloud_3_label',  '',              'Хмара 3: назва'),
    ('backup_cloud_3_path',   '',              'Хмара 3: шлях до папки синхронізації');

-- -------------------------------------------------------------
-- SEED: базові одиниці виміру і категорії
-- -------------------------------------------------------------

INSERT OR IGNORE INTO units(name) VALUES ('кг'), ('шт'), ('буханка'), ('л');

INSERT OR IGNORE INTO categories(name, is_baked) VALUES
    ('Хліб', 1),
    ('Булки', 1),
    ('Магазин', 0),
    ('Інше', 0);
