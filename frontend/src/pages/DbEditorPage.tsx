import { useState, useEffect, useCallback, useMemo } from 'react'
import { useAuth } from '../context/AuthContext'
import styles from './DbEditorPage.module.css'
import ErdView from './DbEditorErd'

// ── Types ─────────────────────────────────────────────────────────────────

interface TableInfo { name: string; row_count: number }

interface Column {
  cid: number
  name: string
  type: string
  not_null: boolean
  default: string | null
  is_pk: boolean
}

interface ForeignKey {
  from_col: string
  to_table: string
  to_col: string
  on_update: string
  on_delete: string
}

interface IndexInfo { name: string; unique: boolean; columns: string[] }

interface SchemaInfo {
  table: string
  columns: Column[]
  foreign_keys: ForeignKey[]
  indexes: IndexInfo[]
  ddl: string
}

interface DataResult {
  total: number
  page: number
  page_size: number
  columns: string[]
  rows: Record<string, unknown>[]
}

interface FkOption { value: unknown; label: string }

// ── Table descriptions (static, human-readable) ───────────────────────────

const TABLE_DESCRIPTIONS: Record<string, string> = {
  clients:                'Клієнти — покупці продукції пекарні. Прив\'язані до маршрутів, можуть мати індивідуальні ціни та Telegram-авторизацію.',
  products:               'Вироби — продукція пекарні (хліб, булки, інше). Мають тип, вагу, собівартість.',
  categories:             'Категорії виробів. Використовуються для групування і цінової логіки.',
  units:                  'Одиниці виміру (шт, кг, буханка тощо).',
  routes:                 'Маршрути доставки. Клієнти прив\'язані до маршрутів.',
  orders:                 'Замовлення клієнтів. Кожен рядок — одна позиція товару для клієнта на дату.',
  invoices:               'Накладні на відвантаження. Документ для конкретного клієнта на дату.',
  invoice_lines:          'Рядки накладної — деталі кожної позиції: товар, кількість, ціна.',
  prices:                 'Базові ціни на вироби з датами дії. Можуть бути прив\'язані до категорії.',
  client_price_overrides: 'Індивідуальні ціни для конкретних клієнтів (пріоритет над базовими).',
  baking_tasks:           'Завдання на випічку — замовлена, рекомендована і фактична кількість по виробах.',
  finances:               'Фінансові операції — оплати, накладні, списання боргів тощо.',
  finance_articles:       'Статті фінансових операцій (замінює старий enum finance_type).',
  settings:               'Налаштування системи (ключ-значення). Включає шаблони бота, токени, параметри.',
  shop_counts:            'Щоденна звірка магазину: залишок вчора, надходження, введений залишок, продано.',
  movements:              'Рухи товарів по всіх типах операцій (надходження, продаж, списання тощо).',
  daily_balances:         'Щоденні залишки продуктів з каскадним перерахунком.',
  ingredients:            'Інгредієнти для виготовлення виробів із собівартістю.',
  product_ingredients:    'Рецептура виробів: склад і кількість кожного інгредієнта.',
  route_cancellations:    'Скасування рейсів (маршрутів) з причиною.',
  cancellation_lines:     'Рядки скасованого рейсу: товар, кількість, розподіл (магазин/перенести/списати).',
  users:                  'Користувачі системи: login, роль (operator/accountant/admin/owner), пароль-хеш.',
  auth_sessions:          'Активні сесії авторизації. Токен → user_id з TTL.',
  client_bot_users:       'Авторизовані Telegram-акаунти клієнтів (chat_id, телефон, ім\'я).',
  other_products:         'Товари групи Інше (не власного виробництва) з закупівельною і продажною ціною.',
  other_stock_in:         'Надходження товарів групи Інше на склад магазину.',
}

// ── Column hints (human-readable per table.column) ─────────────────────────

