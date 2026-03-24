-- Міграція 011: Оновлення статусів накладних + додавання corrective_for_id
-- Старі статуси: draft | printed | delivered | cancelled
-- Нові статуси:  draft | sent    | processing | accepted | cancelled
-- printed  → sent
-- delivered → accepted
-- Додається поле corrective_for_id для коригуючих накладних

PRAGMA foreign_keys = OFF;

BEGIN TRANSACTION;

CREATE TABLE invoices_new (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_number    TEXT    NOT NULL UNIQUE,
    invoice_date      TEXT    NOT NULL,
    route_id          INTEGER REFERENCES routes(id),
    client_id         INTEGER NOT NULL REFERENCES clients(id),
    status            TEXT    DEFAULT 'draft'
                              CHECK(status IN ('draft','sent','processing','accepted','cancelled')),
    corrective_for_id INTEGER REFERENCES invoices_new(id),
    total_sum         REAL    DEFAULT 0,
    notes             TEXT,
    created_at        TEXT    DEFAULT (datetime('now'))
);

INSERT INTO invoices_new
    (id, invoice_number, invoice_date, route_id, client_id,
     status, corrective_for_id, total_sum, notes, created_at)
    SELECT
        id, invoice_number, invoice_date, route_id, client_id,
        CASE status
            WHEN 'printed'   THEN 'sent'
            WHEN 'delivered' THEN 'accepted'
            ELSE status
        END,
        NULL,
        total_sum, notes, created_at
    FROM invoices;

DROP TABLE invoices;
ALTER TABLE invoices_new RENAME TO invoices;

COMMIT;

PRAGMA foreign_keys = ON;
