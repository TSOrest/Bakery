-- Міграція 012: Нова схема магазину — звірки з гнучкими періодами, каса, надходження ззовні
-- Замінює щоденну shop_counts-логіку на shop_reconciliations (period_from/period_to)
-- Старі таблиці (shop_counts, other_products, other_stock_in) зберігаються для сумісності

BEGIN TRANSACTION;

-- Ціна закупівлі для виробів (для товарів, що купуються ззовні для магазину)
ALTER TABLE products ADD COLUMN purchase_price REAL DEFAULT 0;

-- Звірки магазину (гнучкий період: денна, тижнева, місячна)
CREATE TABLE IF NOT EXISTS shop_reconciliations (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    shop_client_id  INTEGER NOT NULL REFERENCES clients(id),
    period_from     TEXT    NOT NULL,   -- 'YYYY-MM-DD'
    period_to       TEXT    NOT NULL,   -- 'YYYY-MM-DD'
    cash_expected   REAL    DEFAULT 0,  -- авто: сума (sold * price)
    cash_actual     REAL,               -- введено оператором
    cash_diff       REAL,               -- cash_actual - cash_expected
    notes           TEXT,
    closed          INTEGER DEFAULT 0,  -- 1 = підтверджено, редагування заблоковано
    closed_at       TEXT,
    closed_by       TEXT,
    created_at      TEXT    DEFAULT (datetime('now'))
);

-- Рядки звірки (один виріб = один рядок)
CREATE TABLE IF NOT EXISTS shop_reconciliation_lines (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    reconciliation_id INTEGER NOT NULL REFERENCES shop_reconciliations(id) ON DELETE CASCADE,
    product_id        INTEGER NOT NULL REFERENCES products(id),
    opening_balance   REAL    DEFAULT 0,  -- залишок на початок (з попередньої звірки)
    received          REAL    DEFAULT 0,  -- авто: надходження за період
    entered_balance   REAL,               -- введено оператором (фактичний залишок)
    written_off       REAL    DEFAULT 0,  -- списано (введено оператором)
    calculated_sold   REAL,               -- авто: opening + received - entered - written_off
    price             REAL,               -- ціна продажу
    expected_cash     REAL,               -- авто: calculated_sold * price
    UNIQUE(reconciliation_id, product_id)
);

-- Надходження товарів ззовні (для магазину: куплені на стороні, не з власного виробництва)
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

COMMIT;
