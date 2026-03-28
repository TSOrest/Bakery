-- Рядки розподілу списань у звірці магазину
-- Замінює пряме введення written_off: тепер кожне списання/пайок/передача клієнту
-- зберігається окремим рядком; written_off = SUM(disposal_lines.qty)

CREATE TABLE IF NOT EXISTS shop_disposal_lines (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    reconciliation_line_id INTEGER NOT NULL REFERENCES shop_reconciliation_lines(id) ON DELETE CASCADE,
    disposal_type          TEXT    NOT NULL CHECK(disposal_type IN ('writeoff','ration','client')),
    client_id              INTEGER REFERENCES clients(id),
    qty                    REAL    NOT NULL,
    notes                  TEXT,
    created_at             TEXT    DEFAULT (datetime('now'))
);
