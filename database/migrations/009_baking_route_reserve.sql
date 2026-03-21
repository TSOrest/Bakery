-- Міграція 009: налаштування резерву для маршруту у розподілі надлишків
INSERT OR IGNORE INTO settings (key, value, description)
VALUES ('baking_route_reserve', '0', 'Резерв для маршруту у розподілі надлишків (0/1, функція в розробці)');
