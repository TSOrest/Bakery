-- Виправлення: записи "Списання магазину" від клієнта-магазину були імпортовані
-- з art_id=2 (Оплата) замість art_id=43 (Списання магазину).
-- SQLite LIKE не підтримує Cyrillic case-insensitivity — порівнюємо точно.

UPDATE finances
SET article_id = 43
WHERE sign = 1
  AND article_id = 2
  AND notes IN ('Списання магазину', 'списання', 'Списання')
  AND client_id IN (
    SELECT id FROM clients WHERE client_kind = 'shop'
  );
