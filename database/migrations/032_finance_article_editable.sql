-- Міграція 032: прапор editable у finance_articles
-- Дозволяє редагувати суму у фінансовому записі поточного дня,
-- якщо стаття має editable=1. Замість DELETE — PATCH amount/notes.

ALTER TABLE finance_articles ADD COLUMN editable INTEGER DEFAULT 0;

-- Default editable=1 для типових income/expense касових і клієнтських статей.
-- Системні автоматичні (Накладна) — лишаються editable=0 щоб не ламати облік.
UPDATE finance_articles
   SET editable = 1
 WHERE name IN (
       'Оплата',
       'Внесення в касу',
       'Виплата з каси',
       'Готівка водія',
       'Списання'
   );
