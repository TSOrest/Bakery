-- Осиротілі/непов'язані борги накладних (finance_type='invoice') з імпорту.
--
-- create_invoice_finance_entry()/recompute_invoice_finance()
-- (backend/services/finance.py) визначають "чи вже є борговий запис для
-- цієї накладної" звірянням Finance.notes == Invoice.invoice_number. Для
-- 99.7% імпортованих зі старої бази накладних notes містить вільний текст
-- ("внесення початкового боргу", "борг банк" тощо) замість номера
-- накладної — лише 0.3% (створені самим застосунком) справді збігаються.
--
-- Наслідок: будь-яка корекція вже прийнятої імпортованої накладної
-- (POST /invoices/{id}/transfer, PUT /invoices/{id}/lines) не знаходила
-- існуючий борговий запис і мовчки створювала ДРУГИЙ — борг клієнта
-- подвоювався без жодної помітної помилки.
--
-- Виправляємо задньим числом: де для (client_id, finance_date) існує
-- РІВНО ОДНА накладна з тим самим invoice_date — notes переписується на
-- її invoice_number. Це та сама природна відповідність, за якою й сам
-- імпорт групував замовлення в накладні (client_id + дата) — не довільна
-- вгадана евристика. Неоднозначні випадки (0 або 2+ накладних клієнта на
-- ту саму дату) свідомо НЕ чіпаємо — краще лишити як є, ніж вгадати
-- неправильно. Код (backend/services/finance.py, _find_invoice_finance_entry)
-- має той самий fallback як додатковий захист для решти.

UPDATE finances
SET notes = (
    SELECT i.invoice_number FROM invoices i
    WHERE i.client_id = finances.client_id AND i.invoice_date = finances.finance_date
)
WHERE finance_type = 'invoice'
  AND notes NOT IN (SELECT invoice_number FROM invoices)
  AND (
      SELECT COUNT(*) FROM invoices i2
      WHERE i2.client_id = finances.client_id AND i2.invoice_date = finances.finance_date
  ) = 1;
