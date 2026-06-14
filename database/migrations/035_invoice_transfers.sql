-- Міграція 035: реєстр переміщень товару між накладними на стадії Маршрутів.
-- Замінює механізм коригуючих накладних: корекція = пряме редагування рядків
-- накладної + запис у цей леджер (для анотацій "куди пішло / звідки прийшло").
--
-- source_invoice_id — накладна звідки списано (qty зменшено)
-- target_invoice_id — накладна куди додано (qty збільшено/створено рядок)
-- Обидві ON DELETE CASCADE — при видаленні/архівації накладної прибираються.

CREATE TABLE IF NOT EXISTS invoice_transfers (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    transfer_date     TEXT    NOT NULL,
    source_invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    target_invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    product_id        INTEGER NOT NULL REFERENCES products(id),
    qty               REAL    NOT NULL,
    notes             TEXT,
    created_at        TEXT    DEFAULT (datetime('now')),
    created_by        TEXT
);

CREATE INDEX IF NOT EXISTS idx_inv_transfers_src ON invoice_transfers(source_invoice_id);
CREATE INDEX IF NOT EXISTS idx_inv_transfers_tgt ON invoice_transfers(target_invoice_id);
