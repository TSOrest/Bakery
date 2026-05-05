-- Міграція 026: додаткові індекси для гарячих місць (виявлено аудитом)

-- finances: фільтрація по статті у дашборді (Накладна / Оплата)
CREATE INDEX IF NOT EXISTS idx_finances_article ON finances(article_id, finance_date);

-- invoices: фільтрація по статусу і даті
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status, invoice_date);

-- shop_sales: POS-агрегація по магазину і даті
CREATE INDEX IF NOT EXISTS idx_shop_sales_shop_date ON shop_sales(shop_client_id, sale_date);
CREATE INDEX IF NOT EXISTS idx_shop_sales_product ON shop_sales(product_id, batch_date);

-- shop_reconciliations: пошук поточної відкритої / останньої закритої
CREATE INDEX IF NOT EXISTS idx_shop_recon_shop_period ON shop_reconciliations(shop_client_id, period_to DESC);
CREATE INDEX IF NOT EXISTS idx_shop_recon_open ON shop_reconciliations(shop_client_id, closed);

-- shop_reconciliation_lines: foreign key + product
CREATE INDEX IF NOT EXISTS idx_shop_recon_lines_rec ON shop_reconciliation_lines(reconciliation_id);

-- shop_receipts: магазин + дата надходження
CREATE INDEX IF NOT EXISTS idx_shop_receipts ON shop_receipts(shop_client_id, receipt_date);

-- shop_disposal_lines: каскадне видалення з reconciliation_line
CREATE INDEX IF NOT EXISTS idx_shop_disposal_line ON shop_disposal_lines(reconciliation_line_id);

-- movements: журнал руху товарів
CREATE INDEX IF NOT EXISTS idx_movements_date_product ON movements(move_date, product_id);
