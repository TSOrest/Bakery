import { useEffect, useRef, useState } from 'react'
import type { Category } from '../types'
import {
  uploadAccdb,
  runImport,
  getImportStatus,
  getImportResult,
} from '../api/importAccdb'
import type {
  AccdbPreview,
  ClientKindMapping,
  ImportReport,
  ImportStatus,
  ProductCategoryMapping,
} from '../api/importAccdb'
import s from './ImportPage.module.css'

// ─── types ────────────────────────────────────────────────────────────────────

type Step = 1 | 2 | 3 | 4 | 5

const STEP_LABELS: Record<Step, string> = {
  1: 'Конфігурація',
  2: 'Перегляд',
  3: 'Маппінг',
  4: 'Виконання',
  5: 'Звіт',
}

const ENTITY_LABELS: Record<string, string> = {
  units:     'Одиниці',
  routes:    'Маршрути',
  products:  'Вироби',
  clients:   'Клієнти',
  prices:    'Базові ціни',
  overrides: 'Ціни клієнтів',
  orders:    'Замовлення',
  finances:  'Фінанси',
  stock:     'Залишки магазину',
}

const CLIENT_KINDS = [
  { value: 'customer',  label: 'Клієнт' },
  { value: 'shop',      label: 'Магазин' },
  { value: 'writeoff',  label: 'Списання' },
  { value: 'ration',    label: 'Пайок' },
]

