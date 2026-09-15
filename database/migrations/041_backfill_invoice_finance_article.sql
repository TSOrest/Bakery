-- Міграція 041: заповнення article_id для боргових записів накладної.
--
-- create_invoice_finance_entry() (backend/services/finance.py) ніколи не
-- встановлював article_id — лише finance_type='invoice'. Через це Денний
-- звіт (_dr_section3/_is_invoice_entry, backend/routers/print_views.py, що
-- звіряється саме з article_id, а не з finance_type — бо в імпортованих
-- даних касові статті 'Оплата з каси'/'Виведення з каси' помилково мають
-- finance_type='invoice') не розпізнавав ці записи як борг накладної і
-- помилково враховував їх суму як рух готівки в "Залишок в касі" —
-- подвійний облік боргу клієнтів, що робив залишок штучно (аж до
-- від'ємних значень) заниженим.
--
-- Записи створені імпортом .accdb вже мають правильний article_id
-- (import_accdb.py коректно мапить їх на статтю 'Накладна') — WHERE
-- article_id IS NULL зачіпає лише "живі" записи, створені застосунком.

UPDATE finances
   SET article_id = (SELECT id FROM finance_articles WHERE name = 'Накладна' LIMIT 1)
 WHERE finance_type = 'invoice'
   AND article_id IS NULL
   AND EXISTS (SELECT 1 FROM finance_articles WHERE name = 'Накладна');
