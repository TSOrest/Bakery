-- Міграція 016: шаблон повідомлення при відправці накладної через Telegram
-- Запустити: sqlite3 bakery.db < database/migrations/016_bot_invoice_sent_tpl.sql

INSERT OR IGNORE INTO settings (key, value, description) VALUES
  ('bot_tpl_invoice_sent',
   'Ваше замовлення на {date} відправлено. Ось ваша накладна.',
   'Шаблон повідомлення при надсиланні PDF накладної клієнту (змінні: {date})');
