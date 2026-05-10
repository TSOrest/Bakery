-- PARTIAL UNIQUE INDEX: системні фінансові статті унікальні за (name, direction).
-- Користувацькі (is_system=0) лишаються без обмежень — оператор може створити
-- кілька статей з однаковою назвою для різних потреб обліку.
--
-- Імпорт з .accdb міг створити дублі canonical-статей "Внесення в касу",
-- "Готівка водія", "Кредит обміну" — цей індекс блокує повторення.
--
-- Перед застосуванням треба прибрати дублі з is_system=1 (виконано окремо).

CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_articles_system_unique
    ON finance_articles(name, direction)
    WHERE is_system = 1;
