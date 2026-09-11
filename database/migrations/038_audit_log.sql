-- Аудит-лог змін існуючих записів (тільки UPDATE від користувачів, не CREATE і не системні)
CREATE TABLE IF NOT EXISTS audit_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_table  TEXT NOT NULL,   -- 'finances', 'invoice_lines', 'orders', 'baking_tasks', 'clients'
    entity_id     INTEGER NOT NULL,
    changed_field TEXT NOT NULL,   -- 'amount', 'qty', 'baked_qty', 'discount_pct', ...
    old_value     TEXT,            -- попереднє значення (рядком)
    new_value     TEXT,            -- нове значення
    changed_by    TEXT NOT NULL,   -- username оператора
    changed_at    TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity
    ON audit_log(entity_table, entity_id);
