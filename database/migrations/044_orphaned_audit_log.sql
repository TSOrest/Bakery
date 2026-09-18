-- Осиротілі записи audit_log після минулих "Скидань бази даних".
--
-- POST /settings/reset-db видаляв orders/invoice_lines/finances/clients
-- (customer), але не audit_log — журнал змін цих же сутностей. entity_id —
-- поліморфне посилання (немає єдиного FK, бо entity_table різна для різних
-- рядків), тож PRAGMA foreign_key_check таких рядків не бачить, але вони
-- вказують на записи, яких вже немає. Видаляємо лише те, що дійсно
-- осиротіло (перевірка по кожній entity_table окремо) — решта історії змін
-- лишається. Виправлено паралельно (backend/routers/settings.py): reset-db
-- тепер очищає audit_log разом з іншими робочими даними.

DELETE FROM audit_log WHERE entity_table = 'orders'        AND entity_id NOT IN (SELECT id FROM orders);
DELETE FROM audit_log WHERE entity_table = 'invoice_lines'  AND entity_id NOT IN (SELECT id FROM invoice_lines);
DELETE FROM audit_log WHERE entity_table = 'finances'       AND entity_id NOT IN (SELECT id FROM finances);
DELETE FROM audit_log WHERE entity_table = 'clients'        AND entity_id NOT IN (SELECT id FROM clients);
