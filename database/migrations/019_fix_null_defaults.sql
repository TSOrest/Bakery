-- Замінюємо NULL на дефолтні значення для всіх колонок що мають NOT NULL семантику
-- Потрібно для баз даних де колонки були додані через ALTER TABLE без UPDATE існуючих рядків

UPDATE units       SET is_active = 1     WHERE is_active IS NULL;
UPDATE categories  SET is_active = 1     WHERE is_active IS NULL;
UPDATE categories  SET is_baked  = 1     WHERE is_baked  IS NULL;
UPDATE categories  SET reserve_pct = 5.0 WHERE reserve_pct IS NULL;
UPDATE categories  SET sort_order = 0    WHERE sort_order IS NULL;
UPDATE products    SET is_active = 1     WHERE is_active IS NULL;
UPDATE products    SET cost_per_unit = 0 WHERE cost_per_unit IS NULL;
UPDATE products    SET initial_stock = 0 WHERE initial_stock IS NULL;
UPDATE other_products SET is_active = 1        WHERE is_active IS NULL;
UPDATE other_products SET purchase_price = 0   WHERE purchase_price IS NULL;
UPDATE other_products SET sell_price = 0       WHERE sell_price IS NULL;
UPDATE routes      SET is_active = 1     WHERE is_active IS NULL;
UPDATE routes      SET sort_order = 0    WHERE sort_order IS NULL;
UPDATE clients     SET is_active = 1     WHERE is_active IS NULL;
UPDATE clients     SET discount_pct = 0  WHERE discount_pct IS NULL;
UPDATE clients     SET is_own_shop = 0   WHERE is_own_shop IS NULL;
UPDATE clients     SET print_invoice = 1 WHERE print_invoice IS NULL;
