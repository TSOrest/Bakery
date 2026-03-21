-- Міграція 010: origin_id для orders + системні клієнти writeoff/ration
--
-- origin_id:
--   NULL = звичайне замовлення клієнта
--   0    = надлишок випічки (не з замовлення)
--   X    = переміщення з orders.id = X

ALTER TABLE orders ADD COLUMN origin_id INTEGER;

-- Системні клієнти (INSERT OR IGNORE — безпечно, якщо вже існують)
INSERT OR IGNORE INTO clients (full_name, short_name, client_kind, is_active, created_at)
VALUES
    ('Списання', 'Списання', 'writeoff', 1, datetime('now')),
    ('Пайок',    'Пайок',    'ration',   1, datetime('now'));
