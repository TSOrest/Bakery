-- Міграція 004: підтримка клієнтів у Telegram-боті
-- Запустити: sqlite3 bakery.db < database/migrations/004_bot_client_orders.sql

-- Telegram chat ID клієнта (прив'язується після авторизації по телефону)
ALTER TABLE clients ADD COLUMN bot_chat_id TEXT;

-- Статус верифікації замовлення від бота
ALTER TABLE orders ADD COLUMN bot_status TEXT;
-- pending   = подано клієнтом, очікує підтвердження оператора
-- confirmed = підтверджено
-- rejected  = відхилено
-- modified  = підтверджено зі зміною кількості

ALTER TABLE orders ADD COLUMN bot_rejection_reason TEXT;

-- Шаблони повідомлень бота (змінні: {date}, {sum}, {reason})
INSERT OR IGNORE INTO settings (key, value, description) VALUES
  ('bot_tpl_reminder',
   'Нагадування: ви ще не подали замовлення на {date}. Будь ласка, оформіть його через бота.',
   'Шаблон нагадування клієнту про подачу замовлення'),
  ('bot_tpl_deadline',
   'Прийом замовлень через бота на {date} завершено. Для уточнень телефонуйте оператору.',
   'Шаблон повідомлення про закриття прийому замовлень'),
  ('bot_tpl_confirmed',
   '✅ Ваше замовлення на {date} підтверджено.\nСума: {sum} грн.',
   'Шаблон підтвердження замовлення оператором'),
  ('bot_tpl_rejected',
   '❌ Ваше замовлення на {date} відхилено.\nПричина: {reason}',
   'Шаблон відхилення замовлення оператором'),
  ('bot_tpl_modified',
   '✏️ Ваше замовлення на {date} підтверджено зі змінами.\nНова сума: {sum} грн.\nПримітка: {reason}',
   'Шаблон підтвердження зі зміною кількості');
