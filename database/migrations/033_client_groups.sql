-- Міграція 033: групи клієнтів у межах маршруту
-- Дозволяє об'єднувати клієнтів одного маршруту у групи (напр. за районом міста
-- або порядком завантаження машини). Використовується для друкованої форми
-- "Сортування" — оператор бачить агрегацію виробів по групах у межах рейсу.

CREATE TABLE IF NOT EXISTS client_groups (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    route_id   INTEGER NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT    DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_client_groups_route ON client_groups(route_id);

-- FK у clients. ON DELETE SET NULL — видалення групи лишає клієнтів без групи.
ALTER TABLE clients ADD COLUMN client_group_id INTEGER
    REFERENCES client_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_clients_client_group ON clients(client_group_id);
