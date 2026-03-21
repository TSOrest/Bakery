import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import styles from './DbEditorPage.module.css'

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
  surplus_allocations:    'Розподіл надлишків випічки: магазин, маршрут, пайок, списання.',
  surplus_allocation_lines: 'Деталізовані рядки розподілу надлишків.',
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
  const [showDdl,      setShowDdl]      = useState(false)

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  }

  const apiFetch = useCallback(async (path: string, opts?: RequestInit) => {
    const res = await fetch(`/api/v1/db-editor${path}`, { ...opts, headers })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.detail ?? `HTTP ${res.status}`)
    }
    return res.json()
  }, [token]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load tables list
  useEffect(() => {
    apiFetch('/tables').then(setTables).catch(() => {})
  }, [apiFetch])

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
      apiFetch('/tables').then(setTables).catch(() => {})
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
      apiFetch('/tables').then(setTables).catch(() => {})
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
          <div className={styles.sidebarTitle}>Таблиці ({tables.length})</div>
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
                            {o.label} (#{o.value})
                          </option>
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
