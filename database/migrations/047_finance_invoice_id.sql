-- Прив'язка боргового запису фінансів до накладної через справжній
-- зовнішній ключ (invoice_id) замість пошуку за notes/(client_id,date)
-- (_find_invoice_finance_entry, backend/services/finance.py). Пропозиція
-- з QA-аудиту — усуває корінь Критичної знахідки №3 (дублювання боргу
-- при корекції імпортованих накладних), а не лише евристично обходить її.
--
-- Backfill: покриває записи, чий notes вже коректно дорівнює
-- invoice_number (після міграції 045 це майже всі однозначні історичні
-- випадки, і всі створені самим застосунком з початку). Записи без
-- відповідності лишаються з invoice_id=NULL — код і далі має notes/дата
-- fallback для решти (_find_invoice_finance_entry).
ALTER TABLE finances ADD COLUMN invoice_id INTEGER REFERENCES invoices(id);

UPDATE finances
SET invoice_id = (
    SELECT i.id FROM invoices i
    WHERE i.invoice_number = finances.notes AND i.client_id = finances.client_id
)
WHERE finance_type = 'invoice'
  AND invoice_id IS NULL
  AND notes IN (SELECT invoice_number FROM invoices);
