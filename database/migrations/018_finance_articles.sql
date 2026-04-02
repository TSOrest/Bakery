-- Міграція 018: таблиця статей фінансів + article_id у finances

CREATE TABLE IF NOT EXISTS finance_articles (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    name      TEXT    NOT NULL,
    direction TEXT    NOT NULL CHECK(direction IN ('income','expense')),
    is_system INTEGER DEFAULT 0
);

-- Початкові системні статті (вставляємо лише якщо таблиця порожня)
INSERT OR IGNORE INTO finance_articles (id, name, direction, is_system) VALUES
    (1, 'Накладна',        'expense', 1),
    (2, 'Оплата',          'income',  1),
    (3, 'Списання',        'income',  1),
    (4, 'Внесення в касу', 'income',  1),
    (5, 'Готівка водія',   'income',  1),
    (6, 'Кредит обміну',   'expense', 1);

-- Додаємо article_id до finances (безпечно для вже існуючої таблиці)
ALTER TABLE finances ADD COLUMN article_id INTEGER REFERENCES finance_articles(id);
