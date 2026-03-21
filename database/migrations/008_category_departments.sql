-- Міграція 008: Категорії як відділи випічки
-- Видаляємо products.type (enum bread/bun/other) і переносимо логіку в categories.
-- Кожна категорія тепер є відділом: is_baked=1 → печеться, is_baked=0 → лише магазин.
-- reserve_pct замінює settings bun_reserve_pct / bread_reserve_pct (тепер per-category).

-- 1. Нові поля в categories
ALTER TABLE categories ADD COLUMN is_baked  INTEGER NOT NULL DEFAULT 1;
ALTER TABLE categories ADD COLUMN reserve_pct REAL NOT NULL DEFAULT 5.0;
ALTER TABLE categories ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

-- 2. Заповнюємо відомі категорії
UPDATE categories SET is_baked = 1, reserve_pct = 5, sort_order = 1 WHERE name = 'Хліб';
UPDATE categories SET is_baked = 1, reserve_pct = 5, sort_order = 2 WHERE name = 'Булки';
UPDATE categories SET is_baked = 0, reserve_pct = 0, sort_order = 10 WHERE name = 'Магазин';
UPDATE categories SET is_baked = 0, reserve_pct = 0, sort_order = 11 WHERE name = 'Інше';

-- 3. Видаляємо колонку type з products (SQLite 3.35+)
ALTER TABLE products DROP COLUMN type;
