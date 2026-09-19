-- Система сповіщень у програмі (дзвоник у Layout.tsx) — пропозиція з
-- QA-аудиту, розширена користувачем: тост зі звуком + історія +
-- керування встановленням оновлень із попередженням активних сесій.
-- Однакові сповіщення для всіх ролей (без audience-фільтра).
CREATE TABLE IF NOT EXISTS notifications (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    type       TEXT NOT NULL,   -- bot_order | new_version | import_done | backup_done | update_warning
    title      TEXT NOT NULL,
    body       TEXT,
    meta       TEXT,            -- JSON, напр. {"version": "v1.6.0", "changelog": "..."}
    created_at TEXT NOT NULL,
    read_at    TEXT             -- NULL = непрочитане
);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at);
