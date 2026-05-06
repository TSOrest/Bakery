-- Міграція 028: last_used_at для session timeout (N8 з аудиту)
ALTER TABLE user_sessions ADD COLUMN last_used_at TEXT;
-- Існуючі сесії — позначити як щойно використані щоб не invalidate одразу
UPDATE user_sessions SET last_used_at = datetime('now') WHERE last_used_at IS NULL;