const COLUMN_HINTS: Record<string, Record<string, string>> = {
  products: {
    type:           "Тип виробу: 'bread' (хліб), 'bun' (булка), 'other' (інше). Визначає логіку резервів і залишків.",
    cost_per_unit:  'Розрахункова собівартість одиниці на основі рецептури (product_ingredients).',
    is_active:      '1 = активний (відображається в замовленнях), 0 = архівний.',
    initial_stock:  'Початковий залишок для seed при першому запуску. Не відображається як поточний залишок.',
    unit_id:        'Одиниця виміру (кг, шт, буханка тощо) з таблиці units.',
    category_id:    'Категорія виробу. Впливає на застосування цінових правил.',
  },
  clients: {
    discount_pct:         'Відсоток знижки від базової ціни (0..100). Застосовується якщо немає індивідуального прайсу.',
    route_id:             'Маршрут доставки. Клієнт закріплений за одним маршрутом.',
    is_active:            '1 = активний, 0 = архівний (не відображається в замовленнях).',
    is_own_shop:          'Застаріле поле. Використовувати client_kind = shop замість цього.',
    client_kind:          "Тип клієнта: 'customer' = звичайний клієнт, 'shop' = власний магазин пекарні, 'writeoff' = системний клієнт списань, 'ration' = системний клієнт пайків, 'underbaked' = системний клієнт недопеченої продукції. Системні клієнти (writeoff/ration/underbaked) створюються автоматично і не можна деактивувати.",
    print_invoice:        '1 = друкувати накладну для цього клієнта, 0 = не друкувати.',
    bot_phones:           'Телефони для авторизації в Telegram-боті (через кому). Клієнт може авторизуватися з цих номерів.',
    client_group:         'Підгрупа в межах маршруту (наприклад: назва населеного пункту). Впливає на сортування накладних.',
    receiver_name:        "ПІБ особи що приймає товар ('Прийняв' у накладній).",
    delivery_agent:       "Через кого відправляється товар ('ВідпЧерез' у старій системі).",
    delivery_note_number: 'Номер доручення.',
    delivery_note_date:   'Дата доручення.',
  },
  orders: {
    status:             "Статус: 'draft' (чернетка), 'confirmed' (підтверджено), 'closed' (закрито).",
    source:             "Джерело: 'phone' (по телефону), 'paper' (паперове), 'bot' (через Telegram-бота).",
    exchange_type:      "Тип обміну: 'none', 'pre_order' (заздалегідь), 'post_delivery' (після доставки).",
    exchange_qty:       'Кількість несвіжого товару для обміну.',
    exchange_price:     'Ціна несвіжого товару при обміні.',
    exchange_notes:     "Обов'язкова нотатка для post_delivery обміну — умови передачі.",
    price_override:     'Ціна-override для цього рядка. NULL = ціна береться автоматично за пріоритетом.',
    bot_status:         "Статус обробки через бота: 'pending', 'confirmed', 'rejected', 'modified'.",
    bot_original_qty:   'Оригінальна кількість до зміни оператором (зберігається при модифікації замовлення).',
    placed_by_chat_id:  'Telegram chat_id користувача що подав замовлення через бота.',
    parent_order_id:    'ID батьківського рядка замовлення (для дочірніх рядків переміщення/повернення).',
    delivered_qty:      'Фактично передана кількість. Може відрізнятися від замовленої qty.',
    origin_id:          'Джерело рядка: NULL = звичайне замовлення клієнта; 0 = надлишок випічки (розподілено оператором); X = переміщено з orders.id=X.',
  },
  invoices: {
    invoice_number: "Унікальний номер у форматі YYYYMMDD-NNN. Лічильник NNN скидається щодня.",
    status:         "Статус: 'draft', 'printed' (роздруковано), 'delivered' (доставлено), 'cancelled'.",
    total_sum:      'Загальна сума накладної — сума всіх рядків invoice_lines.',
  },
  invoice_lines: {
    price:          'Базова ціна рядка на момент формування накладної.',
    price_override: 'Ціна-override для цього рядка. NULL = використовується price.',
    is_exchange:    '1 = рядок обміну (несвіжий товар замінюється свіжим).',
    is_stale:       '1 = несвіжий товар.',
    sum:            'Підсумок рядка = qty × COALESCE(price_override, price).',
  },
  prices: {
    category_id: 'NULL = ціна для всіх категорій клієнтів. Якщо заповнено = тільки для цієї категорії.',
    valid_from:  'Дата початку дії ціни (YYYY-MM-DD).',
    valid_to:    'Дата закінчення дії. NULL = ціна безстрокова (діє до появи нової).',
    is_active:   '1 = ціна активна.',
    created_by:  'Логін користувача що вніс ціну.',
  },
  client_price_overrides: {
    price:      'Індивідуальна ціна — пріоритет над базовою ціною зі знижкою.',
    valid_from: 'Дата початку дії індивідуальної ціни.',
    valid_to:   'Дата закінчення. NULL = безстрокова.',
  },
  baking_tasks: {
    ordered_qty:     'Сумарна кількість з підтверджених замовлень клієнтів на цю дату.',
    recommended_qty: 'Рекомендована кількість = ordered_qty + резерв % (з налаштувань bun/bread_reserve_pct).',
    baked_qty:       'Фактично спечена кількість — вводить пекар.',
  },
  shop_counts: {
    product_type:       "Тип: 'bread' (свіже), 'stale' (несвіже), 'other' (товари групи Інше).",
    yesterday_balance:  'Залишок з попереднього дня — авто-перенос.',
    received_today:     'Надходження сьогодні з випічки + повернення від водіїв.',
    entered_balance:    'Фактичний залишок введений оператором під час щоденної звірки.',
    written_off_entered:'Списання введене оператором при звірці.',
    calculated_sold:    'Авторозрахунок продажів = вчора + надійшло − введений − списано.',
    saved:              '1 = звірку підтверджено і заблоковано редагування.',
    price:              'Ціна продажу на момент звірки.',
  },
  movements: {
    move_type:    "Тип руху: 'in' (надходження), 'sold' (продаж), 'writeoff' (списання), 'ration' (пайок), 'return_stale', 'exchange_out/in', 'cancel_to_shop'.",
    is_stale:     '1 = несвіжий товар.',
    source_table: "Таблиця-джерело події ('orders', 'invoices', 'baking_tasks' тощо).",
    source_id:    'ID запису в таблиці-джерелі.',
    route_id:     'Маршрут, якщо рух пов\'язаний з рейсом.',
  },
  daily_balances: {
    is_stale:     '1 = запис для несвіжого товару.',
    start_balance:'Залишок на початок дня.',
    received:     'Надходження за день (з baking_tasks, повернення).',
    sold:         'Продано за день.',
    written_off:  'Списано за день.',
    end_balance:  'Залишок на кінець дня = start + received − sold − written_off.',
    computed_at:  'Час останнього перерахунку. Каскадний перерахунок запускається при змінах.',
  },
  finances: {
    sign:       '+1 = надходження (збільшує баланс клієнта), -1 = витрата (зменшує баланс).',
    article_id: 'Стаття фінансової операції з таблиці finance_articles.',
    client_id:  'NULL = загальна касова операція не прив\'язана до клієнта.',
    amount:     'Завжди позитивне число. Напрямок визначається полем sign.',
    created_by: 'Логін користувача що вніс операцію.',
  },
  finance_articles: {
    direction:  "'income' = надходження, 'expense' = витрата.",
    is_system:  '1 = системна стаття (не можна видалити, можна лише перейменувати).',
  },
  settings: {
    key:         'Унікальний ідентифікатор налаштування.',
    value:       'Поточне значення (текстовий рядок).',
    description: 'Пояснення призначення налаштування.',
    updated_at:  'Дата останньої зміни значення.',
  },
  client_bot_users: {
    chat_id:       'Telegram chat ID авторизованого користувача — унікальний ідентифікатор.',
    is_active:     '1 = авторизація активна, 0 = відкликана оператором.',
    authorized_at: 'Дата і час авторизації через /start.',
    phone:         'Телефон з якого була авторизація (отримується від Telegram).',
  },
  users: {
    role:          "Роль: 'operator', 'accountant', 'admin', 'owner'.",
    password_hash: 'SHA-256 хеш пароля (salt + password).',
    salt:          'Рандомна сіль для хешування пароля.',
    role_label:    'Відображувана назва ролі в інтерфейсі.',
  },
  auth_sessions: {
    token:      'Bearer-токен сесії — передається в Authorization заголовку.',
    expires_at: 'TTL токена. Після цього часу токен більше не прийматиметься.',
  },
  cancellation_lines: {
    disposition:          "'to_shop' (в магазин), 'to_next_day' (перенести), 'writeoff' (списати).",
    next_day_price_override: 'Знижена ціна при перенесенні товару на наступний день.',
  },
  route_cancellations: {
    cancel_date:  'Дата скасованого рейсу.',
    cancelled_by: 'Логін оператора що скасував рейс.',
  },
  other_products: {
    purchase_price: 'Закупівельна ціна — собівартість.',
    sell_price:     'Ціна продажу в магазині.',
    is_active:      '1 = активний товар, 0 = архівний.',
  },
  other_stock_in: {
    qty:            'Кількість товару що надійшла на склад.',
    purchase_price: 'Закупівельна ціна на момент надходження.',
  },
  product_ingredients: {
    qty_per_unit: 'Кількість інгредієнта на одну одиницю виробу (використовується для розрахунку собівартості).',
  },
  ingredients: {
    price_per_unit:   'Ціна за одиницю інгредієнта — використовується для розрахунку cost_per_unit виробу.',
    price_updated_at: 'Дата останнього оновлення ціни інгредієнта.',
  },
}

