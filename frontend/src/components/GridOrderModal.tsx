/**
 * Зведений вид замовлень (pivot grid): клієнти × вироби × дата.
 *
 * Етап 2: auto-save 1-клітинка через існуючі POST/PUT/DELETE /orders.
 * Етап 3 (далі): bulk-flush + paste TSV з Excel.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import Modal from './Modal'
import { api } from '../api/client'
import type {
  Category, Client, GridCell, GridResponse, Product, Route,
} from '../types'
import styles from './GridOrderModal.module.css'

interface Props {
  open: boolean
  onClose: () => void
  onSaved: () => void           // OrdersPage перевантажує дані після закриття
  workDate: string
  categories: Category[]
  clients: Client[]
  products: Product[]
  routes: Route[]
}

type SaveStatus = 'saving' | 'saved' | 'error'
type CellKey = `${number}-${number}`

const EMPTY_CELL: GridCell = {
  qty: 0, base_order_id: null, extra_qty: 0, extra_count: 0,
  extra_lines: [], has_pending_bot: false,
}

function nf(n: number): string {
  if (!n) return ''
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

export default function GridOrderModal({
  open, onClose, onSaved, workDate, categories, clients, products, routes,
}: Props) {

  // ── State ──────────────────────────────────────────────────────────────────
  const [grid, setGrid] = useState<GridResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState<Record<CellKey, SaveStatus>>({})
  const [activeCategoryId, setActiveCategoryId] = useState<number | null>(null)
  const [activeRouteId, setActiveRouteId] = useState<number | null>(null)
  const timers = useRef<Record<CellKey, ReturnType<typeof setTimeout>>>({})

  // ── Завантаження сітки ────────────────────────────────────────────────────
  const loadGrid = () => {
    setLoading(true)
    api.get<GridResponse>(`/orders/grid?order_date=${workDate}`)
      .then(g => setGrid(g))
      .catch(() => setGrid({ order_date: workDate, locked_client_ids: [], cells: {} }))
      .finally(() => setLoading(false))
  }
  useEffect(() => {
    if (open) loadGrid()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, workDate])

  // ── Категорії для tabs (тільки is_baked=1: Хліб, Булки) ───────────────────
  const bakedCats = useMemo(
    () => categories
      .filter(c => c.is_baked === 1 && c.is_active === 1)
      .sort((a, b) => a.sort_order - b.sort_order),
    [categories],
  )

  useEffect(() => {
    if (open && bakedCats.length > 0 && activeCategoryId === null) {
      setActiveCategoryId(bakedCats[0].id)
    }
  }, [open, bakedCats, activeCategoryId])

  // ── Вироби активної категорії ─────────────────────────────────────────────
  const activeProducts = useMemo(() => {
    if (activeCategoryId === null) return []
    return products
      .filter(p => p.is_active === 1 && p.category_id === activeCategoryId)
      .sort((a, b) => a.name.localeCompare(b.name, 'uk'))
  }, [products, activeCategoryId])

  // ── Клієнти по рейсах ─────────────────────────────────────────────────────
  // Тільки звичайні customer-и, не системні (writeoff/ration/underbaked)
  const activeRoutes = useMemo(
    () => routes.filter(r => r.is_active === 1).sort((a, b) => a.sort_order - b.sort_order),
    [routes],
  )

  const clientsByRoute = useMemo(() => {
    const m: Record<number, Client[]> = {}
    for (const c of clients) {
      if (c.client_kind !== 'customer') continue
      if (c.is_active !== 1) continue
      const rid = c.route_id ?? 0
      if (!m[rid]) m[rid] = []
      m[rid].push(c)
    }
    for (const rid in m) {
      m[rid].sort((a, b) => (a.short_name || a.full_name).localeCompare(b.short_name || b.full_name, 'uk'))
    }
    return m
  }, [clients])

  // ── Дефолтний активний рейс — перший з клієнтами ──────────────────────────
  useEffect(() => {
    if (open && activeRouteId === null && activeRoutes.length > 0) {
      const firstWithClients = activeRoutes.find(r => (clientsByRoute[r.id] || []).length > 0)
      if (firstWithClients) setActiveRouteId(firstWithClients.id)
    }
  }, [open, activeRoutes, clientsByRoute, activeRouteId])

  // ── Допоміжне: cell getter ────────────────────────────────────────────────
  const getCell = (cid: number, pid: number): GridCell =>
    grid?.cells[cid]?.[pid] ?? EMPTY_CELL

  const isLocked = (cid: number): boolean =>
    !!grid && grid.locked_client_ids.includes(cid)

  // ── Підсумки (по рядку клієнта, по колонці виробу, загальні) ──────────────
  const visibleClients = useMemo(
    () => activeRouteId === null ? [] : (clientsByRoute[activeRouteId] || []),
    [clientsByRoute, activeRouteId],
  )

  const rowSums = useMemo(() => {
    const r: Record<number, number> = {}
    for (const c of visibleClients) {
      let s = 0
      for (const p of activeProducts) s += getCell(c.id, p.id).qty
      r[c.id] = s
    }
    return r
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleClients, activeProducts, grid])

  const colSums = useMemo(() => {
    const r: Record<number, number> = {}
    for (const p of activeProducts) {
      let s = 0
      for (const c of visibleClients) s += getCell(c.id, p.id).qty
      r[p.id] = s
    }
    return r
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleClients, activeProducts, grid])

  const grandTotal = useMemo(
    () => Object.values(colSums).reduce((a, b) => a + b, 0),
    [colSums],
  )

  // ── Збереження клітинки ───────────────────────────────────────────────────
  const setCellLocal = (cid: number, pid: number, patch: Partial<GridCell>) => {
    setGrid(prev => {
      if (!prev) return prev
      const cells = { ...prev.cells }
      const row = { ...(cells[cid] || {}) }
      row[pid] = { ...(row[pid] ?? EMPTY_CELL), ...patch }
      cells[cid] = row
      return { ...prev, cells }
    })
  }

  const setSavingFlag = (key: CellKey, status: SaveStatus | null) => {
    setSaving(prev => {
      const next = { ...prev }
      if (status === null) delete next[key]
      else next[key] = status
      return next
    })
  }

  const handleCellChange = (cid: number, pid: number, raw: string) => {
    if (isLocked(cid)) return
    const qty = raw === '' ? 0 : Number(raw)
    if (isNaN(qty) || qty < 0) return
    setCellLocal(cid, pid, { qty })

    const key: CellKey = `${cid}-${pid}`
    if (timers.current[key]) clearTimeout(timers.current[key])

    timers.current[key] = setTimeout(async () => {
      setSavingFlag(key, 'saving')
      try {
        const existingId = getCell(cid, pid).base_order_id
        if (existingId) {
          if (qty <= 0) {
            await api.delete(`/orders/${existingId}`)
            setCellLocal(cid, pid, { qty: 0, base_order_id: null })
          } else {
            await api.put(`/orders/${existingId}`, { qty })
          }
        } else if (qty > 0) {
          const created = await api.post<{ id: number }>('/orders/', {
            client_id: cid, product_id: pid, qty, order_date: workDate,
          })
          setCellLocal(cid, pid, { base_order_id: created.id })
        }
        setSavingFlag(key, 'saved')
        setTimeout(() => setSavingFlag(key, null), 1500)
      } catch {
        setSavingFlag(key, 'error')
      }
    }, 600)
  }

  // ── Клавіатурна навігація: Enter ↓, Tab → (стандартний) ───────────────────
  const inputRefs = useRef<Record<CellKey, HTMLInputElement | null>>({})

  const handleKeyDown = (e: React.KeyboardEvent, cid: number, pid: number) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      const rowIdx = visibleClients.findIndex(c => c.id === cid)
      const nextClient = visibleClients[rowIdx + 1]
      if (nextClient) {
        const nextKey: CellKey = `${nextClient.id}-${pid}`
        inputRefs.current[nextKey]?.focus()
        inputRefs.current[nextKey]?.select()
      }
    }
  }

  if (!open) return null

  return (
    <Modal
      fullscreen
      onClose={onClose}
      title={`❖ Зведений вид замовлень — ${workDate}`}
    >
      <div
        className={styles.shell}
        onKeyDown={(e) => { if (e.key === 'Escape') { onSaved(); onClose() } }}
      >
        {/* ── Toolbar ───────────────────────────────────────────────────── */}
        <div className={styles.toolbar}>
          <div className={styles.tabGroup}>
            {bakedCats.map(cat => (
              <button
                key={cat.id}
                className={`${styles.tabButton} ${activeCategoryId === cat.id ? styles.tabButtonActive : ''}`}
                onClick={() => setActiveCategoryId(cat.id)}
              >
                {cat.name}
              </button>
            ))}
          </div>

          <div className={styles.routePills}>
            {activeRoutes.map(route => {
              const count = (clientsByRoute[route.id] || []).length
              if (count === 0) return null
              return (
                <button
                  key={route.id}
                  className={`${styles.routePill} ${activeRouteId === route.id ? styles.routePillActive : ''}`}
                  onClick={() => setActiveRouteId(route.id)}
                >
                  {route.name}<span className={styles.routeBadge}>{count}</span>
                </button>
              )
            })}
          </div>

          <div className={styles.stats}>
            <span>
              <span className={styles.statBig}>{grandTotal}</span> шт по {activeProducts.length} виробах × {visibleClients.length} клієнтах
            </span>
          </div>
        </div>

        {/* ── Сітка ─────────────────────────────────────────────────────── */}
        <div className={styles.gridWrap}>
          {loading ? (
            <div style={{ padding: 24, color: '#888' }}>Завантаження…</div>
          ) : (
            <table className={styles.grid}>
              <thead>
                <tr>
                  <th className={styles.thClient}>Клієнт</th>
                  {activeProducts.map(p => (
                    <th key={p.id} className={styles.thProduct} title={p.name}>
                      <span className={styles.label}>{p.short_name || p.name}</span>
                    </th>
                  ))}
                  <th className={styles.thRowSum}>Σ</th>
                </tr>
              </thead>
              <tbody>
                {visibleClients.length === 0 && (
                  <tr>
                    <td colSpan={activeProducts.length + 2} style={{ padding: 24, textAlign: 'center', color: '#888' }}>
                      Рейс не має активних клієнтів. Оберіть інший.
                    </td>
                  </tr>
                )}
                {visibleClients.map(client => {
                  const locked = isLocked(client.id)
                  return (
                    <tr key={client.id}>
                      <td className={styles.tdClient}>
                        <div className={styles.clientLabel}>
                          {locked && <span className={styles.lockIcon}>🔒</span>}
                          <span>{client.short_name || client.full_name}</span>
                        </div>
                      </td>
                      {activeProducts.map(p => {
                        const key: CellKey = `${client.id}-${p.id}`
                        const cell = getCell(client.id, p.id)
                        const status = saving[key]
                        const cls = [
                          styles.cellInput,
                          status === 'saving' && styles.cellSaving,
                          status === 'saved' && styles.cellSaved,
                          status === 'error' && styles.cellError,
                          locked && styles.cellLocked,
                        ].filter(Boolean).join(' ')
                        const tooltip = cell.extra_lines.length > 0
                          ? cell.extra_lines.map(l => `${kindLabel(l.kind)} ${nf(l.qty)}`).join('\n')
                          : undefined
                        return (
                          <td key={p.id}>
                            <div className={styles.cellWrap}>
                              <input
                                ref={el => { inputRefs.current[key] = el }}
                                className={cls}
                                type="number"
                                min={0}
                                step="any"
                                value={cell.qty === 0 ? '' : cell.qty}
                                onChange={e => handleCellChange(client.id, p.id, e.target.value)}
                                onFocus={e => e.target.select()}
                                onKeyDown={e => handleKeyDown(e, client.id, p.id)}
                                readOnly={locked}
                                title={tooltip}
                              />
                              {cell.extra_count > 0 && (
                                <span className={styles.extraBadge} title={tooltip}>
                                  +{nf(cell.extra_qty)}
                                </span>
                              )}
                              {cell.has_pending_bot && (
                                <span className={styles.pendingDot} title="Pending bot-замовлення" />
                              )}
                            </div>
                          </td>
                        )
                      })}
                      <td className={styles.tdRowSum}>{nf(rowSums[client.id] || 0)}</td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td className={styles.tdClient}>Σ по виробу</td>
                  {activeProducts.map(p => (
                    <td key={p.id}>{nf(colSums[p.id] || 0)}</td>
                  ))}
                  <td className={styles.tdRowSum}>{nf(grandTotal)}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>
    </Modal>
  )
}

function kindLabel(k: string): string {
  switch (k) {
    case 'exchange':     return '↩ обмін'
    case 'discount':     return '% знижка'
    case 'transfer_in':  return '↦ переміщення'
    case 'surplus':      return '⚖ надлишок'
    default:             return k
  }
}
