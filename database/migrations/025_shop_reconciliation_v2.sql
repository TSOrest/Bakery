-- batch_date для POS-продажів (яка партія продана)
ALTER TABLE shop_sales ADD COLUMN batch_date TEXT;

-- ціна при списанні / продажу за зниженою ціною
ALTER TABLE shop_disposal_lines ADD COLUMN price REAL;
