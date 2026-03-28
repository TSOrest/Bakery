-- Міграція 015: таблиця продажів магазину через POS-інтерфейс
CREATE TABLE IF NOT EXISTS shop_sales (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    shop_client_id  INTEGER NOT NULL REFERENCES clients(id),
    sale_date       TEXT NOT NULL,          -- YYYY-MM-DD
    product_id      INTEGER NOT NULL REFERENCES products(id),
    qty             REAL NOT NULL,
    price           REAL NOT NULL,
    amount          REAL NOT NULL,          -- qty * price
    session_id      TEXT,                   -- UUID: об'єднує позиції одного чека
    notes           TEXT,
    created_at      TEXT DEFAULT (datetime('now')),
    created_by      TEXT                    -- username продавця
);

CREATE INDEX IF NOT EXISTS idx_shop_sales_date
    ON shop_sales(shop_client_id, sale_date);

CREATE INDEX IF NOT EXISTS idx_shop_sales_session
    ON shop_sales(session_id);
