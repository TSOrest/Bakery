-- Міграція 037: індекси на найгарячіших FK.
--
-- invoice_lines(invoice_id) — таблиця з ON DELETE CASCADE і найчастішим джойном
-- (рядки накладної), досі без індексу по FK: каскадні видалення й вибірки
-- рядків сканували всю таблицю. shop_counts / daily_balances — часті вибірки за
-- датою при звірці й перерахунку балансів.
CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice ON invoice_lines(invoice_id);
CREATE INDEX IF NOT EXISTS idx_shop_counts_date       ON shop_counts(count_date);
CREATE INDEX IF NOT EXISTS idx_daily_balances_date    ON daily_balances(balance_date, product_id);
