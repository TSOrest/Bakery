-- Міграція 036: уніфікація типу рядка накладної в одне поле line_kind.
-- Замість двох boolean is_exchange / is_stale (взаємовиключні) — line_kind:
--   'normal' | 'exchange' | 'stale' | 'surplus'.
-- 'surplus' — надлишок випічки, долитий прямо в накладну магазину (замість Order origin_id=0).
-- УВАГА: стосується ЛИШЕ invoice_lines. is_stale у movements/daily_balances — інший концепт,
-- не чіпається.

ALTER TABLE invoice_lines ADD COLUMN line_kind TEXT DEFAULT 'normal';

UPDATE invoice_lines SET line_kind = 'exchange' WHERE is_exchange = 1;
UPDATE invoice_lines SET line_kind = 'stale'    WHERE is_stale = 1 AND COALESCE(is_exchange, 0) = 0;

ALTER TABLE invoice_lines DROP COLUMN is_exchange;
ALTER TABLE invoice_lines DROP COLUMN is_stale;
