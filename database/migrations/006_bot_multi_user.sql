-- Міграція 006: підтримка кількох користувачів бота на одного клієнта

-- Дозволені телефони для авторизації (через кому)
ALTER TABLE clients ADD COLUMN bot_phones TEXT;

-- Авторизовані користувачі бота
CREATE TABLE IF NOT EXISTS client_bot_users (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id      INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    chat_id        TEXT    NOT NULL UNIQUE,
    phone          TEXT,
    first_name     TEXT,
    authorized_at  TEXT    DEFAULT (datetime('now')),
    is_active      INTEGER DEFAULT 1
);

-- Хто саме з бота подав замовлення (chat_id конкретного користувача)
ALTER TABLE orders ADD COLUMN placed_by_chat_id TEXT;
