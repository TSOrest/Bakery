-- Додаємо batch_date до shop_reconciliation_lines:
-- кожне надходження різної дати → окремий рядок у звірці
-- (для ідентифікації котру партію продано/списано)

PRAGMA foreign_keys = OFF;
BEGIN TRANSACTION;

-- Нова таблиця з batch_date (без UNIQUE-constraint — замінюємо на partial indexes нижче)
CREATE TABLE shop_reconciliation_lines_v2 (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    reconciliation_id INTEGER NOT NULL REFERENCES shop_reconciliations(id) ON DELETE CASCADE,
    product_id        INTEGER NOT NULL REFERENCES products(id),
    batch_date        TEXT,    -- дата надходження/випічки; NULL = залишок з попередньої звірки
    opening_balance   REAL    DEFAULT 0,
    received          REAL    DEFAULT 0,
    entered_balance   REAL,
    written_off       REAL    DEFAULT 0,
    calculated_sold   REAL,
    price             REAL,
    expected_cash     REAL
);

-- Переносимо існуючі дані (всі старі рядки = "залишок", batch_date = NULL)
INSERT INTO shop_reconciliation_lines_v2
    SELECT id, reconciliation_id, product_id, NULL,
           opening_balance, received, entered_balance, written_off,
           calculated_sold, price, expected_cash
    FROM shop_reconciliation_lines;

-- Перестворюємо disposal_lines з правильним FK
CREATE TABLE shop_disposal_lines_v2 (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    reconciliation_line_id INTEGER NOT NULL REFERENCES shop_reconciliation_lines_v2(id) ON DELETE CASCADE,
    disposal_type          TEXT    NOT NULL CHECK(disposal_type IN ('writeoff','ration','client')),
    client_id              INTEGER REFERENCES clients(id),
    qty                    REAL    NOT NULL,
    notes                  TEXT,
    created_at             TEXT    DEFAULT (datetime('now'))
);

INSERT INTO shop_disposal_lines_v2 SELECT * FROM shop_disposal_lines;

DROP TABLE shop_disposal_lines;
DROP TABLE shop_reconciliation_lines;

ALTER TABLE shop_reconciliation_lines_v2 RENAME TO shop_reconciliation_lines;
ALTER TABLE shop_disposal_lines_v2       RENAME TO shop_disposal_lines;

-- Partial unique indexes:
-- тільки один рядок "залишок" (batch_date IS NULL) на (rec, product)
CREATE UNIQUE INDEX idx_recline_opening
    ON shop_reconciliation_lines(reconciliation_id, product_id)
    WHERE batch_date IS NULL;

-- унікальна пара (rec, product, batch_date) серед рядків з batch_date
CREATE UNIQUE INDEX idx_recline_batch
    ON shop_reconciliation_lines(reconciliation_id, product_id, batch_date)
    WHERE batch_date IS NOT NULL;

COMMIT;
PRAGMA foreign_keys = ON;
