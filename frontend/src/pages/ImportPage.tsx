/**
 * Майстер імпорту з Microsoft Access — full-screen modal, 10 кроків.
 * Відкривається з кнопки у BackupTab (AdminPage.tsx).
 */
import { useEffect, useRef, useState } from 'react'
import {
  uploadAccdb,
  runImport,
  getImportStatus,
  getImportResult,
  getImportContext,
} from '../api/importAccdb'
import type {
  AccdbPreview,
  CategoryMapping,
  ClientMapping,
  ImportContext,
  ImportReport,
  ImportStatus,
  PriceCategory,
  RouteMapping,
} from '../api/importAccdb'

// ─── helpers ──────────────────────────────────────────────────────────────────

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function fmt(n: number, dec = 2): string {
  return n.toFixed(dec)
}

// ─── constants ────────────────────────────────────────────────────────────────

type WizardStep = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10

const STEP_INFO: Record<WizardStep, { label: string; tableKey?: string }> = {
  1:  { label: 'Параметри' },
  2:  { label: 'Маршрути',     tableKey: 'routes' },
  3:  { label: 'Одиниці',      tableKey: 'units' },
  4:  { label: 'Вироби',       tableKey: 'products' },
  5:  { label: 'Клієнти',      tableKey: 'clients' },
  6:  { label: 'Ціни',         tableKey: 'prices' },
  7:  { label: 'Замовлення',   tableKey: 'orders' },
  8:  { label: 'Фінанси',      tableKey: 'finances' },
  9:  { label: 'Підтвердження' },
  10: { label: 'Виконання' },
}

const ENTITY_LABELS: Record<string, string> = {
  routes:   'Маршрути',
  units:    'Одиниці виміру',
  clients:  'Клієнти',
  products: 'Вироби',
  prices:   'Ціни',
  orders:   'Замовлення',
  finances: 'Фінанси',
  stock:    'Залишки магазину',
}

const KIND_LABELS: Record<string, string> = {
  customer: 'Клієнт',
  shop:     'Магазин',
  writeoff: 'Списання',
  ration:   'Пайок',
}

// ─── styles (inline) ──────────────────────────────────────────────────────────

const OVERLAY: React.CSSProperties = {
  position: 'fixed', inset: 0,
  background: 'rgba(0,0,0,0.55)',
  zIndex: 10000,
  display: 'flex', alignItems: 'stretch',
}

const MODAL: React.CSSProperties = {
  display: 'flex', flexDirection: 'column',
  width: '100vw', height: '100vh',
  background: '#fff',
  overflow: 'hidden',
}

const HEADER: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '0 1.5rem',
  height: 52,
  background: '#1e293b',
  color: '#fff',
  flexShrink: 0,
}

const BODY: React.CSSProperties = {
  display: 'flex', flex: 1, overflow: 'hidden',
}

const SIDEBAR: React.CSSProperties = {
  width: 220, flexShrink: 0,
  borderRight: '1px solid #e5e7eb',
  background: '#f8fafc',
  overflowY: 'auto',
  padding: '1rem 0',
}

const CONTENT: React.CSSProperties = {
  flex: 1, overflowY: 'auto',
  padding: '1.5rem 2rem',
  maxWidth: 900,
}

const FOOTER: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '0.75rem 2rem',
  borderTop: '1px solid #e5e7eb',
  background: '#f9fafb',
  flexShrink: 0,
}

const BTN_PRIMARY: React.CSSProperties = {
  padding: '8px 20px', borderRadius: 6, border: 'none', cursor: 'pointer',
  background: '#2563eb', color: '#fff', fontSize: '0.9rem', fontWeight: 500,
}

const BTN_SECONDARY: React.CSSProperties = {
  padding: '8px 18px', borderRadius: 6, border: '1px solid #d1d5db', cursor: 'pointer',
  background: '#fff', color: '#374151', fontSize: '0.9rem',
}

const BTN_DISABLED: React.CSSProperties = {
  ...BTN_PRIMARY, background: '#93c5fd', cursor: 'not-allowed',
}

const INPUT: React.CSSProperties = {
  padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 6,
  fontSize: '0.9rem', width: '100%', boxSizing: 'border-box' as const,
}

const LABEL: React.CSSProperties = {
  fontSize: '0.82rem', fontWeight: 600, color: '#374151', marginBottom: 4, display: 'block',
}

const HINT: React.CSSProperties = {
  fontSize: '0.75rem', color: '#6b7280', marginTop: 4,
}

const WARN_BOX: React.CSSProperties = {
  background: '#fef2f2', border: '1px solid #fca5a5',
  borderRadius: 8, padding: '12px 16px', color: '#991b1b', marginBottom: 16,
}

const INFO_BOX: React.CSSProperties = {
  background: '#eff6ff', border: '1px solid #bfdbfe',
  borderRadius: 8, padding: '12px 16px', color: '#1e40af', marginBottom: 16,
  fontSize: '0.85rem',
}

const SUCCESS_BOX: React.CSSProperties = {
  background: '#f0fdf4', border: '1px solid #86efac',
  borderRadius: 8, padding: '14px 18px', color: '#15803d',
  fontWeight: 600, marginBottom: 20,
}

const TABLE_STYLE: React.CSSProperties = {
  width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem',
}

const TH: React.CSSProperties = {
  background: '#f9fafb', fontWeight: 600, padding: '7px 10px',
  textAlign: 'left', borderBottom: '1px solid #e5e7eb',
}

const TD: React.CSSProperties = {
  padding: '6px 10px', borderBottom: '1px solid #f1f5f9',
}

