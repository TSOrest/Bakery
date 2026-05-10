-- Виправлення shop_disposal_lines:
--   1) додаємо колонку price (міграція 025 не виконалась — позначена applied, але statement не пройшов)
--   2) виправляємо orphan FK: reconciliation_line_id → shop_reconciliation_lines (а не _v2 з міграції 014)
--   3) розширюємо CHECK: sale як ще один disposal_type (продаж поза POS зі своєю ціною)
--
-- Виконується через перебудову таблиці (SQLite не підтримує ALTER FK).
-- Існуючі дані переносяться з price=NULL для legacy рядків.
--
-- УВАГА: run_migrations() виконує statement-и поодинці через split на крапку з комою,
-- тому BEGIN/COMMIT тут не використовуються. Pragma живе в межах однієї connection.

PRAGMA foreign_keys = OFF;

CREATE TABLE shop_disposal_lines_new (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    reconciliation_line_id INTEGER NOT NULL REFERENCES shop_reconciliation_lines(id) ON DELETE CASCADE,
    disposal_type          TEXT    NOT NULL CHECK(disposal_type IN ('writeoff','ration','client','sale')),
    client_id              INTEGER REFERENCES clients(id),
    qty                    REAL    NOT NULL,
    price                  REAL,
    notes                  TEXT,
    created_at             TEXT    DEFAULT (datetime('now'))
);

INSERT INTO shop_disposal_lines_new
    (id, reconciliation_line_id, disposal_type, client_id, qty, price, notes, created_at)
    SELECT id, reconciliation_line_id, disposal_type, client_id, qty, NULL, notes, created_at
    FROM shop_disposal_lines;

DROP TABLE shop_disposal_lines;

ALTER TABLE shop_disposal_lines_new RENAME TO shop_disposal_lines;

CREATE INDEX IF NOT EXISTS idx_shop_disposal_line ON shop_disposal_lines(reconciliation_line_id);

PRAGMA foreign_keys = ON;
