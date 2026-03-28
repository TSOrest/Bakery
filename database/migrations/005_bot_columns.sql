-- Міграція 005: додає колонки для Telegram-бота
ALTER TABLE clients ADD COLUMN bot_chat_id TEXT;
ALTER TABLE orders ADD COLUMN bot_status TEXT;           -- pending|confirmed|rejected|modified
ALTER TABLE orders ADD COLUMN bot_rejection_reason TEXT;