function tbl(extra?: React.CSSProperties) {
  return { ...TABLE_STYLE, ...extra }
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function Sidebar({
  step, maxReached, onStep,
}: {
  step: WizardStep
  maxReached: WizardStep
  onStep: (s: WizardStep) => void
}) {
  const steps = Object.entries(STEP_INFO).map(([k, v]) => ({
    num: Number(k) as WizardStep, ...v,
  }))

  return (
    <div style={SIDEBAR}>
      <div style={{ padding: '0 0.75rem', marginBottom: '0.5rem', fontSize: '0.7rem',
        fontWeight: 700, color: '#94a3b8', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        Кроки імпорту
      </div>
      {steps.map(s => {
        const isCurrent = s.num === step
        const isDone    = s.num < step
        const isReached = s.num <= maxReached
        return (
          <div
            key={s.num}
            onClick={() => isReached && s.num !== 10 && onStep(s.num)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '7px 12px',
              cursor: isReached && s.num !== 10 ? 'pointer' : 'default',
              background: isCurrent ? '#eff6ff' : 'transparent',
              borderLeft: isCurrent ? '3px solid #2563eb' : '3px solid transparent',
              color: isCurrent ? '#2563eb' : isDone ? '#16a34a' : '#6b7280',
              fontSize: '0.84rem',
              fontWeight: isCurrent ? 600 : 400,
            }}
          >
            <span style={{
              width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '0.72rem', fontWeight: 700,
              background: isCurrent ? '#2563eb' : isDone ? '#16a34a' : '#e5e7eb',
              color: isCurrent || isDone ? '#fff' : '#6b7280',
            }}>
              {isDone ? '✓' : s.num}
            </span>
            {s.label}
          </div>
        )
      })}
    </div>
  )
}

// ─── Step 1: Parameters ───────────────────────────────────────────────────────

function StepParams({
  file, setFile,
  password, setPassword,
  transDate, setTransDate,
  finMonths, setFinMonths,
  orderDays, setOrderDays,
  driverErr,
  existingCount,
  uploading, uploadErr,
  onUpload,
}: any) {
  const disabled = !file || uploading || !!driverErr || (existingCount !== null && existingCount > 0)
  return (
    <div>
      <h2 style={{ marginBottom: 4, fontSize: '1.1rem' }}>Крок 1 — Параметри імпорту</h2>
      <p style={{ color: '#6b7280', fontSize: '0.85rem', marginBottom: 20 }}>
        Вкажіть файл .accdb та параметри перенесення даних.
      </p>

      {driverErr && (
        <div style={WARN_BOX}>
          <strong>Відсутній Microsoft Access ODBC Driver</strong>
          <pre style={{ marginTop: 8, whiteSpace: 'pre-wrap', fontSize: '0.82rem' }}>{driverErr}</pre>
        </div>
      )}
      {existingCount !== null && existingCount > 0 && (
        <div style={{ ...WARN_BOX, background: '#fff7ed', borderColor: '#fed7aa', color: '#92400e' }}>
          <strong>База вже містить дані ({existingCount} клієнтів).</strong>
          {' '}Перед імпортом необхідно скинути базу даних (секція «Скидання бази даних»).
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 520 }}>
        <div>
          <label style={LABEL}>Файл бази Access (.accdb)</label>
          <input type="file" accept=".accdb" style={{ ...INPUT, padding: '6px' }}
            onChange={e => setFile(e.target.files?.[0] ?? null)} />
        </div>
        <div>
          <label style={LABEL}>Пароль до файлу (якщо є)</label>
          <input type="password" value={password} style={INPUT}
            placeholder="залиште порожнім якщо без пароля"
            onChange={e => setPassword(e.target.value)} />
        </div>
        <div>
          <label style={LABEL}>Дата переходу на нову систему</label>
          <input type="date" value={transDate} style={INPUT}
            onChange={e => setTransDate(e.target.value)} />
          <div style={HINT}>Базові ціни будуть встановлені з цієї дати.</div>
        </div>
        <div style={{ display: 'flex', gap: 16 }}>
          <div style={{ flex: 1 }}>
            <label style={LABEL}>Місяців фінансової історії</label>
            <input type="number" min={1} max={24} value={finMonths} style={INPUT}
              onChange={e => setFinMonths(Number(e.target.value))} />
            <div style={HINT}>Фінансові операції до дати переходу.</div>
          </div>
          <div style={{ flex: 1 }}>
            <label style={LABEL}>Днів замовлень</label>
            <input type="number" min={1} max={365} value={orderDays} style={INPUT}
              onChange={e => setOrderDays(Number(e.target.value))} />
            <div style={HINT}>Замовлення до дати переходу.</div>
          </div>
        </div>
        {uploadErr && <div style={WARN_BOX}>{uploadErr}</div>}
        <div>
          <button style={disabled ? BTN_DISABLED : BTN_PRIMARY} disabled={disabled} onClick={onUpload}>
            {uploading ? 'Завантаження та аналіз...' : 'Завантажити та проаналізувати файл'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Step 2: Routes ───────────────────────────────────────────────────────────

function StepRoutes({
  preview, routeMappings, setRouteMappings,
}: {
  preview: AccdbPreview
  routeMappings: RouteMapping[]
  setRouteMappings: (m: RouteMapping[]) => void
}) {
  const update = (idx: number, patch: Partial<RouteMapping>) => {
    setRouteMappings(routeMappings.map((r, i) => i === idx ? { ...r, ...patch } : r))
  }

  return (
    <div>
      <h2 style={{ marginBottom: 4, fontSize: '1.1rem' }}>Крок 2 — Маршрути</h2>
      <p style={{ color: '#6b7280', fontSize: '0.85rem', marginBottom: 12 }}>
        Вкажіть які маршрути переносити. Службові маршрути (пекарня, system) можна пропустити —
        клієнти таких маршрутів отримають порожній маршрут.
      </p>

      {preview.suggested_route_skips.length > 0 && (
        <div style={INFO_BOX}>
          Авто-пропоновано пропустити: <strong>{preview.suggested_route_skips.join(', ')}</strong>
        </div>
      )}

      {routeMappings.length === 0 ? (
        <p style={{ color: '#6b7280' }}>Маршрутів не знайдено в Access</p>
      ) : (
        <table style={tbl()}>
          <thead>
            <tr>
              <th style={TH}>Маршрут Access</th>
              <th style={{ ...TH, width: 80, textAlign: 'center' }}>Переносити</th>
              <th style={{ ...TH, width: 220 }}>Назва в новій системі</th>
              <th style={{ ...TH, width: 100 }}>Порядок</th>
            </tr>
          </thead>
          <tbody>
            {routeMappings.map((rm, i) => (
              <tr key={rm.access_id} style={{ background: rm.import_it ? '#fff' : '#f9fafb' }}>
                <td style={{ ...TD, color: rm.import_it ? '#111' : '#9ca3af' }}>
                  {preview.all_routes.find(r => r.access_id === rm.access_id)?.name ?? `#${rm.access_id}`}
                </td>
                <td style={{ ...TD, textAlign: 'center' }}>
                  <input type="checkbox" checked={rm.import_it}
                    onChange={e => update(i, { import_it: e.target.checked })} />
                </td>
                <td style={TD}>
                  <input
                    type="text" disabled={!rm.import_it}
                    value={rm.name_override}
                    placeholder={preview.all_routes.find(r => r.access_id === rm.access_id)?.name ?? ''}
                    onChange={e => update(i, { name_override: e.target.value })}
                    style={{ ...INPUT, opacity: rm.import_it ? 1 : 0.4 }}
                  />
                </td>
                <td style={TD}>
                  <input
                    type="number" min={0} disabled={!rm.import_it}
                    value={rm.sort_order}
                    onChange={e => update(i, { sort_order: Number(e.target.value) })}
                    style={{ ...INPUT, width: 80, opacity: rm.import_it ? 1 : 0.4 }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// ─── Step 3: Units ────────────────────────────────────────────────────────────

function StepUnits({ preview }: { preview: AccdbPreview }) {
  return (
    <div>
      <h2 style={{ marginBottom: 4, fontSize: '1.1rem' }}>Крок 3 — Одиниці виміру</h2>
      <p style={{ color: '#6b7280', fontSize: '0.85rem', marginBottom: 20 }}>
        Одиниці виміру переносяться автоматично без додаткового налаштування.
      </p>
      <div style={{ ...INFO_BOX, display: 'flex', alignItems: 'center', gap: 16 }}>
        <span style={{ fontSize: '2rem' }}>📏</span>
        <div>
          <strong>Знайдено одиниць виміру: {preview.routes.count ?? 0}</strong>
          <div style={{ fontSize: '0.82rem', marginTop: 2 }}>
            Таблиця: <code style={{ background: '#dbeafe', padding: '1px 5px', borderRadius: 3 }}>
              _Одиниці
            </code>
          </div>
        </div>
      </div>
      <p style={{ fontSize: '0.85rem', color: '#374151' }}>
        Всі одиниці будуть перенесені з їх оригінальними назвами.
        Після імпорту ви зможете відредагувати їх у Довідниках.
      </p>
    </div>
  )
}

// ─── Step 4: Products / Categories ───────────────────────────────────────────

function StepProducts({
  preview, catMappings, setCatMappings,
}: {
  preview: AccdbPreview
  catMappings: CategoryMapping[]
  setCatMappings: (m: CategoryMapping[]) => void
}) {
  const update = (idx: number, patch: Partial<CategoryMapping>) => {
    setCatMappings(catMappings.map((c, i) => i === idx ? { ...c, ...patch } : c))
  }

  return (
    <div>
      <h2 style={{ marginBottom: 4, fontSize: '1.1rem' }}>Крок 4 — Вироби та категорії</h2>
      <p style={{ color: '#6b7280', fontSize: '0.85rem', marginBottom: 8 }}>
        Кожен тип виробу з Access стане категорією в новій системі.
        Вкажіть назву, чи випікається товар і порядок відображення.
      </p>
      <p style={{ ...HINT, marginBottom: 16 }}>
        Вироби ({preview.products.count}) переносяться автоматично. Знайдено типів:
      </p>

      {catMappings.length === 0 ? (
        <p style={{ color: '#6b7280' }}>Типів виробів не знайдено в Access</p>
      ) : (
        <table style={tbl()}>
          <thead>
            <tr>
              <th style={TH}>Тип (Access)</th>
              <th style={{ ...TH, width: 200 }}>Назва категорії</th>
              <th style={{ ...TH, width: 100, textAlign: 'center' }}>Випікається</th>
              <th style={{ ...TH, width: 90 }}>Порядок</th>
              <th style={{ ...TH, width: 90 }}>Резерв %</th>
            </tr>
          </thead>
          <tbody>
            {catMappings.map((cm, i) => (
              <tr key={cm.access_type}>
                <td style={TD}>{cm.access_type}</td>
                <td style={TD}>
                  <input type="text" value={cm.category_name} style={INPUT}
                    onChange={e => update(i, { category_name: e.target.value })} />
                </td>
                <td style={{ ...TD, textAlign: 'center' }}>
                  <input type="checkbox" checked={cm.is_baked === 1}
                    onChange={e => update(i, { is_baked: e.target.checked ? 1 : 0 })} />
                </td>
                <td style={TD}>
                  <input type="number" min={0} value={cm.sort_order} style={{ ...INPUT, width: 70 }}
                    onChange={e => update(i, { sort_order: Number(e.target.value) })} />
                </td>
                <td style={TD}>
                  <input type="number" min={0} max={100} step={0.5} value={cm.reserve_pct}
                    style={{ ...INPUT, width: 70 }}
                    onChange={e => update(i, { reserve_pct: Number(e.target.value) })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// ─── Step 5: Clients ──────────────────────────────────────────────────────────

function StepClients({
  preview, clientMappings, setClientMappings, context,
}: {
  preview: AccdbPreview
  clientMappings: ClientMapping[]
  setClientMappings: (m: ClientMapping[]) => void
  context: ImportContext | null
}) {
  const [showAll, setShowAll] = useState(false)

  // non-customer ids from suggested list
  const suggestedIds = new Set(
    preview.suggested_non_customers.map(s => s.access_id).filter(Boolean)
  )

  // Clients shown: suggested + any manually added; "show all" adds the rest
  const visibleIds: Set<number> = showAll
    ? new Set(preview.all_clients_preview.map(c => c.access_id))
    : new Set([
        ...Array.from(suggestedIds),
        ...clientMappings.filter(m => m.client_kind !== 'customer').map(m => m.access_id),
      ])

  const nameOf = (id: number) =>
    preview.all_clients_preview.find(c => c.access_id === id)?.name
    ?? preview.suggested_non_customers.find(s => s.access_id === id)?.name
    ?? `#${id}`

  const getMappingFor = (aid: number): ClientMapping =>
    clientMappings.find(m => m.access_id === aid) ?? {
      access_id: aid, client_kind: 'customer', merge_with: null, skip: false,
    }

  const updateMapping = (aid: number, patch: Partial<ClientMapping>) => {
    const existing = clientMappings.find(m => m.access_id === aid)
    if (existing) {
      setClientMappings(clientMappings.map(m => m.access_id === aid ? { ...m, ...patch } : m))
    } else {
      setClientMappings([...clientMappings, { access_id: aid, client_kind: 'customer', merge_with: null, skip: false, ...patch }])
    }
  }

  const visibleList = Array.from(visibleIds).sort((a, b) => {
    const na = nameOf(a), nb = nameOf(b)
    return na.localeCompare(nb, 'uk')
  })

  return (
    <div>
      <h2 style={{ marginBottom: 4, fontSize: '1.1rem' }}>Крок 5 — Клієнти</h2>
      <p style={{ color: '#6b7280', fontSize: '0.85rem', marginBottom: 4 }}>
        Клієнти ({preview.clients.count}) переносяться як <strong>Клієнт</strong> за замовчуванням.
        Тут відображаються лише внутрішні (<strong>Свій = ✓</strong> в Access) — вони потребують уваги.
      </p>
      <p style={{ ...HINT, marginBottom: 16 }}>
        <strong>Об'єднати з…</strong> — перепризначити всі замовлення/фінанси на існуючий запис.
        <strong> Пропустити</strong> — не створювати взагалі (рекомендовано для -Надлишки- тощо).
        Клієнти без маппінгу тут теж не будуть створені (лише зовнішні клієнти де Свій = ✗ імпортуються автоматично).
      </p>

      {visibleList.length === 0 && !showAll && (
        <div style={INFO_BOX}>Внутрішніх клієнтів (Свій=True) не виявлено. Всі будуть імпортовані як «Клієнт».</div>
      )}

      {visibleList.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={tbl({ minWidth: 680 })}>
            <thead>
              <tr>
                <th style={TH}>Клієнт (Access)</th>
                <th style={{ ...TH, width: 80, textAlign: 'center' }}>Пропустити</th>
                <th style={{ ...TH, width: 130 }}>Тип</th>
                <th style={{ ...TH, width: 240 }}>Об'єднати з існуючим</th>
              </tr>
            </thead>
            <tbody>
              {visibleList.map(aid => {
                const cm = getMappingFor(aid)
                const isSkipped = cm.skip
                return (
                  <tr key={aid} style={{
                    background: isSkipped ? '#f9fafb' : suggestedIds.has(aid) ? '#fefce8' : '#fff',
                    opacity: isSkipped ? 0.55 : 1,
                  }}>
                    <td style={TD}>
                      {nameOf(aid)}
                      {suggestedIds.has(aid) && (
                        <span style={{ color: '#ca8a04', fontSize: '0.72rem', marginLeft: 6 }}>
                          авто-пропозиція
                        </span>
                      )}
                    </td>
                    <td style={{ ...TD, textAlign: 'center' }}>
                      <input type="checkbox" checked={isSkipped}
                        onChange={e => updateMapping(aid, { skip: e.target.checked, merge_with: null })} />
                    </td>
                    <td style={TD}>
                      <select
                        disabled={isSkipped}
                        value={cm.client_kind}
                        onChange={e => updateMapping(aid, { client_kind: e.target.value as ClientMapping['client_kind'], merge_with: null })}
                        style={{ ...INPUT, width: 120, opacity: isSkipped ? 0.4 : 1 }}
                      >
                        {Object.entries(KIND_LABELS).map(([v, l]) => (
                          <option key={v} value={v}>{l}</option>
                        ))}
                      </select>
                    </td>
                    <td style={TD}>
                      <select
                        disabled={isSkipped}
                        value={cm.merge_with ?? ''}
                        onChange={e => updateMapping(aid, { merge_with: e.target.value ? Number(e.target.value) : null })}
                        style={{ ...INPUT, width: 230, opacity: isSkipped ? 0.4 : 1 }}
                      >
                        <option value="">— створити новий —</option>
                        {(context?.existing_clients ?? []).map(ec => (
                          <option key={ec.id} value={ec.id}>
                            {ec.full_name || ec.short_name} ({KIND_LABELS[ec.client_kind] ?? ec.client_kind})
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <button style={{ ...BTN_SECONDARY, fontSize: '0.82rem' }} onClick={() => setShowAll(v => !v)}>
          {showAll
            ? `Показати лише внутрішніх (${suggestedIds.size})`
            : `Показати всіх клієнтів (${preview.clients.count})`}
        </button>
        {!showAll && (
          <span style={{ ...HINT, marginLeft: 12 }}>
            Решта {preview.clients.count - visibleList.length} клієнтів (Свій=✗) — імпортуються автоматично як «Клієнт».
          </span>
        )}
      </div>
    </div>
  )
}

// ─── Step 6: Prices ───────────────────────────────────────────────────────────

function StepPrices({
  preview, basePriceCat, setBasePriceCat,
}: {
  preview: AccdbPreview
  basePriceCat: string
  setBasePriceCat: (s: string) => void
}) {
  return (
    <div>
      <h2 style={{ marginBottom: 4, fontSize: '1.1rem' }}>Крок 6 — Ціни</h2>
      <p style={{ color: '#6b7280', fontSize: '0.85rem', marginBottom: 16 }}>
        Виберіть яка цінова категорія є базовою (буде записана в таблицю цін).
        Решта стануть індивідуальними цінами клієнтів. Ціни імпортуються з повною історією (поле TS).
      </p>

      {preview.price_categories.length === 0 ? (
        <p style={{ color: '#6b7280' }}>Цінових категорій не знайдено в Access</p>
      ) : (
        <table style={tbl()}>
          <thead>
            <tr>
              <th style={{ ...TH, width: 60, textAlign: 'center' }}>Базова</th>
              <th style={TH}>Категорія</th>
              <th style={{ ...TH, width: 120, textAlign: 'right' }}>Записів цін</th>
              <th style={{ ...TH, width: 100, textAlign: 'right' }}>Клієнтів</th>
            </tr>
          </thead>
          <tbody>
            {(preview.price_categories as PriceCategory[]).map(pc => (
              <tr key={pc.access_id}
                style={{ background: basePriceCat === pc.access_id ? '#f0fdf4' : '#fff' }}>
                <td style={{ ...TD, textAlign: 'center' }}>
                  <input type="radio" name="base_price"
                    checked={basePriceCat === pc.access_id}
                    onChange={() => setBasePriceCat(pc.access_id)} />
                </td>
                <td style={TD}>
                  <strong>{pc.name}</strong>
                  <span style={{ color: '#9ca3af', fontSize: '0.78rem', marginLeft: 6 }}>
                    (id: {pc.access_id})
                  </span>
                </td>
                <td style={{ ...TD, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {pc.price_count}
                </td>
                <td style={{ ...TD, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {pc.client_count}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// ─── Step 7: Orders ───────────────────────────────────────────────────────────

function StepOrders({
  preview, orderDays, setOrderDays, transDate,
}: {
  preview: AccdbPreview
  orderDays: number
  setOrderDays: (n: number) => void
  transDate: string
}) {
  const cutoff = transDate
    ? new Date(new Date(transDate).getTime() - orderDays * 86400000).toISOString().slice(0, 10)
    : '—'

  return (
    <div>
      <h2 style={{ marginBottom: 4, fontSize: '1.1rem' }}>Крок 7 — Замовлення</h2>
      <p style={{ color: '#6b7280', fontSize: '0.85rem', marginBottom: 20 }}>
        Замовлення з Access будуть перенесені за вказаний період до дати переходу.
      </p>

      <div style={{ ...INFO_BOX }}>
        <div style={{ fontSize: '0.95rem', marginBottom: 8 }}>
          <strong>Знайдено замовлень в Access: {preview.orders.count}</strong>
        </div>
        <div style={{ fontSize: '0.82rem' }}>
          Будуть перенесені замовлення з <strong>{cutoff}</strong> по <strong>{transDate || '…'}</strong>
        </div>
      </div>

      <div style={{ maxWidth: 300 }}>
        <label style={LABEL}>Кількість днів замовлень</label>
        <input type="number" min={1} max={365} value={orderDays} style={INPUT}
          onChange={e => setOrderDays(Number(e.target.value))} />
        <div style={HINT}>Замовлення за {orderDays} днів до дати переходу ({cutoff})</div>
      </div>
    </div>
  )
}

// ─── Step 8: Finances ─────────────────────────────────────────────────────────

function StepFinances({
  preview, finMonths, setFinMonths, transDate,
}: {
  preview: AccdbPreview
  finMonths: number
  setFinMonths: (n: number) => void
  transDate: string
}) {
  const cutoff = transDate
    ? new Date(
        new Date(new Date(transDate).getFullYear(), new Date(transDate).getMonth() - finMonths, 1)
      ).toISOString().slice(0, 7)
    : '—'

  return (
    <div>
      <h2 style={{ marginBottom: 4, fontSize: '1.1rem' }}>Крок 8 — Фінансова історія</h2>
      <p style={{ color: '#6b7280', fontSize: '0.85rem', marginBottom: 20 }}>
        Фінансові операції з Access будуть перенесені за вказаний період.
      </p>

      <div style={INFO_BOX}>
        <div style={{ fontSize: '0.95rem', marginBottom: 8 }}>
          <strong>Знайдено фінансових операцій: {preview.finances.count}</strong>
        </div>
        <div style={{ fontSize: '0.82rem' }}>
          Будуть перенесені операції з <strong>{cutoff}</strong> по <strong>{transDate || '…'}</strong>
        </div>
      </div>

      <div style={{ maxWidth: 300 }}>
        <label style={LABEL}>Місяців фінансової історії</label>
        <input type="number" min={1} max={24} value={finMonths} style={INPUT}
          onChange={e => setFinMonths(Number(e.target.value))} />
        <div style={HINT}>Операції за {finMonths} міс. до дати переходу ({cutoff}+)</div>
      </div>
    </div>
  )
}

// ─── Step 9: Confirmation ─────────────────────────────────────────────────────

function StepConfirm({
  preview, transDate, finMonths, orderDays,
  routeMappings, catMappings, clientMappings, basePriceCat,
}: {
  preview: AccdbPreview
  transDate: string
  finMonths: number
  orderDays: number
  routeMappings: RouteMapping[]
  catMappings: CategoryMapping[]
  clientMappings: ClientMapping[]
  basePriceCat: string
}) {
  const importedRoutes = routeMappings.filter(r => r.import_it).length
  const skippedRoutes  = routeMappings.filter(r => !r.import_it).length
  const mergedClients  = clientMappings.filter(c => c.merge_with !== null).length
  const renamedClients = clientMappings.filter(c => c.client_kind !== 'customer').length
  const baseCat = preview.price_categories.find(p => p.access_id === basePriceCat)

  return (
    <div>
      <h2 style={{ marginBottom: 4, fontSize: '1.1rem' }}>Крок 9 — Підтвердження</h2>
      <p style={{ color: '#6b7280', fontSize: '0.85rem', marginBottom: 20 }}>
        Перевірте налаштування перед запуском. Після запуску зупинити імпорт неможливо.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <SummaryRow label="Файл Access" value={preview.access_tables.length + ' таблиць'} />
        <SummaryRow label="Дата переходу" value={transDate} />
        <SummaryRow label="Фінансова історія" value={`${finMonths} міс.`} />
        <SummaryRow label="Замовлення" value={`${orderDays} днів`} />
        <SummaryRow label="Маршрути" value={
          `${importedRoutes} переноситься${skippedRoutes > 0 ? `, ${skippedRoutes} пропущено` : ''}`
        } />
        <SummaryRow label="Категорії виробів" value={catMappings.length + ' типів'} />
        <SummaryRow label="Клієнти" value={
          `${preview.clients.count} всього` +
          (mergedClients > 0 ? `, ${mergedClients} об'єднуються з існуючими` : '') +
          (renamedClients > 0 ? `, ${renamedClients} не-customer` : '')
        } />
        <SummaryRow label="Базова цінова категорія"
          value={baseCat ? `${baseCat.name} (${baseCat.price_count} цін)` : '— не вибрано —'} />
      </div>

      <div style={{ marginTop: 24, background: '#fff7ed', border: '1px solid #fed7aa',
        borderRadius: 8, padding: '12px 16px', color: '#92400e', fontSize: '0.85rem' }}>
        <strong>Увага!</strong> Після натискання «Розпочати імпорт» дані будуть записані в базу.
        Переконайтеся що база порожня або зроблено бекап.
      </div>
    </div>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', borderBottom: '1px solid #f1f5f9', paddingBottom: 8 }}>
      <div style={{ width: 220, fontSize: '0.85rem', color: '#6b7280', flexShrink: 0 }}>{label}</div>
      <div style={{ fontSize: '0.85rem', fontWeight: 500 }}>{value}</div>
    </div>
  )
}

// ─── Step 10: Execution + Report + Reconciliation ─────────────────────────────

function StepExecution({
  status, report,
}: {
  status: ImportStatus | null
  report: ImportReport | null
}) {
  const [correcting, setCorrecting] = useState<Set<number>>(new Set())
  const [corrected, setCorrected]   = useState<Set<number>>(new Set())
  const [corrErr, setCorrErr]       = useState<Record<number, string>>({})

  async function applyCorrection(clientId: number, diff: number) {
    setCorrecting(s => new Set(s).add(clientId))
    try {
      // diff = access_balance - computed_balance
      // positive diff → Access shows more debt → add payment record (sign=+1, payment received)
      // negative diff → Access shows less debt → add invoice-like record (sign=-1)
      const sign = diff > 0 ? 1 : -1
      const amount = Math.abs(diff)
      const res = await fetch('/api/v1/finances/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id:    clientId,
          finance_date: new Date().toISOString().slice(0, 10),
          finance_type: 'payment',
          amount,
          sign,
          notes: 'Корекція імпорту (баланс Access)',
        }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.detail ?? 'Помилка корекції')
      }
      setCorrected(s => new Set(s).add(clientId))
    } catch (e: any) {
      setCorrErr(prev => ({ ...prev, [clientId]: e.message }))
    } finally {
      setCorrecting(s => { const n = new Set(s); n.delete(clientId); return n })
    }
  }

  // Running state
  if (!report && !status?.error) {
    return (
      <div>
        <h2 style={{ marginBottom: 4, fontSize: '1.1rem' }}>Крок 10 — Виконання</h2>
        <p style={{ color: '#6b7280', fontSize: '0.85rem', marginBottom: 20 }}>
          Імпорт виконується у фоновому режимі...
        </p>
        <div style={{ marginBottom: 12, fontSize: '0.9rem', color: '#374151' }}>
          {status?.step || 'Підготовка...'}
        </div>
        <div style={{ height: 12, background: '#e5e7eb', borderRadius: 6, overflow: 'hidden', maxWidth: 500 }}>
          <div style={{
            height: '100%', background: '#2563eb', borderRadius: 6,
            width: `${status?.progress ?? 0}%`, transition: 'width 0.4s ease',
          }} />
        </div>
        <div style={{ fontSize: '0.82rem', color: '#6b7280', marginTop: 6 }}>
          {status?.progress ?? 0}%
        </div>
      </div>
    )
  }

  // Error state
  if (status?.error) {
    return (
      <div>
        <h2 style={{ marginBottom: 16, fontSize: '1.1rem' }}>Крок 10 — Помилка</h2>
        <div style={WARN_BOX}>
          <strong>Помилка імпорту:</strong>
          <pre style={{ marginTop: 8, whiteSpace: 'pre-wrap', fontSize: '0.82rem' }}>
            {status.error}
          </pre>
        </div>
      </div>
    )
  }

  if (!report) return null

  const mismatches = report.validation.balance_mismatches

  return (
    <div>
      <h2 style={{ marginBottom: 4, fontSize: '1.1rem' }}>Крок 10 — Результат</h2>

      <div style={report.success ? SUCCESS_BOX : WARN_BOX}>
        {report.success ? 'Імпорт завершено успішно' : 'Імпорт завершено з помилками'}
      </div>

      <div style={{ fontSize: '0.82rem', color: '#6b7280', marginBottom: 16 }}>
        Дата переходу: <strong>{report.transition_date}</strong> ·{' '}
        {report.started_at.slice(0, 19).replace('T', ' ')} —{' '}
        {report.finished_at.slice(11, 19)}
      </div>

      {/* Entity summary */}
      <h3 style={{ fontSize: '0.95rem', marginBottom: 8 }}>Зведення по сутностях</h3>
      <table style={tbl({ marginBottom: 24 })}>
        <thead>
          <tr>
            <th style={TH}>Сутність</th>
            <th style={{ ...TH, textAlign: 'right' }}>Знайдено</th>
            <th style={{ ...TH, textAlign: 'right' }}>Імпортовано</th>
            <th style={{ ...TH, textAlign: 'right' }}>Пропущено</th>
            <th style={TH}>Попередження</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(report.entities).map(([key, ep]) => (
            <tr key={key}>
              <td style={TD}>{ENTITY_LABELS[key] ?? key}</td>
              <td style={{ ...TD, textAlign: 'right' }}>{ep.found}</td>
              <td style={{ ...TD, textAlign: 'right', color: '#16a34a' }}>{ep.imported}</td>
              <td style={{ ...TD, textAlign: 'right' }}>{ep.skipped > 0 ? ep.skipped : '—'}</td>
              <td style={TD}>
                {ep.warnings.length > 0 && (
                  <details>
                    <summary style={{ color: '#b45309', cursor: 'pointer' }}>
                      {ep.warnings.length} попередж.
                    </summary>
                    {ep.warnings.slice(0, 15).map((w, i) => (
                      <div key={i} style={{ color: '#b45309', fontSize: '0.78rem' }}>{w}</div>
                    ))}
                  </details>
                )}
                {ep.errors.length > 0 && (
                  <details>
                    <summary style={{ color: '#991b1b', cursor: 'pointer' }}>
                      {ep.errors.length} помилок
                    </summary>
                    {ep.errors.slice(0, 10).map((e, i) => (
                      <div key={i} style={{ color: '#991b1b', fontSize: '0.78rem' }}>{e}</div>
                    ))}
                  </details>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Zero-price products */}
      {report.validation.zero_price_products.length > 0 && (
        <div style={{ ...WARN_BOX, marginBottom: 16 }}>
          <strong>Вироби без ціни ({report.validation.zero_price_products.length}):</strong>
          <ul style={{ margin: '8px 0 0 16px', fontSize: '0.82rem' }}>
            {report.validation.zero_price_products.map((n, i) => <li key={i}>{n}</li>)}
          </ul>
        </div>
      )}

      {/* Balance reconciliation */}
      <h3 style={{ fontSize: '0.95rem', marginBottom: 8 }}>Звірка балансів клієнтів</h3>
      {mismatches.length === 0 ? (
        <div style={{ color: '#16a34a', fontSize: '0.85rem', marginBottom: 16 }}>
          ✓ Всі баланси співпадають
        </div>
      ) : (
        <>
          <p style={{ color: '#b45309', fontSize: '0.85rem', marginBottom: 8 }}>
            Знайдено розбіжностей: {mismatches.length}. Натисніть «+ Корекція» для виправлення.
          </p>
          <table style={tbl({ marginBottom: 20 })}>
            <thead>
              <tr>
                <th style={TH}>Клієнт</th>
                <th style={{ ...TH, textAlign: 'right' }}>Баланс Access</th>
                <th style={{ ...TH, textAlign: 'right' }}>Розрахований</th>
                <th style={{ ...TH, textAlign: 'right' }}>Різниця</th>
                <th style={{ ...TH, width: 120 }}>Дія</th>
              </tr>
            </thead>
            <tbody>
              {mismatches.map((m) => (
                <tr key={m.client_id} style={{ background: corrected.has(m.client_id) ? '#f0fdf4' : '#fff' }}>
                  <td style={TD}>{m.client_name}</td>
                  <td style={{ ...TD, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {fmt(m.access_balance)}
                  </td>
                  <td style={{ ...TD, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {fmt(m.computed_balance)}
                  </td>
                  <td style={{
                    ...TD, textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                    color: m.diff > 0 ? '#16a34a' : '#dc2626',
                  }}>
                    {m.diff > 0 ? '+' : ''}{fmt(m.diff)}
                  </td>
                  <td style={TD}>
                    {corrected.has(m.client_id) ? (
                      <span style={{ color: '#16a34a', fontSize: '0.82rem' }}>✓ Застосовано</span>
                    ) : (
                      <>
                        <button
                          style={{ ...BTN_PRIMARY, padding: '4px 12px', fontSize: '0.78rem' }}
                          disabled={correcting.has(m.client_id)}
                          onClick={() => applyCorrection(m.client_id, m.diff)}
                        >
                          {correcting.has(m.client_id) ? '...' : '+ Корекція'}
                        </button>
                        {corrErr[m.client_id] && (
                          <div style={{ color: '#dc2626', fontSize: '0.72rem', marginTop: 2 }}>
                            {corrErr[m.client_id]}
                          </div>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {mismatches.filter(m => !corrected.has(m.client_id)).length > 1 && (
            <button
              style={{ ...BTN_SECONDARY, fontSize: '0.85rem', marginBottom: 20 }}
              onClick={async () => {
                for (const m of mismatches) {
                  if (!corrected.has(m.client_id)) {
                    await applyCorrection(m.client_id, m.diff)
                  }
                }
              }}
            >
              Застосувати всі корекції ({mismatches.filter(m => !corrected.has(m.client_id)).length})
            </button>
          )}
        </>
      )}

      <div style={{ marginTop: 8 }}>
        <button style={BTN_PRIMARY} onClick={() => window.location.reload()}>
          Готово — перейти до системи
        </button>
      </div>
    </div>
  )
}

// ─── Main Component ────────────────────────────────────────────────────────────

interface Props {
  onClose: () => void
}

export default function ImportPage({ onClose }: Props) {
  const [step, setStep]         = useState<WizardStep>(1)
  const [maxReached, setMaxReached] = useState<WizardStep>(1)

  // Step 1 state
  const [file, setFile]             = useState<File | null>(null)
  const [password, setPassword]     = useState('')
  const [transDate, setTransDate]   = useState(today())
  const [finMonths, setFinMonths]   = useState(2)
  const [orderDays, setOrderDays]   = useState(60)
  const [uploading, setUploading]   = useState(false)
  const [uploadErr, setUploadErr]   = useState('')
  const [driverErr, setDriverErr]   = useState<string | null>(null)
  const [driverChecked, setDriverChecked] = useState(false)
  const [existingCount, setExistingCount] = useState<number | null>(null)

  // Preview & context
  const [preview, setPreview]   = useState<AccdbPreview | null>(null)
  const [context, setContext]   = useState<ImportContext | null>(null)

  // Mapping state (steps 2-6)
  const [routeMappings, setRouteMappings]   = useState<RouteMapping[]>([])
  const [catMappings, setCatMappings]       = useState<CategoryMapping[]>([])
  const [clientMappings, setClientMappings] = useState<ClientMapping[]>([])
  const [basePriceCat, setBasePriceCat]     = useState('')

  // Execution state
  const [importStatus, setImportStatus] = useState<ImportStatus | null>(null)
  const [report, setReport]             = useState<ImportReport | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Checks on mount
  useEffect(() => {
    fetch('/api/v1/import/driver-check')
      .then(r => r.json())
      .then(data => { setDriverErr(data.ok ? null : data.error); setDriverChecked(true) })
      .catch(() => setDriverChecked(true))

    fetch('/api/v1/clients/?active_only=false')
      .then(r => r.json())
      .then((data: { client_kind?: string }[]) =>
        setExistingCount(data.filter(c => c.client_kind === 'customer').length))
      .catch(() => setExistingCount(0))

    getImportContext().then(setContext).catch(() => {})
  }, [])

  // Poll on step 10
  useEffect(() => {
    if (step === 10) {
      pollRef.current = setInterval(async () => {
        try {
          const st = await getImportStatus()
          setImportStatus(st)
          if (!st.running) {
            clearInterval(pollRef.current!)
            if (!st.error) {
              const r = await getImportResult()
              setReport(r)
            }
          }
        } catch { /* ignore */ }
      }, 2000)
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [step])

  function goTo(s: WizardStep) {
    setStep(s)
    if (s > maxReached) setMaxReached(s)
  }

  // ── Upload (Step 1 → 2) ──────────────────────────────────────────────────────
  async function handleUpload() {
    if (!file) return
    setUploading(true)
    setUploadErr('')
    try {
      const prev = await uploadAccdb(file, password)
      setPreview(prev)

      // Initialize route mappings from all_routes
      const suggested = new Set(prev.suggested_route_skips)
      setRouteMappings(
        prev.all_routes.map((r, i) => ({
          access_id:     r.access_id,
          import_it:     !suggested.has(r.name),
          name_override: '',
          sort_order:    i + 1,
        }))
      )

      // Initialize category mappings
      setCatMappings(
        prev.product_types.map((pt, i) => ({
          access_type:   pt,
          category_name: pt,
          is_baked:      1,
          sort_order:    i + 1,
          reserve_pct:   5.0,
        }))
      )

      // Initialize client mappings from suggested_non_customers
      setClientMappings(
        prev.suggested_non_customers
          .filter(s => s.access_id !== null)
          .map(s => ({
            access_id:   s.access_id!,
            client_kind: s.suggested_kind as ClientMapping['client_kind'],
            merge_with:  s.suggested_merge_id,
            skip:        false,
          }))
      )

      setBasePriceCat(prev.base_price_category ?? '')
      goTo(2)
    } catch (e: any) {
      setUploadErr(e.message ?? 'Помилка завантаження')
    } finally {
      setUploading(false)
    }
  }

  // ── Run Import (Step 9 → 10) ─────────────────────────────────────────────────
  async function handleRunImport() {
    if (!preview) return
    try {
      await runImport({
        temp_file_token:     preview.temp_file_token,
        db_password:         password,
        transition_date:     transDate,
        finance_months:      finMonths,
        order_days:          orderDays,
        route_mappings:      routeMappings,
        category_mappings:   catMappings,
        client_mappings:     clientMappings,
        default_client_kind: 'customer',
        base_price_category: basePriceCat,
      })
      goTo(10)
    } catch (e: any) {
      alert(e.message ?? 'Помилка запуску імпорту')
    }
  }

  // ── Navigation ──────────────────────────────────────────────────────────────
  const canGoNext: boolean = (() => {
    if (step === 1) return !!preview
    if (step === 10) return false
    return true
  })()

  function handleNext() {
    if (step === 9) { handleRunImport(); return }
    if (step < 10) goTo((step + 1) as WizardStep)
  }

  function handleBack() {
    if (step > 1) goTo((step - 1) as WizardStep)
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div style={OVERLAY} onClick={e => e.stopPropagation()}>
      <div style={MODAL}>
        {/* Header */}
        <div style={HEADER}>
          <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>
            Імпорт з Microsoft Access
          </span>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', color: '#fff',
              fontSize: '1.4rem', cursor: 'pointer', lineHeight: 1, padding: '0 4px',
            }}
            title="Закрити"
          >×</button>
        </div>

        {/* Body */}
        <div style={BODY}>
          {/* Sidebar */}
          <Sidebar step={step} maxReached={maxReached} onStep={goTo} />

          {/* Main content */}
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
            <div style={CONTENT}>
              {step === 1 && (
                <StepParams
                  file={file} setFile={setFile}
                  password={password} setPassword={setPassword}
                  transDate={transDate} setTransDate={setTransDate}
                  finMonths={finMonths} setFinMonths={setFinMonths}
                  orderDays={orderDays} setOrderDays={setOrderDays}
                  driverErr={driverChecked ? driverErr : null}
                  existingCount={existingCount}
                  uploading={uploading}
                  uploadErr={uploadErr}
                  onUpload={handleUpload}
                />
              )}
              {step === 2 && preview && (
                <StepRoutes
                  preview={preview}
                  routeMappings={routeMappings}
                  setRouteMappings={setRouteMappings}
                />
              )}
              {step === 3 && preview && (
                <StepUnits preview={preview} />
              )}
              {step === 4 && preview && (
                <StepProducts
                  preview={preview}
                  catMappings={catMappings}
                  setCatMappings={setCatMappings}
                />
              )}
              {step === 5 && preview && (
                <StepClients
                  preview={preview}
                  clientMappings={clientMappings}
                  setClientMappings={setClientMappings}
                  context={context}
                />
              )}
              {step === 6 && preview && (
                <StepPrices
                  preview={preview}
                  basePriceCat={basePriceCat}
                  setBasePriceCat={setBasePriceCat}
                />
              )}
              {step === 7 && preview && (
                <StepOrders
                  preview={preview}
                  orderDays={orderDays}
                  setOrderDays={setOrderDays}
                  transDate={transDate}
                />
              )}
              {step === 8 && preview && (
                <StepFinances
                  preview={preview}
                  finMonths={finMonths}
                  setFinMonths={setFinMonths}
                  transDate={transDate}
                />
              )}
              {step === 9 && preview && (
                <StepConfirm
                  preview={preview}
                  transDate={transDate}
                  finMonths={finMonths}
                  orderDays={orderDays}
                  routeMappings={routeMappings}
                  catMappings={catMappings}
                  clientMappings={clientMappings}
                  basePriceCat={basePriceCat}
                />
              )}
              {step === 10 && (
                <StepExecution
                  status={importStatus}
                  report={report}
                />
              )}
            </div>

            {/* Footer nav */}
            {step !== 10 && (
              <div style={FOOTER}>
                <div style={{ fontSize: '0.8rem', color: '#9ca3af' }}>
                  Крок {step} з 10
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  {step > 1 && (
                    <button style={BTN_SECONDARY} onClick={handleBack}>
                      ← Назад
                    </button>
                  )}
                  {step === 1 ? (
                    <button
                      style={(!file || uploading || !!driverErr || (existingCount !== null && existingCount > 0)) ? BTN_DISABLED : BTN_PRIMARY}
                      disabled={!file || uploading || !!driverErr || (existingCount !== null && existingCount > 0)}
                      onClick={handleUpload}
                    >
                      {uploading ? 'Завантаження...' : 'Далі →'}
                    </button>
                  ) : step === 9 ? (
                    <button style={BTN_PRIMARY} onClick={handleRunImport}>
                      Розпочати імпорт
                    </button>
                  ) : (
                    <button style={canGoNext ? BTN_PRIMARY : BTN_DISABLED} disabled={!canGoNext} onClick={handleNext}>
                      Далі →
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
