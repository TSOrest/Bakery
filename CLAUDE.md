# Пекарня — Project Context for Claude Code

## Що це за проект
Система управління пекарнею. Замінює застарілу базу Access (.accdb).
Повне ТЗ узгоджено, розробка починається з Фази 1 (MVP).

## Технічний стек
- **Backend:** Python 3.11+ + FastAPI + SQLAlchemy 2.0
- **Database:** SQLite (один файл `bakery.db`)
- **Frontend:** React 18 + Vite + TypeScript (роздається самим FastAPI у продакшні)
- **Друк:** PDF через браузер (weasyprint)
- **Розгортання:** Windows, повністю офлайн, localhost
  - Task Scheduler — автозапуск при вході в систему
  - `tray.py` (pystray + Pillow) — системний трей
  - Оновлення через GitHub API + git tags

## Структура проекту
```
bakery/
├── CLAUDE.md              ← цей файл
├── backend/
│   ├── main.py            ← FastAPI app entry point
│   ├── database.py        ← SQLite connection, session
│   ├── models/            ← SQLAlchemy models
│   ├── routers/           ← API endpoints по модулях
│   ├── schemas/           ← Pydantic schemas
│   ├── services/          ← бізнес-логіка
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── pages/         ← сторінки по вкладках
│   │   ├── components/    ← спільні компоненти
│   │   ├── api/           ← fetch-обгортки
│   │   └── types/         ← TypeScript типи
│   ├── package.json
│   └── vite.config.ts
├── database/
│   ├── schema.sql         ← повна схема SQLite
│   └── migrations/        ← зміни схеми
├── scripts/
│   ├── install-service.ps1  ← реєстрація Task Scheduler задач + firewall
│   ├── update.ps1           ← оновлення через GitHub tag
│   ├── rollback.ps1         ← відкат до попередньої версії
│   ├── run-tray.ps1         ← dev-версія watchdog (prod генерується в ProgramData)
│   └── notify.ps1           ← WinRT toast через PowerShell
├── dev/                     ← dev-інструменти, gitignored, не потрапляють клієнту
│   ├── release.ps1          ← автоматизований реліз на GitHub
│   ├── create-installer.ps1 ← генерує Bakery-Setup.ps1 з вбудованими токенами
│   └── generate_demo_db.py  ← генерація демо-бази даних
└── tests/
    ├── test_api.py
    └── test_services.py
```

## Ролі користувачів
| Роль | Доступ |
|------|--------|
| operator | замовлення, випічка, маршрути, накладні, магазин |
| accountant | фінанси, баланси, перегляд всього |
| admin | довідники, ціни, налаштування, повний доступ |
| owner | read-only дашборд (мобільний через HTTPS) |
| seller | POS-каса (`/pos`, `PosPage.tsx`) — продаж через касовий термінал магазину |

---

## База даних — повна схема SQLite

### Довідники
```sql
-- Одиниці виміру
CREATE TABLE units (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,  -- кг, шт, буханка
    is_active INTEGER DEFAULT 1
);

-- Категорії виробів (динамічний довідник, НЕ фіксований enum — адмін додає
-- свої категорії; класифікація хліб/булка/інше повністю на category_id,
-- окремого поля products.type НЕ існує)
CREATE TABLE categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,       -- напр. Хліб, Булка, Магазин, Інше — довільні
    is_active INTEGER DEFAULT 1,
    is_baked INTEGER DEFAULT 1,      -- 1 = відділ випікає; 0 = лише магазин/інше (не в завданнях випічки)
    reserve_pct REAL DEFAULT 5.0,    -- % резерву для рекомендованої кількості
    sort_order INTEGER DEFAULT 0     -- порядок відображення і друку завдань
);

-- Вироби
CREATE TABLE products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    short_name TEXT,
    weight REAL,
    unit_id INTEGER REFERENCES units(id),
    category_id INTEGER REFERENCES categories(id),
    cost_per_unit REAL DEFAULT 0,    -- розрахункова собівартість
    purchase_price REAL DEFAULT 0,   -- ціна закупівлі (товари ззовні)
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    initial_stock REAL DEFAULT 0     -- початковий залишок (лише перша звірка)
);

-- Компоненти / інгредієнти
CREATE TABLE ingredients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    unit_id INTEGER REFERENCES units(id),
    price_per_unit REAL DEFAULT 0,
    price_updated_at TEXT
);

-- Склад виробу
CREATE TABLE product_ingredients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id),
    ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
    qty_per_unit REAL NOT NULL,
    UNIQUE(product_id, ingredient_id)
);

-- Товари групи ІНШЕ (не власного виробництва)
CREATE TABLE other_products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    unit_id INTEGER REFERENCES units(id),
    purchase_price REAL DEFAULT 0,
    sell_price REAL DEFAULT 0,
    is_active INTEGER DEFAULT 1
);

-- Маршрути
CREATE TABLE routes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1
);

-- Клієнти
CREATE TABLE clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    short_name TEXT,
    address TEXT,
    phone TEXT,
    director TEXT,
    accountant TEXT,
    route_id INTEGER REFERENCES routes(id),
    discount_pct REAL DEFAULT 0,  -- % знижки
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    -- Поля Фази 3.5 (реалізовані)
    is_own_shop INTEGER DEFAULT 0,        -- власний магазин пекарні
    print_invoice INTEGER DEFAULT 1,
    receiver_name TEXT,                   -- ПІБ того хто приймає товар
    delivery_agent TEXT,                  -- "ВідпЧерез"
    delivery_note_number TEXT,
    delivery_note_date TEXT,
    client_group TEXT,                    -- legacy текстова підгрупа (з .accdb імпорту)
    -- v1.1.7: нормалізоване поле — FK на client_groups
    client_group_id INTEGER REFERENCES client_groups(id) ON DELETE SET NULL,
    client_kind TEXT DEFAULT 'customer',  -- customer|shop|writeoff|ration|underbaked
    bot_chat_id TEXT,
    bot_phones TEXT
);

-- Групи клієнтів (v1.1.7) — об'єднання клієнтів у межах маршруту
-- для друку Сортування / Маршрутного / Адресного листів.
CREATE TABLE client_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    route_id INTEGER NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);
-- Cascade: видалення маршруту → видалення груп → клієнти стають "Без групи"
-- (clients.client_group_id = NULL). PUT /clients зі зміною route_id скидає
-- client_group_id якщо група належить іншому маршруту.
```
⚠ Баг (виправлено): `update_client()` (`backend/routers/clients.py`) збирав
патч через `data.model_dump(exclude_none=True)` — це викидало з патча БУДЬ-ЯКЕ
поле зі значенням `null`, незалежно від того, чи оператор навмисно очистив
його (напр. "зняти маршрут" у формі клієнта), чи просто не вказав. Через це
очищення `route_id`/адреси/телефону/директора/бухгалтера тощо через форму
НІКОЛИ не спрацьовувало — значення в базі мовчки лишалось старим, без жодної
помилки. Виправлено на `exclude_unset=True` — коректно розрізняє "поле не
надіслане" (частковий PATCH, напр. кнопка "Відновити" шле лише
`{is_active: 1}`, лишаючи решту полів як є) від "поле надіслане як null"
(форма `ClientsTab.tsx` завжди шле всі поля, тож явний `null` тепер
записується).

### Ціни
```sql
-- Базові ціни (з датами дії)
CREATE TABLE prices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id),
    category_id INTEGER REFERENCES categories(id),  -- NULL = для всіх категорій
    price REAL NOT NULL,
    valid_from TEXT NOT NULL,   -- дата початку дії
    valid_to TEXT,              -- NULL = безстроково
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    created_by TEXT
);

-- Індивідуальні ціни клієнтів
CREATE TABLE client_price_overrides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL REFERENCES clients(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    price REAL NOT NULL,
    valid_from TEXT NOT NULL,
    valid_to TEXT,
    UNIQUE(client_id, product_id, valid_from)
);

-- Ціна несвіжого товару при обміні (per product)
-- зберігається як окремий запис у prices з category_id = 'stale'
-- або як поле в products.stale_price
```

**Пріоритет застосування ціни:**
1. `invoice_lines.price_override` — найвищий пріоритет (брак, акція)
2. `client_price_overrides` — індивідуальна ціна клієнта
3. базова ціна × (1 - clients.discount_pct/100)
4. базова ціна з `prices` за category_id і датою

### Замовлення
```sql
CREATE TABLE orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL REFERENCES clients(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    qty REAL NOT NULL DEFAULT 0,
    order_date TEXT NOT NULL,   -- 'YYYY-MM-DD'
    status TEXT DEFAULT 'draft' CHECK(status IN ('draft','confirmed','closed')),
    source TEXT DEFAULT 'phone' CHECK(source IN ('phone','paper')),
    -- Обмін
    exchange_type TEXT DEFAULT 'none' CHECK(exchange_type IN ('none','pre_order','post_delivery')),
    exchange_qty REAL DEFAULT 0,
    exchange_price REAL,        -- ціна несвіжого товару
    exchange_notes TEXT,        -- нотатка про умови (обов'язкова для post_delivery)
    -- Ціна рядка
    price_override REAL,        -- якщо NULL — береться автоматично
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    created_by TEXT,
    -- Split-логіка (Фаза 3.5) і надлишок/переміщення (v1.2.0+)
    parent_order_id INTEGER REFERENCES orders(id),  -- дочірній рядок (переміщення/повернення)
    delivered_qty REAL,         -- фактично передана кількість (може відрізнятись від qty)
    origin_id INTEGER           -- 0 = надлишок випічки (пайок/списання), N = id батьківського
                                 -- замовлення при /orders/{id}/transfer; NULL = звичайний рядок
    -- + bot-поля (source, bot_status, bot_rejection_reason, bot_original_qty,
    --   placed_by_chat_id) — див. ALTER TABLE нижче в розділі Telegram Bot
);
```
`origin_id` — ключове поле для всієї логіки v1.3.0 "Замовлено/Спечено/Відхилення"
(див. розділ "Реліз v1.3.0" нижче): `0` = пайок/списання (системний клієнт,
без накладної), `N>0` = переміщено від замовлення N, `NULL` = звичайне.

**Два типи обміну:**
- `pre_order` — клієнт заздалегідь просить замінити черствий хліб. Свіжий іде безкоштовно, черствий забирається і виставляється на магазин за `exchange_price`.
- `post_delivery` — водій повертається з поверненнями. Оператор вносить `exchange_notes`, розподіляє товар: магазин / інший клієнт / списати. Товар отримує `is_stale=1`.

### Випічка
```sql
CREATE TABLE baking_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_date TEXT NOT NULL,
    product_id INTEGER NOT NULL REFERENCES products(id),
    ordered_qty REAL DEFAULT 0,
    recommended_qty REAL DEFAULT 0,  -- ordered + резерв %
    baked_qty REAL DEFAULT 0,        -- фактично спечено
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(task_date, product_id)
);

```
`baked_qty` — `NULL` = ще не введено (не 0!), `0` = введено явний нуль; на цій
відмінності будується UI-логіка "чи введена випічка" (`baked_entered`).

Таблиця `surplus_allocations` (розподіл надлишку по alloc_date/product) —
**видалена** (B1, синхронізація schema.sql з моделями). Замінена на
`invoice_lines.line_kind='surplus'` (надлишок вноситься прямо рядком у
накладну магазину, v1.3.0) + `Order origin_id=0` (пайок/списання).

### Накладні
```sql
CREATE TABLE invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_number TEXT NOT NULL UNIQUE,  -- формат: YYYYMMDD-NNN
    invoice_date TEXT NOT NULL,
    route_id INTEGER REFERENCES routes(id),
    client_id INTEGER NOT NULL REFERENCES clients(id),
    status TEXT DEFAULT 'draft' CHECK(status IN ('draft','printed','delivered','cancelled')),
    total_sum REAL DEFAULT 0,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    corrective_for_id INTEGER REFERENCES invoices(id)  -- посилання на оригінал (legacy
                                                        -- коригуючі накладні, новий UI
                                                        -- create_corrective_invoice не викликає)
);

CREATE TABLE invoice_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    qty REAL NOT NULL,
    price REAL NOT NULL,
    price_override REAL,    -- NULL = використовується price
    line_kind TEXT DEFAULT 'normal',  -- normal | exchange | stale | surplus (міграція 036)
    sum REAL NOT NULL       -- qty * COALESCE(price_override, price)
);
```

`line_kind` (v1.3.0, міграція 036) — єдиний тип рядка замість колишніх boolean `is_exchange`/`is_stale`
(взаємовиключні). `surplus` — надлишок випічки, долитий прямо в накладну магазину (раніше — окремий
`Order origin_id=0`). УВАГА: `is_stale` у `movements`/`daily_balances` — ІНШИЙ концепт (несвіжий сток),
не плутати з `line_kind`.

**Відображення обміну на друку (налаштування `invoice_exchange_inline`, 0/1, default 0)** —
`backend/main.py` (`DEFAULT_SETTINGS`), перемикач у AdminPage → Налаштування → Параметри
пекарні → Додаткові функції (`SettingsTab.tsx`). Вимкнено (типово) — рядки `line_kind='exchange'`
показуються окремою секцією «Обмін» унизу накладної (як і завжди). Увімкнено — кількість обміну
показується новою колонкою «Обм.» одразу за «Кільк.» у ЗАГАЛЬНОМУ списку, замість окремої секції:
виріб зі звичайним рядком отримує обмін у той самий рядок; виріб ЛИШЕ з обміном отримує синтетичний
рядок (qty=price=sum=0, без запису в БД — лише для друку); якщо виріб має 2 рядки різної ціни (після
`_merge_lines_for_display`) — обмін додається лише в перший з них. Гілка активується ЛИШЕ коли в
конкретній накладній є хоч один рядок обміну — накладні без обміну виглядають однаково незалежно
від стану перемикача. Реалізовано дзеркально в обох рендерах (`render_invoice_block` — HTML,
`render_invoice_pdf_bytes` — PDF для Telegram; спільні helper-и `_apply_inline_exchange()` /
`_obmin_getter()`), оскільки це — два незалежно написані шаблони, не одне спільне джерело.

**Нумерація накладних:** автоматична відносно дати, формат `YYYYMMDD-NNN`.
Приклад: перша накладна 15 березня 2026 = `20260315-001`.

```sql
-- Переміщення товару між накладними на стадії Маршрутів (v1.2.0).
-- Замінює механізм коригуючих накладних: корекція = пряме редагування рядків
-- накладної + запис тут (для анотацій "куди пішло / звідки прийшло").
CREATE TABLE invoice_transfers (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    transfer_date     TEXT NOT NULL,
    source_invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    target_invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    product_id        INTEGER NOT NULL REFERENCES products(id),
    qty               REAL NOT NULL,
    line_kind         TEXT DEFAULT 'normal',  -- normal | exchange — тип рядка-джерела (міграція 039)
    notes             TEXT,
    created_at        TEXT DEFAULT (datetime('now')),
    created_by        TEXT
);
```
⚠ Баг (виправлено міграцією **043** + `backend/routers/settings.py`): `POST
/settings/reset-db` ("Скидання бази даних", Бекапи та імпорт) видаляв
`invoices`, але не `invoice_transfers` (таблиця з'явилась пізніше, у v1.2.0
— reset-db під неї не оновили). Після скидання+повторного .accdb-імпорту
нові `invoices` отримують нові `id`, і старі `invoice_transfers` лишаються
"осиротілими" назавжди — посилаються на накладні, яких вже немає (так на
реальній базі накопичилось 61 таких рядків, `PRAGMA foreign_key_check`
показував 122 порушення — по 2 на рядок, source+target). Дані непридатні
до відновлення (немає способу дізнатись, якій новій накладній відповідав
старий id) — 043 просто видаляє такі рядки одноразово; `reset_database()`
тепер видаляє `invoice_transfers` разом з `invoices`, тож ситуація більше
не повториться.

