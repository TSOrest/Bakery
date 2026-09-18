-- Осиротілі рядки invoice_transfers.
--
-- POST /settings/reset-db ("Скидання бази даних") видаляв invoices (для
-- повторного .accdb-імпорту з чистого стану), але не видаляв invoice_transfers
-- — таблицю переміщень товару між накладними (з'явилась пізніше, у v1.2.0,
-- і reset-db не оновили під неї). Після скидання+повторного імпорту нові
-- invoices отримують нові id — старі invoice_transfers лишаються назавжди
-- "осиротілими" (посилаються на invoices, яких вже нема). Дані таких рядків
-- непридатні для відновлення (немає способу дізнатись, якій НОВІЙ накладній
-- відповідав старий id) — єдиний коректний крок це видалити їх. Вони й так
-- не впливають на активну роботу (усі читання transfers/*, transfers-by-date
-- вже стійкі до відсутньої накладної — повертають порожньо), лише
-- захаращують таблицю. Виправлено паралельно (backend/routers/settings.py):
-- reset-db тепер теж видаляє invoice_transfers, тож ця ситуація більше не
-- повториться.

DELETE FROM invoice_transfers
WHERE source_invoice_id NOT IN (SELECT id FROM invoices)
   OR target_invoice_id NOT IN (SELECT id FROM invoices);
