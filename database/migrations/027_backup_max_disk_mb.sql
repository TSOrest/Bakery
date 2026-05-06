-- Міграція 027: налаштування ротації бекапів за розміром (N4 з аудиту)
-- 0 = без обмеження (default — зворотна сумісність)
INSERT OR IGNORE INTO settings (key, value, description)
VALUES ('backup_max_disk_mb', '0', 'Макс. сумарний розмір бекапів у MB (0 = без обмеження)');
