-- Реорганізація фінансових статей:
-- 1. Додаємо поле needs_client (1 = потребує клієнта, 0 = загальна)
-- 2. Зливаємо "Списання магазину" (id=25) у "Списання боргу" (id=18), перейменовуємо у "Списання"
-- 3. Видаляємо "Виручка магазину" (id=22) — замінюється статтею "Оплата" (id=2) для клієнта магазин

ALTER TABLE finance_articles ADD COLUMN needs_client INTEGER DEFAULT 0;

-- Злиття: переводимо записи Списання магазину → Списання боргу
UPDATE finances SET article_id = 18 WHERE article_id = 25;
DELETE FROM finance_articles WHERE id = 25;

-- Перейменовуємо "Списання боргу" → "Списання"
UPDATE finance_articles SET name = 'Списання' WHERE id = 18;

-- Злиття: переводимо записи Виручка магазину → Оплата
UPDATE finances SET article_id = 2 WHERE article_id = 22;
DELETE FROM finance_articles WHERE id = 22;

-- Встановлюємо needs_client для клієнтських статей
UPDATE finance_articles SET needs_client = 1 WHERE id IN (1, 2, 18, 19, 26);
-- id 1=Накладна, 2=Оплата, 18=Списання, 19=Кредит обміну, 26=Початковий баланс

-- Загальні статті (needs_client = 0): 20=Внесення в касу, 21=Готівка водія, 23=Оплата з каси, 24=Виведення з каси
-- (вже 0 за замовчуванням, явно підтверджуємо)
UPDATE finance_articles SET needs_client = 0 WHERE id IN (20, 21, 23, 24);
