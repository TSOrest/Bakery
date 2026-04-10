-- Наводимо лад зі статтями фінансових операцій.
-- Видаляємо всі порожні статті (без прив'язаних записів у finances).
-- Залишаємо тільки id=1 (Накладна) і id=2 (Оплата) — вони мають реальні дані.
-- Після цього створюємо повний канонічний набір.

DELETE FROM finance_articles
WHERE id NOT IN (SELECT DISTINCT article_id FROM finances WHERE article_id IS NOT NULL)
  AND id NOT IN (1, 2);

-- Гарантуємо правильні назви основних статтей
UPDATE finance_articles SET name = 'Накладна',  direction = 'expense', is_system = 1 WHERE id = 1;
UPDATE finance_articles SET name = 'Оплата',    direction = 'income',  is_system = 1 WHERE id = 2;

-- Додаємо відсутні системні статті (INSERT OR IGNORE — безпечний повтор)
INSERT OR IGNORE INTO finance_articles (name, direction, is_system) SELECT 'Списання боргу',    'expense', 1 WHERE NOT EXISTS (SELECT 1 FROM finance_articles WHERE name = 'Списання боргу');
INSERT OR IGNORE INTO finance_articles (name, direction, is_system) SELECT 'Кредит обміну',     'expense', 1 WHERE NOT EXISTS (SELECT 1 FROM finance_articles WHERE name = 'Кредит обміну');
INSERT OR IGNORE INTO finance_articles (name, direction, is_system) SELECT 'Внесення в касу',   'income',  1 WHERE NOT EXISTS (SELECT 1 FROM finance_articles WHERE name = 'Внесення в касу');
INSERT OR IGNORE INTO finance_articles (name, direction, is_system) SELECT 'Готівка водія',     'income',  1 WHERE NOT EXISTS (SELECT 1 FROM finance_articles WHERE name = 'Готівка водія');
INSERT OR IGNORE INTO finance_articles (name, direction, is_system) SELECT 'Виручка магазину',  'income',  1 WHERE NOT EXISTS (SELECT 1 FROM finance_articles WHERE name = 'Виручка магазину');
INSERT OR IGNORE INTO finance_articles (name, direction, is_system) SELECT 'Оплата з каси',     'expense', 1 WHERE NOT EXISTS (SELECT 1 FROM finance_articles WHERE name = 'Оплата з каси');
INSERT OR IGNORE INTO finance_articles (name, direction, is_system) SELECT 'Виведення з каси',  'expense', 1 WHERE NOT EXISTS (SELECT 1 FROM finance_articles WHERE name = 'Виведення з каси');
INSERT OR IGNORE INTO finance_articles (name, direction, is_system) SELECT 'Списання магазину', 'expense', 1 WHERE NOT EXISTS (SELECT 1 FROM finance_articles WHERE name = 'Списання магазину');
INSERT OR IGNORE INTO finance_articles (name, direction, is_system) SELECT 'Початковий баланс', 'income',  1 WHERE NOT EXISTS (SELECT 1 FROM finance_articles WHERE name = 'Початковий баланс');