Той самий клас багу знайшовся ще у трьох місцях (ретельна перевірка на
прохання користувача — реальний ручний тест "Скинути базу" на dev виявив
`audit_log`, решту — код-рев'ю за аналогією):
- **`client_groups`** (прив'язані до `route_id`) — `reset_database()` видаляв
  `routes`, але не `client_groups`; вони лишались з битим `route_id`.
- **`clients.route_id` / `clients.client_group_id`** на клієнтах, що
  лишаються (системні/магазин) — якщо такий клієнт мав маршрут/групу (напр.
  магазин, вручну прив'язаний до маршруту "Пекарня" — див. вище), після
  видалення `routes`/`client_groups` ці поля лишались вказувати в
  порожнечу. Тепер `reset_database()` явно обнуляє їх у кінці.
- **`audit_log`** (журнал змін `orders`/`invoice_lines`/`finances`/`clients`)
  — поліморфне посилання (`entity_table`+`entity_id`, без єдиного FK), тож
  `PRAGMA foreign_key_check` таких рядків НЕ бачить (не порушення constraint,
  просто стають нерелевантними) — 8 рядків знайдено на реальному
  ручному тесті скидання. Міграція **044** прибрала їх (перевірка існування
  по кожній `entity_table` окремо — чіпає лише дійсно осиротіле, не всю
  історію); `reset_database()` тепер видаляє `audit_log` разом з іншими
  робочими даними.

Усі чотири — той самий корінь: `reset_database()` виконує видалення з
`PRAGMA foreign_keys = OFF` (потрібно для self-referential FK на
`invoices.corrective_for_id`/`orders.parent_order_id`), що дозволяє
видалити батьківський запис БЕЗ падіння на дочірніх — але й без CASCADE,
тож будь-яку таблицю/поле, яке посилається на видалене і явно не в списку
`reset_database()`, потрібно перевіряти вручну при кожній зміні схеми.

**Корекція накладної (v1.2.0) — уніфіковане переміщення замість коригуючих:**
- `POST /invoices/{id}/transfer {product_id, qty, to_client_id, source_line_kind}` —
  переносить товар з рядка цієї накладної на іншого клієнта / магазин / системного
  клієнта. `source_line_kind` (default `'normal'`) — з якого рядка брати кількість.
- Джерело: рядок `qty ↓`, `total_sum ↓`. Ціль: накладна на ту ж дату (створюється
  якщо нема) — рядок `qty ↑/створюється` ЗАВЖДИ як `line_kind='normal'`, ціна через
  `get_price`, `total_sum ↑`.
- Магазин-ціль (`client_kind='shop'`/`is_own_shop=1`): ціль-накладна стає `accepted`
  → товар одразу у POS (`compute_current_stock`), борг магазину НЕ створюється.
- Фінанси обох накладних синхронізуються `recompute_invoice_finance` (працює і
  для вже accepted — оновлює борг-запис; для shop/writeoff/ration борг не ведеться).
- `PUT /invoices/{id}/lines` розширено: редагування у draft/sent/processing/accepted
  + перерахунок фінансів. `create_corrective_invoice` лишається лише для перегляду
  старих коригуючих (новий UI його не викликає).
- Оплата приймається за фінальною (скоригованою) сумою; фінанси відображають її.
- Різниця з `/orders/{id}/transfer`: той — стадія чернеток (до накладної, дочірні
  orders); `/invoices/{id}/transfer` — стадія сформованих накладних.
- **Корекція обміну (`source_line_kind='exchange'`)**: дозволяє взяти кількість з
  обмінного рядка (`line_kind='exchange'`, безкоштовний) — на відміну від
  `'normal'`, тут ДОЗВОЛЕНО `to_client_id == client_id` цієї ж накладної
  ("не можна переміщати самому собі" діє лише для звичайних рядків). Три
  сценарії корекції коли клієнт фактично не обміняв, а: (1) продав як
  звичайний — `to_client_id` = сам клієнт, кількість переходить у платний
  рядок (`tgt = src`, той самий invoice); (2) не забрав — `to_client_id` =
  магазин; (3) зіпсувався/загублений — `to_client_id` = writeoff. `invByPC` у
  BakingPage вже включає `line_kind='exchange'` у попит нарівні зі звичайним
  (виключає лише `'surplus'`), а `redistribByPC` нейтралізує переміщення
  customer/shop незалежно від типу рядка-джерела — тож жодна з трьох корекцій
  не змінює «Замовлено». `RoutesPage.tsx` (`InvoiceDetailPanel`) — окрема
  таблиця «Корекція обміну» під основною, з опцією «✓ Продано цьому ж
  клієнту» першою в дропдауні цілей. Анотації "передано →"/"отримано від"
  розрізняються за `invoice_transfers.line_kind` (`transfersFor(productId,
  kind)`); self-переміщення показує окремий текст «↺ продано як звичайний».

### Рухи та залишки
```sql
CREATE TABLE movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    move_date TEXT NOT NULL,
    product_id INTEGER NOT NULL REFERENCES products(id),
    move_type TEXT NOT NULL CHECK(move_type IN (
        'in',           -- надходження з випічки
        'sold',         -- продаж
        'writeoff',     -- списання
        'ration',       -- пайок персоналу
        'return_stale', -- повернення несвіжого
        'exchange_out', -- відправлено в обмін (свіжий)
        'exchange_in',  -- отримано в обмін (черствий на магазин)
        'cancel_to_shop' -- після скасування рейсу
    )),
    qty REAL NOT NULL,
    is_stale INTEGER DEFAULT 0,  -- 1 = несвіжий товар
    price REAL,
    source_table TEXT,  -- 'orders', 'invoices', 'baking_tasks' тощо
    source_id INTEGER,
    route_id INTEGER REFERENCES routes(id),
    client_id INTEGER REFERENCES clients(id),
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE daily_balances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    balance_date TEXT NOT NULL,
    product_id INTEGER NOT NULL REFERENCES products(id),
    is_stale INTEGER DEFAULT 0,
    start_balance REAL DEFAULT 0,
    received REAL DEFAULT 0,
    sold REAL DEFAULT 0,
    written_off REAL DEFAULT 0,
    end_balance REAL DEFAULT 0,  -- розраховується: start + received - sold - written_off
    computed_at TEXT,
    UNIQUE(balance_date, product_id, is_stale)
);
-- Каскадний перерахунок з дати зміни — тільки для змінених продуктів
```
**Увага:** `movements`/`daily_balances` існують у схемі, але в коді НІЧОГО в
них не пише (жоден `db.add(Movement(...))`/`DailyBalance(...)` не знайдено,
роутера `movements.py` немає). Фактичний рух товару відстежується через
`orders`/`invoice_lines`/`invoice_transfers`/`shop_disposal_lines` (див.
розділ "Магазин" нижче та `/reports/product-balances`). Не покладатись на ці
дві таблиці як на джерело даних.

### Магазин

Активна модель (v1.0.0+) — гнучка POS/звірка-система, `backend/models/shop.py`:
```sql
-- Звірка магазину за гнучкий період (денна/тижнева/місячна)
CREATE TABLE shop_reconciliations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shop_client_id INTEGER NOT NULL REFERENCES clients(id),
    period_from TEXT NOT NULL,
    period_to TEXT NOT NULL,
    cash_expected REAL DEFAULT 0,   -- авто: сума (sold * price)
    cash_actual REAL,               -- введено оператором
    cash_diff REAL,                 -- cash_actual - cash_expected
    notes TEXT,
    closed INTEGER DEFAULT 0,
    closed_at TEXT,
    closed_by TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Рядок звірки: один виріб / одна партія (batch_date=NULL = залишок з попередньої звірки)
CREATE TABLE shop_reconciliation_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reconciliation_id INTEGER NOT NULL REFERENCES shop_reconciliations(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    batch_date TEXT,
    opening_balance REAL DEFAULT 0,  -- лише для batch_date=NULL
    received REAL DEFAULT 0,         -- авто: надходження за batch_date
    entered_balance REAL,            -- введено оператором
    written_off REAL DEFAULT 0,      -- авто: SUM(disposal_lines.qty)
    calculated_sold REAL,            -- авто: opening + received - entered - written_off
    price REAL,
    expected_cash REAL               -- авто: calculated_sold * price
);

-- Розподіл списань: списання / пайок / передача клієнту / продаж поза POS
CREATE TABLE shop_disposal_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reconciliation_line_id INTEGER NOT NULL REFERENCES shop_reconciliation_lines(id),
    disposal_type TEXT NOT NULL,  -- writeoff | ration | client | sale
    client_id INTEGER REFERENCES clients(id),
    qty REAL NOT NULL,
    price REAL,    -- ціна продажу (лише disposal_type='sale')
    notes TEXT,
    created_at TEXT
);

-- Надходження товарів ЗЗОВНІ для магазину (куплені, не з власного виробництва)
CREATE TABLE shop_receipts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shop_client_id INTEGER NOT NULL REFERENCES clients(id),
    receipt_date TEXT NOT NULL,
    product_id INTEGER NOT NULL REFERENCES products(id),
    qty REAL NOT NULL,
    purchase_price REAL DEFAULT 0,
    notes TEXT,
    created_at TEXT
);

-- Продаж товару через POS-інтерфейс продавця (роль seller, сторінка /pos)
CREATE TABLE shop_sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shop_client_id INTEGER NOT NULL REFERENCES clients(id),
    sale_date TEXT NOT NULL,     -- YYYY-MM-DD
    product_id INTEGER NOT NULL REFERENCES products(id),
    qty REAL NOT NULL,
    price REAL NOT NULL,
    amount REAL NOT NULL,        -- qty * price
    session_id TEXT,             -- UUID: обʼєднує позиції одного чека
    batch_date TEXT,             -- дата партії товару (яку партію продано)
    notes TEXT,
    created_at TEXT,
    created_by TEXT              -- username продавця
);
```
`compute_current_stock()` (`backend/routers/shop.py`) рахує поточний залишок
"на льоту" з цих таблиць — без потреби у відкритій звірці.

Legacy-таблиці (лишені для сумісності зі старими даними, НЕ основний
механізм):
```sql
CREATE TABLE shop_counts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    count_date TEXT NOT NULL,
    product_id INTEGER NOT NULL REFERENCES products(id),
    product_type TEXT DEFAULT 'bread' CHECK(product_type IN ('bread','stale','other')),
    yesterday_balance REAL DEFAULT 0,
    received_today REAL DEFAULT 0,   -- авто з baking_tasks + повернення
    entered_balance REAL,            -- фактичний залишок (вводить оператор)
    written_off_entered REAL DEFAULT 0,
    calculated_sold REAL,            -- авто: yesterday + received - entered - writeoff
    price REAL,
    saved INTEGER DEFAULT 0,         -- 1 = підтверджено, заблоковано редагування
    UNIQUE(count_date, product_id, product_type)
);

CREATE TABLE other_stock_in (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stock_date TEXT NOT NULL,
    other_product_id INTEGER NOT NULL REFERENCES other_products(id),
    qty REAL NOT NULL,
    purchase_price REAL,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);
```

### Фінанси
```sql
-- Статті фінансових операцій (реалізовано у Фазі 3.5).
-- Системні статті (is_system=1) видаляти не можна, лише редагувати.
-- editable (v1.1.7) дозволяє ✏ редагування суми операції поточного дня
-- через PATCH /finances/{id} замість видалення.
CREATE TABLE finance_articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    direction TEXT NOT NULL CHECK(direction IN ('income','expense')),
    is_system INTEGER DEFAULT 0,
    needs_client INTEGER DEFAULT 0,  -- 1 = операція потребує прив'язки до клієнта
    editable INTEGER DEFAULT 0       -- 1 = PATCH amount/notes дозволено (поточний день)
);
-- PARTIAL UNIQUE INDEX: системні статті унікальні за (name, direction).
-- За замовчуванням editable=1 (міграція 032, виправлено міграцією 040 —
-- 032 звірялась з неіснуючою назвою 'Виплата з каси' замість справжньої
-- 'Виведення з каси', і не включала кілька канонічних статей узагалі):
-- Оплата, Внесення в касу, Виведення з каси, Оплата з каси, Готівка водія,
-- Списання боргу, Кредит обміну, Виручка магазину, Списання магазину.
-- НЕ editable (автогенеровані системою): Накладна, Початковий баланс,
-- Архівний залишок.
--
-- PATCH /finances/{id} дозволяє редагування суми/нотатки якщо: finance_date
-- == поточна робоча дата (перевіряє frontend) І article.editable=1 І
-- finance_type != 'invoice'. Борговий запис накладної (invoice) захищений
-- завжди — його суму підтримує recompute_invoice_finance, ручна правка
-- розсинхронізувала б журнал із самою накладною. Автоматичні записи оплат
-- (created_by='system', finance_type='payment' — з'являються при прийнятті
-- накладної з сумою оплати) РЕДАГОВНІ нарівні з ручними: цю умову
-- (created_by != 'system') прибрано, бо recompute_invoice_finance записи
-- оплат не перераховує — виправляти помилково внесену оплату (напр. накладну
-- прийняли з оплатою, якої фактично не було) інакше можна було лише через
-- прямий доступ до БД.

CREATE TABLE finances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    finance_date TEXT NOT NULL,
    client_id INTEGER REFERENCES clients(id),  -- NULL = загальна операція
    finance_type TEXT NOT NULL CHECK(finance_type IN (
        'invoice',         -- накладна виставлена (мінус баланс клієнта)
        'payment',         -- оплата від клієнта (плюс)
        'writeoff',        -- списання боргу
        'deposit',         -- внесення в касу
        'route_cash',      -- готівка від водія
        'exchange_credit'  -- кредит при pre_order обміні
    )),
    article_id INTEGER REFERENCES finance_articles(id),  -- замінює finance_type у відображенні
    amount REAL NOT NULL,  -- завжди позитивне число
    sign INTEGER NOT NULL CHECK(sign IN (1,-1)),  -- +1 або -1
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    created_by TEXT       -- 'system' для автоматичних записів (не редагуються)
);
```

### Аудит-лог (v1.3.2)
```sql
-- Захищений журнал змін — тільки UPDATE існуючих записів користувачами.
-- CREATE і системні автодії НЕ логуються. Немає write-ендпоінтів окрім
-- write_audit() (backend/models/audit.py), що викликається з роутерів
-- ПЕРЕД safe_commit. Читання: GET /audit?entity_table=X&entity_id=Y
-- (require_user). Фронтенд: AuditBadge.tsx — іконка ⚠ на змінених рядках,
-- з'являється лише якщо є записи (auto-fetch при монтуванні), lazy-popup
-- з історією. Інструментовано: finances (amount, notes), invoice_lines
-- (qty, price_override), orders (qty, price_override, delivered_qty),
-- clients (discount_pct, is_active).
CREATE TABLE audit_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_table  TEXT NOT NULL,   -- 'finances', 'invoice_lines', 'orders', 'clients'
    entity_id     INTEGER NOT NULL,
    changed_field TEXT NOT NULL,
    old_value     TEXT,
    new_value     TEXT,
    changed_by    TEXT NOT NULL,   -- username
    changed_at    TEXT             -- виставляється з Python (datetime.now().isoformat()),
                                    -- НЕ DB DEFAULT — SQLAlchemy лишає NULL в пам'яті інакше
);
CREATE INDEX idx_audit_log_entity ON audit_log(entity_table, entity_id);
```

### Авторизація
```sql
CREATE TABLE users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    salt          TEXT NOT NULL,
    full_name     TEXT DEFAULT '',
    role          TEXT DEFAULT 'operator',  -- operator|accountant|admin|owner|seller
    is_active     INTEGER DEFAULT 1
);

CREATE TABLE user_sessions (
    token        TEXT PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users(id),
    created_at   TEXT,
    last_used_at TEXT  -- оновлюється при кожному auth-запиті; NULL = legacy сесія
);
```
⚠ Баг (виправлено): реальні лог-файли клієнта (3 місяці, 44 МБ) показали
2045 traceback-ів `sqlalchemy.exc.PendingRollbackError` (до 852/день у дні
активного одночасного використання) — 97.8% усіх помилок за весь період.
Причина: `get_current_user()` (`backend/routers/auth.py`) оновлює
`last_used_at` (throttled, раз/хв) в `try: ... db.commit() ... except
Exception: pass` — коли `db.commit()` падав (типово `sqlite3.
OperationalError: database is locked` при конкурентній записи кількох
операторів+бота), виняток гасився БЕЗ `db.rollback()`. SQLAlchemy 2.0
лишає сесію в стані "потрібен явний rollback()" — і та ж сесія (той самий
`db` через `Depends(get_db)`) використовується далі в тому самому запиті
(типово `require_admin`, лінива підвантажка `user.role`) → друга, вже
фатальна помилка на дії, геть не пов'язаній з причиною. Виправлено:
`except Exception: db.rollback()`. Паралельно (`backend/database.py`)
додано `PRAGMA busy_timeout=5000` — без нього SQLite віддає "database is
locked" миттєво замість короткого очікування, тож сам лок траплявся
частіше, ніж потрібно. Тест: `tests/test_auth_session_touch_rollback.py`.

### Telegram Bot
```sql
-- Авторизовані користувачі бота (кілька акаунтів на клієнта)
CREATE TABLE client_bot_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL REFERENCES clients(id),
    chat_id TEXT NOT NULL UNIQUE,
    phone TEXT,
    first_name TEXT,
    authorized_at TEXT,
    is_active INTEGER DEFAULT 1
);
```

Bot-поля в існуючих таблицях:
```sql
-- orders
ALTER TABLE orders ADD COLUMN source TEXT DEFAULT 'phone' CHECK(source IN ('phone','paper','bot'));
ALTER TABLE orders ADD COLUMN bot_status TEXT CHECK(bot_status IN ('pending','confirmed','rejected','modified'));
ALTER TABLE orders ADD COLUMN bot_rejection_reason TEXT;
ALTER TABLE orders ADD COLUMN bot_original_qty REAL;   -- qty до зміни оператором
ALTER TABLE orders ADD COLUMN placed_by_chat_id TEXT;  -- хто подав замовлення

-- clients
ALTER TABLE clients ADD COLUMN bot_phones TEXT;        -- телефони для авторизації (через кому)
```

### Налаштування
```sql
CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    description TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Дефолтні налаштування
INSERT INTO settings VALUES
    ('bakery_name', 'Пекарня', 'Назва пекарні'),
    ('director', '', 'ПІБ директора'),
    ('accountant', '', 'ПІБ бухгалтера'),
    ('address', '', 'Адреса пекарні'),
    ('phone', '', 'Телефон'),
    ('order_lock_time', '22:00', 'Час блокування замовлень'),
    ('bun_reserve_pct', '5', 'Резерв для булок, %'),
    ('bread_reserve_pct', '5', 'Резерв для хліба, %'),
    ('archive_months', '1', 'Місяців зберігати в активній БД'),
    ('cancel_discount_pct', '10', 'Знижка при перенесенні скасованого рейсу, %'),
    ('invoice_number_format', 'YYYYMMDD-NNN', 'Формат номера накладної'),
    ('copy_order_days', '14', 'Кількість днів для функції копіювати з дати'),
    -- Telegram Bot
    ('telegram_bot_token', '', 'Токен Telegram-бота'),
    ('bot_order_start_time', '08:00', 'Час початку прийому замовлень'),
    ('bot_orders_closed_until', '', 'Бот не приймає замовлення до цього часу (ISO datetime)'),
    ('bot_tpl_confirmed', '✅ {product} × {qty} шт на {date} підтверджено.', 'Шаблон: підтвердження'),
    ('bot_tpl_rejected', '❌ {product} × {qty} шт на {date} відхилено. Причина: {reason}', 'Шаблон: відхилення'),
    ('bot_tpl_modified', '✏️ {product}: замовлено {qty} → змінено на {new_qty} шт на {date}.', 'Шаблон: зміна кількості'),
    ('bot_tpl_reminder', 'Нагадування: ви ще не подали замовлення на {date}.', 'Шаблон: нагадування'),
    ('bot_tpl_deadline', 'Прийом замовлень через бота на {date} завершено.', 'Шаблон: закриття прийому');
```

---

## API структура (FastAPI)

### Роутери
Повний список підключається в `backend/main.py` (`app.include_router(...)`).
Нижче — по одному представнику на роутер з характерними ендпоінтами; де
кількість велика (`shop`, `invoices`, `settings`) — лише найважливіші, решта
в самому файлі роутера.

```
/api/v1/
    /auth
        login, /me, /logout               POST/GET/POST
        users, public-users               GET — список користувачів (для екрану входу)
    /auth/github                          OAuth GitHub (issues-інтеграція)
    /products          GET, POST, PUT, DELETE
    /categories        GET, POST
    /ingredients       GET, POST, PUT
    /clients           GET, POST, PUT, DELETE
    /routes            GET, POST, PUT
    /client-groups     GET, POST, PUT, DELETE          ← v1.1.7
        /{id}/members  GET, PUT — призначення клієнтів до групи
    /prices            GET, POST, PUT — з логікою дат
    /orders            GET, POST, PUT, DELETE — з копіюванням
        /grid          GET — матриця клієнти×вироби для Зведеного виду (v1.1.4)
        /bulk-upsert   POST — масове збереження з atomic locked-check (v1.1.4)
        /{id}/transfer POST — переміщення на дочірній рядок (стадія чернеток)
    /baking            GET, POST — завдання + результат + розподіл
    /invoices          GET, POST, PUT — з автонумерацією; ще 14 ендпоінтів у файлі,
                       найважливіші: /generate-drafts, /generate-from-orders,
                       /{id}/transfer, /set-surplus, /close-shops, /{id}/status,
                       /{id}/lines (PUT — редагування рядків), /transfers-by-date,
                       /locked-clients
    /shop              27 ендпоінтів (POS + гнучка звірка, `shop_reconciliations`
                       і похідні — див. схему БД "Магазин"); основні групи:
                       /shops, /summary, /reconciliations*, /receipts*,
                       /pos/products, /sales* (POS-продаж), /other-products
    /finances          GET, POST, PATCH /{id} (v1.1.7), DELETE
        /balances      GET — баланси-борги клієнтів (ClientBalance, НЕ daily_balances)
        articles       GET, POST, PUT, DELETE (з прапором editable)
    /reports
        /product-balances  GET?date= — Баланси Виробів (v1.3.3), звірка з
                           Денним звітом (спільна функція _compute_section1_data)
    /audit             GET?entity_table=&entity_id= — read-only, історія змін (v1.3.2)
    /settings          GET, PUT; ще /telegram/status, /telegram/restart,
                       /telegram/stop, /reset-db, /server-info
    /dashboard         /, /shop-summary/, /calendar/, /trends — дашборд власника
    /db-editor         /tables, /tables/{t}/schema, /tables/{t}/data (GET/PUT/DELETE
                       рядка) — прямий перегляд/редагування БД (адмін-інструмент,
                       окремий маршрут /db-editor поза Layout)
    /backup            14 ендпоінтів: /list, /now, /cloud/detect, /restore/{f},
                       /demo/enter, /demo/exit, /archive
    /issues            GET / (список client-report) · POST / (нове звернення → GitHub)
    /bot/
        pending-orders              GET — замовлення зі статусом pending
        orders/{id}/verify          PUT — підтвердити/відхилити/змінити кількість
        broadcast-reminder          POST — розсилка нагадувань
        broadcast-deadline          POST — розсилка закриття прийому
        order-status                GET — чи приймає бот замовлення
        order-status/stop           POST — зупинити до ранку наступного дня
        order-status/resume         POST — відновити негайно
        clients/{id}/bot-users      GET — список авторизованих Telegram-юзерів
        clients/{id}/bot-users/{uid} DELETE — відкликати авторизацію
    /print/                                            ← друковані форми (без auth, як усі /print/)
        invoice/{id}                GET — одна накладна
        invoices                    GET — пакет накладних (2 на A4)
        baking                      GET — завдання пекарям
        baking-report                GET — звіт результату випічки
        daily-report                GET — денний звіт
        debts                       GET — боргова відомість
        monthly-sales               GET — місячний звіт продажів
        client-statement            GET — виписка клієнта
        group-sort                  GET — Сортування товару за групами (v1.1.7)
        route-sheet                 GET — Маршрутний лист водія (v1.1.7)
        address-sheet               GET — Адресний лист клієнтів (v1.1.7)
```

**Немає в API** (таблиці/функціонал видалені або ніколи не мали окремого
роутера): `/movements`, `/cancellations` — див. примітки в схемі БД вище.

### Ключові бізнес-правила для сервісів
- `get_price(product_id, client_id, date)` — повертає ціну по пріоритету
- `generate_invoice_number(date)` — `YYYYMMDD-NNN`, NNN скидається щодня
- `recalculate_balances(product_id, from_date)` — каскадний перерахунок
- `copy_orders(source_date, target_date, client_ids)` — копіювання замовлень
- `commit_reconciliation(date)` — підтвердження звірки магазину → рухи
- `process_exchange(order_id)` — обробка обміну → рух товару

---

## Frontend — вкладки (React pages)

| Вкладка | URL | Опис |
|---------|-----|------|
| Замовлення | `/orders` | Список клієнтів по маршрутах, введення кількостей |
| Маршрути | `/routes` | Накладні-чернетки з замовлень → друк → корекція → відправка |
| Випічка | `/baking` | Внесення результату + вирівнювання розбіжностей (від накладних) |
| Магазин | `/shop` | Щоденна звірка, несвіжий товар, група ІНШЕ |
| Фінанси | `/finances` | 5 під-вкладок: Дашборд (`OwnerDashboard`), Баланси клієнтів, Баланси Виробів (`ProductBalancesTab`, v1.3.3 — звірка руху продукції з Денним звітом), Журнал операцій, Звіти (друковані PDF) |
| Довідники | `/admin` | Вироби, клієнти, ціни, маршрути, налаштування |

Поза основним `Layout`-меню (не в списку вкладок вище, окремі маршрути):
| Сторінка | URL | Опис |
|---------|-----|------|
| Довідка | `/help` | `HelpPage.tsx` — інструкції для операторів (див. правило оновлення при релізі) |
| DB Editor | `/db-editor` | `DbEditorPage.tsx` — прямий перегляд/редагування таблиць БД (адмін), окремий від Layout маршрут |
| POS-каса | `/pos` | `PosPage.tsx` — окремий інтерфейс для ролі `seller`, встановлюється як окремий "додаток" на планшеті магазину |

**Поточна дата** завжди видима у хедері і доступна для зміни (для роботи "за вчора").

### Робочий цикл (v1.3.0)
Порядок меню відповідає реальному циклу: **Замовлення → Маршрути → Випічка → Магазин**.
1. Замовлення вносяться у вкладці Замовлення.
2. У Маршрутах кнопка **«Сформувати накладні»** будує з замовлень повноцінні
   накладні-чернетки (з номером і рядками; функціонал як «Відправлені», але статус `draft`).
   Магазини сюди НЕ потрапляють. Поняття `virtual_draft` (замовлення без рядків) прибрано.
3. Оператор разово друкує клієнтські накладні, розкладає по ящиках; за потреби зменшує
   кількість прямо в накладній (`✏ Корекція`, доступна і для `draft`), передруковує.
4. **«Відправити машини»** переводить чернетки `draft → sent`.
5. Випічка вноситься ПІСЛЯ відправки. Розбіжності рахуються **від накладних** (сума
   `invoice_lines` клієнтів), не від замовлень. Надлишок → магазин/пайок/списання;
   недопечене → тільки магазин (клієнтські рейси вже поїхали).
6. **«Закрити накладну магазину»** переводить накладні власних магазинів `draft → accepted`
   напряму (без `sent`, без оплати — магазини розраховуються через звірку).

**KPI-картки маршрутів** (горизонтальна смуга над списком клієнтів у Маршрутах,
`RoutesPage.tsx`, `kpiCards`): баланс + Кредит/Дебет одна під одною (назва зліва,
сума справа — вужча картка, більше рейсів без прокрутки). Назва рейсу
скорочується "розумно" через вимірювання реальної ширини тексту на canvas
(`abbreviateRouteLabel`/`measureTextWidth`) — ЛИШЕ коли фактично не влазить,
кількість клієнтів у дужках лишається завжди повною ("Перемишляни (39)" →
"Перем. (39)"). Підписи "Кредит"/"Дебет" скорочені до "К"/"Д" (повна назва —
в title); самі суми — завжди повні, з копійками дрібнішим текстом
(`.kpiKopecks`), без винятків.
- ⚠ Баг (виправлено): "Кредит" (`invoiceSum`) для картки рахувався за
  `invoice.route_id` (`invoices.filter(i => i.route_id === r.id)`), а не за
  реальними клієнтами маршруту (`filterClients`/`clientIdSet`) — тоді як
  "Дебет" (`debitSum`) вже правильно рахувався саме за клієнтами. Розбіжність:
  при корекції (`POST /invoices/{id}/transfer`) цільова накладна системного
  клієнта (Списання/Пайок/Недопечено) успадковує `route_id` від
  джерела (`_resolve_or_create_invoice(db, to_client_id, date, src.route_id)`,
  `backend/routers/invoices.py`) — тож її сума потрапляла в "Кредит" маршруту-
  джерела, хоча системний клієнт не входить у список/лічильник клієнтів цього
  маршруту і ніхто його не бачить. Виправлено: `invoiceSum`/`correctionSum`
  тепер рахуються за тим самим `clientIdSet`, що й `debitSum`.

---

## Фази розробки

### ✅ Фаза 1 — MVP
- [x] Структура проекту + встановлення (`install.bat`)
- [x] SQLite схема (`database/schema.sql`) — всі 18 таблиць
- [x] FastAPI app + database session (WAL, foreign keys)
- [x] SQLAlchemy моделі для всіх таблиць
- [x] Pydantic schemas + CRUD endpoints для довідників
- [x] Логіка замовлень: POST/GET/PUT/DELETE + копіювання з дати
- [x] Сервіс `get_price()` — 4-рівневий пріоритет цін
- [x] Завдання на випічку + внесення результату + розподіл надлишків
- [x] Накладні: генерація + автонумерація `YYYYMMDD-NNN`
- [x] React каркас: навігація по вкладках + дата роботи в хедері
- [x] Вкладка Замовлення (таблиця клієнт × виріб, inline-редагування)
- [x] Вкладка Випічка (завдання + baked_qty)
- [x] Вкладка Довідники (перегляд виробів, клієнтів, маршрутів)
- [x] Базові тести: pytest + TestClient

### ✅ Фаза 2 — Повний цикл
- [x] Stale-логіка: несвіжий товар по всьому ланцюжку
- [x] Скасування рейсу
- [x] Магазин: щоденна звірка, несвіжий, ІНШЕ
- [x] Переробка вкладки Маршрути (накладні, друк, повернення)
- [x] Авторизація і ролі (JWT, 4 ролі, матриця прав)
- [x] Друк PDF — накладні (2 на A4) + завдання пекарям

### ✅ Розгортання на Windows (виконано паралельно з Фазами 1-2)
- [x] FastAPI роздає зібраний фронтенд (один процес, без окремого Vite в продакшні)
- [x] Task Scheduler автозапуск при вході в систему (`install-service.bat`)
  - задача `BakeryApp`, тригер AtLogon, перезапуск 5×/хв при збої
  - задача `BakeryTray`, тригер AtLogon — трей стартує автоматично
  - `run-server.ps1` вбиває orphan-процеси перед стартом (fix port 8000 conflict)
  - лог сервера → `logs/bakery-YYYY-MM-DD.log` (один файл на добу; кожен рядок з повним
    `[YYYY-MM-DD HH:MM:SS]`). Пише PS-конвеєр (`LogLine` у run-server.ps1, ім'я файла рахується
    на кожен рядок → коректно через північ). `backend/main.py` робить `logging.basicConfig` →
    backend-помилки потрапляють у лог із префіксом рівня (ERROR:/WARNING:)
- [x] Системний трей `tray.py` (pystray):
  - іконка хліба на кольоровому колі (зелений/червоний/жовтий) замість літери "B"
  - анімація при запуску: жовта іконка блимає поки сервер не відповів
  - бейдж = доступне оновлення; uptime + розмір БД у tooltip
  - меню: Відкрити · підменю розділів (6 сторінок) · Запустити/Перезапустити/Зупинити · Оновлення · Відкат · Логи · Вийти
  - захист від дублювання (lock-файл)
  - task `BakeryTray` (AtLogon) + watchdog `run-tray.ps1` — автозапуск і перезапуск через 5 сек після будь-якого виходу
  - сповіщення при старті трею з поточним станом сервера
  - balloon-сповіщення: зміна стану сервера, нова версія, початок оновлення/відкату, зміна стану інтернету (state-based)
  - `_poll_internet` thread (кожні 30 сек): моніторить з'єднання, нотифікує при втраті/відновленні
  - PowerShell WinRT toast (`scripts/notify.ps1`) — надійний, зберігається у центрі сповіщень
  - `action_logs` → запускає **переглядач логів** `log_viewer.py` (окреме Python-вікно, tkinter,
    лише stdlib; `subprocess.Popen([sys.executable, log_viewer.py, logs_dir])`). Читає лог-файли
    напряму з диска — працює без сервера/БД (для діагностики падінь). Дерево дат + фільтри за
    рівнем (Info/Warning/Error…) і типом (Сервер/Застосунок/HTTP/Сповіщення/Інтернет) + пошук;
    traceback згортається в один запис (подвійний клік → повний текст). Пункт меню «Папка логів»
    (`action_open_logs_folder`) — сирий доступ через Провідник. `_notify`/`_poll_internet`
    пишуть у файл дня (`_today_log()`) з повним datetime
  - `_resolve_data_dir()`: автовизначення DATA_DIR (env → `%ProgramData%\Bakery\bakery.db` → парсинг run-server.ps1 → fallback ROOT); вирішує проблему коли трей запущений без `BAKERY_DATA_DIR`
  - `_poll_flags()` thread (кожні 2 сек): обробляє flag-файли від frontend — `RESTORE_REQUESTED`, `DEMO_ENTER_REQUESTED`, `DEMO_EXIT_REQUESTED`; окремий від `_poll_backup()` (60 сек) для швидкої реакції (≤2 сек)
  - `_notified_version`: balloon про нову версію надсилається лише один раз на версію, не повторюється щогодини
  - `action_install_update` запускається в окремому `threading.Thread` (як `action_rollback`) — інакше `MessageBoxW` блокує pystray event thread і кнопки діалогу не реагують
  - об'єднаний потік оновлення (v1.1.9): "Перевірити оновлення" при знайденій новій версії одразу показує діалог Так/Ні "Встановити зараз?" і запускає встановлення на "Так" — без окремого кроку через меню. Спільний хелпер `_run_install(icon, current, latest)` (бекап → `update.ps1` → `icon.stop()`, без повторного підтвердження) використовується і `_do_check_update`, і `action_install_update` (шлях через balloon → меню)
  - ⚠ Баг (виправлено): `_fetch_latest_tag()` гасив будь-яку помилку запиту до
    GitHub без жодного слідy в логах, і оператор при ручній перевірці бачив
    хибне "Встановлена остання версія: X" замість правди "перевірку не
    вдалось виконати" (v1.4.3: додано `truststore` + лог помилки (`[UPDATE]`
    у денному лог-файлі) + чесне повідомлення при провалі перевірки).
    Справжня причина (з'ясована завдяки цьому логуванню, підтверджено на
    реальній машині клієнта, v1.4.4): `_github_headers()` завжди чіпляє
    Authorization з `github_oauth_token` (з інтеграції Звернень), якщо він
    заповнений у settings — і коли цей токен недійсний/відкликаний, GitHub
    відповідає `401 Unauthorized` на ВЕСЬ запит, включно з читанням тегів
    публічного репозиторію, де токен взагалі не обов'язковий. `truststore`
    (v1.4.3) тут ні до чого — сертифікат не був причиною, просто перше
    правдиве повідомлення про помилку дало точний текст (`HTTPError 401`)
    замість сліпого "щось не так з мережею". Виправлено: `_github_api_get()`
    — при 401/403 з токеном повторює запит анонімно (репозиторій публічний,
    анонімний доступ працює завжди незалежно від стану токена клієнта).
    Той самий недійсний токен, найімовірніше, заразом ламає й саму функцію
    "Звернення" (💬) для цього клієнта — окремо не перевірено.
- [x] Система оновлень та відкату через GitHub:
  - `VERSION` файл + git-теги (`v1.0.0`, `v1.1.0`, …)
  - автоперевірка GitHub API раз на годину (balloon тільки при першому виявленні нової версії)
  - `update.bat` / `rollback.bat` — оновлення з відкатом
  - `update.ps1`: зупинка → git checkout → очищення `logs/` і `dev/` з ROOT → pip + npm build → рестарт → регенерація `run-server.ps1` і `run-tray.ps1` в ProgramData → трей
  - `rollback.ps1`: приймає `-TargetTag`; якщо не вказаний — читає `PREVIOUS_VERSION`
  - вибір версії відкату через PowerShell `Out-GridView` (список локальних git-тегів)
  - автоматичний бекап `bakery.db` перед оновленням і відкатом (`bakery.db.bak-VERSION-TIMESTAMP`)
- [x] Dev-режим: `start-dev.bat` (uvicorn --reload + Vite HMR)
- [x] `dev/release.ps1` — автоматизований реліз: оновлює `VERSION`, комітить, пушить, створює GitHub Release через REST API (gitignored, тільки для розробника)
- [x] `dev/create-installer.ps1` — генерує `Bakery-Setup.ps1` з вбудованими токенами (git clone + install + write ISSUES_TOKEN до БД); файл gitignored щоб токени не потрапили в репо
- [x] Система звернень (Issues): `backend/routers/issues.py` проксує GitHub Issues API; `IssuesWidget.tsx` — плаваюча кнопка 💬 на всіх сторінках; токен зберігається в БД, ніколи не потрапляє у браузер
- [x] Бекап та відновлення бази:
  - автобекап щодня при старті трею (`_poll_backup` thread, 60 сек)
  - ручний бекап і відновлення через UI налаштувань
  - відновлення: API записує `RESTORE_REQUESTED` (JSON з path і параметрами) → `_poll_flags()` підхоплює за ≤2 сек → тре зупиняє сервер, копіює БД через `sqlite3.connect(...).backup()`, перезапускає
  - міграція БД при першому встановленні: якщо в ProgramData немає `bakery.db` — копіюється з ROOT

### ✅ Фаза 3 — Фінанси та аналітика
- [x] Фінансовий модуль (баланси клієнтів, рух коштів, журнал операцій)
- [x] Управління цінами (майбутні дати, % зміна)
- [x] Собівартість і маржинальність
- [x] Мобільний дашборд для власника
- [x] Аудит-лог змін + обнулення фінансових операцій (v1.3.2, див. "Реліз v1.3.2")
- [x] Баланси Виробів — звірка руху продукції з Денним звітом (v1.3.3, див. "Реліз v1.3.3")

### ✅ Telegram Bot
- [x] Авторизація через номер телефону (`/start` → контакт → прив'язка до клієнта)
- [x] Мульти-юзер: кілька Telegram-акаунтів на одного клієнта (`client_bot_users`)
- [x] `bot_phones` — список телефонів клієнта для авторизації в боті (через кому)
- [x] Подача замовлення через бота: вибір типу → вибір товару → кількість
  - показує ціну клієнта з урахуванням знижок (не вагу)
  - сторінкова навігація по товарах
- [x] Статус замовлення: значок на початку рядка (⏳/✅/✏️/❌/👤 для оператора)
- [x] Верифікація оператором: підтвердити / відхилити / змінити кількість
  - відповідь надсилається тому хто подав замовлення (`placed_by_chat_id`)
  - fallback на перший активний chat_id клієнта
  - зберігає `bot_original_qty` при зміні кількості
- [x] Розсилки: нагадування клієнтам без замовлення, повідомлення про закриття прийому
- [x] Кнопка "📦 Накладна сьогодні" — дані з таблиці `invoices` + баланс клієнта
- [x] Контроль прийому замовлень: стоп (до ранку наступного дня) / відновлення
  - налаштування `bot_orders_closed_until` (ISO datetime)
  - налаштування `bot_order_start_time` (час відновлення, default "08:00")
- [x] Блокування замовлень коли накладна вже сформована (як у UI оператора)
- [x] Шаблони повідомлень у налаштуваннях (`bot_tpl_confirmed/rejected/modified/reminder/deadline`)
- [x] UI оператора (OrdersPage): індикатор стану прийому (зелений/червоний), кнопка стоп/відновлення
- [x] UI оператора: блокування рядків клієнта при наявності накладної (🔒)
- [x] UI оператора: автооновлення pending-замовлень кожні 30 сек
- [x] UI оператора: жовтий фон для pending, сірий disabled-вигляд для rejected
- [x] UI оператора: розширений tooltip з примітками та оригінальною кількістю
- [x] AdminPage: поле `bot_phones` + таблиця авторизованих користувачів з кнопкою відкликання
- [x] BakingPage: попередження про непідтверджені bot-замовлення перед формуванням/друком
- [x] Pending bot-замовлення виключені з агрегату для випічки
- [x] Звіти для персоналу (`backend/services/telegram_bot.py`, авторизований по
  `telegram_allowed_phones`): `/report` (💰 стан фінансів на сьогодні),
  `/debts` (📉 повний список боржників), `/orders` (📋 замовлення сьогодні),
  `/baking` (🍞 стан випічки сьогодні), `/dailyreport` (📄 Денний звіт
  пекарні у PDF на поточну дату).
  - ⚠ Баг (виправлено): `top_debtors` (`GET /dashboard/`) і `_report_debts()`
    рахували боржників по ВСІХ `client_kind`, включно із системними клієнтами
    (Списання/Пайок/Недопечено) — внутрішні бухгалтерські рахунки, не реальні
    боржники. Через це "Списання" могло з'явитись у списку боржників з
    великою сумою. Виправлено фільтром `client_kind == 'customer'`, як і в
    `get_summary()`/`FinancesPage.tsx` (`regularBalances`). `_report_orders()`
    заразом отримав той самий `Order.qty > 0` фільтр, що вже стояв у
    `get_dashboard()`.
  - **`_report_finance()` (команда `/report`) переписана на основі
    `get_dashboard()`** — та сама інформація й термінологія, що й на
    дашборді власника, щоб цифри в боті й на сайті завжди збігались:
    "Залишок у касі" (`fin_summary.cash_balance`, якого в `GET /dashboard/`
    раніше не було — додано в `finance` секцію відповіді), "Борг клієнтів"/
    "Переплата клієнтів" (було "Загальний борг"/"Аванси" — незрозумілі
    оператору назви) і сьогоднішні "Виставлено"/"Надійшло"/"Виведено з
    каси" (`today.revenue/payments_sum/cash_out`). Прибрано "Нетто-баланс"
    (аванси мінус борг — плутав власника так само, як однойменна картка на
    FinancesPage до переробки, див. вище) і "Топ боржники" (дублює окрему
    команду `/debts`, там і так є повний список).
  - **`/dailyreport` — PDF Денного звіту через headless-браузер, не через
    HTML→PDF бібліотеку.** `render_daily_report_pdf_bytes()` /
    `render_html_to_pdf_bytes()` (`backend/routers/print_views.py`, поруч з
    `render_invoice_pdf_bytes()` у секції "PDF для Telegram") викликають
    `daily_report()` напряму і рендерять ЛІТЕРАЛЬНО ту саму HTML-відповідь
    через `msedge.exe --headless --print-to-pdf` (`_find_chromium()` шукає
    Edge, потім Chrome, у стандартних шляхах встановлення) — тому PDF і
    сторінка в браузері завжди 1:1 (report-parity через дослівне
    перевикористання функції, а не дублювання розмітки). xhtml2pdf (вже є в
    requirements.txt, використовувався раніше для спроби генерації PDF
    накладної — `_PDF_CSS_TPL`, тепер мертвий код) свідомо НЕ використано
    для цього звіту: його CSS-парсер падає на `@page :last` (є в `BASE_CSS`),
    кирилиця через `@font-face` з `url(file://...)` не вантажиться (PDF
    виходить однакового розміру незалежно від шрифту — ознака що шрифт
    просто ігнорується), і є внутрішній баг сортування CSS-каскаду
    (`TypeError` в `CSSSelectorCombinationQualifier`) на комплексних
    стилях — саме тому `render_invoice_pdf_bytes()` вже побудований вручну
    через ReportLab, а не xhtml2pdf. Headless-браузер обійшов усі ці
    проблеми без жодної переробки CSS. Бот: кнопка «📄 Денний звіт» у
    `_staff_keyboard()`, команда `/dailyreport`/`/деньзвіт`, `_send_document()`
    (спільний хелпер `sendDocument`, виділений заразом із коду відправки PDF
    накладної клієнту).
  - ⚠ Баг (виправлено): `setMyCommands` (список команд у "/"-меню Telegram)
    викликався один раз при старті бота БЕЗ `scope` — Telegram застосовує
    такий виклику глобально, для будь-кого. Через це звичайний клієнт,
    відкривши бота і натиснувши "/", бачив службові команди персоналу (💰
    Стан фінансів, 📉 Борги, 🍞 Випічка, 📄 Денний звіт) у себе в меню —
    хоча сам виклик команди й так захищений `_is_staff()` (клієнт не
    отримає реальні дані), сама видимість цих команд у клієнта неприпустима
    (розкриває внутрішній функціонал, плутає клієнта). Виправлено:
    `_clear_default_commands()` — глобальний scope тепер завжди порожній;
    `_set_staff_commands(token, chat_id)` — список персоналу встановлюється
    ЛИШЕ для конкретного `chat_id` через `scope={"type":"chat","chat_id":...}`,
    викликається і при старті бота (для вже авторизованого персоналу за
    `telegram_authorized_chats`), і одразу в момент нової авторизації
    (`/start` → контакт → номер у `telegram_allowed_phones`).

### ⬜ Фаза 3.5 — Уточнення (на основі аналізу старої системи)

#### Модель даних — зміни

**Замовлення (`orders`) — Split-логіка:**
- Додати поле `parent_order_id INTEGER REFERENCES orders(id)` — посилання на батьківський рядок
- Оригінальний рядок — основа (parent_order_id IS NULL)
- Дочірні рядки (`parent_order_id = X`) — списання частини на інші потреби (переміщення, повернення, інший клієнт)
- Приклад: замовлено 10 хот-догів клієнту А → частина 3 шт переміщується клієнту Б → додається дочірній рядок з `client_id = Б`, `qty = 3`, `parent_order_id = id оригінального рядка`
- UI показує оригінал і дочірні рядки разом → видно "замовлено 10, передано 3, залишилось 7"
- Поле `delivered_qty REAL` — фактично передана кількість (може відрізнятись від qty)

**Клієнти (`clients`) — додаткові поля:**
- `is_own_shop INTEGER DEFAULT 0` — власний магазин пекарні (клієнт серед клієнтів, але товар туди передається, а не продається). Впливає на логіку "Магазину" і фінансів
- `print_invoice INTEGER DEFAULT 1` — чи друкувати накладну для цього клієнта
- `receiver_name TEXT` — ПІБ того хто приймає товар ("Прийняв" зі старої системи)
- `delivery_agent TEXT` — через кого відправляється ("ВідпЧерез")
- `delivery_note_number TEXT` — номер доручення
- `delivery_note_date TEXT` — дата доручення
- `client_group TEXT` — підгрупа в межах маршруту (напр. назва населеного пункту); використовується для сортування накладних і розміщення в машину

**Вироби (`products`) — початковий залишок:**
- Додати поле `initial_stock REAL DEFAULT 0` — використовується одноразово при першому запуску для внесення початкових залишків у магазині (не поточний залишок, лише seed-значення)

**Фінансові статті — зробити редагованими:**
- Створити таблицю `finance_articles` (id, name, direction CHECK IN ('income','expense'), is_system INT DEFAULT 0)
- `finances.finance_type` замінити на `article_id INTEGER REFERENCES finance_articles(id)`
- Системні статті (is_system=1) не можна видалити, лише редагувати назву
- Оператор може додавати власні статті (is_system=0)
- Початкові системні статті: "Накладна" (expense), "Оплата" (income), "Списання боргу" (expense), "Внесення в касу" (income), "Готівка від водія" (income), "Кредит при обміні" (expense)

#### UX — потокові операції

**Вкладка Замовлення:**
- Ліворуч: дерево Маршрут → (Група) → Клієнт з індикатором "є замовлення сьогодні"
- Правоуч при виборі клієнта: список виробів з полем кількості + підказка "середнє за 30 днів"
- Швидкий перехід до наступного клієнта (кнопка / Enter після останнього поля)
- Вироби впорядковані за частотою замовлень (часто замовлені — зверху)
- Дочірні рядки (переміщення) відображаються під основним рядком у тій же таблиці, відступом
- Перевірка дублів: якщо той самий виріб+клієнт+дата вже є — попереджати, не дублювати

**Вкладка Випічка:**
- Потокове внесення: оператор іде по списку виробів і вносить Спечено + Пайок в один рядок
- Пайок (`ration_qty`) відображається прямо в рядку виробу, не у окремому діалозі
- Після введення — Enter переходить до наступного рядка
- Кнопка "Закрити день" — фіксує результат і переводить статус

**Вкладка Маршрути (робота з водієм):**
- Акцент на внесення **суми від водія** для конкретного клієнта з поточного маршруту
- Список клієнтів маршруту + поле "Сума від водія" поруч (мінімізація помилки "не той клієнт")
- Клієнт з активним замовленням на сьогодні — підсвічений, решта — приглушені
- При кліку на клієнта — розгортається деталь: список виробів замовлення + поле "переміщено/повернено"
- Звідси ж можна ввести дочірній рядок замовлення (переміщення до іншого клієнта або повернення)

**Вкладка Магазин:**
- Верхній блок: **поточний стан продукції на екрані без прокручування** — компактна таблиця/сітка з назвою, типом, ціною, залишком, продано/списано
- Нижній блок або окрема панель: **потокове внесення залишків** — список виробів з полем "Введений залишок" і "Списано", Enter → наступний рядок
- Кнопка підтвердження звірки — тільки після підтвердження дані зберігаються і рахунок закривається

#### Фінанси — покращення інформативності
- Головний екран: картки з підсумками (загальний борг, аванси, нетто, надходження за тиждень/місяць)
- Інтерактивна деталізація: клік на клієнта → розгортається журнал операцій по ньому
- Фільтр по статтях (редаговані статті відображаються в фільтрі)
- Групування по маршрутах в списку клієнтів-боржників

- [x] Додати `parent_order_id` і `delivered_qty` до orders
- [x] Додати поля до clients (is_own_shop, print_invoice, receiver_name, delivery_agent, delivery_note_number, delivery_note_date, client_group)
- [x] Додати `initial_stock` до products
- [x] Замінити finance_type enum на таблицю `finance_articles`
- [x] UX вкладки Замовлення: дерево маршрут→клієнт, підказка середнього, швидка навігація
- [x] UX вкладки Випічка: пайок у рядку, Enter-навігація
- [x] UX вкладки Маршрути: акцент на "сума від водія", розгортання деталі замовлення
- [x] UX вкладки Магазин: картки магазинів + модальна звірка з гнучким періодом, потоковим вводом і касою
- [x] UX Фінанси: картки + інтерактивна деталізація + редаговані статті
- [ ] Резерв для маршруту у розподілі надлишків (`baking_route_reserve`):
  - Опція вже є в dropdown (вмикається в Налаштуваннях → Параметри пекарні)
  - Потрібно реалізувати: вибір конкретного маршруту, автододавання рядка до замовлень або рух у `movements` (тип `in`, route_id заповнений)
  - Узгодити з `daily_balances` і відображенням у вкладці Маршрути

### ✅ Денний звіт пекарні (PDF A4)
- [x] `GET /api/v1/print/daily-report?date=YYYY-MM-DD` → HTML (HTMLResponse, без авторизації як усі `/print/`)
- [x] Секція 1 — Продукція: хліб і булки окремо; колонки Замовлено / Спечено / Обмін / Магазин
  - Спечено: fallback на Замовлено якщо baking_tasks відсутні
  - Обмін: береться з `orders.qty` де `exchange_type != 'none'` (не з `exchange_qty` — у імпортованих даних він завжди 0)
- [x] Секція 2 — Маршрути: по кожному маршруту хліб/булки/обмін/сума; обмін з `orders`, не з `invoice_lines.is_exchange`
- [x] Секція 3 — Фінанси: 3.1 Залишок на початок дня (накопичений з попередніх днів) → 3.2 Клієнтські операції (Накладна першою) → 3.3 Касові операції → 3.4 Залишок в касі
  - `_is_invoice_entry()`: перевіряє тільки назву статті "Накладна" (не `finance_type` — у імпортованих даних касові статті мають `finance_type='invoice'`)
  - ⚠ Баг (виправлено, міграція 041): `create_invoice_finance_entry()` (`backend/services/finance.py`)
    не встановлював `article_id` для боргового запису накладної — лише `finance_type`. Через це
    `_is_invoice_entry()` не розпізнавала запис і помилково враховувала його як рух готівки в
    "Залишок в касі" (подвійний облік боргу клієнтів — борг вже врахований окремо в "Переплата/Борг
    клієнтів"), штучно занижуючи залишок аж до від'ємних значень. Виправлено: `article_id` тепер
    завжди проставляється на 'Накладна' (як і `create_payment_finance_entry` робить для 'Оплата').
    Міграція 041 backfill-ить старі записи без `article_id`.
  - Формат від'ємних сум у "Залишок на початок дня"/"Залишок в касі" (обидва блоки, `prev_block` і
    `bal_block`): `+`/`−`&nbsp;`fmt(abs(x))`, як і всюди в звіті — раніше `bal_block` викликав
    `fmt(cash_balance)` напряму, що для від'ємних сум давало звичайний ASCII-дефіс замість
    стилізованого «−» (U+2212), несумісно з рештою звіту.
  - Підказки (title-тултіп + короткий підпис `.dr-fin-caption`) пояснюють різницю між "Клієнтські
    операції" (борг, не готівка) і "Касові операції" (реальний рух готівки) — додано після скарги
    операторів що не розуміли чому "Залишок в касі" від'ємний.
  - ⚠ Той самий import-артефакт (касові статті мають ненадійний `finance_type`) спричиняв ІДЕНТИЧНИЙ
    баг у `GET /dashboard/` (`backend/routers/dashboard.py`, `_invoice_filter`/`_payment_filter`,
    використовуються для `today.revenue` і `finance.payments_week/month`) — ці фільтри перевіряли
    `article_id.in_(...) OR finance_type == 'invoice'/'payment'` замість лише `article_id`. Через
    OR-fallback "Оплата з каси"/"Виведення з каси" (`finance_type='invoice'`) потрапляли у
    "виручку", а "Списання магазину" (`finance_type='payment'`) — у "надходження". Виправлено:
    фільтри звіряються ЛИШЕ з `article_id`, без fallback. `get_summary()` (`backend/services/finance.py`)
    має той самий шаблон для `income_7d`/`income_30d` (`Finance.finance_type.in_(...)`), але ці поля
    ніде не рендеряться у фронтенді (мертвий вивід) — не виправлено, бо непомітно; виправити перед
    підключенням десь у UI.
  - **`get_cash_balance(db, as_of, exclusive)`** (`backend/services/finance.py`) — спільна функція для
    "Залишок у касі"/"Залишок в касі": та сама формула (сума всіх НЕ-накладних `Finance` записів),
    раніше дубльована окремо в `_dr_section3` (Денний звіт) і відсутня на дашборді фінансів взагалі.
    Тепер обидва місця викликають цю ОДНУ функцію — виключає ризик розійтись. `exclusive=True` —
    строго до `as_of` (для "залишку на початок дня" у звіті); `exclusive=False` (default) — включно
    з `as_of` (для "поточного залишку" на дашборді). Це ІНШИЙ концепт ніж борг/переплата клієнтів
    (`ClientBalance`/`get_all_balances`) — готівка на руках, а не дебіторка.
  - **KPI-картки `FinancesPage.tsx` (`summaryBar`)** — перебудовано після скарги що «Загальний борг /
    Переплати / Чистий баланс» плутають (чистий баланс майже завжди дублює борг, коли переплат
    немає). Замінено на: **«Залишок у касі»** (нова, першою, `summary.cash_balance` — виділена
    класом `summaryCardFeatured`, синя рамка) → **«Борг клієнтів»** (було «Загальний борг»; коли є
    переплати — показує «нетто X грн» у підказці замість окремої картки) → **«Переплата клієнтів»**
    (було «Переплати»). Окрема картка «Чистий баланс» прибрана — вона дублювала «Борг клієнтів» у
    типовому випадку (немає переплат) і плутала операторів трьома майже однаковими числами.
    Магазин/Пайок/Списання — без змін.
  - **`OwnerDashboard.tsx` (вкладка "Дашборд" всередині `FinancesPage.tsx`)** — прибрано верхній
    рядок оновлення ("Дані на N" + час + кнопка "Оновити", лишився лише 5-хвилинний автооновлення)
    і заголовок "ДЕТАЛІ — N" над панеллю деталей дня (дата й так у заголовку картки "Виручка і
    оплати — N") — після видалення 4 KPI-карток над календарем (Фінансовий стан/Топ боржники/
    Замовлення (7 днів)/Надходження — дублювали summaryBar і "Баланси клієнтів") ці елементи стали
    зайвими повторами дати. `.grid` (календар+деталі) також втратив власний `padding: 14px` —
    зайвий відступ порівняно з секцією графіків нижче (`DashboardCharts` не додає власного padding,
    обидві секції спираються лише на `.embedded`).
  - **`DayDetailPanel`**: картка "Виручка і оплати" отримала третій рядок "Виведено з каси" —
    `today.cash_out` (нове поле `get_dashboard()`, сума статей 'Виведення з каси' + 'Оплата з каси'
    за дату, `Finance.amount` без sign). Картки "Замовлення" і "Випічка" об'єднано в одну
    "Замовлення і випічка" — `orders.today_qty` і `baking.ordered` показували те саме число
    (одиниці замовлені сьогодні), дублювання прибрано.
- [x] Вкладка "Звіти": підвкладка `tab==='reports'` всередині `FinancesPage.tsx` (НЕ окремий маршрут — `ReportsPage.tsx` існує у файловій системі, але ніде не імпортується, мертвий файл), датепікер + кнопки "Відкрити звіт PDF" → нова вкладка

### ✅ Міграція з .accdb
- [x] `backend/routers/import_accdb.py` — ендпоінти: upload, preview, context, run, status, result
- [x] `backend/services/import_accdb.py` (~1500 рядків) — повний імпорт:
  - читання .accdb через PowerShell 32-bit OleDb (ACE driver) або pyodbc як fallback
  - preview: перші N рядків кожної таблиці, автовизначення маппінгу колонок
  - import: одиниці → маршрути → вироби → клієнти → фінансові статті → ціни → замовлення → накладні → фінансові операції → звірка балансів → залишки магазину
  - прогрес в реальному часі (SSE або polling `/import/status`)
  - файл зберігається в `DATA_DIR/tmp/` і автовидаляється через 24 год
- [x] `frontend/src/api/importAccdb.ts` + UI сторінка імпорту в AdminPage

### ⬜ Фаза 4 — Розширення
- [ ] Розширені звіти (аналітика, порівняння по тижнях/місяцях)
- [x] Архівування, автобекапи (реалізовано в tray.py + UI налаштувань)

---

## Важливі деталі

- Мова інтерфейсу: **українська**
- SQLite — один файл, повністю офлайн
- Друк через браузер на лазерний принтер (PDF)
- Кілька операторів одночасно (локальна мережа)
- Windows-середовище, проект на локальному диску
  - Task Scheduler (AtLogon) для автозапуску сервера і трею
  - `pythonw.exe` для запуску трею без консольного вікна
- Майбутня підтримка кількох магазинів (архітектурно врахувати)
- Міграція зі старої бази: клієнти, вироби, ціни, замовлення, рухи, фінанси

## Архітектура продакшн-розгортання

### Дві папки PROD

| Папка | Призначення |
|-------|-------------|
| `C:\Program Files\Bakery\` | Код застосунку (git clone) |
| `C:\ProgramData\Bakery\` | Дані: `bakery.db`, `logs/`, `scripts/` |

**Змінна оточення** `BAKERY_DATA_DIR=C:\ProgramData\Bakery` встановлюється в згенерованих скриптах і читається backend та tray.py для визначення де шукати БД і логи.

**Згенеровані скрипти** (НЕ в git, створюються `install-service.ps1` і `update.ps1`):
- `C:\ProgramData\Bakery\scripts\run-server.ps1` — запуск uvicorn з hardcoded шляхами
- `C:\ProgramData\Bakery\scripts\run-tray.ps1` — watchdog для tray.py

`scripts/run-tray.ps1` у репо — статична dev-версія (без `BAKERY_DATA_DIR`), tray.py знаходить DATA_DIR через `_resolve_data_dir()`.

```
C:\Program Files\Bakery\          ← git clone, код
C:\ProgramData\Bakery\
    ├── bakery.db                  ← база даних
    ├── logs/bakery-YYYY-MM-DD.log ← лог сервера (файл на добу; переглядач: log_viewer.py)
    └── scripts/
            ├── run-server.ps1    ← згенерований install/update
            └── run-tray.ps1      ← згенерований install/update

Windows Task Scheduler → BakeryApp (AtLogon, перезапуск 5×/хв)
    └── C:\ProgramData\Bakery\scripts\run-server.ps1
            ├── встановлює BAKERY_DATA_DIR
            ├── вбиває orphan-процеси uvicorn (fix порту 8000)
            └── uvicorn backend.main:app --host 0.0.0.0 --port 8000
                    ├── /api/v1/...     FastAPI роутери
                    └── /*              frontend/dist (React SPA, StaticFiles)

Windows Task Scheduler → BakeryTray (AtLogon)
    └── C:\ProgramData\Bakery\scripts\run-tray.ps1  (watchdog)
            └── pythonw C:\Program Files\Bakery\tray.py
                    ├── _resolve_data_dir() → C:\ProgramData\Bakery
                    ├── моніторить /api/health кожні 5 сек
                    ├── _poll_flags() кожні 2 сек — RESTORE/DEMO flags
                    ├── перевіряє GitHub tags раз на годину
                    └── керує Task Scheduler задачами (BakeryApp, BakeryTray)
```

**Важливо:** `frontend/dist` будується при `install-service.bat` і `update.bat`.
У git не зберігається (`.gitignore`). При dev-режимі — Vite на порту 5173.

**Dev-інструменти** (`dev/`, gitignored, не потрапляють клієнту):
- `dev/release.ps1` — реліз на GitHub
- `dev/create-installer.ps1` — генерує інсталятор з токенами
- `dev/generate_demo_db.py` — демо-база
- `Bakery-Setup.ps1` / `scripts/Bakery-Setup.ps1` — gitignored (містять OAuth токени)

## Стиль коду
- Python: PEP8, type hints скрізь, docstrings для сервісів
- React: TypeScript, функціональні компоненти, hooks
- SQL: явні назви полів, без `SELECT *`
- Коментарі: українською де пояснюється бізнес-логіка

## Git workflow
- Після кожної завершеної функції: commit + push на main
- Commit message формат: `feat: назва функції` / `fix: опис`  
- Перед push — запустити pytest (backend) і npm run build (frontend)
- Гілки: main (стабільний), dev (розробка), feature/* (фічі)

### Оновлення документації при релізі

**ПРАВИЛО: перед виставленням версії (тег + GitHub Release) — завжди:**
1. Додати в `CLAUDE.md` зміни, внесені цим релізом: нові таблиці/поля БД,
   нові роутери/ендпоінти, нові сторінки/вкладки фронтенду, зміни бізнес-логіки.
   Короткий запис у відповідний розділ схеми/API/фаз розробки — не обов'язково
   окремий release-notes блок для кожної дрібної версії (ті лишаються для
   значущих релізів, як `## Реліз v1.3.0 — ...`).
2. Перевірити чи потребує оновлення **довідка користувача**
   (`frontend/src/pages/HelpPage.tsx`) — окремий документ від CLAUDE.md,
   написаний для операторів простою мовою (не технічний). CLAUDE.md
   документує код для AI-агента; HelpPage.tsx пояснює робочий процес людям.
   Вони легко розходяться, бо зміни в програму вносяться, а обидва довідники
   оновлюються вручну. Перевірка: чи згадана нова вкладка/кнопка/поле в
   HelpPage.tsx, чи не описує застарілий воркфлоу (напр. кроки, яких вже
   немає, або яких бракує після зміни бізнес-логіки).

Обидва пункти — частина визначення "завершено" для будь-якої функції, що
змінює структуру даних, API або UI, не окрема задача "колись потім".

## Відомі обмеження

- **SQLite WAL mode**: один файл, обмеження на конкурентні writes (~50/сек). Для пекарні з кількома операторами на локальній мережі — більш ніж достатньо.
- **Telegram бот**: один токен на одну пекарню. Якщо потрібно кілька пекарень з ботами — окремий токен у налаштуваннях кожної.
- **Архівування**: ручне через UI (Налаштування → Бекапи → Архівувати). Автоматичне за розкладом не реалізоване — додати у наступних версіях.
- **Cloud-бекап (Google Drive/OneDrive/Dropbox)**: працює через локальну папку синхронізації. Якщо клієнт-додаток хмари не запущений — копія залишиться лише локально.
- **Шифрування БД**: SQLite БД не шифрована. Захист — через права Windows (`C:\ProgramData\Bakery` доступний лише адміну машини).
- **Архітектура для одного магазину**: код підтримує кілька магазинів через `client_kind='shop'`, але UI оптимізовано під 1-3 точки.
- **PDF Денного звіту в Telegram (`/dailyreport`)**: потребує встановленого Microsoft Edge або Chrome на машині сервера (`_find_chromium()`, `backend/routers/print_views.py`) — headless-друк через нього. Обидва зазвичай уже є на Windows 10/11 за замовчуванням; якщо відсутні — команда відповідає повідомленням про помилку, решта бота продовжує працювати.

## Безпека (стан на v1.1.x)

- **Паролі**: bcrypt (cost=12) з прозорим апгрейдом legacy SHA256 при login
- **API auth**: усі мутації (POST/PUT/PATCH/DELETE) на роутерах вимагають Bearer токен через `require_user`/`require_admin`
- **Rate-limiting**: на `/auth/login` — in-memory dict `{ip: attempts}`, >5 спроб за 5 хв → 429 Too Many Requests з `Retry-After` header (cleanup кожні 10 хв)
- **Сесії**: таймаут **30 днів неактивності** через `UserSession.last_used_at` — оновлюється при кожному `get_current_user`, прострочені сесії видаляються автоматично (міграція 028)
- **OAuth токени**: зберігаються відкритим текстом у налаштуваннях БД (запланований Batch 4.2 — шифрування Fernet з ключем у `BAKERY_DATA_DIR/.fernet_key`)
- **Frontend API token (v1.1.7)**: усі raw `fetch()` у `frontend/src/api/*.ts` переведено на централізований `api/client.ts` що додає `Authorization: Bearer <token>` з `localStorage.bakery_token`. Для FormData-upload (`importAccdb`, `issues/assets`) — окрема обгортка з ручним додаванням headers.

## Критичні знахідки передрелізного QA-аудиту (виправлено)

Повний передрелізний аудит (5 областей, живе тестування на відновленому
бекапі клієнта) виявив 6 критичних знахідок — усі виправлені:

1. **Від'ємна кількість у `PUT /invoices/{id}/lines` без перевірки**
   (`backend/schemas/invoices.py`, `InvoiceLineQtyUpdate.qty`) — мінус на
   мінус (`qty=-50`, `price_override=-100`) давав позитивну суму, довільно
   роздуваючи `total_sum` накладної. Виправлено: `Field(..., ge=0)`.
   Тест: `tests/test_invoice_line_qty_validation.py`.
2. **Дашборд власника ігнорував обрану дату для всіх фінансових цифр**
   (`backend/routers/dashboard.py`, `get_dashboard()`) — `get_summary()`/
   `get_all_balances()` викликались без `as_of`, тож борг/каса/переплата/
   топ-боржники завжди рахувались "на зараз" незалежно від календаря.
   Підтверджено: три різні дати з понад місяцем реальної роботи між ними
   давали побайтово ідентичний результат. Виправлено: `as_of=today` у
   обох викликах. Тест: `tests/test_dashboard_date_param.py`.
3. **Корекція вже прийнятої ІМПОРТОВАНОЇ накладної дублювала борг
   клієнта** (`backend/services/finance.py`) — `create_invoice_finance_entry()`/
   `recompute_invoice_finance()` шукали існуючий борговий запис через
   `Finance.notes == invoice_number`; для 99.7% імпортованих накладних
   `notes` — вільний текст, не номер. Корекція (`/invoices/{id}/transfer`,
   `PUT /invoices/{id}/lines`) не знаходила існуючий запис і створювала
   другий. Виправлено: `_find_invoice_finance_entry()` — fallback за
   `(client_id, finance_date)` коли для цієї пари існує рівно одна
   накладна (та сама пара, за якою й сам імпорт групував замовлення в
   накладні); міграція **045** backfill-ить `notes` для однозначних
   історичних випадків. Тест: `tests/test_invoice_finance_dedup_import.py`.
4. **`github_issues_token` віддавався у відкритому тексті будь-якій ролі**
   (`backend/routers/settings.py`, `_ALWAYS_STRIP`) — токен не був у
   списку прихованих полів; `GET /settings/` віддавав його навіть ролі
   `seller`. Виправлено: додано до `_ALWAYS_STRIP`. Тест доповнено в
   `tests/test_auth_protection.py`.
5. **Редактор бази даних (`/db-editor`) показував `user_sessions.token` і
   `users.password_hash`/`salt` у відкритому, редагованому вигляді** —
   скопіювавши токен сесії з відповіді, можна увійти під тим користувачем
   без пароля. Виправлено: `_mask_row()` маскує ці поля у `GET .../data`;
   `PUT .../row/{pk}` ігнорує спроби записати їх (захист від бездумного
   "відкрити рядок → зберегти", що перезаписало б реальний токен/хеш
   буквальним текстом маски). Тест: `tests/test_db_editor_sensitive_masking.py`.
6. **`/baking` у Telegram-боті падав з TypeError, коли випічка ще не
   введена повністю** (`backend/services/telegram_bot.py`, `_report_baking()`)
   — `baked_qty IS NULL` (навмисно, не 0), а функція рахувала
   `sum()`/порівнювала/форматувала це значення напряму. Підтверджено на
   реальних даних: 53/53 і 54/54 завдань з `baked_qty IS NULL` — команда
   падала (бот мовчав) велику частину типового робочого дня. Виправлено:
   `None` трактується як 0 у сумі; рядки без введеного результату
   показують "?" замість формату `None`. Тест:
   `tests/test_telegram_bot_baking_report_null.py`.

## Високі знахідки QA-аудиту — Розділ 1: Замовлення → Маршрути → Випічка (виправлено)

Той самий аудит, 16 "високих" знахідок, розбір по розділах звіту. Розділ 1
(7 знахідок):

1. **Самопереміщення в `/orders/{id}/transfer` не блокувалось**
   (`backend/routers/orders.py`, `transfer_order`) — можна було перемістити
   рядок замовлення тому ж клієнту, створюючи безглуздий дублікат-дочірній
   рядок. Це чернеткова стадія (`parent_order_id`/`origin_id`, до формування
   накладних) — не той самий ендпоінт, що обробляє "продано як звичайний"
   для обмінного хліба (`/invoices/{id}/transfer`, стадія ПІСЛЯ формування
   накладних, `source_line_kind='exchange'`), тож заборона тут нікого не
   зачіпає. Виправлено: `to_client_id == parent.client_id` → 400, без
   винятку.
2. **FK-порушення в замовленнях давало оманливий 409** (`create_order`,
   `transfer_order`) — неіснуючий `client_id`/`product_id` падав на
   `IntegrityError` бази ("запис вже існує") замість чіткого 404.
   Виправлено: явна перевірка існування перед збереженням.
3. **Борг магазину створювався при прийнятті накладної без перевірки типу
   клієнта** (`backend/services/finance.py`,
   `create_invoice_finance_entry()`) — перевірка `client_kind`/`is_own_shop`
   була лише в `recompute_invoice_finance()` (корекції), не в самому
   прийнятті. Магазин (`client_kind='shop'`) не повинен мати борг — він
   розраховується через звірку. Виправлено: та ж перевірка на початку
   функції, одразу закриває всі 3 місця викликів у `invoices.py`.
4. **Помилки валідації (422) англійською технічним жаргоном**
   (`backend/main.py`) — Pydantic-повідомлення типу "Input should be
   greater than or equal to 0" доходили до оператора напряму. Виправлено:
   глобальний `exception_handler(RequestValidationError)` перекладає
   найпоширеніші типи помилок українською для всіх ендпоінтів.
5. **`PUT /orders/{id}` не давав очистити nullable-поле** (`update_order`)
   — той самий баг класу, що вже був виправлений у `clients.py`:
   `exclude_none=True` викидав з патча явний `null`. Виправлено:
   `exclude_unset=True`.
6. **"Спечено" без індикатора збереження** (`frontend/src/pages/BakingPage.tsx`,
   `handleBakedChange`) — оператор не бачив, чи значення дійшло до сервера.
   Додано saving/saved/error стан на клітинку (той самий шаблон, що в
   `OrdersPage.tsx`/`OrderModal.tsx`).
7. **Кнопки могли застигнути назавжди без try/finally** — `RoutesPage.tsx`
   (`handleSend`, `handleAccept`, `acceptChecked`), `BakingPage.tsx`
   (`handleGenerate`). Якщо запит падав — кнопка лишалась заблокованою
   до перезавантаження сторінки. Виправлено: try/finally (той самий
   шаблон, що вже правильно був у `sendMachines`); `acceptChecked` заразом
   отримав per-item try/catch + підсумковий toast, як `sendMachines`.

Тести: `tests/test_orders_high_findings.py`, `tests/test_invoice_accept_shop_no_debt.py`,
`tests/test_validation_error_translation.py`.

## Високі знахідки QA-аудиту — Розділ 3: Фінанси, звіти, дашборд (виправлено)

Розділ 3 (5 знахідок):

1. **Редагування суми не перевіряло дату на бекенді** (`backend/routers/finances.py`,
   `update_finance`, PATCH) — фронтенд показує кнопку ✏ лише для
   `finance_date == workDate` (дата в хедері, будь-яка, довільно змінювана
   оператором), але сам ендпоінт цього не перевіряв: прямий виклик API міг
   відредагувати суму БУДЬ-ЯКОГО історичного запису редагованої статті.
   Виправлено: `_current_work_dates()` рахує на сервері ту саму "поточну
   робочу дату" за формулою фронтенду (`Layout.tsx`, `computeEffectiveDate`
   — час переходу з налаштування `work_date_next_day_time`, default 18:00)
   плюс попередній день (легітимна "робота за вчора"); `update_finance`
   відхиляє (400) редагування за межами цього вікна.
2. **Друкована "Боргова відомість" показувала службові рахунки як
   боржників** (`backend/routers/print_views.py`, `debts_report`) —
   Списання/Пайок/Недопечено/Магазин (`client_kind != 'customer'`) не
   фільтрувались, хоча це внутрішні бухгалтерські рахунки. Виправлено:
   фільтр `client_kind == 'customer'`, як в усіх інших звітах.
3. **`POST /finances/` не перевіряв sign проти напрямку статті**
   (`create_finance`) — можна було створити "дохід" зі знаком `-1` (чи
   навпаки), спотворюючи суми, що групуються за напрямком (баланси, звіти).
   Виправлено: `sign` має відповідати `article.direction` (income → +1,
   expense → -1), інакше 422.
4. **Перейменування системної статті ламало б код** (`backend/routers/finances_articles.py`,
   `update_article`) — назва системних статей звіряється буквально в кількох
   місцях (`backend/services/finance.py`, `print_views.py`: "Накладна",
   "Оплата" тощо). Виправлено: зміна `name` для `is_system=1` блокується
   (400); `direction`/`editable` лишаються редагованими.
5. **Дублікат назви статті дозволявся для НЕ-системних** (`create_article`,
   `update_article`) — унікальність раніше перевірялась лише для системних
   статей (частковий унікальний індекс, міграція 031). Виправлено: явна
   перевірка унікальності `name` для будь-якої статті при створенні й
   перейменуванні (409).

Тести: `tests/test_finance_patch_date_guard.py`,
`tests/test_debts_report_excludes_system_clients.py`,
`tests/test_finance_article_sign_and_rename_guards.py`.

## Високі знахідки QA-аудиту — Розділ 4: Довідники, адмін, безпека (виправлено)

Розділ 4 (2 з 3 — гранульовані права ролей відкладено в окрему хвилю, див.
Контекст у плані аудиту: не дірка безпеки, fail-safe — просто не дає прав,
які власник реально налаштував):

1. **`/auth/github/*` без авторизації** (`backend/routers/auth_github.py`) —
   Device Flow (`/start`, `/poll`), статус (`/status`) і `/logout` не мали
   жодної залежності auth: будь-хто в локальній мережі міг запустити OAuth
   Device Flow пекарні або відкликати вже підключений GitHub-акаунт.
   Виправлено: `dependencies=[Depends(require_admin)]` на рівні роутера (як
   уже було в `import_accdb.py`). Не зачіпає `IssuesWidget.tsx` (💬 на всіх
   сторінках, усі ролі) — там `getGitHubStatus()` лише для необов'язкового
   аватара автора коментаря, обгорнутий у `.catch(() => {})`; сам сабміт
   звернення йде через `/issues`, не `/auth/github/*`.
2. **GET довідників читались без входу взагалі** — `products.py`,
   `clients.py`, `prices.py`, `routes.py`, `categories.py`,
   `client_groups.py`, `ingredients.py` (включно з `margin-report` —
   собівартість/маржа). Мутації (POST/PUT/DELETE) вже мали `require_admin`,
   але самі GET-и не мали НІЯКОЇ залежності — будь-хто в локальній мережі
   без токена міг прочитати повний список клієнтів (адреси, телефони,
   знижки), ціни, склад інгредієнтів, маржинальність. Виправлено:
   `Depends(require_user)` на кожен GET (без прив'язки до конкретної
   ролі — те саме узгоджене рішення, що для гранульованих прав вище;
   `bulk-preview` у `prices.py` — виняток, лишився `require_admin`, бо це
   попередній перегляд саме адмінської масової зміни цін, не звичайний
   довідник).

Тести: `tests/test_auth_protection.py` (розширено).

## Високі знахідки QA-аудиту — Розділ 5: Звернення / підтримка (виправлено)

Останній розділ 16 "високих" знахідок (1 пункт) — останній пункт плану:

1. **"Звернення" (💬, `IssuesWidget.tsx` — кнопка в інтерфейсі програми, НЕ
   Telegram-бот) без авторизації взагалі** (`backend/routers/issues.py`) —
   жоден з 5 ендпоінтів (`GET /`, `GET /{n}/comments`, `POST /`,
   `POST /{n}/comments`, `POST /assets`) не мав auth-залежності: будь-хто в
   локальній мережі без токена міг читати й писати звернення клієнта на
   GitHub від імені пекарні (репозиторій приватний, але прохід йшов через
   сервер пекарні з уже вбудованим `github_oauth_token`). Виправлено:
   `dependencies=[Depends(require_user)]` на рівні роутера (як у `bot.py`);
   `add_comment`/`create_issue` — `Optional[User] = Depends(get_current_user)`
   → `User = Depends(require_user)` (підпис автора коментаря/звернення
   гарантовано є, `if user else` fallback на анонімний `gh_login` прибрано
   як мертвий код).

Тести: `tests/test_auth_protection.py` (розширено).

Цим закрито всі 16 "високих" знахідок передрелізного QA-аудиту (гранульовані
права ролей — єдиний пункт, свідомо відкладений в окрему хвилю за
узгодженням з користувачем).

## Середні знахідки QA-аудиту — Розділ 1: Замовлення → Маршрути → Випічка (виправлено)

Той самий аудит, 17 "середніх" знахідок. Розділ 1 (6 знахідок):

1. **Дата замовлення приймала будь-який текст** — `backend/schemas/orders.py`
   (`OrderCreate.order_date`). Підтверджено в реальній базі: рядки з
   `"not-a-date"` і неіснуючою датою `"2028-02-30"`. Виправлено:
   `field_validator` через `date.fromisoformat` (відкидає і формат, і
   неіснуючі календарні дати).
2. **Зведений вид не блокував архівні дати** —
   `frontend/src/components/GridOrderModal.tsx`. Звичайна форма замовлення
   коректно блокує редагування застарілих дат (`isDateLocked`, налаштування
   `order_past_days`) — Зведений вид цю перевірку не отримував: `isLocked()`
   рахував лише `locked_client_ids` (накладна вже сформована), не дату.
   Виправлено: проп `isDateLocked` прокинуто з `OrdersPage.tsx`, `isLocked()`
   тепер `isDateLocked || locked_client_ids.includes(cid)` — одна точка
   входу, автоматично покриває і рендер клітинки, і вставку з Excel.
3. **«Сформувати накладні» для вкладки «Внутрішні» формувало накладні для
   ВСІХ маршрутів** — `backend/routers/invoices.py` (`generate_drafts`),
   `frontend/src/pages/RoutesPage.tsx` (`generateInvoices`). Лічильник на
   кнопці рахував лише внутрішніх клієнтів (`route_id IS NULL`), але
   `route_id` не передавався взагалі для цієї вкладки (`activeRouteId===-1`
   не проходило умову `>0`) — бекенд формував для клієнтів усіх маршрутів.
   Виправлено: `route_id=0` — новий сентинел "без маршруту" (реальні
   `route_id` завжди autoincrement ≥1) — `generate_drafts()` фільтрує
   `Client.route_id.is_(None)`; фронтенд відправляє `route_id=0` для
   вкладки «Внутрішні».
4. **Немає кнопки скасування накладної** — додано кнопку «❌ Скасувати»
   (draft/sent → cancelled, `RoutesPage.tsx`, `InvoiceDetailPanel`) за
   підтвердженням (`useConfirm`, danger). Бекенд і так підтримував статус
   `cancelled` повністю. Доступність контролюється новим налаштуванням
   **`enable_invoice_cancel`** (0/1, default 0) — AdminPage → Налаштування
   → Параметри пекарні → Додаткові функції, за зразком інших перемикачів
   цієї секції; кнопка прихована для магазинів (закриваються через Випічку).
5. **Редагування вже розподіленого надлишку без верхньої межі** —
   `frontend/src/pages/BakingPage.tsx` (`handleSaveSurplusEdit`).
   Додавання нового надлишку клемпиться `surplusRemaining` — редагування
   вже внесеного рядка цього не мало. Виправлено: та сама верхня межа
   (`line.qty + surplusRemaining`), і в `<input max=...>`, і в обробнику.
6. **Вставка з Excel без підсумку** — `GridOrderModal.tsx` (`handlePaste`).
   Додано toast після вставки: «Вставлено N значень у M рядків (пропущено
   K заблокованих)».

Тести: `tests/test_order_date_validation.py`,
`tests/test_generate_drafts_internal_route_sentinel.py`.

## Середні знахідки QA-аудиту — Розділ 3: Фінанси, звіти, дашборд (виправлено)

Розділ 3 (2 з 3 — owner-роль узгоджено як частину відкладеної хвилі
гранульованих прав, без окремого фіксу):

1. **Видалення фінансового запису не лишало сліду в audit_log** —
   `backend/routers/finances.py` (`delete_finance`). Захист від видалення є
   лише для боргового запису накладної — решта видалень (включно з
   автозаписами оплат, `created_by='system'`) проходили без жодного сліду,
   на відміну від редагування суми (яке завжди аудитується). Виправлено:
   `write_audit()` зі знімком `amount`/`notes` перед видаленням запису
   (запис у `audit_log` лишається після видалення самого запису — це і є
   ціль аудит-логу, історія переживає сам об'єкт).
2. **Owner-роль технічно може змінювати фінанси** — узгоджено з користувачем:
   у власника немає окремого read-only статусу, доступ керується тими самими
   чекбоксами гранульованих прав, що й в інших ролей (`role_permissions`, не
   перевіряється на бекенді — та сама, вже відкладена в окрему хвилю High-
   знахідка "Довідники/Адмін №1"). Без окремого фіксу тут.
3. **"Залишок у касі" = 0,00 до реального переходу на нову систему, без
   позначки** — перевірено напряму на реальній копії бази (`bakery.db`,
   42147 фін. записів): сума всіх НЕ-накладних записів (Оплата/Оплата з
   каси/Виведення з каси/Списання боргу/Внесення в касу) на будь-яку
   проміжну дату до 15.09.2026 — математично ~0.00 на 8 контрольних датах
   підряд (з кроком у місяць). Це НЕ баг імпорту — `import_accdb.py`
   імпортує всю історію з реальними датами без обрізання
   (`finance_cutoff = None`). Причина в самих вихідних даних: стара
   Access-система не вела окремий "залишок у касі" як накопичувану
   величину — кожен реальний прихід (Оплата) в старому обліку симетрично
   гасився видатковим записом (Оплата з каси/Виведення з каси) того ж
   старого обліку, тож сума історично й структурно дає нуль незалежно від
   дати; розраховувати нема з чого. Виправлено: нове налаштування
   **`cash_tracking_start_date`** (порожньо = вимкнено, AdminPage →
   Налаштування → Параметри пекарні). Для дат до цієї межі — Денний звіт
   (`_dr_section3`, спільний хелпер `_cash_cell()`) і картка "Залишок у
   касі" на `FinancesPage.tsx` показують примітку "дані каси до {дата} не
   відстежувались окремо (перенесено зі старої системи)" замість цифри
   `0,00`, яка виглядала як реально порахований нуль.

Тести: `tests/test_finance_delete_audit_and_cash_marker.py`.

## Повторний аудит "Магазин/POS" — критична + високі знахідки (виправлено)

Розділ "Магазин/POS" оригінального аудиту не зберігся (технічний збій сесії
планування) — повторено окремим проходом живого тестування (dev-сервер,
відновлена копія реальної продакшн-бази, зворотні тестові записи з
префіксом AUDIT-TEST, прибрані після перевірки). Знайдено критичну і кілька
високих знахідок — виправлено негайно, окремо від планового проходу
"середніх" знахідок.

1. **Критична: майже весь `backend/routers/shop.py` (27 ендпоінтів) без
   авторизації взагалі** — лише 4 з 27 мали `require_user`; решта
   (`confirm_reconciliation` — закриває звірку + пише фінансовий запис,
   `delete_reconciliation`, `add_disposal`, `create_receipt`, `get_summary`,
   `pos/products` тощо) були доступні будь-кому в локальній мережі без
   токена. Підтверджено живими запитами без заголовка Authorization: `GET
   /shop/summary` → 200 з реальними цифрами, `POST /shop/receipts` → 201
   (реально створений рядок). Виправлено: `dependencies=[Depends(require_user)]`
   на рівні роутера (як `bot.py`/`issues.py`). Заразом: `confirm_reconciliation`,
   `delete_reconciliation`, `update_opening_cash` — закриваючі/видаляючі дії
   над звіркою — додатково заблоковано для ролі `seller` (новий хелпер
   `_forbid_seller`) — POS-каса, обмежена на фронтенді лише сторінкою `/pos`;
   без цієї перевірки продавець міг напряму викликати ці ендпоінти через API.
2. **Кількості/ціни без нижньої межі** (`backend/schemas/shop.py`) — той
   самий клас багу, що вже виправлений для накладних. Підтверджено:
   від'ємне списання роздуло очікувану готівку з 252 до 28252; продаж з
   qty=-5 підняв залишок товару замість зменшити. Виправлено: `Field(gt=0)`
   на `qty`/`entered_balance`, `Field(ge=0)` на ціни, `Field(min_length=1)`
   на `ShopSaleCreate.lines` (заразом закрито окремий "медіум" — порожній
   список рядків продажу давав необроблений 500 через `lines[0]`).
3. **Надходження заднім числом у вже закритий період мовчки зникало і не
   видалялось** — `create_receipt` не мав перевірки на закритий діапазон
   (яку `delete_receipt` вже мав, лише навпаки): товар одразу зникав з усіх
   екранів (`compute_current_stock` рахує "отримано" лише від
   `last_closed.period_to+1`) і не міг бути видалений через API. Виправлено:
   дзеркальна перевірка в `create_receipt` (409, дата має бути після
   закритої звірки).
4. **Неіснуючий client_id/product_id — оманливий 409 або необроблений 500**
   — `create_receipt` (409 "запис вже існує" замість 404, той самий клас
   багу що вже виправлений в `orders.py`), `add_disposal` (client_id для
   `disposal_type='client'` — `db.flush()` поза `safe_commit` пропускав
   `IntegrityError` необробленим, чистий 500). Виправлено: явні перевірки
   існування (404) перед вставкою.

**Побічно знайдено і виправлено — прихована втрата даних на СВІЖІЙ базі**
(виявлено власним регрес-тестом, не оригінальним аудитом): міграція
`014_shop_line_batch_date.sql` перебудовує `shop_reconciliation_lines`/
`shop_disposal_lines` через create-copy-DROP-rename. `run_migrations()`
(`backend/database.py`) ділив SQL-файл на statements наївно по `;`, а
коментарі прибирав лише ЦІЛИМИ рядками — коментар із крапкою з комою
всередині тексту (напр. "дата надходження/випічки; NULL = залишок...")
розрізав `CREATE TABLE ..._v2` навпіл, ламаючи його синтаксично. Оскільки
`CREATE TABLE ..._v2` падав, а безумовні `DROP TABLE shop_reconciliation_lines`/
`shop_disposal_lines` у тому ж файлі — окремі, синтаксично чисті statements —
виконувались УСПІШНО, обидві таблиці видалялись НАЗАВЖДИ без відновлення
на будь-якій свіжій інсталяції (реальний prod bakery.db не постраждав —
міграція була позначена застосованою задовго до того, як цей коментар
зіпсувався; проблема виявилась лише зараз, на тестовій БД, бо жоден
попередній тест не створював базу даних з нуля). Виправлено:
`_strip_sql_comments()` прибирає `--`-коментарі по рядку (до кінця рядка) ще
ДО поділу на statements; окремо — сам факт, що `create_all()` на свіжій базі
вже створює `shop_reconciliation_lines` з `batch_date` (фінальна схема),
робить весь create-copy-rename в 014 зайвим і руйнівним — файл тепер
повністю пропускається, якщо колонка вже є, з прямим `CREATE UNIQUE INDEX
IF NOT EXISTS` для двох partial-індексів, які він мав встановити.

Тести: `tests/test_shop_auth_and_validation.py`.

## Середні знахідки QA-аудиту — Розділ 4: Довідники, адмін, безпека (виправлено)

Розділ 4 (5 знахідок):

1. **Перетин дат ціни не перевірявся, коли задані ОБИДВІ дати** —
   `backend/routers/prices.py` (`create_price`). Перевірка колізії була
   лише в гілці безстрокової ціни (`valid_to is None` — автозакриття
   попередніх) — коли явно задані і `valid_from`, і `valid_to`, перевірки
   не було взагалі: дві ціни з накладеними діапазонами могли існувати
   одночасно (система мовчки бере новішу за `valid_from`, а стара сама
   собою "відновлюється" після дати закінчення нової). Виправлено: та сама
   перевірка перетину, що вже є в `replace_price` (409, з датами
   конфліктної ціни в повідомленні).
2. **Кнопка «Відновити» маршруту не працювала** — `backend/routers/routes.py`
   (`update_route`) приймав `RouteCreate` (без поля `is_active` — фізично
   не міг встановити активність) і використовував `model_dump()` без
   `exclude_unset` (будь-яке часткове збереження скидало `sort_order` на
   0 — `RouteCreate.sort_order` default `0`). Виправлено: нова схема
   `RouteUpdate` (усі поля `Optional`, включно з `is_active`) +
   `exclude_unset=True` (той самий фікс, що вже застосований для
   clients/orders цієї сесії). Фронтенд вже надсилав `is_active: 1`
   правильно — прогалина була суто в бекенд-схемі.
3. **Однакову назву маршруту можна було створити двічі** —
   `backend/models/references.py` (`Route.name` — без `unique=True`).
   Повідомлення "Маршрут із такою назвою вже існує" (`safe_commit`
   conflict_msg) вже було написане в коді, але не мало DB-обмеження, яке
   могло б його викликати. Перевірено на реальній базі — дублікатів
   немає. Виправлено: міграція **046** — unique index на `routes.name` і
   на `client_groups(name, route_id)` (та сама прогалина; групи вже мали
   готовий `conflict_msg`, теж ніколи не спрацьовував).
4. **Пароль без мінімальної довжини** — `backend/routers/auth.py`
   (`UserCreate`, `UserUpdate`). Підтверджено: пароль `"1"` створювався і
   одразу працював для входу. Виправлено: `field_validator`, мінімум 6
   символів (`MIN_PASSWORD_LENGTH`).
5. **Ім'я файлу бекапу без перевірки виходу за межі папки** —
   `backend/services/backup.py` (`delete_backup`, `get_backup_meta`,
   `restore_backup`) і `backend/routers/backup.py` (`download_backup`,
   `restore_backup` — той самий клас проблеми в роутері, побудова шляху
   напряму, без сервісних функцій; `restore_backup` — найнебезпечніше
   місце, бо `backup_path` іде напряму в `tray.py`'s SQLite backup API
   поверх живої `bakery.db`). Виправлено: `Path(filename).name` (голе
   ім'я файлу, без `../`/шляхових роздільників) у всіх п'яти місцях —
   той самий мінімальний принцип, що вже застосований для роздачі
   фронтенду (`backend/main.py`, `.resolve()`+`is_relative_to`).

Тести: `tests/test_prices_overlap_and_route_fixes.py`,
`tests/test_password_min_length.py`, `tests/test_backup_path_traversal.py`.

## Середні знахідки QA-аудиту — Розділ 5: Telegram-бот, звернення (виправлено)

Розділ 5 (2 з 3 — п.3 залишено як відоме обмеження за рішенням користувача):
остання секція плану "середніх" знахідок.

1. **Помилка форматування шаблону бота ламала ВСІ підтвердження/відхилення/
   зміни кількості через бота** — `backend/routers/bot.py` (`verify_order`,
   `broadcast_reminder`, `broadcast_deadline`). `tpl.format(...)`
   викликався напряму як аргумент `_send_to_client()` — якщо
   адмін-редагований шаблон (Налаштування → Бот → Шаблони) містив биту
   плейсхолдер-дужку, виняток стався ДО `safe_commit`, тож сама зміна
   статусу замовлення взагалі не зберігалась (а для розсилок — падіння на
   ПЕРШОМУ ж клієнті переривало розсилку всім іншим). Виправлено: новий
   хелпер `_safe_notify()` — форматування і надсилання обгорнуті в
   try/except; помилка лише логується (`log.warning`), решта дії
   (збереження статусу замовлення / продовження розсилки іншим клієнтам)
   виконується як завжди.
2. **Помилка звернень завжди звинувачувала інтернет** —
   `frontend/src/components/IssuesWidget.tsx` (`loadIssues`,
   `handleSubmit`). Реальна причина від сервера (напр. 503 "GitHub не
   налаштовано") повністю відкидалась — статичний текст завжди казав
   "перевірте підключення до інтернету", навіть коли причина геть інша.
   Виправлено: новий хелпер `extractApiErrorDetail()` дістає `detail` з
   тіла помилки (`api/client.ts` кидає `Error` з JSON відповіді сервера в
   тексті) і показує його як є; статичний текст лишається лише як
   fallback, коли розпарсити нічого (справжня мережева помилка).
3. **«Мої звернення» показує звернення всіх і підписує чужі як «Ви»** —
   узгоджено з користувачем: залишено як відоме обмеження (спільний
   GitHub-акаунт для всіх співробітників = спільний простір звернень за
   задумом, без окремого фіксу).

Тести: `tests/test_bot_template_error_resilience.py`.

Цим закрито всі 17 "середніх" знахідок передрелізного QA-аудиту (п.2
Розділу 3 і п.3 Розділу 5 — свідомо без окремого фіксу за узгодженням з
користувачем; Магазин/POS — окремий повторний аудит, критична + високі
знахідки виправлені окремо, див. вище).

## Низькі знахідки QA-аудиту — Розділ 1: Замовлення/Маршрути/Випічка (виправлено)

Останній шар того самого аудиту — 19 "низьких" знахідок з оригінального
звіту + 2 з повторного аудиту Магазину. На відміну від Critical/High/
Medium, це суміш реальних дрібних багів, мертвого коду і застарілого
тексту — не все отримує код-фікс. Версія `v1.5.0` виставлена локально
(тег, без пуша) одразу після завершення всіх Critical/High/Medium фіксів.

Розділ 1 (4 з 5 — п.2 без фіксу):

1. **Незахищене поле ціни в «% Знижка»** — `backend/schemas/orders.py`
   (`OrderCreate.price_override`, `OrderUpdate.price_override`).
   Клієнтський `min={0}` на `<input>` (`OrderModal.tsx:581`) не заважає
   ввести від'ємне число напряму з клавіатури — бекенд взагалі не
   перевіряв. Виправлено: `Field(None, ge=0)` — той самий фікс, що вже є
   для `qty`.
2. **Enter не переходить до наступного клієнта** — узгоджено з
   користувачем: пропущено (реалізація функції, не "низький" фікс).
   Задокументовано в CLAUDE.md (розділ Фаза 3.5) як не відповідне
   реальному стану — механізму переходу між клієнтами в `OrderModal.tsx`
   немає взагалі, лише перехід між виробами одного клієнта.
3. **Немає підтвердження при видаленні рядка надлишку/обмінної знижки** —
   `BakingPage.tsx` (`handleDeleteSurplus`), `OrderModal.tsx`
   (`handleDeleteExtraLine`). Додано `useConfirm()` перед видаленням — за
   зразком уже використаного в цих файлах для інших дій. Аудит-лог НЕ
   додається — видалення цих рядків (`orders`/`invoice_lines`) не входить
   у поточне охоплення `audit_log` (лише UPDATE перелічених полів);
   розширення охоплення на DELETE — окрема, більша задача.
4. **Мертвий код** `aggregate_for_baking_from_invoices`
   (`backend/services/orders.py`, ~28 рядків) — підтверджено нуль
   викликів. Видалено.
5. **Опція «🚚 Маршрут (резерв)»** у розподілі надлишку нічого не робила
   (`targetId = Number('route')` = `NaN`, мовчки відсіюється) — функція
   офіційно недороблена (Фаза 3.5, "Резерв для маршруту" — у списку
   невиконаних). Приховано опцію з випадаючого списку
   (`BakingPage.tsx`); заразом прибрано плумбінг `routeReserve`
   (fetch `/settings/` + prop через `DiscrepancyPanel`), який після
   приховання опції не мав іншого використання — сам перемикач
   `baking_route_reserve` у Налаштуваннях лишається для майбутньої
   реалізації.

Тести: `tests/test_low_findings_section1.py`.

## Низькі знахідки QA-аудиту — Розділ 3: Фінанси, звіти, дашборд (виправлено)

Розділ 3 (1 з 2 — п.2 без фіксу, лише пояснення):

1. **Дати «останньої накладної»/«останньої оплати» рахувались через
   ненадійну ознаку** — `backend/services/finance.py` (`get_all_balances`)
   звірялась з `Finance.finance_type == "payment"/"invoice"` — той самий
   клас багу, що вже виправлений в `_is_invoice_entry`/дашборд-фільтрах
   (для 99.7% імпортованих накладних `finance_type` не збігається з
   реальним типом операції). Виправлено: звірка з `article_id` (статті
   "Оплата"/"Накладна"), той самий патерн, що скрізь після критичних
   фіксів.
2. **"Виручка" на графіку тенденцій і "Виставлено" на дашборді
   рахуються по-різному** — підтверджено читанням коду: `get_trends()`
   рахує `SUM(Invoice.total_sum)` напряму з `invoices` (усі накладні,
   включно з чернетками/магазинами); `get_dashboard()`'s `revenue_today`
   рахує `Finance.amount` за статтею "Накладна" (лише прийняті,
   `customer`). Реально можуть розійтись. Узгоджено з користувачем:
   лишити різні метрики — додано `HelpTip` на графіку тенденцій
   (`DashboardCharts.tsx`), що пояснює різницю замість переробки
   розрахунку.

Тести: `tests/test_low_findings_section3.py`.

## Низькі знахідки QA-аудиту — Розділ 4: Довідники, адмін, безпека (виправлено)

Розділ 4 (6 з 7 — п.7 без фіксу):

1. **Створення категорії/одиниці не працювало через Swagger** —
   `backend/routers/categories.py` (`create_category`, `create_unit`) —
   `name: str` як бар параметр FastAPI трактує як query, не JSON-тіло;
   фронтенд це вже обходив вручну (`CategoriesTab.tsx`,
   `api.post('/categories', null, 'name=...')`). Виправлено: нова схема
   `backend/schemas/references.py::NameCreate{name}`, обидва ендпоінти
   приймають JSON-тіло; `CategoriesTab.tsx` спрощено до звичайного
   `api.post('/categories', {name})`.
2. **Оманливий 409 замість 404 на неіснуючі FK** — той самий клас, що вже
   виправлений в `orders.py`, знайдено ще в трьох місцях:
   `create_ingredient` (`unit_id`), `create_override` (`client_id`/
   `product_id` — раніше УСІ `IntegrityError`, включно з FK-порушенням,
   ловились одним `except` і видавали "Індивідуальна ціна вже існує",
   навіть коли причина — неіснуючий клієнт), `create_price` (`product_id`).
   Додано явні перевірки існування (404) перед вставкою в усіх трьох.
3. **Підказки в редакторі бази застарілі** — `frontend/src/pages/DbEditorPage.tsx`:
   `password_hash`/`role` оновлено (bcrypt замість SHA-256; додано роль
   `seller`); мертвий блок `auth_sessions` (насправді таблиця називається
   `user_sessions`, поле — `last_used_at`, не `expires_at` — підказки
   НІКОЛИ не показувались) перейменовано на правильну назву/поле; мертві
   блоки `cancellation_lines`/`route_cancellations` (таблиці видалені ще
   при B1) видалено; `finance_articles.is_system` оновлено — після
   Medium-фіксу цієї ж сесії системну статтю більше не можна
   перейменувати, лише тип/editable (підказка досі казала "можна
   перейменувати").
4. **GitHub client secret не шифрувався** (на відміну від
   `github_oauth_token`) — `backend/routers/auth_github.py` (`_client_creds`),
   `backend/routers/settings.py` (загальні `PUT /settings/{key}`/`PUT
   /settings/`, без шифрування для жодного ключа). Виправлено:
   `_ENCRYPTED_KEYS`/`_maybe_encrypt()` у `settings.py` шифрує
   `github_client_secret` на запис; `_client_creds()` розшифровує з тим
   самим lazy-міграційним патерном, що вже є в `issues.py`'s `_token()`
   (plain → перешифрувати на льоту).
5. **Мертві налаштування хмарних провайдерів** — перевірено фактично: НЕ
   всі 8 (як здалось з першого читання звіту), а лише 3 з 6:
   `backup_cloud_{1,2,3}_label` ніде не читаються (0 звернень з фронтенду
   й бекенду — `BackupTab.tsx` показує назви провайдерів захардкожено).
   `backup_cloud_{1,2,3}_path` — ЖИВА, робоча функція (`backup.py`'s
   `do_backup(cloud_paths=...)`, реальне копіювання бекапів у папки
   синхронізації, задокументовано в "Відомих обмеженнях"). Видалено лише
   3 мертві `_label`-налаштування з `DEFAULT_SETTINGS`; `_path` не
   чіпались.
6. **Немає попередження при деактивації виробу/клієнта, що
   використовується в активних даних** — `backend/routers/products.py`
   (`deactivate_product`), `backend/routers/clients.py`
   (`deactivate_client`). На відміну від маршрутів (де це блокує дію) —
   тут лише інформаційне попередження в відповіді, дія НЕ блокується
   (бізнес-правило нечітке для виробів/клієнтів, на відміну від
   однозначного "активні клієнти маршруту"): виріб — кількість замовлень
   за останні 30 днів; клієнт — ненульовий баланс (борг/переплата).
   `frontend/src/api/client.ts`: `api.delete` тепер generic (`<T =
   void>`), щоб читати тіло відповіді там, де воно є.
7. **Rate-limit по IP блокує й правильний пароль до кінця вікна** (спільний
   лічильник для кількох користувачів з одного IP) → очікувана поведінка
   (сам аудит це визнає) — без фіксу.

Тести: `tests/test_low_findings_section4.py`.

## Низькі знахідки QA-аудиту — Розділ 5 і Магазин/POS (виправлено)

Останній розділ Low-плану. Розділ 5 (2 з 3 — п.1 без фіксу, п.3 = Розділ 4
п.4, вже виправлено):

1. **Зупинка бота вимикає лише нові повідомлення від клієнтів** —
   узгоджено з користувачем: задум, не баг. Підтвердження/відхилення
   оператором і розсилки (`broadcast-reminder`/`broadcast-deadline`)
   навмисно продовжують працювати під час "стопу" прийому нових
   замовлень — операторський функціонал і клієнтський прийом замовлень
   розв'язані свідомо. Без фіксу.
2. **Довідка бота не згадувала кнопку «📦 Накладна сьогодні» і кириличні
   команди** — `backend/services/telegram_bot.py`: `CLIENT_HELP` тепер
   згадує кнопку "📦 Накладна сьогодні"; `STAFF_HELP` (текст команди
   `/help` в самому боті — раніше кириличні альтернативи (`/звіт`,
   `/борги` тощо) були задокументовані лише в module docstring, невидимому
   персоналу) тепер показує обидва варіанти написання кожної команди.
3. **Індикатор аудит-логу відсутній у формі клієнта** —
   `frontend/src/pages/admin/ClientsTab.tsx` не імпортував `AuditBadge`
   взагалі, хоча `discount_pct`/`is_active` клієнта вже інструментовані
   в `audit_log` (Реліз v1.3.2). Додано `<AuditBadge entityTable="clients"
   entityId={c.id} />` біля колонки знижки в таблиці клієнтів.

Магазин/POS — знахідки повторного аудиту (2):

1. **Мертвий код: legacy `ShopCount`/`OtherStockIn` ендпоінти** —
   `backend/routers/shop.py` (`/counts`, `/stock-in` — 6 функцій:
   `list_counts`, `update_count`, `list_stock_in`, `create_stock_in`,
   `delete_stock_in` + непотрібні імпорти). Підтверджено: 0 звернень з
   фронтенду. Видалено ендпоінти й імпорти; моделі/таблиці
   (`ShopCount`/`OtherStockIn`) лишені без змін (уже позначені "для
   сумісності" в схемі БД, видалення таблиць — окрема операція з
   міграцією). `/other-products` (інша сутність, `OtherProduct`) НЕ
   зачеплено — не входив у цю знахідку.
2. **Потенційне подвійне рахування через легасі-корективні накладні** —
   `_shop_invoice_dates()` виключає `corrective_for_id IS NOT NULL`, але
   `_received_from_invoices()`/`_received_from_invoices_batched()` — ні.
   Аудит явно позначив як код-рев'ю без живого відтворення (нижча
   впевненість). Не виправлено наосліп — додано детальний коментар у
   `_received_from_invoices()`, що документує ризик, чому він стосується
   лише легасі-імпортованих даних (новий UI `create_corrective_invoice`
   не викликає), і який фільтр додати, якщо колись знадобиться це
   виправити.

Тести: `tests/test_low_findings_section5.py`, `tests/test_low_findings_shop.py`.

Цим закрито всі 19 "низьких" знахідок оригінального звіту + 2 з повторного
аудиту Магазину. Передрелізний QA-аудит повністю опрацьований: 6
критичних, 16+3 (Магазин) високих, 17 середніх, 19+2 низьких — усе
закомічено (18 комітів разом), версія `v1.5.0` виставлена локально
(тег, без пуша).

## Реалізація прийнятих "Пропозицій нових функцій" QA-аудиту — Розділ A: Замовлення

Останній шар передрелізного QA-аудиту — 18 ідей нових функцій (не
дефекти). Пройдено з користувачем по кожній окремо: 2 вже виконані як
частина інших розділів, 6 відхилено, 10 прийнято. Розділ A (2):

1. **Флаш незбережених змін перед виходом** — `frontend/src/pages/OrdersPage.tsx`
   (`handleQtyChange`) і `frontend/src/components/GridOrderModal.tsx`
   (`scheduleFlush`/`flush`) мають debounce 600мс — швидкий перехід на
   іншу дату/сторінку в цю коротку мить міг "втекти" від автозбереження.
   Виправлено: `OrdersPage.tsx` — новий `pendingQty` ref (яке саме
   значення ще не збережено по кожному ключу) + `flushAllPending()`,
   викликається в cleanup ефекту `[workDate]` (спрацьовує і при зміні
   дати, і при розмонтуванні сторінки — стандартна поведінка React) до
   того, як підвантажаться дані нової дати. `GridOrderModal.tsx` — новий
   `handleClose()` (await `flush()` якщо є `pendingRef.current.size >
   0`, потім `onClose()`), використовується замість прямого `onClose` і
   на Escape, і на закриття модалки.
2. **М'яке попередження при підозріло високій ціні рядка** —
   `frontend/src/components/OrderModal.tsx` (форма "% Знижка — своя
   ціна"). Якщо введена ціна ≥5× базової ціни виробу (`prices[productId]`,
   вже завантажені для модалки) — жовта іконка ⚠ з підказкою поруч із
   полем, не блокує збереження (ймовірна помилка вводу — "зайве замість
   кількості", від'ємні значення вже заборонені бекендом окремо).

## Реалізація прийнятих "Пропозицій нових функцій" QA-аудиту — Розділ B: Фінанси

Розділ B (1):

1. **Прив'язка фінансового запису до накладної через `invoice_id`** —
   `backend/models/finances.py` (`Finance.invoice_id`, FK на `invoices.id`),
   міграція **047** (додає колонку + backfill за `notes == invoice_number`
   для записів, де це вже коректно — тобто майже всі однозначні історичні
   випадки після міграції 045, і всі створені застосунком). Замінює
   евристичний пошук `_find_invoice_finance_entry()`
   (`backend/services/finance.py`) на прямий і однозначний — новий
   пріоритет 1 (`Finance.invoice_id == invoice.id`), notes/дата лишаються
   fallback-ами для записів без `invoice_id` (старі, не заторкнуті
   backfill-ом). `create_invoice_finance_entry()` тепер завжди проставляє
   `invoice_id`; `recompute_invoice_finance()` самозагоює відсутній
   `invoice_id` на записах, знайдених через fallback. Прямо усуває корінь
   Критичної знахідки №3 (дублювання боргу при корекції імпортованих
   накладних) — а не лише обходить її евристикою.

Тести: `tests/test_finance_invoice_id_link.py`.

## Реалізація прийнятих "Пропозицій нових функцій" QA-аудиту — Розділ C: Адмін

Розділ C (1):

1. **Банер демо-режиму в головному шелі** — `frontend/src/components/Layout.tsx`.
   `GET /backup/demo/status` раніше опитувався лише на `LoginPage.tsx` (до
   входу) — після входу персонал, працюючи з відновленою демо-копією бази,
   не бачив цього факту на жодній сторінці (легко переплутати з реальним
   продом). Новий `useEffect` (одноразово при монтуванні, як інші
   налаштування) + жовта смуга-банер під шапкою, видима на кожній сторінці
   основного застосунку поки `demo_status.active === true`. Свідомо НЕ
   поширено на `/pos` (`PosPage.tsx`) — окремий кіоск-інтерфейс поза
   `Layout`, не входить у "кожну сторінку" з формулювання задачі.

## Реалізація прийнятих "Пропозицій нових функцій" QA-аудиту — Розділ D: Система сповіщень у програмі

Замінює початкову ідею аудиту "push у Telegram про нове bot-замовлення" —
користувач суттєво розширив її в повноцінну систему сповіщень усередині
самого застосунку.

- **Нова таблиця `notifications`** (міграція **048**, `backend/models/notifications.py`):
  `id, type, title, body, meta (JSON-рядок), created_at, read_at (NULL=непрочитане)`.
  Колонка НЕ називається `metadata` — це зарезервоване ім'я в SQLAlchemy
  (`Base.metadata`). Однакові сповіщення для всіх ролей, без audience-фільтра.
- **`backend/routers/notifications.py`**: `GET /notifications` (50 останніх,
  найновіші перші), `GET /notifications/unread-count`, `POST
  /notifications/{id}/read`, `POST /notifications/read-all`. Усі — `require_user`
  (читає/позначає будь-яка авторизована роль).
- **Без internal write-ендпоінта для tray.py** (свідоме архітектурне рішення,
  відступ від початкового чорнового дизайну плану): сервер слухає `0.0.0.0`
  (мережа пекарні), тож незахищений `POST /notifications/system` був би
  доступний будь-якому пристрою в локальній мережі — міг би підсунути фальшиве
  сповіщення "Нова версія" з довільним changelog усім операторам. Замість
  цього `tray.py` (`_create_notification()`) пише рядок напряму в `bakery.db`
  через `sqlite3.connect()` — той самий рівень довіри й механізм, що вже
  використовує `_read_setting()` в тому ж файлі. Некритично обгорнуто в
  `try/except: pass` — помилка запису сповіщення не повинна ламати перевірку
  оновлень чи автобекап.
- **Тригери створення сповіщень:**
  - Нове bot-замовлення (`type='bot_order'`) — `backend/services/telegram_bot.py`
    (`_save_order_item()`), лише для НОВОГО pending-рядка (не при зміні
    кількості вже поданого).
  - Нова версія програми (`type='new_version'`, `meta={version, changelog}`) —
    `tray.py` (`_do_check_update()`), один раз на версію (той самий guard
    `_notified_version != latest`, що вже стояв для balloon-сповіщення).
  - Автобекап виконано (`type='backup_done'`) — `tray.py` (`_poll_backup()`).
  - Імпорт з Access завершено (`type='import_done'`) — `backend/services/import_accdb.py`
    (`run_import()`, одразу після побудови фінального звіту). Записується
    окремим `try/except: db.rollback()` — помилка нотифікації НЕ повинна
    відкочувати вже успішно закомічений імпорт (сам імпорт комітиться
    раніше, окремо, рядком 1563).
- **Frontend — `NotificationBell.tsx`** (нове, змонтовано в `Layout.tsx` між
  логотипом-меню і посиланням «Довідка»): 🔔 з бейджем кількості непрочитаних,
  polling `GET /notifications/unread-count`-подібний (фактично повний
  `GET /notifications`, для одночасного виявлення НОВИХ id) кожні 25 сек.
  Клік відкриває панель-оверлей (portal, поверх контенту, закривається кліком
  поза нею) зі списком, одразу викликає `POST /notifications/read-all`.
  Новий елемент (id, не бачений цим браузером раніше) — ефемерний тост
  (`useToast()`, перевикористання) + звук. **Звук синтезується Web Audio API
  (два коротких sine-тони) — БЕЗ окремого mp3/wav asset-файлу**: простіше,
  не залежить від шляху/збірки статики, не ризикує зіпсованим/відсутнім
  файлом при оновленні. Автоплей browser може заблокувати до першої
  взаємодії користувача — обгорнуто в try/catch, тоді просто без звуку.
- **Кнопка "⬇ Встановити оновлення"** на картці `type='new_version'` —
  видима лише якщо `role === 'admin'` або роль має новий дозвіл
  `can_install_update` (`RolePermissionsTab.tsx`, нова колонка-група
  "Додатково", той самий флаг-патерн у `role_permissions` JSON, що вже
  використовує `admin_system`). Клік → `POST /settings/request-update`.
- **`POST /settings/request-update`** (`backend/routers/settings.py`,
  захищено новим `require_install_update_perm` — дзеркало `require_system_perm`
  з `auth.py`, перевіряє `can_install_update` замість `admin_system`):
  рахує ІНШІ активні сесії (`UserSession.last_used_at` у межах останніх 10 хв,
  виключаючи сесію самого ініціатора — токен береться з `Authorization`
  header, той самий запит що й `get_current_user`). Якщо є хоч одна — створює
  сповіщення `type='update_warning'` всім ("розпочнеться через 1 хвилину") і
  через `threading.Timer(60, ...)` пише прапор `UPDATE_REQUESTED` (JSON з
  `version`); якщо немає жодної — пише прапор одразу. **Той самий
  flag-файловий міст**, що вже є для `RESTORE_REQUESTED`/`DEMO_*_REQUESTED`
  (`backend/routers/backup.py`) — `tray.py`'s `_poll_flags()` (цикл 2 сек)
  підхоплює `UPDATE_REQUESTED` і виконує встановлення через уже наявний
  `_run_install()` (бекап БД → `update.ps1 -TargetTag <version>` → `icon.stop()`),
  без повторного діалогу підтвердження (уже підтверджено в застосунку, і за
  потреби вже витримало 60-секундну затримку).

Тести: `tests/test_notifications.py` (CRUD сповіщень, відмова в дозволі,
delayed-гілка з попередженням при активній іншій сесії — "негайна" гілка
навмисно не покрита HTTP-тестом: у спільній тестовій БД гарантувати
"нуль інших активних сесій" неможливо без втручання в стан інших тестів
через session-scoped фікстури `admin_token`/`operator_token`).

## Реалізація прийнятих "Пропозицій нових функцій" QA-аудиту — Розділ E: Telegram-бот

Розділ E (4):

1. **QR-код Telegram-бота на друкованій накладній** — нові налаштування
   `invoice_bot_qr_enabled` (0/1, default **0** — вимкнено) і
   `telegram_bot_username` (текст, без `@`), перемикач і поле в
   AdminPage → Налаштування → Параметри пекарні → Додаткові функції
   (`SettingsTab.tsx`, той самий патерн, що `invoice_exchange_inline`/
   `enable_invoice_cancel`). Реалізовано дзеркально в обох рендерах
   (`backend/routers/print_views.py`): `_bot_qr_html()` — HTML для
   браузера (`render_invoice_block`, `<img>` з `data:image/png;base64,...`),
   `_bot_qr_png_bytes()` + ReportLab `Image` — PDF для Telegram
   (`render_invoice_pdf_bytes`) — той самий підхід, що вже застосований
   для `invoice_exchange_inline` (два незалежно написані шаблони, не
   спільне джерело). QR-контент (`t.me/<username>`) однаковий для БУДЬ-
   ЯКОЇ накладної — `_bot_qr_png_bytes()` кешується (`lru_cache`) за
   юзернеймом, щоб пакетний друк (`/print/invoices`, 2 на A4, десятки
   рахунків) не перегенеровував той самий QR щоразу. Бібліотека
   `qrcode==7.4.2` (нова залежність, `requirements.txt`) — генерує PNG
   через Pillow, який уже встановлений (tray.py).
2. **`/baking` за замовчуванням показує лише невведені позиції** —
   `backend/services/telegram_bot.py` (`_report_baking()`). Підсумок
   (Замовлено/Спечено/%) і далі рахується по УСІХ завданнях; перелік
   нижче — лише `baked_qty IS NULL`, з рядком-підсумком
   "⏳ Ще не введено: N з M". Коли все введено — "✅ Усі позиції введено"
   замість переліку. Раніше повний список (спечене + невведене) губив
   головне на завданнях з десятками позицій.
3. **`/debts` групує боржників за маршрутом** — `_report_debts()`, той
   самий принцип, що вже є в друкованій "Борговій відомості"
   (`print_views.py`, `debts_report`, `by_route`). Групи сортуються
   алфавітно, "Без маршруту" — завжди останньою; всередині групи —
   як і раніше, за сумою боргу.
4. **Нова команда `/ціна` (або `/price`) `<назва>`** — `_report_price()`,
   лише для персоналу (`_is_staff()`). Пошук підрядком по Python-стороні
   (НЕ SQL `LIKE`/`ilike` — SQLite `LIKE` регістронезалежний лише для
   ASCII, кириличні "Хліб"/"хліб" не збігались би), до 5 збігів. Ціна —
   через `get_price(db, product_id, client_id=0, date)`: `client_id=0`
   гарантовано не існує в `clients`, тож `get_price` детерміновано падає
   на "базову" гілку без жодної знижки (`db.get(Client, 0)` → `None`).
   `/price` (ASCII) додано в офіційне `/`-меню бота (`BOT_COMMANDS`,
   `setMyCommands`) — Telegram не приймає кириличні імена команд у меню;
   `/ціна` лишається робочим при ручному введенні (диспетчер команд
   перевіряє `cmd_base` без обмежень Telegram на набір символів).

Тести: `tests/test_invoice_bot_qr.py`, `tests/test_telegram_bot_debts_grouping.py`,
`tests/test_telegram_bot_price_command.py`; `tests/test_telegram_bot_baking_report_null.py`
оновлено під нову "лише невведене" поведінку.

## Реалізація прийнятих "Пропозицій нових функцій" QA-аудиту — Розділ F: клієнт скасовує власне замовлення

Розділ F (1) — останній пункт плану "Пропозицій нових функцій":

1. **Кнопка «🗑 Скасувати» для непідтвердженої позиції в «Моє замовлення»**
   — `backend/services/telegram_bot.py`. Перелік "Моє замовлення" тепер
   надсилається з inline-клавіатурою (`_pending_orders_keyboard()`) — по
   одній кнопці `🗑 Скасувати: <виріб> (<qty> шт)` на кожен рядок зі
   `source='bot'` і `bot_status='pending'` (підтверджені/відхилені/
   змінені оператором — вже зафіксовані, скасовувати пізно). Inline-
   клавіатура прикріплюється лише до ЦЬОГО повідомлення і не замінює
   постійну reply-клавіатуру знизу екрана (`_client_keyboard()`) — коли
   pending немає, `reply_markup` просто не передається, і клавіатура
   лишається як була.
   - Новий callback `cancelorder:{order_id}` оброблюється в
     `_handle_callback()` **до** гейту `if not state: return` — на
     відміну від callback-ів flow "додати товар" (`cat:`/`prod:`/`page:`),
     скасування не прив'язане до `_client_state`.
   - Чиста функція `_try_cancel_own_order(db, chat_id, order_id)` —
     перевіряє належність через `client_bot_users` (`_get_client_by_chat`,
     підтримує кілька Telegram-акаунтів на клієнта), `source == 'bot'`
     і `bot_status == 'pending'`; повертає `(назва, кількість)` при
     успіху або `None` (чуже/неіснуюче/вже опрацьоване — без винятку,
     клієнт просто бачить "Це замовлення вже неактуальне"). Не займає
     нічого зі сторони оператора — `verify_order()` (`backend/routers/bot.py`)
     pending ще не торкався.
   - `CLIENT_HELP` (текст команди `/help`/`❓ Допомога` для клієнтів) —
     згадка нової кнопки.

Тести: `tests/test_telegram_bot_cancel_own_order.py` (успішне скасування,
захист від скасування чужого замовлення, захист від скасування вже
опрацьованого оператором, коректний склад inline-клавіатури) — тестує
чисту логіку напряму, без походу в `_handle_callback`/мережевий виклик
Telegram API.

Цим закрито всі 10 прийнятих "Пропозицій нових функцій" передрелізного
QA-аудиту (Розділи A–F). Разом з попередніми Critical/High/Medium/Low
розділами цей аудит повністю опрацьований.

## Фікс: кількісні поля в Магазині змінювались на 0.001 стрілочками

⚠ Баг (виправлено): `frontend/src/pages/ShopPage.tsx` — стрілочки (spinner)
на полях "Кількість" мінялись на `0.001`/`0.0001` замість цілого числа,
хоча продукція власного виробництва рахується виключно цілими одиницями
(шт/буханка — не можна продати чи списати "0.3 хліба"). Причина:
`<input type="number" step="0.001">` на трьох полях + `StreamInput`
(компонент "потокового введення" для колонки "Залишок" у таблиці звірки)
мав default `step='0.001'`. Виправлено на `step="1"` (і `min="1"` для
списання, де 0 не має сенсу) у чотирьох місцях: "Кількість" у формі
надходження товару ззовні (рядок ~603), "Кількість" у модалці
"Початковий залишок магазину" (рядок ~727), "Кількість" у формі розподілу
списання/пайка/передачі (рядок ~1810), і default `StreamInput` (колонка
"Залишок" основної таблиці звірки). Цінові/грошові поля (ціна закупки,
ціна продажу, фактична виручка) залишені з `step="0.01"` — копійки
потрібні. `ProductsTab.tsx` (`weight`, вага виробу в кг) теж НЕ
чіпалась — це не кількість проданого, а фізична вага одиниці товару,
де дробова точність доречна.

## Гранульовані права ролей

Найчастіше відкладена позиція цієї сесії (High-знахідка QA-аудиту
"Довідники/Адмін №1"). Дослідження виявило дві незалежні прогалини:
(1) в 5 адмін-розділах Довідників (Виробництво/Клієнти/Ціни/Організація/
Система, групи `tabConfig.ts`) УСІ мутації жорстко `require_admin`
незалежно від `role_permissions` — прапорець групи в матриці ніколи не
давав non-admin ролі реально створити/редагувати/видалити щось, лише
бачити вкладку; (2) навпаки, Фінанси (`finances.py`) перевіряють лише
`require_user` — БУДЬ-ЯКА роль з видимістю сторінки (включно з `owner`,
що потрапляє туди побічно через "reports"/"dashboard") технічно може
вносити/редагувати/видаляти фінансові записи (конкретний приклад з
аудиту). Межа обсягу (узгоджено з користувачем): гранулюємо саме ці два
випадки; оперативні вкладки (Замовлення/Випічка/Маршрути/Магазин) — без
змін, "будь-яка роль з доступом до сторінки діє вільно" там є задумом.

**Крок 1 — модель + інфраструктура (без підключення до жодного роутера):**

- **`backend/routers/auth.py`**: новий генеричний dependency-фабрикатор
  `require_perm(key: str)` — консолідує патерн, що раніше дублювався в
  `require_system_perm`/`require_install_update_perm` (роль == admin →
  пропустити; інакше `key in perms.get(role, [])` з `Setting("role_permissions")`;
  інакше 403). Обидва старі імені лишаються як тонкі аліаси:
  `require_system_perm = require_perm("admin_system.view")`,
  `require_install_update_perm = require_perm("can_install_update")` —
  жодного call site змінювати не довелось.
- **Номенклатура ключів**: сторінкові (`orders`,`baking`,`routes`,`shop`,
  `finances`,`pos`) — без змін. Нові групові CRUD-ключі `<група>.<дія>`
  (`admin_goods|admin_clients|admin_prices|admin_org|admin_system` ×
  `view|create|edit|delete`) — по одному на кожен адмін-розділ Довідників.
  `admin_clients` покриває Клієнтів, Маршрути, Групи клієнтів, і
  Системні клієнти (`SystemClientsTab.tsx` теж через `clients.py`, попри
  візуальне розміщення вкладки під "Організація" в tabConfig.ts).
  `admin_org` CRUD стосується лише Фінансових статей (єдиний справжній
  ресурс у групі); `admin_system` CRUD — лише Користувачів. Некрудні
  точкові прапорці (форми налаштувань і разові небезпечні дії, не
  вкладаються в CRUD): `admin_org.settings`, `admin_system.backup`,
  `admin_system.reset_db`, `admin_system.import`, `admin_system.github`,
  `admin_system.db_editor`. `finances.{create,edit,delete}` — нове, без
  `.view` (вже покрито видимістю сторінки).
  **`PUT /settings/role_permissions` лишається жорстко `require_admin`
  завжди, без винятку** (інакше делегований `admin_org.settings` дав би
  змогу самому собі дописати будь-який інший дозвіл) — правило в коді,
  реалізується в Кроці 2 разом з рештою `settings.py`.
- **`backend/main.py`, `_migrate_role_permissions_granular()`** —
  одноразова ідемпотентна міграція, викликається одразу після
  `_seed_initial_data()` при кожному старті (ідемпотентність — сама
  перевірка наявності старих ключів):
  - Старий плоский прапорець групи (`admin_goods` тощо) → замінюється
    ЛИШЕ на `<група>.view`. create/edit/delete НЕ виставляються: ці дії
    реально ніколи не працювали для non-admin (`require_admin` завжди
    блокував) — дефолтне "не виставлено" не змінює жодної фактичної
    поведінки, лише знімає оманливий вигляд "нібито дозволено".
  - Фінанси: роль з буквальним `"finances"` АБО `"reports"` АБО
    `"dashboard"` (та сама OR-логіка видимості, що в `Layout.tsx`)
    отримує `finances.create/edit/delete=true` — **зберігає статус-кво
    для ВСІХ ролей включно з `owner`** (підтверджено користувачем: на
    день оновлення нічого фактично не змінюється, адміністратор сам
    звузить через нову матрицю, коли буде готовий).

Тести: `tests/test_role_permissions_granular.py` (`require_perm` —
admin завжди/роль з ключем/роль без ключа; міграція — розгортання
кожної з 5 груп у `.view`, збереження фінансового мутування з усіх
трьох джерел видимості, відсутність зайвого гранту без видимості,
ідемпотентність повторного запуску).

**Крок 2 — підключення до 5 адмін-груп Довідників:** `require_admin` на
мутаціях замінено на `require_perm("<група>.<дія>")` у `products.py`,
`categories.py` (категорії + одиниці), `clients.py`, `routes.py`,
`client_groups.py` (усі три — `admin_clients`), `prices.py`,
`ingredients.py` (обидва — `admin_prices`), `finances_articles.py`
(`admin_org`), `auth.py` (Users CRUD — `admin_system`).

⚠ **Важливе відхилення від початкового плану, виявлене прямо під час
виконання**: план передбачав додати `.view`-перевірку і на GET-ендпоінти
цих розділів (`list_products`, `list_clients`, `list_prices` тощо). Під
час підключення `products.py` з'ясувалось, що ці GET-и — СПІЛЬНА
інфраструктура, яку читають операційні сторінки (`OrdersPage.tsx`,
`BakingPage.tsx`, `RoutesPage.tsx`, `ShopPage.tsx` — `GET /products/`;
аналогічно для `/clients/`, `/prices/`) для власних дропдаунів/довідок,
геть незалежно від того, чи роль має адмінський доступ до Довідників.
Додавання `.view`-гейту зламало б Замовлення/Випічку/Маршрути/Магазин
для будь-якої ролі без явного `admin_goods.view`/`admin_clients.view`
(тобто для `operator` за замовчуванням). **Виправлено рішення: GET-и
лишаються `require_user` без змін** — `.view`-ключі існують у моделі й
використовуються ЛИШЕ фронтендом для видимості вкладки (Крок 4), без
backend-примусу на самих даних (та сама поведінка, що була й раніше —
не регресія). По дорозі знайдено і виправлено суміжну прогалину:
`GET /finances/articles/` не мав ЖОДНОЇ auth-залежності (не `require_admin`,
а взагалі нічого) — додано `require_user` (не `admin_org.view`, з тієї ж
причини: `FinancesPage.tsx`'s журнал операцій читає список статей для
дропдауна незалежно від адмінського доступу).

**Hard-rule проти ескалації прав через Users CRUD** (`auth.py`,
`create_user`/`update_user`): дозвіл `admin_system.create`/`.edit` тепер
може бути делегований non-admin ролі, але роль без буквального
`role == "admin"` НЕ може (а) призначити комусь роль `admin` (`create_user`
з `body.role == "admin"`, `update_user` з `body.role == "admin"`), (б)
редагувати вже-адмінський обліковий запис (`update_user`, якщо
`user.role == "admin"`) — обидва варіанти 403 незалежно від дозволу.

Тести: `tests/test_admin_groups_perm_wiring.py` (по одному смоук-тесту
на кожну з 4 представницьких груп — 403 без ключа → 201/200 з ключем;
обидва боки hard-rule ескалації Users).

**Крок 3 — Фінанси + точкові прапорці небезпечних дій:**

- **`finances.py`**: `create_finance`/`update_finance`/`delete_finance`
  тепер `require_perm("finances.create"/"finances.edit"/"finances.delete")`
  замість `require_user`. Це і є пряме усунення прикладу з аудиту — за
  замовчуванням (див. Крок 1, міграція) `accountant` зберігає всі три
  дії, `owner` теж (статус-кво на день оновлення), решта — без змін.
  Перевірено, що `ImportPage.tsx`'s корекція балансу при .accdb-імпорті
  (окремий `POST /finances/`, для виправлення розбіжностей Access) теж
  підпадає під `finances.create` — узгоджено як прийнятне: хто виконує
  імпорт (`admin_system.import`), тому варто дати і `finances.create`.
- **`backup.py`** (13 ендпоінтів) → `require_perm("admin_system.backup")`
  на кожному окремо (НЕ router-level dependency — `GET /backup/demo/status`
  у тому самому роутері навмисно без будь-якої авторизації, для
  до-логінного банера на `LoginPage.tsx`; router-level гейт зламав би це).
- **`auth_github.py`**, **`import_accdb.py`** — router-level
  `dependencies=[Depends(require_perm("admin_system.github"/"admin_system.import"))]`
  (тут можна — усі ендпоінти цих роутерів однаково чутливі, винятків нема).
- **`db_editor.py`** — власна паралельна `_require_admin()` (дублікат
  `auth.require_admin` з трохи іншою поведінкою — 403 замість 401 на
  неавторизований запит) видалена; замінена на router-level
  `require_perm("admin_system.db_editor")`.
- **`settings.py`**: generic `PUT /settings/{key}` і `PUT /settings/`
  (bulk) → `require_perm("admin_org.settings")`; `telegram/restart`,
  `telegram/stop`, `telegram/authorized/{chat_id}` DELETE — той самий
  ключ (Telegram Бот — підрозділ "Організація"). `POST /settings/reset-db`
  → окремий `admin_system.reset_db` (найкатастрofічніша дія, не
  бандлиться з рештою).
  **Hard-rule**: ключ `role_permissions` у ЦИХ ДВОХ generic-ендпоінтах
  редагується ЛИШЕ буквальним `user.role == "admin"`, незалежно від
  `admin_org.settings` — перевірка `key == "role_permissions"` (для
  одиничного PUT) і `"role_permissions" in body` (для масового) — інакше
  роль з делегованим `admin_org.settings` могла б сама собі дописати
  будь-який інший дозвіл через цей самий generic-запис.

Тести: `tests/test_danger_zone_perm_wiring.py` (по одному смоук-тесту на
кожен прапорець — backup/db_editor/github/import/admin_org.settings,
403→200; окремо — role_permissions hard-rule через обидва
generic-ендпоінти, з підтвердженням що ІНШІ ключі того самого масового
запиту проходять нормально); `finances.create` додано до
`tests/test_admin_groups_perm_wiring.py`. `reset_db` навмисно НЕ отримав
happy-path тесту тут — лише 403-заборона (уже покрита `test_auth_protection.py`);
щасливий шлях лишається в ізольованому `test_zz_reset_db.py` (навмисно
останній за алфавітом — знищує робочі дані спільної тестової БД).

**Крок 4 — фронтенд, модель прав:**

- **`AuthContext.tsx`**: новий обчислюваний `can(key: string): boolean`
  (`user?.role === 'admin' || (permissions[role] ?? []).includes(key)`) —
  єдина точка перевірки дії-рівневого дозволу, дзеркалить backend'ний
  `require_perm()`. `NotificationBell.tsx`'s `canInstallUpdate` переведено
  на `can('can_install_update')` (прибрано дублікат виразу).
- **`RolePermissionsTab.tsx` — повністю переписано**: верхня таблиця
  сторінкового доступу (`MAIN_PAGE_PERMS`) лишилась як була. Стару єдину
  таблицю з одним прапорцем на весь розділ Довідників (`ADMIN_SUB_PERMS`
  з `tabConfig.ts`) замінено на 6 окремих CRUD-блоків
  (`CRUD_BLOCKS`) — по одному на `admin_goods`/`admin_clients`/
  `admin_prices`/`admin_org`/`admin_system` (Перегляд/Створення/
  Редагування/Видалення) і окремо `finances` (лише 3 дії, без Перегляду —
  вже покрито сторінковим "Фінанси" вище). `admin_org` і `admin_system`
  мають додаткові колонки-прапорці для точкових небезпечних дій
  (`admin_org.settings`; `admin_system.backup/reset_db/import/github/db_editor`).
  Спільний `<CheckCell>` (роль=admin → нередагований "✓", інакше
  чекбокс) використовується всюди — той самий підхід, що вже був.
  `import { ADMIN_TAB_GROUPS } from './tabConfig'` прибрано з цього файлу
  (більше не потрібен тут — `tabConfig.ts` і сам експорт лишаються,
  використовуються в `AdminPage.tsx` для сайдбару).

**Крок 5 — дії-рівневе блокування кнопок (фінальний крок):** кожна
кнопка/поле, що мутує дані через уже гранульовані ендпоінти, тепер
перевіряє `can('<ключ>')` перед рендером (той самий патерн скрізь:
`{can('group.action') && <button>...}`, підібраний за РЕАЛЬНИМ
backend-викликом кнопки, не за візуальним групуванням вкладки):

- `ProductsTab.tsx`, `CategoriesTab.tsx` (категорії + одиниці),
  `SimpleListTab.tsx` (одиниці виміру) → `admin_goods.{create,edit,delete}`.
- `ClientsTab.tsx`, `RoutesTab.tsx`, `ClientGroupsTab.tsx`,
  `SystemClientsTab.tsx` → `admin_clients.{create,edit,delete}`
  (`SystemClientsTab` теж — бо мутує через `clients.py`, попри візуальне
  розміщення вкладки під "Організація" в `tabConfig.ts`). У `ClientsTab.tsx`
  індивідуальні ціни клієнта (`POST/DELETE /prices/overrides`) гейтяться
  окремо як `admin_prices.{create,delete}` — інша група, інший роутер.
- `PricesTab.tsx`, `IngredientsTab.tsx` → `admin_prices.{create,edit,delete}`.
  `PriceGantt.tsx`'s `onEdit`/`onDelete` пропси стали опціональними
  (`?:`) — компонент ховає кнопку "✎"/"×" сам, коли пропс не передано
  (`can(...) ? handler : undefined`), замість дублювання перевірки в
  розмітці Ganttа.
- `FinanceArticlesTab.tsx` → `admin_org.{create,edit,delete}`.
- `UsersTab.tsx` → `admin_system.{create,edit}` + дзеркало backend
  hard-rule: `ROLE_OPTIONS` приховує "Адміністратор" для не-true-admin
  (`roleOptionsFor()`), кнопки "Редагувати"/"Вимкнути" ховаються на рядку
  вже-адмінського користувача, якщо дивишся не з-під справжнього admin.
- `BackupTab.tsx` — три різні дозволи в одному файлі: `admin_org.settings`
  (форма автобекапу/хмарних шляхів — generic `/settings/` запис),
  `admin_system.backup` (список/бекап зараз/відновити/видалити/демо/
  архівування — усі дії `backup.py`), `admin_system.import` (кнопка
  "Імпорт з Access", окремо від решти — інший роутер), `admin_system.reset_db`
  (`<ResetDbSection />`, гейт на виклику компонента).
- `SettingsTab.tsx` — той самий поділ: усі форми параметрів
  пекарні/бота/шаблонів/`github_repo` → `admin_org.settings`; GitHub
  Device Flow (авторизуватись/вийти) у `IssuesSettingsSection` →
  `admin_system.github` (окремо від збереження самого поля репозиторію).
- `AdminPage.tsx` + `App.tsx` — посилання "⚠️ Редактор БД" і сам маршрут
  `/db-editor` тепер перевіряють `can('admin_system.db_editor')` замість
  жорсткого `isAdmin`/відсутності перевірки (`Navigate` на `/` для
  невповноважених — раніше рятував лише бекенд-403, без UX-редиректу).
- `FinancesPage.tsx` — кнопки "+ Оплата"/"+ Операція" →
  `finances.create`; кнопка "✎ Редагувати суму" (обидва місця: панель
  клієнта і загальний журнал) → існуюча умова `canEditFinance()`
  (дата/стаття/editable) ТА `can('finances.edit')` — обидві мають
  збігтися. `deleteFinance()` (`api/finances.ts`) лишається мертвим
  кодом на фронтенді (жодної кнопки виклику ніде не було й раніше) —
  без гейту, бо нема що гейтити.
- `AuthContext.tsx`, `NotificationBell.tsx`, `RolePermissionsTab.tsx` —
  див. Крок 4 вище.

Цим закрито гранульовані права ролей повністю: backend (Кроки 1-3) +
frontend (Кроки 4-5). Найчастіше відкладена позиція цієї сесії — закрита.

**Фікс UI (пост-реліз)**: `RolePermissionsTab.tsx` — 6 CRUD-блоків
(`CRUD_BLOCKS`) + "Додатково" раніше рендерились одразу всі підряд одним
довгим списком таблиць. Замінено на підменю-перемикач (той самий
`tabBtn`-патерн, що вже є в `PricesTab.tsx`): `ALL_BLOCKS = [...CRUD_BLOCKS,
EXTRA_BLOCK]` (точкові дозволи "Додатково" оформлені як ще один блок з
`actions: []`, щоб перемикатись тим самим механізмом), `activeBlock` стейт
показує лише ОДНУ таблицю за раз (Виробництво/Клієнти/Ціни та
собівартість/Організація/Система/Фінанси/Додатково). Верхня таблиця
"Доступ ролей до розділів" (сторінковий доступ, `MAIN_PAGE_PERMS`) лишилась
без змін — вона й так компактна, підменю стосується лише розлогого
детального блоку.

## Фікс: магазин відсутній у Зведеному виді замовлень

⚠ Баг (виправлено): `frontend/src/components/GridOrderModal.tsx` (Зведений
вид замовлень, ❖-модалка в Замовленнях) показував рейси клієнтів
(вертикальний акордеон bottom-left) і рахував Σ по виробу/загальний
підсумок лише по `client_kind === 'customer'` — магазин (`client_kind ===
'shop'`) був повністю виключений з `clientsByRoute`/`allCustomerClients`,
хоча замовник бачив і редагував замовлення магазину через звичайну
(не-Зведену) вкладку Замовлення, де `OrdersPage.tsx` (рядок ~474) навпаки
завжди показує магазин у КОЖНОМУ рейсі (`c.client_kind === 'shop' ||
c.route_id === routeId`). Розбіжність: та сама кількість магазину була
врахована в звичайному виді, але зникала в Зведеному. Бекенд
(`GET /orders/grid`, `backend/routers/orders.py`) тут ні до чого — рядки
`orders` магазину й так повертаються в `cells` без жодного фільтра за
`client_kind`, проблема була суто у фронтенд-групуванні.

Виправлено: `clientsByRoute`/`allCustomerClients` тепер включають і
`'customer'`, і `'shop'`. Магазин типово не прив'язаний до рейсу
(`route_id IS NULL`) — потрапляє в сентинел-бакет `0`, для якого додано
синтетичну вкладку **«Внутрішні»** (`activeRoutes` = реальні маршрути +
`{id: 0, name: 'Внутрішні', ...}`) — той самий термін і сентинел-підхід,
що вже використовується в `RoutesPage.tsx` для клієнтів без маршруту.
Вкладка рендериться лише коли бакет непорожній (як і решта рейсів —
`if (count === 0) return null`), тож на бакеріях без "безрейсових"
клієнтів/магазину нічого візуально не змінюється.

## Фікс: сортування "Завдання пекарям" за id замість алфавіту

⚠ Баг (виправлено): `GET /print/baking` (`backend/routers/print_views.py`,
`print_baking`) будував рядки друкованого завдання в порядку
`BakingTask.product_id` (тобто порядку внесення виробу в довідник) —
пекарі скаржились, що виріб важко знайти в довгому списку (напр. "Хліб
Стрийський особливий" і "...різаний" опинялись поруч, а "Хліб
Мармуровий"/"Хліб Карпатський" — розкидані далі). Виправлено: рядки
кожної групи-категорії сортуються за назвою виробу (`Product.name`) перед
рендером, а не за порядком у списку `tasks`. Заголовки категорій і сам
підсумковий рядок "Разом" не зачеплені.

Тест: `tests/test_print_baking_sort.py`.

## Фікс: шапка маршрутного/адресного листа лишалась сама на сторінці

⚠ Баг (виправлено): `GET /print/route-sheet` і `GET /print/address-sheet`
(`backend/routers/print_views.py`) — у друкованому PDF шапка сторінки
(`.page-head`: назва маршруту + дата + підсумок) опинялась одна на першій
сторінці, а весь вміст (перша група клієнтів + таблиця) переносився на
наступну. Причина: `.group-block` має `page-break-inside: avoid` (не
розривати групу посеред) — якщо перший блок групи не вміщався в залишок
місця під шапкою, рушій друку переносив ЦІЛИЙ блок групи на нову
сторінку, а шапку, для якої такого правила не було, лишав самотньою.
Виправлено: `.page-head` отримав `break-after: avoid` /
`page-break-after: avoid` — рушій друку більше не розриває сторінку одразу
після шапки, тож вона переноситься РАЗОМ із вмістом, а не окремо. Та сама
CSS-верстка задубльована в обох друкованих формах (`route-sheet` і
`address-sheet`, два незалежні HTML-шаблони) — виправлено в обох.

## Фікс: перегляд накладної на екрані дублював рядок виробу й анотацію переміщення

⚠ Баг (виправлено): `InvoiceDetailPanel` (`frontend/src/pages/RoutesPage.tsx`,
перегляд накладної в Маршрутах — НЕ друк) рендерив КОЖЕН `invoice_lines`
рядок окремо. Той самий виріб міг мати кілька окремих рядків БД за однаковою
ціною (власне замовлення + переміщення від іншого клієнта + надлишок —
кожен запис `orders` при генерації стає окремим `InvoiceLine`, без
агрегації — той самий факт, що вже задокументований і виправлений для
ДРУКУ в "Реліз v1.3.4" через `_merge_lines_for_display()`). На екрані такого
об'єднання не було — оператор бачив виріб двічі. Гірше: `transfersFor(productId,
kind)` фільтрує анотації переміщення ЛИШЕ за `product_id`+`line_kind`, без
прив'язки до конкретного рядка — тож коли рядків для одного виробу було
два, ОБИДВА показували ОДНАКОВУ анотацію "↓ передано → Пайок" (переміщення
насправді відбулось один раз, з одного рядка). Причина, чому в друку цього
не було: `_merge_lines_for_display()` вже об'єднує однакові рядки перед
рендером; на екрані такого еквівалента не було.

Виправлено: `mergeInvoiceLinesForDisplay()` (`RoutesPage.tsx`) — та сама
логіка, що й backend-функція (групування за `(product_id, ефективна ціна)`,
підсумовування qty/sum), застосована ЛИШЕ для показу основної таблиці й
секції «Обмін» (`displayMainLines`/`displayExchLines`). У базі рядки не
чіпаються. **Панель корекції/переміщення (`showCorrect`) свідомо лишена на
"сирих" `mainLines`/`exchLines`** — переміщення (`POST /invoices/{id}/transfer`)
і так діє на рівні `product_id` через `next()` (бере ПЕРШИЙ рядок цього
виробу, не конкретний обраний), а не по `line.id`, тож об'єднання відображення
джерела корекції нічого не виправило б і ризикувало б неузгодженістю "Залишок"
з тим, скільки реально можна перемістити з конкретного рядка.

## Аудит-фікси v0.9.36-v1.0.4

**v0.9.36-v0.9.39:**
- **B1-B7 (блокери)**: бекап з WAL checkpoint, ідемпотентні міграції, SQL injection захист, bcrypt, авторизація на роутерах, dashboard NULL fixes
- **V1-V10 (важливі)**: safe_commit helper, логування пригнічених винятків, Toast/ConfirmDialog компоненти, sanitize помилок, orphan-checks, atomic update.ps1
- **N5+N6+N7** (пост-реліз): synchronous=FULL, cache_size=-32768 (32MB), retry на release upload, try/finally для токенів installer

**v1.0.0-v1.0.4:**
- **Магазин/POS**: `compute_current_stock()` — lazy-обчислення стоку без потреби у відкритій звірці; POS-валідація стоку (HTTP 422 коли продаж перевищує залишок); атомарна перевірка cart у `setCart` callback (без race при швидких кліках); секція "📦 Залишки магазину" з пропорційним горизонтальним grid; кнопки Звірка ↔ Початковий залишок — взаємовиключні
- **БД (міграції 029-031)**:
  - 029: `shop_disposal_lines.price` + перебудова orphan FK (`_v2` → правильна таблиця); CHECK розширено до `'sale'`
  - 030: PARTIAL UNIQUE INDEX на `clients(client_kind)` WHERE writeoff/ration/underbaked — захист від дублів системних клієнтів
    - ⚠ Баг (виправлено міграцією **042** + `main.py`): `_seed_initial_data()` (`backend/main.py`) виконується
      на рівні МОДУЛЯ — кожен uvicorn-воркер (reloader + child при `--reload`, або старий/новий воркер під час
      перезапуску) імпортує `backend.main` і викликає її окремо. Перевірка "клієнт цього kind вже існує?" +
      вставка — класична TOCTOU-гонка: якщо два процеси проходять перевірку майже одночасно, до того як
      хтось із них закомітив — обидва бачать "не існує" і обидва вставляють. Це справжня причина дублів
      "Пайок"/"Списання" (НЕ імпорт .accdb — `import_accdb.py` вже коректно перевикористовує канонічного
      системного клієнта, і НЕ ручне створення через форму — хоча `SystemClientsTab.tsx` теж мала прогалину,
      дропдаун типу дозволяв обрати вже зайнятий kind, виправлено заразом як додатковий захист). Чому індекс
      з міграції 030 не зупинив це: `run_migrations()` (`backend/database.py`) ковтає помилку кожного
      statement і все одно позначає міграцію застосованою (навмисно — щоб історичні transform-міграції не
      падали щозапуску на свіжій БД) — якщо на момент першого запуску 030 гонка вже встигла створити дублі,
      `CREATE UNIQUE INDEX` падав, індекс так і не з'являвся, і повторно міграція вже не виконувалась (нічим
      було зупинити наступні гонки). Виправлено: 042 зливає всі посилання (orders/invoices/finances/
      shop_disposal_lines/client_bot_users/client_price_overrides/movements) з дублів на канонічного
      (найменший id), видаляє дублі, відновлює індекс; `_seed_initial_data()` тепер ловить `IntegrityError`
      на commit (програний забіг гонки) замість падіння всього воркера при старті.
  - 031: PARTIAL UNIQUE INDEX на `finance_articles(name, direction)` WHERE is_system=1
- **schema.sql sync (B1)**: повна синхронізація з моделями SQLAlchemy — 29 таблиць, 24 індекси, 24 default settings; видалено застарілі `surplus_*`, `route_cancellations`, `cancellation_lines`
- **safe_commit() поширено** на категорії, магазин, auth, bot (~34 місця разом)
- **Frontend stability**: останні `alert()` → toast у BakingPage і ImportPage; fix race у `ReconciliationCalendar` (`selectedRec.lines.length` падав при slim-об'єкті); fix кирилиці у трей-діалогах; update.ps1 без credential helper

## Реліз v1.3.0 — переосмислений робочий цикл (накладні-чернетки + випічка після маршрутів)

Порядок меню: **Замовлення → Маршрути → Випічка → Магазин → Фінанси → Налаштування**.

- **Меню/трей/довідка**: «Випічка» перенесено після «Маршрутів» (Layout.tsx, tray.py, HelpPage.tsx).
- **Накладні-чернетки замість `virtual_draft`**: поняття «чернетка без рядків» прибрано.
  Кнопка **«Сформувати накладні»** у Маршрутах (`POST /invoices/generate-drafts`) будує з
  замовлень повноцінні накладні зі статусом `draft` (з номером і рядками). `generate-from-orders`
  default `initial_status='draft'`. `VirtualDraftPanel` видалено; редагування замовлень лишається
  у вкладці Замовлення.
- **Магазини у Маршрутах** (`isShopClient`): власні магазини показуються у списку і
  створюються разом з усіма (`generate-drafts` включає `client_kind IN ('customer','shop')`),
  їх накладні можна **коригувати**, але на них НЕ діють масові операції (друк/відправка/
  прийняття) і **немає кнопок зміни стану** (Відправити/Прийнято) — накладна магазину
  закривається у Випічці («Закрити накладну магазину»). Чекбокс і поле оплати для рядка
  магазину не показуються.
- **Друк ≠ відправка**: «🖨 Друкувати» не змінює статус (чернетки лишаються чернетками);
  окрема дія **«Відправити машини»** переводить `draft → sent`. Корекція (`✏`) доступна і для
  чернеток (зменшити недопечене перед відправкою).
- **Випічка: Замовлено / Спечено / Відхилення** (розрахунок `calcByProduct` у BakingPage з
  замовлень origin_id NULL + накладних клієнтів/магазинів). Колонки «Корекції» НЕМАЄ: будь-які
  корекції накладних (зменшення клієнта, перенесення на магазин, списання, пайок) перерозподіляють
  уже спечений товар і **не впливають ні на «Замовлено», ні на «Відхилення»** (Відхилення =
  Спечено − Замовлено, вирівнюється через магазин). Правило по клієнту:
  `Заказ = max(замовлено, в_накладних_adj)` — обмінні/додаткові вироби (в накладній понад
  замовлення, напр. імпортований обмін) рахуються як **замовлені** (їх пекли).
  - **Нейтралізація перерозподілів**: `в_накладних_adj = в_накладних + Σпереміщено_З −
    Σпереміщено_В` лише для переміщень МІЖ обліковими клієнтами (customer/shop). Перенесене
    клієнт→магазин (чи клієнт→клієнт) — це перерозподіл уже спеченого (товар «слідує» за
    початковим замовленням джерела), тож НЕ подвоює «Замовлено». Дані: `GET
    /invoices/transfers-by-date?date=`. Переміщення на системних клієнтів (underbaked/…) НЕ
    нейтралізуються — їх обробляє «зняти недопечене».
  - **Замовлено** = Σ max(o, i_adj) по клієнтах+магазинах. Пряме зменшення клієнта лишає max=order
    (не опускає Замовлено); перерозподіл нейтралізовано; екстра (обмін) піднімає до i_adj.
    - **Надлишок не входить у попит**: рядки `line_kind='surplus'` виключаються з `invByPC` (попиту)
      завжди — і в чернетці, і після прийняття. Тож «Замовлено» не подвоюється долитим надлишком
      (фантомний «Конфлікт» неможливий за побудовою — більше немає окремого origin_id=0 для магазину).
  - **Відхилення = Спечено − Замовлено** (rawDev). `> 0` перепечено → розподіл надлишку;
    `< 0` недопечено → зняти з магазину. Ефективне = rawDev + зняте_з_магазину −
    розподілений_надлишок (бейджі «✂ N знято» / «↗ N розподілено»). НЕ рахується від «В накладних»
    — інакше пряма корекція клієнта створювала б фантомне відхилення.
  - Приклад: К1 20 + К2 10 + Магазин 16 = 46; Спечено 25 → Відхилення −21; зняти 16 з магазину
    (скільки є) → ефективне −5 + попередження. Якщо магазину вистачає — ефективне 0, бейдж «✂ знято».
  - Приклад перерозподілу: Болотня 14 (магазин 0); 4 перенесено Болотня→магазин (накладні:
    Болотня 10, магазин 4). Замовлено = **14** (не 18); Спечено 16 → надлишок +2.
  - Приклад прямої корекції: Болотня замовив 16, у накладній зменшено 16→14 (без переміщення);
    Спечено 16 → Замовлено **16**, Відхилення **0** (корекція не створює фантомний +2).
- **Права панель розбіжностей**: деталізація по клієнтах `Клієнт | Заказ(=max(o,i_adj)) | В накладних(факт) |
  Відхилення(=Заказ−В накладних)` + рядок «Сума» (при перерозподілі Σ Відхилень = 0: джерело
  «+N віддано», ціль «−N отримано»). Надлишок (Спечено>потреба) → розподіл на
  магазин/пайок/списання. Недопечене → магазин(и) редаговані (поле «зняти»), клієнти лише
  для перегляду. Зняття з магазину = **переміщення на системного клієнта «Недопечено»**
  (`POST /invoices/{shop_inv}/transfer to_client_id=underbaked`) → зменшує рядок накладної
  магазину, лишає виноску «↓ Знято недопечене −X» (через `invoice_transfers`,
  `counterparty_kind='underbaked'`), без боргу. Edge-case (бракує більше ніж є в магазині):
  зняти що є + попередження з переліком клієнтів і кількостями у їх накладних.
- **Розподіл надлишку (v1.3.0)**: надлишок на МАГАЗИН вноситься **прямо в чернетку-накладну
  магазину** як рядок `line_kind='surplus'` (`POST /invoices/set-surplus {shop_client_id,
  product_id, qty, date}`; qty=0 видаляє рядок). Видно/редагується в Маршрутах; доступний у
  касі/звірці лише після `draft → accepted`. Пайок/списання — окремі `Order origin_id=0` (накладної
  не мають). Панель об'єднує обидва джерела (`linesFor`). Надлишок-рядки виключені з попиту
  (invByPC), тож «Замовлено» не зростає.
- **Магазин — «Закрити накладну магазину»** (кнопка у Випічці, активна після внесення всієї
  випічки і розподілу надлишків): `POST /invoices/close-shops` переводить накладні-чернетки
  магазинів `draft → accepted` напряму (без `sent`, без оплати, без боргу — магазин розраховується
  через звірку). Надлишок уже в рядках (`set-surplus`); долив `origin_id=0` лишився legacy-safety.
  Ідемпотентно (магазини з прийнятою накладною пропускаються).
- **Залишок магазину — без подвійного рахунку** (правило «накладна перекриває замовлення»):
  сирі замовлення магазину (`Order origin_id IS NULL/0`) рахуються як «надходження з пекарні»
  (`compute_current_stock`/звірка) лише на дати БЕЗ накладної магазину (legacy/імпорт). На дати
  з накладною (`_shop_invoice_dates`) товар іде через накладну: поки чернетка — не рахується
  ніде (прихований до «Закрити»); після `accepted` — через `_received_from_invoices`. Так
  попередні замовлення магазину + надлишки рахуються рівно один раз. Денний звіт (`print_views`)
  досі читає сирі надлишки-орди (їх не видаляємо). `transfer`-у-магазин лишає накладну чернеткою
  (товар у POS після закриття). У звірку (`create_reconciliation`/`refresh-received`) додано
  прийняті накладні магазину.
- **Відкрита звірка покриває до поточної дати (v1.3.1)**: `compute_current_stock` у гілці відкритої
  звірки бере `opening_balance` рядків як базу, а `received` рахує ЖИВЕ від `_effective_date_from`
  до `as_of_date` — тож POS завжди бачить прийняті накладні (в т.ч. надлишок), навіть якщо
  `period_to` звірки застарів. `create_reconciliation` при наявній відкритій звірці **розширює**
  її `period_to` до запитаної дати і перечитує `received` (спільний хелпер `_recompute_received`);
  новій звірці `period_to` клемпиться `≥ period_from` (без інвертованого періоду). Фронт `initRec`
  синхронізує відкриту звірку через POST. Виправляє «застряглу» стару відкриту звірку, що ховала
  новіший товар у POS і звірці.

## Реліз v1.3.2 — аудит-лог змін + обнулення фінансових операцій

- **Проблема**: оператор не міг виправити помилково внесену суму (дублікат
  запису з імпорту Access) — видалення ламало б звʼязок з накладною, а
  редагування без сліду приховувало б факт зміни.
- **Обнулення замість видалення**: `PATCH /finances/{id}` дозволяє `amount=0`
  (`FinanceUpdate` валідатор `v < 0` замість `v <= 0`; `FinanceCreate` для
  нових записів лишає мінімум `0.01`).
- **Захищений аудит-лог** (див. схему БД вище, `audit_log`): логуються лише
  UPDATE існуючих записів користувачами — НЕ CREATE, НЕ системні автодії.
  Інструментовано: `finances` (amount, notes), `invoice_lines` (qty,
  price_override), `orders` (qty, price_override, delivered_qty), `clients`
  (discount_pct, is_active). `baking_tasks` свідомо НЕ логується (низька
  цінність, прибрано після фідбеку).
- **Frontend**: `AuditBadge.tsx` — іконка ⚠ (жовтий трикутник) на рядку;
  з'являється лише якщо для рядка є записи в audit_log (auto-fetch при
  монтуванні, ре-fetch через `key` що включає відстежувані поля); клік →
  popup з історією (дата, поле, було→стало, автор). Підключено у
  `FinancesPage.tsx` (журнал + панель клієнта) і `OrderModal.tsx` (поруч з
  полем кількості).

## Реліз v1.3.3 — вкладка "Баланси Виробів"

- **Проблема**: оператори звіряють друкований "Денний звіт пекарні" вручну і
  не можуть швидко знайти де саме кількості не співпадають.
- **Report-parity через спільну функцію**: `_compute_section1_data()`
  (`backend/routers/print_views.py`) — витягнута з `_dr_section1` чиста
  функція без HTML; викликається і друкованим звітом, і новим ендпоінтом.
  Гарантує що Замовлено/Спечено/Обмін/Магазин на екрані завжди 1:1 з PDF
  (структурно неможливо розійтись при майбутніх правках однієї сторони).
- **`GET /reports/product-balances?date=`**: понад report-parity колонки
  додає деталізацію по клієнтах (з `invoice_lines`, розбивка `line_kind`),
  списання/пайок (фабрика — `Order origin_id=0`; магазин —
  `shop_disposal_lines` за `batch_date`), за собівартістю (`cost_per_unit`).
  `diff_qty` (розбіжність) рахується ТІЛЬКИ коли `baked_qty` реально введено
  (`baked_entered=True`), не на report-parity заповнювачі (`else ord_qty`).
- **`ProductBalancesTab.tsx`**: 3 рівні розгортання (категорія → виріб →
  клієнти), усі згорнуті за замовчуванням (кнопка "Розгорнути розбіжності"
  для швидкого пошуку), пошук по назві, чекбокс "Тільки розбіжності",
  hint-підказки (`HelpTip`) на кожній колонці + формула-банер зверху.
- **`movements`/`daily_balances` НЕ використовуються** — джерела:
  `orders` + `invoice_lines` + `shop_disposal_lines` (див. примітку в схемі
  БД, розділ "Рухи та залишки").

## Реліз v1.3.4 — виправлення підсумків Зведеного виду і друку накладної

- **Друк накладної — групування виводу без зміни БД**: клієнт бачив той
  самий виріб у накладній кілька разів з різними кількостями (власне
  замовлення + переміщення від іншого клієнта + надлишок — кожен запис
  `orders` при генерації стає окремим `InvoiceLine`, без агрегації).
  Виправлено ЛИШЕ на рівні друку: нова функція `_merge_lines_for_display()`
  (`backend/routers/print_views.py`) об'єднує рядки одного виробу за
  однаковою ефективною ціною в один рядок під час рендерингу друкованої
  форми (`render_invoice_block` — HTML для браузера, `render_invoice_pdf_bytes`
  — PDF для Telegram-бота). Рядки з різною ціною (напр. price_override)
  лишаються окремими. У базі (`invoice_lines`) записи НЕ змінюються і
  НЕ об'єднуються — генерація накладних (`_build_invoice_for_client`)
  свідомо лишена як є.
- **Зведений вид замовлень — підсумки враховують обмін і не обмежені
  активним фільтром** (`GridOrderModal.tsx`): Σ по клієнту і Σ по виробу
  рахували лише базову кількість (`cell.qty`), ігноруючи `+N`-бейджі
  (обмін/знижка/переміщення/надлишок, `cell.extra_qty`). Крім того Σ по
  клієнту рахувалась лише по продуктах активної вкладки категорії
  (Хліб АБО Булка), а Σ по виробу — лише по клієнтах активного рейсу.
  Тепер обидва підсумки і загальний підсумок у шапці рахуються по всіх
  випічкових категоріях і всіх рейсах разом, включно з `extra_qty`.
  Backend (`GET /orders/grid`) не змінювався — дані вже містили окремо
  `qty` і `extra_qty` для кожної клітинки, проблема була суто у
  фронтендному підсумовуванні.

## Релізи v1.1.x

**v1.1.0-v1.1.2** — Pivot Grid (зведений вид замовлень):
- Альтернативний UI у вкладці Замовлення: кнопка **❖ Зведений вид** відкриває fullscreen-модалку з сіткою клієнти × вироби × дата.
- Ексклюзивні акордеони у кутовій клітинці шапки: категорії (Хліб / Булка) — горизонтально top-right; рейси — вертикально bottom-left.
- Sticky-кути: лівий стовпчик (клієнт), правий (Σ по клієнту), верхня шапка (виріб з vertical-text), нижній footer (Σ по виробу).
- Двоетапне вимірювання ширин колонок через `useLayoutEffect` — точна ширина за реальною шириною label (без `max-content` пастки для vertical-text).
- Бейджі `+N↩` для extra-рядків (обмін/знижка/переміщення), оранжева крапка для pending bot-замовлень.
- Етап 3: bulk-flush (POST `/orders/bulk-upsert` коли N≥2 змін за 600 мс) + paste TSV з Excel (`onPaste` handler, заповнення від anchor вправо/вниз, пропускає locked-клієнтів).
- Backend: GET `/orders/grid?order_date=...` + POST `/orders/bulk-upsert` з atomic locked-check (409 з `locked_client_ids` у detail).

**v1.1.3** — fix update.ps1:
- `npm install --no-audit --no-fund` перед `npm run build` — install уже не падає на машинах з застарілим `node_modules`.
- `Start-Process npm` тепер з `-RedirectStandardOutput`/`-RedirectStandardError` у `C:\ProgramData\Bakery\logs\update-npm-{install,build}.log{,.err}` — є що дивитись при падінні.
- Явні рядки в логу про причину fallback на npm (нема OAuth токена / release не має `frontend-dist.zip` / exception download з повідомленням).
- Sidecar `scripts/manual-upgrade-v1.1.3.ps1` (закомічений) для клієнтів які застрягли на v1.0.x через self-update race (PowerShell кешує старий скрипт у пам'яті). Обходить GCM-popup через `git remote set-url` з embedded токеном, PS 5.1 NativeCommandError (через `$ErrorActionPreference='Continue'` для git-блоку + `--quiet`), кирилицю у username (system-wide `C:\Windows\Temp` замість `$env:TEMP`).

**v1.1.5** — wheel-blur:
- Глобальний listener у `main.tsx`: при `wheel` на focused `<input type="number">` робимо `blur()` → значення не змінюється при прокручуванні сторінки колесом миші. Покриває всі форми з number-inputs одним патчем (Orders, OrderModal, GridOrderModal, BakingPage, FinancesPage, RoutesPage, ShopPage, ImportPage, admin tabs).

**v1.1.6** — bulk-send fix:
- Масова відправка чернеток у Маршрутах: `Promise.all` → послідовний `for...await`. `generate_invoice_number` не atomic — паралельні запити брали однаковий номер → 409 на одному з них → `Promise.all` rejects → UI зависав з "..." і не оновлювався.
- Per-item `try/catch` + загальний `try/finally` — UI завжди розблоковує + `load()` refetch. Toast про результат. Чекбокси з невдалих залишаються виділеними.

**v1.1.7** — фінанси (auth + edit) + групи клієнтів + друковані форми:
- **Auth-fix**: `frontend/src/api/finances.ts`, `importAccdb.ts`, `issues.ts` — усі raw `fetch()` переведено на `api/client.ts` (виправляє "Не авторизовано" при збереженні оплат і копіюванні цін).
- **Edit фінансових сум**: міграція **032** + поле `editable` у `finance_articles` + `PATCH /finances/{id}` (схема `FinanceUpdate`). UI: кнопка ✏ замість 🗑 у FinancesPage (показується тільки для `finance_date == workDate` + `article.editable=1`). Чекбокс "Редаг. суми" у Довіднику фінансових статей. Default editable=1 для: Оплата, Внесення в касу, Виплата з каси, Готівка водія, Списання. ⚠ Умову `created_by != 'system'` пізніше прибрано (див. розділ "Фінанси" вище) — актуальне правило захищає лише `finance_type == 'invoice'`. ⚠ "Виплата з каси" у списку вище — помилка тодішньої міграції 032 (такої статті не існує); виправлено міграцією 040, актуальний список — там само.
- **Групи клієнтів**: міграція **033** + таблиця `client_groups` + `clients.client_group_id` (FK з `ON DELETE SET NULL`). Модель `ClientGroup` (route_id, name, sort_order). Роутер `/client-groups` CRUD + `GET/PUT /{id}/members`. Cascade у `update_client`: при зміні `route_id` група старого маршруту скидається у NULL. Нова вкладка AdminPage "Групи клієнтів" + dropdown у формі клієнта (фільтр за поточним route_id). У формі ClientGroupsTab — multi-select клієнтів для призначення.
- **Друковані форми у Маршрутах** (sticky-секція `printFormsBar` внизу панелі списку, `flex-shrink: 0`):
  - GET `/print/group-sort` — Сортування товару по групах клієнтів (агрегація orders за route → group → product, для завантаження машини).
  - GET `/print/route-sheet` — Маршрутний лист водія. Дані з `invoice_lines` (status != cancelled, не is_exchange). Кожен маршрут на окремій сторінці. Колонки: Виріб | К-сть | Ціна | Брак | Ціна браку | Сума. Шапка з підсумками маршруту, темно-синя смуга-заголовок групи з назвою маршруту (щоб не загубитися при розриві сторінки).
  - GET `/print/address-sheet` — Адресний лист (Клієнт | Адреса | Телефон | Сума зам.). Дані з `invoices`, окрема сторінка на маршрут, групи всередині.
- **Сортування orders у вкладці Замовлення**: у межах клієнта вироби сортуються за `order.id` (порядок внесення) замість алфавіту — відповідає паперовим бланкам.

## Memory і agent-context

Розробник-агент Claude Code зберігає персональну пам'ять у `C:\Users\<user>\.claude\projects\c--Bakery\memory\` (поза репо). Це позаконтекстна тримана знання про:
- Дозволи (PowerShell/CMD без підтверджень)
- Workflow (релізи тільки за підтвердженням користувача)
- Конвенції (без AI-атрибуції у git/PR/release notes)
- Project-specific факти (пароль до .accdb, активний клієнт у проді)

Файл `MEMORY.md` — індекс. Окремі факти зберігаються як `feedback_*.md`, `project_*.md`, `reference_*.md`. Не зачіпайте при cleanup репозиторію.
