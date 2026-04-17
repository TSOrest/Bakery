-- Тип звірки магазину: 'regular' | 'opening' | 'archive'
ALTER TABLE shop_reconciliations ADD COLUMN rec_type TEXT DEFAULT 'regular';
