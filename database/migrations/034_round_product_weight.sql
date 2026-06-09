-- Міграція 034: округлення ваги виробів до 3 знаків (точність 1 г)
-- Виправляє накопичену похибку від імпорту з Access (поле Single зберігало
-- 0.3 як 0.30004515 і подібні). Display-формат у Access це маскував.
-- Для майбутніх імпортів округлення робиться у import_accdb.py.

UPDATE products SET weight = round(weight, 3) WHERE weight IS NOT NULL;
