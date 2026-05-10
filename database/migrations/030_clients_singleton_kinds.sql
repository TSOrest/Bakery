-- PARTIAL UNIQUE INDEX: системні клієнти-singletons
-- writeoff (Списано), ration (Пайок), underbaked (Недопечене) — мають існувати в єдиному екземплярі.
-- shop НЕ обмежується: архітектура передбачає кілька магазинів-клієнтів.
-- customer теж необмежений (звичайні клієнти).
--
-- Якщо у БД є дублі цих kind — міграція впаде на створенні індексу.
-- Перед застосуванням треба прибрати дублі (див. план чистки 121, 122).

CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_singleton_kind
    ON clients(client_kind)
    WHERE client_kind IN ('writeoff', 'ration', 'underbaked');
