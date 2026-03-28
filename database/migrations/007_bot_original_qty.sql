-- Міграція 007: зберігаємо початкову кількість при модифікації бот-замовлення
ALTER TABLE orders ADD COLUMN bot_original_qty REAL;
