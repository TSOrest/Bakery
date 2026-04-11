-- Міграція 022: індекси для оптимізації швидкодії
-- Застосовується автоматично при наступному запуску сервера

-- orders: фільтрація по даті, клієнту, продукту — в усіх роутерах
CREATE INDEX IF NOT EXISTS idx_orders_date        ON orders(order_date);
CREATE INDEX IF NOT EXISTS idx_orders_client_date ON orders(client_id, order_date);
CREATE INDEX IF NOT EXISTS idx_orders_product     ON orders(product_id, order_date);
CREATE INDEX IF NOT EXISTS idx_orders_parent      ON orders(parent_order_id);

-- prices: get_price() робить full scan на кожен виклик
CREATE INDEX IF NOT EXISTS idx_prices_product     ON prices(product_id, valid_from DESC);

-- client_price_overrides: пріоритет цін — пошук по клієнту + продукту
CREATE INDEX IF NOT EXISTS idx_client_prices      ON client_price_overrides(client_id, product_id, valid_from DESC);

-- finances: dashboard, balances, journal — фільтрація по даті і клієнту
CREATE INDEX IF NOT EXISTS idx_finances_date      ON finances(finance_date);
CREATE INDEX IF NOT EXISTS idx_finances_client    ON finances(client_id, finance_date);

-- invoices: locked-clients endpoint, статус + дата
CREATE INDEX IF NOT EXISTS idx_invoices_date_client ON invoices(invoice_date, client_id);

-- baking_tasks: запити по даті завдань
CREATE INDEX IF NOT EXISTS idx_baking_date        ON baking_tasks(task_date);