// ── Component ─────────────────────────────────────────────────────────────

export default function DbEditorPage() {
  const { token } = useAuth()

  const [tables,       setTables]       = useState<TableInfo[]>([])
  const [search,       setSearch]       = useState('')
  const [selected,     setSelected]     = useState<string | null>(null)
  const [schema,       setSchema]       = useState<SchemaInfo | null>(null)
  const [data,         setData]         = useState<DataResult | null>(null)
  const [page,         setPage]         = useState(0)
  const [editRow,      setEditRow]      = useState<Record<string, unknown> | null>(null)
  const [editVals,     setEditVals]     = useState<Record<string, unknown>>({})
  const [fkOptions,    setFkOptions]    = useState<Record<string, FkOption[]>>({})
  const [saving,       setSaving]       = useState(false)
  const [deleting,     setDeleting]     = useState<string | null>(null)
  const [loadingData,  setLoadingData]  = useState(false)
  const [error,        setError]        = useState<string | null>(null)
  const [loadError,    setLoadError]    = useState<string | null>(null)
  const [showDdl,      setShowDdl]      = useState(false)
  const [showErd,      setShowErd]      = useState(false)

  // Parse CHECK(col IN ('v1','v2',...)) from DDL for enum dropdowns in edit modal
  const checkEnums = useMemo<Record<string, string[]>>(() => {
    if (!schema) return {}
    const result: Record<string, string[]> = {}
    const re = /CHECK\s*\(\s*(\w+)\s+IN\s*\(([^)]+)\)/gi
    let m: RegExpExecArray | null
    while ((m = re.exec(schema.ddl)) !== null) {
      const col = m[1]
      const vals = Array.from(m[2].matchAll(/'([^']+)'/g)).map(v => v[1])
      if (vals.length > 0) result[col] = vals
    }
    return result
  }, [schema])


  const apiFetch = useCallback(async (path: string, opts?: RequestInit) => {
    const res = await fetch(`/api/v1/db-editor${path}`, {
      ...opts,
      headers: {
        'Authorization': `Bearer ${token ?? ''}`,
        'Content-Type': 'application/json',
      },
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.detail ?? `HTTP ${res.status}`)
    }
    return res.json()
  }, [token])

  // Load tables list
  const loadTables = useCallback(() => {
    setLoadError(null)
    apiFetch('/tables')
      .then(setTables)
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : 'Помилка завантаження таблиць'))
  }, [apiFetch])

  useEffect(() => { loadTables() }, [loadTables])

  // Load schema + first page when table selected
  useEffect(() => {
    if (!selected) return
    setPage(0)
    setSchema(null)
    setData(null)
    setFkOptions({})
    setError(null)
    setShowDdl(false)

    Promise.all([
      apiFetch(`/tables/${selected}/schema`),
      apiFetch(`/tables/${selected}/data?page=0&page_size=50`),
    ]).then(([s, d]) => {
      setSchema(s)
      setData(d)
    }).catch(e => setError(e.message))
  }, [selected]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadPage = useCallback(async (p: number) => {
    if (!selected) return
    setLoadingData(true)
    setError(null)
    try {
      const d = await apiFetch(`/tables/${selected}/data?page=${p}&page_size=50`)
      setData(d)
      setPage(p)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Помилка')
    } finally {
      setLoadingData(false)
    }
  }, [selected, apiFetch])

  const startEdit = useCallback(async (row: Record<string, unknown>) => {
    setEditRow(row)
    setEditVals({ ...row })
    setError(null)

    if (!schema) return
    const opts: Record<string, FkOption[]> = {}
    for (const fk of schema.foreign_keys) {
      if (fk.from_col in opts) continue
      try {
        const res = await apiFetch(`/tables/${selected}/fk-options/${fk.from_col}`)
        opts[fk.from_col] = res.options
      } catch { /* FK options optional */ }
    }
    setFkOptions(opts)
  }, [schema, selected, apiFetch])

  const saveEdit = async () => {
    if (!selected || !schema) return
    const pkCol = schema.columns.find(c => c.is_pk)?.name
    if (!pkCol) return
    const pkVal = editRow![pkCol]

    setSaving(true)
    setError(null)
    try {
      await apiFetch(`/tables/${selected}/row/${pkVal}`, {
        method: 'PUT',
        body: JSON.stringify(editVals),
      })
      setEditRow(null)
      // Refresh table list counts
      loadTables()
      await loadPage(page)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Помилка збереження')
    } finally {
      setSaving(false)
    }
  }

  const deleteRow = async (pkVal: unknown) => {
    if (!selected) return
    setDeleting(String(pkVal))
    setError(null)
    try {
      await apiFetch(`/tables/${selected}/row/${pkVal}`, { method: 'DELETE' })
      loadTables()
      await loadPage(page)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Помилка видалення')
    } finally {
      setDeleting(null)
    }
  }

  const pkCol    = schema?.columns.find(c => c.is_pk)?.name
  const fkColSet = new Set(schema?.foreign_keys.map(fk => fk.from_col) ?? [])
  const totalPages = data ? Math.ceil(data.total / 50) : 0
  const filteredTables = tables.filter(t => t.name.toLowerCase().includes(search.toLowerCase()))

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className={styles.root}>
      <div className={styles.banner}>
        ⚠️ <b>Редактор бази даних</b> — прямий доступ до SQLite. Зміни незворотні і не проходять
        через бізнес-логіку застосунку. Використовуйте лише при потребі.
      </div>

      <div className={styles.layout}>

        {/* ── Left: table list ─────────────────────────────────────────── */}
        <div className={styles.sidebar}>
          <div className={styles.sidebarTitle}>
            <span>Таблиці ({tables.length})</span>
            <button className={styles.btnToggle} onClick={loadTables} title="Оновити список">⟳</button>
            <button className={styles.btnErd} onClick={() => setShowErd(true)} title="Відкрити схему БД">Схема БД</button>
          </div>
          {loadError && (
            <div style={{ color: '#c0392b', fontSize: '0.75rem', padding: '0.3rem 0.5rem', background: '#fde8e8' }}>
              {loadError}
            </div>
          )}
          <input
            className={styles.searchBox}
            placeholder="Пошук таблиці..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <div className={styles.tableList}>
            {filteredTables.map(t => (
              <div
                key={t.name}
                className={`${styles.tableItem} ${selected === t.name ? styles.tableItemActive : ''}`}
                onClick={() => setSelected(t.name)}
              >
                <span className={styles.tableName}>{t.name}</span>
                <span className={styles.tableCount}>{t.row_count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Center: data grid ────────────────────────────────────────── */}
        <div className={styles.main}>
          {!selected ? (
            <div className={styles.empty}>← Оберіть таблицю зі списку</div>
          ) : !data ? (
            <div className={styles.empty}>Завантаження...</div>
          ) : (
            <>
              <div className={styles.tableHeader}>
                <h2 className={styles.tableTitleText}>{selected}</h2>
                <span className={styles.rowCount}>{data.total} рядків</span>
                {loadingData && <span className={styles.rowCount}>⏳</span>}
              </div>

              {error && <div className={styles.error}>{error}</div>}

              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      {data.columns.map(col => (
                        <th key={col} className={styles.th}>{col}</th>
                      ))}
                      <th className={styles.th} style={{ width: 64 }}>Дії</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((row, i) => {
                      const pk = pkCol != null ? row[pkCol] : i
                      return (
                        <tr key={String(pk ?? i)} className={styles.tr}>
                          {data.columns.map(col => (
                            <td key={col} className={styles.td} title={row[col] != null ? String(row[col]) : ''}>
                              {row[col] == null
                                ? <span className={styles.null}>NULL</span>
                                : String(row[col]).length > 60
                                  ? String(row[col]).slice(0, 60) + '…'
                                  : String(row[col])
                              }
                            </td>
                          ))}
                          <td className={styles.td}>
                            <button className={styles.btnEdit} onClick={() => startEdit(row)} title="Редагувати">✏️</button>
                            {pkCol != null && (
                              <button
                                className={styles.btnDel}
                                disabled={deleting === String(pk)}
                                title="Видалити"
                                onClick={() => {
                                  if (window.confirm(`Видалити рядок (${pkCol}=${pk})?`)) deleteRow(pk)
                                }}
                              >🗑</button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 && (
                <div className={styles.pagination}>
                  <button disabled={page === 0} onClick={() => loadPage(page - 1)}>‹ Попередня</button>
                  <span>Сторінка {page + 1} / {totalPages} ({data.total} рядків)</span>
                  <button disabled={page >= totalPages - 1} onClick={() => loadPage(page + 1)}>Наступна ›</button>
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Right: schema panel ──────────────────────────────────────── */}
        <div className={styles.schemaPanel}>
          {!schema ? (
            <div className={styles.empty} style={{ height: 'auto', paddingTop: '2rem', color: '#ccc' }}>
              Схема
            </div>
          ) : (
            <>
              <div className={styles.schemaTitle}>{schema.table}</div>

              {TABLE_DESCRIPTIONS[schema.table] && (
                <div className={styles.schemaDesc}>{TABLE_DESCRIPTIONS[schema.table]}</div>
              )}

              <div className={styles.schemaSectionTitle}>Колонки</div>
              {schema.columns.map(col => {
                const fk = schema.foreign_keys.find(f => f.from_col === col.name)
                return (
                  <div key={col.name} className={styles.colRow}>
                    <div className={styles.colName}>
                      {col.is_pk && <span className={styles.badge}>PK</span>}
                      {fk && <span className={styles.badgeFk}>FK</span>}
                      {col.name}
                    </div>
                    <div className={styles.colType}>{col.type}</div>
                    <div className={styles.colAttrs}>
                      {col.not_null && <span className={styles.attrChip}>NOT NULL</span>}
                      {col.default != null && <span className={styles.attrChip}>DEFAULT: {col.default}</span>}
                      {fk && <span className={styles.attrFk}>→ {fk.to_table}.{fk.to_col}</span>}
                    </div>
                    {COLUMN_HINTS[schema.table]?.[col.name] && (
                      <div className={styles.colHint}>{COLUMN_HINTS[schema.table][col.name]}</div>
                    )}
                  </div>
                )
              })}

              {schema.foreign_keys.length > 0 && (
                <>
                  <div className={styles.schemaSectionTitle}>Зв'язки (FK)</div>
                  {schema.foreign_keys.map(fk => (
                    <div key={fk.from_col} className={styles.fkRow}>
                      <span className={styles.fkFrom}>{fk.from_col}</span>
                      <span className={styles.fkArrow}> → </span>
                      <span className={styles.fkTo}>{fk.to_table}.{fk.to_col}</span>
                      {fk.on_delete !== 'NO ACTION' && (
                        <span className={styles.fkAction}> (ON DELETE {fk.on_delete})</span>
                      )}
                    </div>
                  ))}
                </>
              )}

              {schema.indexes.length > 0 && (
                <>
                  <div className={styles.schemaSectionTitle}>Індекси</div>
                  {schema.indexes.map(idx => (
                    <div key={idx.name} className={styles.idxRow}>
                      {idx.unique && <span className={styles.badgeUniq}>UNIQUE</span>}
                      <span>{idx.columns.join(', ')}</span>
                    </div>
                  ))}
                </>
              )}

              <div className={styles.schemaSectionTitle}>
                DDL
                <button className={styles.btnToggle} onClick={() => setShowDdl(v => !v)}>
                  {showDdl ? '▾' : '▸'}
                </button>
              </div>
              {showDdl && <pre className={styles.ddl}>{schema.ddl}</pre>}
            </>
          )}
        </div>
      </div>

      {/* ── ERD overlay ─────────────────────────────────────────────────── */}
      {showErd && <ErdView onClose={() => setShowErd(false)} />}

      {/* ── Edit modal ──────────────────────────────────────────────────── */}
      {editRow && schema && (
        <div
          className={styles.modalOverlay}
          onClick={e => { if (e.target === e.currentTarget) { setEditRow(null); setError(null) } }}
        >
          <div className={styles.modal}>
            <div className={styles.modalTitle}>✏️ Редагувати — {selected}</div>

            {error && <div className={styles.error} style={{ margin: '0.5rem 1rem 0' }}>{error}</div>}

            <div className={styles.modalFields}>
              {schema.columns.map(col => {
                const isFk = fkColSet.has(col.name)
                const opts = fkOptions[col.name]
                const val  = editVals[col.name]

                return (
                  <div key={col.name} className={styles.fieldRow}>
                    <label className={styles.fieldLabel}>
                      {col.name}
                      <span className={styles.fieldType}>{col.type}</span>
                      {col.is_pk  && <span className={styles.badge}>PK</span>}
                      {isFk       && <span className={styles.badgeFk}>FK</span>}
                      {col.not_null && <span className={styles.attrChip}>NOT NULL</span>}
                    </label>

                    {col.is_pk ? (
                      <input className={styles.fieldInput} value={val != null ? String(val) : ''} disabled readOnly />
                    ) : isFk && opts ? (
                      <select
                        className={styles.fieldSelect}
                        value={val != null ? String(val) : ''}
                        onChange={e => setEditVals(v => ({
                          ...v,
                          [col.name]: e.target.value === '' ? null : e.target.value,
                        }))}
                      >
                        {!col.not_null && <option value="">— NULL —</option>}
                        {opts.map(o => (
                          <option key={String(o.value)} value={String(o.value)}>
                            {o.label} (#{String(o.value)})
                          </option>
                        ))}
                      </select>
                    ) : checkEnums[col.name] ? (
                      <select
                        className={styles.fieldSelect}
                        value={val != null ? String(val) : ''}
                        onChange={e => setEditVals(v => ({
                          ...v,
                          [col.name]: e.target.value === '' ? null : e.target.value,
                        }))}
                      >
                        {!col.not_null && <option value="">— NULL —</option>}
                        {checkEnums[col.name].map(v => (
                          <option key={v} value={v}>{v}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className={styles.fieldInput}
                        value={val != null ? String(val) : ''}
                        placeholder={col.not_null ? 'Обов\'язкове поле' : 'NULL'}
                        onChange={e => setEditVals(v => ({
                          ...v,
                          [col.name]: e.target.value === '' ? null : e.target.value,
                        }))}
                      />
                    )}
                  </div>
                )
              })}
            </div>

            <div className={styles.modalActions}>
              <button className={styles.btnSave} onClick={saveEdit} disabled={saving}>
                {saving ? 'Збереження...' : '✓ Зберегти'}
              </button>
              <button className={styles.btnCancel} onClick={() => { setEditRow(null); setError(null) }}>
                Скасувати
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