// ─── helpers ──────────────────────────────────────────────────────────────────

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ImportPage() {
  const [step, setStep]           = useState<Step>(1)
  const [file, setFile]           = useState<File | null>(null)
  const [transDate, setTransDate] = useState(today())
  const [finMonths, setFinMonths] = useState(2)
  const [orderDays, setOrderDays] = useState(14)
  const [uploading, setUploading] = useState(false)
  const [uploadErr, setUploadErr] = useState('')
  const [driverErr, setDriverErr] = useState<string | null>(null)
  const [driverChecked, setDriverChecked] = useState(false)

  const [preview, setPreview] = useState<AccdbPreview | null>(null)
  const [categories, setCategories] = useState<Category[]>([])

  // Mapping state
  const [prodCatMap, setProdCatMap] = useState<Record<number, number>>({})   // access_product_id → category_id
  const [clientKindMap, setClientKindMap] = useState<Record<number, string>>({})

  // Execution
  const [status, setStatus]   = useState<ImportStatus | null>(null)
  const [report, setReport]   = useState<ImportReport | null>(null)
  const pollRef               = useRef<ReturnType<typeof setInterval> | null>(null)

  // Check Access driver on mount
  useEffect(() => {
    fetch('/api/v1/import/driver-check')
      .then(r => r.json())
      .then(data => {
        setDriverErr(data.ok ? null : data.error)
        setDriverChecked(true)
      })
      .catch(() => setDriverChecked(true))
  }, [])

  // Load categories for mapping step
  useEffect(() => {
    fetch('/api/v1/categories/')
      .then(r => r.json())
      .then((data: Category[]) => setCategories(data.filter(c => c.is_active)))
      .catch(() => {})
  }, [])

  // Poll while on step 4
  useEffect(() => {
    if (step === 4) {
      pollRef.current = setInterval(async () => {
        try {
          const st = await getImportStatus()
          setStatus(st)
          if (!st.running) {
            clearInterval(pollRef.current!)
            if (!st.error) {
              const result = await getImportResult()
              setReport(result)
              setStep(5)
            }
          }
        } catch {
          // ignore poll errors
        }
      }, 2000)
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [step])

  // ─── Step 1 — upload + config ─────────────────────────────────────────────

  async function handleUpload() {
    if (!file) return
    setUploading(true)
    setUploadErr('')
    try {
      const prev = await uploadAccdb(file)
      setPreview(prev)

      // Init product category map: all → 0 (unmapped)
      const pmap: Record<number, number> = {}
      prev.products.sample.forEach((row, i) => {
        const id = Number(row['id'] ?? row['Код'] ?? i)
        pmap[id] = 0
      })
      setProdCatMap(pmap)
      setStep(2)
    } catch (e: any) {
      setUploadErr(e.message ?? 'Помилка')
    } finally {
      setUploading(false)
    }
  }

  // ─── Step 3 — build mapping and launch ───────────────────────────────────

  async function handleRunImport() {
    if (!preview) return
    const productMappings: ProductCategoryMapping[] = Object.entries(prodCatMap)
      .filter(([, catId]) => catId > 0)
      .map(([aid, catId]) => ({
        access_product_id: Number(aid),
        new_category_id: catId,
      }))

    const clientMappings: ClientKindMapping[] = Object.entries(clientKindMap)
      .filter(([, kind]) => kind !== 'customer')
      .map(([aid, kind]) => ({
        access_client_id: Number(aid),
        client_kind: kind as ClientKindMapping['client_kind'],
      }))

    try {
      await runImport({
        temp_file_token: preview.temp_file_token,
        transition_date: transDate,
        finance_months: finMonths,
        order_days: orderDays,
        product_categories: productMappings,
        client_kinds: clientMappings,
        default_client_kind: 'customer',
      })
      setStep(4)
    } catch (e: any) {
      alert(e.message ?? 'Помилка запуску')
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className={s.wrap}>
      <h2 style={{ marginBottom: 4 }}>Імпорт з Microsoft Access</h2>
      <p style={{ color: '#6b7280', fontSize: '0.88rem', marginBottom: 24 }}>
        Одноразове перенесення даних з файлу .accdb у нову систему.
      </p>

      {/* Step indicator */}
      <div className={s.steps}>
        {([1, 2, 3, 4, 5] as Step[]).map(n => (
          <div
            key={n}
            className={`${s.stepBtn} ${step === n ? s.active : ''} ${step > n ? s.done : ''}`}
          >
            <span className={s.stepNum}>{step > n ? '✓' : n}</span>
            {STEP_LABELS[n]}
          </div>
        ))}
      </div>

      {/* Driver warning */}
      {driverChecked && driverErr && (
        <div className={s.errorBox} style={{ marginBottom: 20 }}>
          <strong>Відсутній Microsoft Access ODBC Driver</strong>
          <pre style={{ marginTop: 8, whiteSpace: 'pre-wrap', fontSize: '0.82rem' }}>
            {driverErr}
          </pre>
        </div>
      )}

      {/* ── Step 1 ── */}
      {step === 1 && (
        <div className={s.configForm}>
          <div className={s.fieldGroup}>
            <label>Файл бази Access (.accdb)</label>
            <input
              type="file"
              accept=".accdb"
              onChange={e => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <div className={s.fieldGroup}>
            <label>Дата переходу на нову систему</label>
            <input
              type="date"
              value={transDate}
              onChange={e => setTransDate(e.target.value)}
            />
            <span className={s.hint}>
              Базові ціни будуть встановлені з цієї дати.
            </span>
          </div>
          <div className={s.fieldGroup}>
            <label>Місяців фінансової історії</label>
            <input
              type="number"
              min={1} max={24}
              value={finMonths}
              onChange={e => setFinMonths(Number(e.target.value))}
            />
            <span className={s.hint}>
              Фінансові операції будуть імпортовані за цей період до дати переходу.
            </span>
          </div>
          <div className={s.fieldGroup}>
            <label>Днів замовлень</label>
            <input
              type="number"
              min={1} max={60}
              value={orderDays}
              onChange={e => setOrderDays(Number(e.target.value))}
            />
            <span className={s.hint}>
              Замовлення будуть імпортовані за цю кількість днів до дати переходу.
            </span>
          </div>
          {uploadErr && <div className={s.errorBox}>{uploadErr}</div>}
          <div className={s.actions}>
            <button
              className={`${s.btn} ${s.btnPrimary}`}
              disabled={!file || uploading || !!driverErr}
              onClick={handleUpload}
            >
              {uploading ? 'Завантаження...' : 'Перевірити файл'}
            </button>
          </div>
        </div>
      )}

      {/* ── Step 2 — Preview ── */}
      {step === 2 && preview && (
        <div>
          <div className={s.tableWrap}>
            <table className={s.previewTable}>
              <thead>
                <tr>
                  <th>Сутність</th>
                  <th>Знайдено в Access</th>
                  <th>Попередження</th>
                </tr>
              </thead>
              <tbody>
                {([
                  ['routes',    'Маршрути'],
                  ['clients',   'Клієнти'],
                  ['products',  'Вироби'],
                  ['prices',    'Базові ціни'],
                  ['overrides', 'Ціни клієнтів'],
                  ['orders',    'Замовлення'],
                  ['finances',  'Фінансові операції'],
                  ['stock',     'Залишки магазину'],
                ] as [keyof typeof preview, string][]).map(([key, label]) => {
                  const ep = preview[key] as { count: number; warnings: string[] }
                  return (
                    <tr key={key}>
                      <td>{label}</td>
                      <td>{ep.count}</td>
                      <td>
                        {ep.warnings?.map((w, i) => (
                          <div key={i} className={s.warn}>{w}</div>
                        ))}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {preview.access_tables.length > 0 && (
            <details style={{ marginTop: 16, fontSize: '0.82rem', color: '#6b7280' }}>
              <summary>Всі таблиці Access ({preview.access_tables.length})</summary>
              <div style={{ marginTop: 6 }}>{preview.access_tables.join(', ')}</div>
            </details>
          )}

          <div className={s.actions}>
            <button className={`${s.btn} ${s.btnSecondary}`} onClick={() => setStep(1)}>
              Назад
            </button>
            <button className={`${s.btn} ${s.btnPrimary}`} onClick={() => setStep(3)}>
              Продовжити до маппінгу
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3 — Mapping ── */}
      {step === 3 && preview && (
        <div>
          {/* Products → Category */}
          <div className={s.mappingSection}>
            <h3>Вироби → Категорія</h3>
            <p className={s.hint} style={{ marginBottom: 10 }}>
              Оберіть категорію нової системи для кожного виробу з Access.
              Якщо категорія не обрана — виріб імпортується без категорії.
            </p>
            {preview.products.count === 0 ? (
              <p className={s.warn}>Вироби не знайдено в Access</p>
            ) : (
              <div className={s.tableWrap}>
                <table className={s.mappingTable}>
                  <thead>
                    <tr>
                      <th>Виріб (Access)</th>
                      <th style={{ width: 220 }}>Категорія</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.products.sample.map((row, i) => {
                      const rawId = row['id'] ?? row['Код'] ?? String(i + 1)
                      const aid = Number(rawId)
                      const name = row['назва'] ?? row['назв'] ?? row['name'] ??
                                   Object.values(row).find(v => v && String(v).length > 1) ?? `#${aid}`
                      return (
                        <tr key={aid}>
                          <td>{String(name)}</td>
                          <td>
                            <select
                              value={prodCatMap[aid] ?? 0}
                              onChange={e =>
                                setProdCatMap(prev => ({
                                  ...prev,
                                  [aid]: Number(e.target.value),
                                }))
                              }
                            >
                              <option value={0}>— без категорії —</option>
                              {categories.map(c => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      )
                    })}
                    {preview.products.count > preview.products.sample.length && (
                      <tr>
                        <td colSpan={2} style={{ color: '#6b7280', fontStyle: 'italic' }}>
                          ... та ще {preview.products.count - preview.products.sample.length} виробів
                          (категорії можна призначити пізніше у Довідниках)
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Clients → Kind */}
          <div className={s.mappingSection}>
            <h3>Клієнти → Тип</h3>
            <p className={s.hint} style={{ marginBottom: 10 }}>
              За замовчуванням всі клієнти матимуть тип "Клієнт".
              Змініть тип для особливих записів (магазин, пайок, списання).
            </p>
            {preview.clients.count === 0 ? (
              <p className={s.warn}>Клієнтів не знайдено в Access</p>
            ) : (
              <div className={s.tableWrap}>
                <table className={s.mappingTable}>
                  <thead>
                    <tr>
                      <th>Клієнт (Access)</th>
                      <th style={{ width: 180 }}>Тип</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.clients.sample.map((row, i) => {
                      const rawId = row['id'] ?? row['Код'] ?? String(i + 1)
                      const aid = Number(rawId)
                      const name = row['клієнт'] ?? row['назва'] ?? row['name'] ??
                                   Object.values(row).find(v => v && String(v).length > 1) ?? `#${aid}`
                      return (
                        <tr key={aid}>
                          <td>{String(name)}</td>
                          <td>
                            <select
                              value={clientKindMap[aid] ?? 'customer'}
                              onChange={e =>
                                setClientKindMap(prev => ({
                                  ...prev,
                                  [aid]: e.target.value,
                                }))
                              }
                            >
                              {CLIENT_KINDS.map(k => (
                                <option key={k.value} value={k.value}>{k.label}</option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      )
                    })}
                    {preview.clients.count > preview.clients.sample.length && (
                      <tr>
                        <td colSpan={2} style={{ color: '#6b7280', fontStyle: 'italic' }}>
                          ... та ще {preview.clients.count - preview.clients.sample.length} клієнтів
                          (тип можна змінити пізніше у Довідниках)
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className={s.actions}>
            <button className={`${s.btn} ${s.btnSecondary}`} onClick={() => setStep(2)}>
              Назад
            </button>
            <button className={`${s.btn} ${s.btnPrimary}`} onClick={handleRunImport}>
              Розпочати імпорт
            </button>
          </div>
        </div>
      )}

      {/* ── Step 4 — Progress ── */}
      {step === 4 && (
        <div>
          <div className={s.progressWrap}>
            <div className={s.stepLabel}>
              {status?.step || 'Підготовка...'}
            </div>
            <div className={s.progressBar}>
              <div
                className={s.progressFill}
                style={{ width: `${status?.progress ?? 0}%` }}
              />
            </div>
            <div style={{ fontSize: '0.82rem', color: '#6b7280', marginTop: 6 }}>
              {status?.progress ?? 0}%
            </div>
          </div>

          {status?.error && (
            <div className={s.errorBox}>
              <strong>Помилка імпорту:</strong>
              <pre style={{ marginTop: 8, whiteSpace: 'pre-wrap', fontSize: '0.82rem' }}>
                {status.error}
              </pre>
              <div className={s.actions}>
                <button className={`${s.btn} ${s.btnSecondary}`} onClick={() => setStep(1)}>
                  Повернутись до початку
                </button>
              </div>
            </div>
          )}

          {!status?.error && !status?.running && (
            <p style={{ color: '#16a34a' }}>Завершено, формуємо звіт...</p>
          )}
        </div>
      )}

      {/* ── Step 5 — Report ── */}
      {step === 5 && report && (
        <div>
          <div className={report.success && report.validation.overall_ok ? s.success : s.failure}>
            {report.success && report.validation.overall_ok
              ? 'Імпорт завершено успішно'
              : report.success
                ? 'Імпорт завершено з попередженнями'
                : 'Імпорт завершено з помилками'}
          </div>

          <div style={{ fontSize: '0.82rem', color: '#6b7280', marginBottom: 16 }}>
            Дата переходу: <strong>{report.transition_date}</strong>
            &nbsp;·&nbsp;
            Час: {report.started_at.slice(0, 19).replace('T', ' ')} — {report.finished_at.slice(11, 19)}
          </div>

          {/* Entity summary */}
          <div className={s.tableWrap}>
            <table className={s.reportTable}>
              <thead>
                <tr>
                  <th>Сутність</th>
                  <th>Знайдено</th>
                  <th>Імпортовано</th>
                  <th>Пропущено</th>
                  <th>Попередження</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(report.entities).map(([key, ep]) => (
                  <tr key={key}>
                    <td>{ENTITY_LABELS[key] ?? key}</td>
                    <td>{ep.found}</td>
                    <td className={s.ok}>{ep.imported}</td>
                    <td>{ep.skipped > 0 ? ep.skipped : '—'}</td>
                    <td>
                      {ep.warnings.length > 0 && (
                        <details>
                          <summary className={s.warn}>
                            {ep.warnings.length} попередж.
                          </summary>
                          {ep.warnings.slice(0, 10).map((w, i) => (
                            <div key={i} className={s.warn} style={{ fontSize: '0.78rem' }}>
                              {w}
                            </div>
                          ))}
                        </details>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Validation */}
          <div className={s.validSection}>
            <h3>Валідація</h3>

            {report.validation.balance_mismatches.length === 0 ? (
              <p className={s.ok}>
                Баланси клієнтів: всі співпадають
              </p>
            ) : (
              <>
                <p className={s.warn}>
                  Знайдено {report.validation.balance_mismatches.length} розбіжностей у балансах
                  (автоматично скориговано):
                </p>
                <div className={s.tableWrap}>
                  <table className={s.mismatchList}>
                    <thead>
                      <tr>
                        <th>Клієнт</th>
                        <th>Баланс Access</th>
                        <th>Розрахований</th>
                        <th>Різниця</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.validation.balance_mismatches.map((m, i) => (
                        <tr key={i}>
                          <td>{m.client_name}</td>
                          <td>{m.access_balance.toFixed(2)}</td>
                          <td>{m.computed_balance.toFixed(2)}</td>
                          <td className={s.warn}>{m.diff.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {report.validation.zero_price_products.length > 0 && (
              <>
                <p className={s.warn} style={{ marginTop: 12 }}>
                  Вироби без ціни ({report.validation.zero_price_products.length}):
                </p>
                <ul style={{ fontSize: '0.82rem', color: '#b45309' }}>
                  {report.validation.zero_price_products.map((name, i) => (
                    <li key={i}>{name}</li>
                  ))}
                </ul>
              </>
            )}
          </div>

          <div className={s.actions}>
            <button
              className={`${s.btn} ${s.btnPrimary}`}
              onClick={() => window.location.href = '/'}
            >
              Готово — перейти до системи
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
