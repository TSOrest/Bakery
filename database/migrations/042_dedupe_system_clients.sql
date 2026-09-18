-- Дублікати системних клієнтів (Списання/Пайок/Недопечено).
--
-- Причина: захисний унікальний індекс idx_clients_singleton_kind (міграція
-- 030) не міг створитись, якщо на момент її запуску дублі вже існували —
-- run_migrations() ловить помилку по кожному statement і все одно позначає
-- міграцію "застосованою" (щоб не повторювати щозапуску), тож індекс
-- фактично ніколи не з'явився. Заразом форма "Системні клієнти"
-- (SystemClientsTab.tsx) дозволяла обрати тип, який уже зайнятий іншим
-- активним клієнтом — так дублі й накопичувались (виправлено окремо в UI).
--
-- Ця міграція: (1) переносить усі посилання (orders/invoices/finances/
-- shop_disposal_lines/client_bot_users/client_price_overrides/movements)
-- з дублів на канонічного (найменший id) клієнта того ж типу, (2) видаляє
-- дублі, (3) відновлює захисний індекс. Ідемпотентна — якщо дублів немає,
-- UPDATE/DELETE не змінюють нічого.

UPDATE orders SET client_id = (
    SELECT MIN(c2.id) FROM clients c2
    WHERE c2.client_kind = (SELECT c1.client_kind FROM clients c1 WHERE c1.id = orders.client_id)
)
WHERE client_id IN (
    SELECT id FROM clients WHERE client_kind IN ('writeoff', 'ration', 'underbaked')
    AND id NOT IN (SELECT MIN(id) FROM clients WHERE client_kind IN ('writeoff', 'ration', 'underbaked') GROUP BY client_kind)
);

UPDATE invoices SET client_id = (
    SELECT MIN(c2.id) FROM clients c2
    WHERE c2.client_kind = (SELECT c1.client_kind FROM clients c1 WHERE c1.id = invoices.client_id)
)
WHERE client_id IN (
    SELECT id FROM clients WHERE client_kind IN ('writeoff', 'ration', 'underbaked')
    AND id NOT IN (SELECT MIN(id) FROM clients WHERE client_kind IN ('writeoff', 'ration', 'underbaked') GROUP BY client_kind)
);

UPDATE finances SET client_id = (
    SELECT MIN(c2.id) FROM clients c2
    WHERE c2.client_kind = (SELECT c1.client_kind FROM clients c1 WHERE c1.id = finances.client_id)
)
WHERE client_id IN (
    SELECT id FROM clients WHERE client_kind IN ('writeoff', 'ration', 'underbaked')
    AND id NOT IN (SELECT MIN(id) FROM clients WHERE client_kind IN ('writeoff', 'ration', 'underbaked') GROUP BY client_kind)
);

UPDATE shop_disposal_lines SET client_id = (
    SELECT MIN(c2.id) FROM clients c2
    WHERE c2.client_kind = (SELECT c1.client_kind FROM clients c1 WHERE c1.id = shop_disposal_lines.client_id)
)
WHERE client_id IN (
    SELECT id FROM clients WHERE client_kind IN ('writeoff', 'ration', 'underbaked')
    AND id NOT IN (SELECT MIN(id) FROM clients WHERE client_kind IN ('writeoff', 'ration', 'underbaked') GROUP BY client_kind)
);

UPDATE client_bot_users SET client_id = (
    SELECT MIN(c2.id) FROM clients c2
    WHERE c2.client_kind = (SELECT c1.client_kind FROM clients c1 WHERE c1.id = client_bot_users.client_id)
)
WHERE client_id IN (
    SELECT id FROM clients WHERE client_kind IN ('writeoff', 'ration', 'underbaked')
    AND id NOT IN (SELECT MIN(id) FROM clients WHERE client_kind IN ('writeoff', 'ration', 'underbaked') GROUP BY client_kind)
);

UPDATE client_price_overrides SET client_id = (
    SELECT MIN(c2.id) FROM clients c2
    WHERE c2.client_kind = (SELECT c1.client_kind FROM clients c1 WHERE c1.id = client_price_overrides.client_id)
)
WHERE client_id IN (
    SELECT id FROM clients WHERE client_kind IN ('writeoff', 'ration', 'underbaked')
    AND id NOT IN (SELECT MIN(id) FROM clients WHERE client_kind IN ('writeoff', 'ration', 'underbaked') GROUP BY client_kind)
);

UPDATE movements SET client_id = (
    SELECT MIN(c2.id) FROM clients c2
    WHERE c2.client_kind = (SELECT c1.client_kind FROM clients c1 WHERE c1.id = movements.client_id)
)
WHERE client_id IN (
    SELECT id FROM clients WHERE client_kind IN ('writeoff', 'ration', 'underbaked')
    AND id NOT IN (SELECT MIN(id) FROM clients WHERE client_kind IN ('writeoff', 'ration', 'underbaked') GROUP BY client_kind)
);

DELETE FROM clients
WHERE client_kind IN ('writeoff', 'ration', 'underbaked')
AND id NOT IN (
    SELECT MIN(id) FROM clients WHERE client_kind IN ('writeoff', 'ration', 'underbaked') GROUP BY client_kind
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_singleton_kind
    ON clients(client_kind)
    WHERE client_kind IN ('writeoff', 'ration', 'underbaked');
