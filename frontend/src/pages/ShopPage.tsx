import React, { forwardRef, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { api } from '../api/client'
import { useWorkDate } from '../context/DateContext'
import { useProductAges } from '../hooks/useProductAges'

// ─── Типи ────────────────────────────────────────────────────────────────────

interface ShopClient {
  id: number
  name: string
  short_name: string | null
}

interface SummaryProductRow {
  product_id: number
  product_name: string
  opening_balance: number
  received: number
  sold: number
  current_balance: number
  price: number | null
}

interface ShopSummary {
  shop_client_id: number
  shop_name: string
  last_reconciliation_id: number | null
  last_reconciliation_from: string | null
  last_reconciliation_to: string | null
  last_closed: number
  products: SummaryProductRow[]
}

interface DisposalLine {
  id: number
  reconciliation_line_id: number
  disposal_type: string
  client_id: number | null
  qty: number
  notes: string | null
}

interface RecLine {
  id: number
  reconciliation_id: number
  product_id: number
  batch_date: string | null
  opening_balance: number
  received: number
  entered_balance: number | null
  written_off: number
  calculated_sold: number | null
  price: number | null
  expected_cash: number | null
  disposal_lines: DisposalLine[]
}

interface Reconciliation {
  id: number
  shop_client_id: number
  period_from: string
  period_to: string
  cash_expected: number
  cash_actual: number | null
  cash_diff: number | null
  notes: string | null
  closed: number
  lines: RecLine[]
}

interface ShopReceipt {
  id: number
  shop_client_id: number
  receipt_date: string
  product_id: number
  qty: number
  purchase_price: number
  notes: string | null
}

interface ClientOption {
  id: number
  label: string
}

// ─── Бейдж давності хліба ─────────────────────────────────────────────────────

export function AgeBadge({ days }: { days: number }) {
  if (days <= 1) return null
  const color = days >= 3 ? '#b71c1c' : '#e65100'
  const bg    = days >= 3 ? '#ffebee' : '#fff3e0'
  return (
    <span style={{
      display: 'inline-block',
      marginLeft: '0.35rem',
      padding: '0 5px',
      fontSize: '0.7rem',
      fontWeight: 700,
      color,
      background: bg,
      border: `1px solid ${color}`,
      borderRadius: '10px',
      verticalAlign: 'middle',
      lineHeight: '1.5',
    }}>
      {days} дн
    </span>
  )
}

// ─── Головний компонент ───────────────────────────────────────────────────────

export default function ShopPage() {
  const { workDate } = useWorkDate()
  const [shops, setShops]         = useState<ShopClient[]>([])
  const [summaries, setSummaries] = useState<ShopSummary[]>([])
  const [loading, setLoading]     = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [modal, setModal]         = useState<{ shopId: number; shopName: string } | null>(null)

  const load = async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const sh = await api.get<ShopClient[]>('/shop/shops')
      setShops(sh)
      try {
        const sm = await api.get<ShopSummary[]>(`/shop/summary?date=${workDate}`)
        setSummaries(sm)
      } catch {
        setSummaries(sh.map((s) => ({
          shop_client_id: s.id, shop_name: s.name,
          last_reconciliation_id: null, last_reconciliation_from: null,
          last_reconciliation_to: null, last_closed: 0, products: [],
        })))
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [workDate])

  if (loading) return <p style={{ padding: '1.5rem' }}>Завантаження...</p>

  return (
    <div style={{ padding: '1.5rem' }}>
      <h2 style={{ marginTop: 0, marginBottom: '1.25rem' }}>Магазин</h2>

      {loadError && (
        <div style={{ background: '#fff0f0', border: '1px solid #f5b8b8', borderRadius: 6, padding: '0.6rem 1rem', marginBottom: '1rem', fontSize: '0.85rem', color: '#c00' }}>
          Помилка завантаження: {loadError}
        </div>
      )}

      {shops.length === 0 ? (
        <div style={{ color: '#888', padding: '2rem 0' }}>
          <p>Немає жодного магазину.</p>
          <p style={{ fontSize: '0.85rem' }}>
            Додайте клієнта з типом <strong>Магазин</strong> у Довідниках → Клієнти.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.25rem' }}>
          {summaries.map((s) => (
            <ShopCard
              key={s.shop_client_id}
              summary={s}
              workDate={workDate}
              onOpen={() => setModal({ shopId: s.shop_client_id, shopName: s.shop_name })}
            />
          ))}
        </div>
      )}

      {modal && (
        <ReconciliationModal
          shopId={modal.shopId}
          shopName={modal.shopName}
          workDate={workDate}
          onClose={() => { setModal(null); load() }}
        />
      )}
    </div>
  )
}

// ─── Картка магазину ──────────────────────────────────────────────────────────

function ShopCard({ summary, workDate, onOpen }: {
  summary: ShopSummary
  workDate: string
  onOpen: () => void
}) {
  const { getAge } = useProductAges(workDate)

  const totalBalance = summary.products.reduce((s, p) => s + p.current_balance, 0)
  const totalSold    = summary.products.reduce((s, p) => s + p.sold, 0)
  const totalCash    = summary.products.reduce((s, p) => s + p.sold * (p.price ?? 0), 0)
  const lastDate     = summary.last_reconciliation_to

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: '1.05rem', color: '#1a3a5c' }}>🏪 {summary.shop_name}</div>
          <div style={{ fontSize: '0.8rem', color: '#888', marginTop: '0.2rem' }}>
            {lastDate
              ? `Остання звірка: ${lastDate} ${summary.last_closed ? '✓' : '(незакрита)'}`
              : 'Звірок не проводилось'}
          </div>
        </div>
        {summary.last_closed === 0 && summary.last_reconciliation_id && <span style={badgeOpen}>Відкрита</span>}
        {summary.last_closed === 1 && <span style={badgeClosed}>Закрита</span>}
      </div>

      <div style={{ display: 'flex', gap: '1.5rem', marginTop: '0.9rem', flexWrap: 'wrap' }}>
        <Metric label="Залишок" value={`${totalBalance.toFixed(1)} од.`} />
        <Metric label="Продано" value={`${totalSold.toFixed(1)} од.`} color="#2e7d32" />
        <Metric label="Виручка" value={`${totalCash.toFixed(2)} грн`} color="#b45309" />
      </div>

      {summary.products.length > 0 && (
        <table style={{ ...miniTableStyle, marginTop: '0.9rem' }}>
          <thead>
            <tr style={{ background: '#f0f4f8' }}>
              <th style={miniTh}>Виріб</th>
              <th style={{ ...miniTh, textAlign: 'right' }}>Залишок</th>
              <th style={{ ...miniTh, textAlign: 'right' }}>Продано</th>
              <th style={{ ...miniTh, textAlign: 'right' }}>Ціна</th>
            </tr>
          </thead>
          <tbody>
            {summary.products.map((p) => {
              const age = getAge(p.product_id)
              return (
                <tr key={p.product_id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                  <td style={miniTd}>
                    {p.product_name}
                    {age && age.age_days > 1 && <AgeBadge days={age.age_days} />}
                  </td>
                  <td style={{ ...miniTd, textAlign: 'right', fontWeight: 600 }}>{p.current_balance.toFixed(1)}</td>
                  <td style={{ ...miniTd, textAlign: 'right', color: '#2e7d32' }}>
                    {p.sold > 0 ? p.sold.toFixed(1) : '—'}
                  </td>
                  <td style={{ ...miniTd, textAlign: 'right', color: '#555' }}>
                    {p.price != null ? p.price.toFixed(2) : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      <button onClick={onOpen} style={{ ...primaryBtn, marginTop: '1rem', width: '100%' }}>
        Відкрити звірку
      </button>
    </div>
  )
}

function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: '0.72rem', color: '#999', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: '1.1rem', fontWeight: 700, color: color ?? '#1a3a5c' }}>{value}</div>
    </div>
  )
}

// ─── Модальне вікно звірки ────────────────────────────────────────────────────

function ReconciliationModal({ shopId, shopName, workDate, onClose }: {
  shopId: number
  shopName: string
  workDate: string
  onClose: () => void
}) {
  const [recs, setRecs]           = useState<Reconciliation[]>([])
  const [activeRec, setActiveRec] = useState<Reconciliation | null>(null)
  const [creating, setCreating]   = useState(false)
  const [cashActual, setCashActual] = useState('')
  const [confirmNotes, setConfirmNotes] = useState('')
  const [saving, setSaving]         = useState(false)
  const [receipts, setReceipts]     = useState<ShopReceipt[]>([])
  const [recForm, setRecForm]       = useState({
    product_id: '', qty: '', purchase_price: '', notes: '', receipt_date: workDate,
  })
  const [products, setProducts]     = useState<{ id: number; name: string }[]>([])
  const [clients, setClients]       = useState<ClientOption[]>([])
  // POS-продажі за день звірки
  const [posSales, setPosSales]     = useState<Record<number, { qty: number; amount: number }>>({})
  const posTotalRef                 = useRef(0)

  const loadRecs = async () => {
    const list = await api.get<Reconciliation[]>(`/shop/reconciliations?shop_client_id=${shopId}`)
    setRecs(list)
    if (list.length > 0 && !activeRec) setActiveRec(list[0])
  }

  const loadReceipts = async () => {
    const r = await api.get<ShopReceipt[]>(`/shop/receipts?shop_client_id=${shopId}`)
    setReceipts(r)
  }

  useEffect(() => {
    loadRecs()
    loadReceipts()
    api.get<{ id: number; name: string }[]>('/products/?active_only=true').then(setProducts)
    api.get<{ id: number; full_name: string; short_name: string | null; client_kind: string }[]>(
      '/clients/?active_only=true'
    ).then((raw) =>
      setClients(
        raw
          .filter((c) => c.id !== shopId)
          .map((c) => ({ id: c.id, label: c.short_name ?? c.full_name }))
          .sort((a, b) => a.label.localeCompare(b.label, 'uk'))
      )
    )
  }, [shopId])

  useEffect(() => {
    if (activeRec) {
      const fresh = recs.find((r) => r.id === activeRec.id)
      if (fresh) setActiveRec(fresh)
    }
  }, [recs])

  // Завантаження POS-продажів для дати звірки
  useEffect(() => {
    if (!activeRec) { setPosSales({}); return }
    const date = activeRec.period_to
    api.get<{ session_id: string; lines: { product_id: number; qty: number; amount: number }[]; total: number }[]>(
      `/shop/sales?shop_client_id=${shopId}&date=${date}`
    ).then(sessions => {
      const agg: Record<number, { qty: number; amount: number }> = {}
      let total = 0
      for (const s of sessions) {
        total += s.total
        for (const ln of s.lines) {
          if (!agg[ln.product_id]) agg[ln.product_id] = { qty: 0, amount: 0 }
          agg[ln.product_id].qty    += ln.qty
          agg[ln.product_id].amount += ln.amount
        }
      }
      posTotalRef.current = total
      setPosSales(agg)
      // Prefill cash_actual якщо поле порожнє і звірка відкрита
      if (!activeRec.closed && cashActual === '' && total > 0) {
        setCashActual(total.toFixed(2))
      }
    }).catch(() => {})
  }, [activeRec?.id, activeRec?.period_to]) // eslint-disable-line react-hooks/exhaustive-deps

  // Авто-обчислення дат нової звірки
  const lastClosedRec = recs.find((r) => r.closed)
  const hasOpenRec    = recs.some((r) => !r.closed)
  const newPeriodTo   = workDate
  const newPeriodFrom = (() => {
    if (lastClosedRec) {
      const d = new Date(lastClosedRec.period_to)
      d.setDate(d.getDate() + 1)
      return d.toISOString().slice(0, 10)
    }
    return workDate
  })()

  const handleCreate = async () => {
    setCreating(true)
    try {
      const rec = await api.post<Reconciliation>('/shop/reconciliations', {
        shop_client_id: shopId, period_from: newPeriodFrom, period_to: newPeriodTo,
      })
      await loadRecs()
      setActiveRec(rec)
    } finally { setCreating(false) }
  }

  const handleRefreshReceived = async () => {
    if (!activeRec) return
    const updated = await api.post<Reconciliation>(
      `/shop/reconciliations/${activeRec.id}/refresh-received`, {}
    )
    setActiveRec(updated)
    await loadRecs()
  }

  const handleLineUpdate = async (
    lineId: number, field: 'entered_balance' | 'price', value: string,
  ) => {
    if (!activeRec) return
    const num = value === '' ? null : Number(value)
    const updated = await api.put<RecLine>(
      `/shop/reconciliations/${activeRec.id}/lines/${lineId}`, { [field]: num },
    )
    setActiveRec((prev) =>
      prev ? { ...prev, lines: prev.lines.map((l) => l.id === updated.id ? updated : l) } : prev
    )
    await loadRecs()
  }

  const handleAddDisposal = async (
    lineId: number, disposal_type: string, qty: number,
    client_id: number | null, notes: string,
  ) => {
    if (!activeRec) return
    const updated = await api.post<RecLine>(
      `/shop/reconciliations/${activeRec.id}/lines/${lineId}/disposals`,
      { disposal_type, qty, client_id: client_id ?? null, notes: notes || null },
    )
    setActiveRec((prev) =>
      prev ? { ...prev, lines: prev.lines.map((l) => l.id === updated.id ? updated : l) } : prev
    )
    await loadRecs()
  }

  const handleDeleteDisposal = async (lineId: number, disposalId: number) => {
    if (!activeRec) return
    await api.delete(
      `/shop/reconciliations/${activeRec.id}/lines/${lineId}/disposals/${disposalId}`
    )
    const freshRec = await api.get<Reconciliation>(`/shop/reconciliations/${activeRec.id}`)
    setActiveRec(freshRec)
    await loadRecs()
  }

  const handleConfirm = async () => {
    if (!activeRec) return
    if (!confirm(`Підтвердити звірку за ${activeRec.period_from}–${activeRec.period_to}? Редагування буде заблоковано.`)) return
    setSaving(true)
    try {
      const confirmed = await api.post<Reconciliation>(
        `/shop/reconciliations/${activeRec.id}/confirm`,
        { cash_actual: cashActual !== '' ? Number(cashActual) : null, notes: confirmNotes || null },
      )
      setActiveRec(confirmed)
      await loadRecs()
    } finally { setSaving(false) }
  }

  const handleDelete = async () => {
    if (!activeRec) return
    if (!confirm('Видалити цю звірку?')) return
    await api.delete(`/shop/reconciliations/${activeRec.id}`)
    setActiveRec(null)
    await loadRecs()
  }

  const handleAddReceipt = async () => {
    if (!recForm.product_id || !recForm.qty) return
    await api.post('/shop/receipts', {
      shop_client_id: shopId,
      receipt_date: recForm.receipt_date,
      product_id: Number(recForm.product_id),
      qty: Number(recForm.qty),
      purchase_price: recForm.purchase_price ? Number(recForm.purchase_price) : 0,
      notes: recForm.notes || null,
    })
    setRecForm({ product_id: '', qty: '', purchase_price: '', notes: '', receipt_date: workDate })
    await loadReceipts()
    // Автоматично оновлюємо звірку щоб партія зʼявилась у таблиці
    if (activeRec && !activeRec.closed) {
      const updated = await api.post<Reconciliation>(
        `/shop/reconciliations/${activeRec.id}/refresh-received`, {}
      )
      setActiveRec(updated)
    }
  }

  const productName = (id: number) => products.find((p) => p.id === id)?.name ?? `#${id}`

  return (
    <div style={overlayStyle} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={modalStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ margin: 0, color: '#1a3a5c' }}>🏪 {shopName} — Звірка</h3>
          <button onClick={onClose} style={closeBtnStyle}>✕</button>
        </div>

        <div style={{ display: 'flex', gap: '1.25rem', height: 'calc(100% - 56px)', overflow: 'hidden' }}>

          {/* ── Ліва панель ────────────────────────────────────────────────── */}
          <div style={{ width: '180px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '0.6rem', overflowY: 'auto' }}>
            <div style={sectionBox}>
              <div style={sectionTitle}>Нова звірка</div>
              {hasOpenRec ? (
                <div style={{ fontSize: '0.78rem', color: '#b45309', lineHeight: 1.5 }}>
                  Закрийте поточну звірку перед створенням нової
                </div>
              ) : (
                <>
                  <div style={{ fontSize: '0.78rem', color: '#555', marginBottom: '0.4rem' }}>
                    {newPeriodFrom === newPeriodTo
                      ? newPeriodFrom
                      : `${newPeriodFrom} – ${newPeriodTo}`}
                  </div>
                  <button onClick={handleCreate} disabled={creating} style={primaryBtn}>
                    {creating ? '…' : '+ Створити'}
                  </button>
                </>
              )}
            </div>

            {recs.length > 0 && (
              <div style={sectionBox}>
                <div style={sectionTitle}>Попередні</div>
                {recs.map((r) => (
                  <button key={r.id} onClick={() => setActiveRec(r)} style={{
                    display: 'block', width: '100%', textAlign: 'left', padding: '0.35rem 0.5rem',
                    background: activeRec?.id === r.id ? '#e8eef5' : 'transparent',
                    border: '1px solid ' + (activeRec?.id === r.id ? '#1a3a5c' : '#e0e0e0'),
                    borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem', marginBottom: '0.3rem',
                  }}>
                    <div style={{ fontWeight: 600 }}>{r.period_from === r.period_to ? r.period_from : `${r.period_from} – ${r.period_to}`}</div>
                    <div style={{ color: r.closed ? '#2e7d32' : '#b45309', fontSize: '0.72rem' }}>
                      {r.closed ? '✓ Закрита' : '○ Відкрита'}
                    </div>
                  </button>
                ))}
              </div>
            )}

            <div style={sectionBox}>
              <div style={sectionTitle}>Надходження</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <input type="date" value={recForm.receipt_date}
                  onChange={(e) => setRecForm({ ...recForm, receipt_date: e.target.value })} style={inputStyle} />
                <select value={recForm.product_id}
                  onChange={(e) => setRecForm({ ...recForm, product_id: e.target.value })} style={inputStyle}>
                  <option value="">— виріб —</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <input type="number" placeholder="Кількість" min="0" step="0.001"
                  value={recForm.qty} onChange={(e) => setRecForm({ ...recForm, qty: e.target.value })} style={inputStyle} />
                <input type="number" placeholder="Ціна закупки" min="0" step="0.01"
                  value={recForm.purchase_price} onChange={(e) => setRecForm({ ...recForm, purchase_price: e.target.value })} style={inputStyle} />
                <input placeholder="Примітка"
                  value={recForm.notes} onChange={(e) => setRecForm({ ...recForm, notes: e.target.value })} style={inputStyle} />
                <button onClick={handleAddReceipt} style={primaryBtn}>+ Додати</button>
              </div>
              {receipts.length > 0 && (
                <div style={{ marginTop: '0.5rem', maxHeight: '150px', overflowY: 'auto' }}>
                  {receipts.map((r) => (
                    <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.78rem', padding: '0.2rem 0', borderBottom: '1px solid #f0f0f0' }}>
                      <div>
                        <div style={{ fontWeight: 600 }}>{productName(r.product_id)}</div>
                        <div style={{ color: '#888' }}>{r.receipt_date} · {r.qty} од.</div>
                      </div>
                      <button onClick={() => api.delete(`/shop/receipts/${r.id}`).then(loadReceipts)} style={deleteBtnSmall}>✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── Права панель ───────────────────────────────────────────────── */}
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {!activeRec ? (
              <div style={{ color: '#aaa', padding: '2rem', textAlign: 'center' }}>Оберіть або створіть звірку</div>
            ) : (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>
                      {activeRec.period_from === activeRec.period_to
                        ? activeRec.period_from
                        : `${activeRec.period_from} – ${activeRec.period_to}`}
                    </span>
                    {activeRec.closed
                      ? <span style={{ ...badgeClosed, marginLeft: '0.5rem' }}>Закрита</span>
                      : <span style={{ ...badgeOpen, marginLeft: '0.5rem' }}>Відкрита</span>}
                  </div>
                  {!activeRec.closed && (
                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                      <button onClick={handleRefreshReceived} style={secondaryBtn} title="Оновити дані надходжень">⟳ Оновити</button>
                      <button onClick={handleDelete} style={delBtn}>Видалити</button>
                    </div>
                  )}
                </div>

                <ReconciliationTable
                  rec={activeRec}
                  clients={clients}
                  productName={productName}
                  workDate={workDate}
                  posSales={posSales}
                  onUpdate={handleLineUpdate}
                  onAddDisposal={handleAddDisposal}
                  onDeleteDisposal={handleDeleteDisposal}
                />

                {/* Каса */}
                <div style={{ ...sectionBox, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <div style={sectionTitle}>Каса</div>
                  <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                    <div>
                      <div style={labelStyle}>Очікувана виручка (авто)</div>
                      <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#1a3a5c' }}>
                        {activeRec.cash_expected.toFixed(2)} грн
                      </div>
                    </div>
                    {posTotalRef.current > 0 && (
                      <div>
                        <div style={labelStyle}>📱 Каса (POS)</div>
                        <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0369a1' }}>
                          {posTotalRef.current.toFixed(2)} грн
                        </div>
                      </div>
                    )}
                    {!activeRec.closed && (
                      <div>
                        <label style={labelStyle}>Фактична виручка</label>
                        <input type="number" min="0" step="0.01"
                          value={cashActual} onChange={(e) => setCashActual(e.target.value)}
                          placeholder="0.00" style={{ ...inputStyle, width: '130px' }} />
                      </div>
                    )}
                    {activeRec.closed && activeRec.cash_actual != null && (
                      <>
                        <div>
                          <div style={labelStyle}>Фактична виручка</div>
                          <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#2e7d32' }}>
                            {activeRec.cash_actual.toFixed(2)} грн
                          </div>
                        </div>
                        <div>
                          <div style={labelStyle}>Різниця</div>
                          <div style={{ fontSize: '1rem', fontWeight: 700, color: (activeRec.cash_diff ?? 0) >= 0 ? '#2e7d32' : '#c00' }}>
                            {(activeRec.cash_diff ?? 0) >= 0 ? '+' : ''}{(activeRec.cash_diff ?? 0).toFixed(2)} грн
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                  {!activeRec.closed && (
                    <>
                      <div>
                        <label style={labelStyle}>Примітка</label>
                        <input value={confirmNotes} onChange={(e) => setConfirmNotes(e.target.value)}
                          style={{ ...inputStyle, width: '100%' }} />
                      </div>
                      <button onClick={handleConfirm} disabled={saving} style={{ ...primaryBtn, alignSelf: 'flex-end' }}>
                        {saving ? '…' : 'Підтвердити звірку'}
                      </button>
                    </>
                  )}
                  {activeRec.notes && (
                    <div style={{ fontSize: '0.85rem', color: '#555' }}>Примітка: {activeRec.notes}</div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Таблиця звірки ───────────────────────────────────────────────────────────

const DISPOSAL_LABELS: Record<string, string> = {
  writeoff: 'Списання',
  ration:   'Пайок',
  client:   'До клієнта',
}

function calcAgeDays(batchDate: string | null, workDate: string): number | null {
  if (!batchDate) return null
  const diff = Math.floor(
    (new Date(workDate).getTime() - new Date(batchDate).getTime()) / 86400000
  )
  return diff >= 0 ? diff : null
}

function ReconciliationTable({
  rec, clients, productName, workDate, posSales, onUpdate, onAddDisposal, onDeleteDisposal,
}: {
  rec: Reconciliation
  clients: ClientOption[]
  productName: (id: number) => string
  workDate: string
  posSales: Record<number, { qty: number; amount: number }>
  onUpdate: (lineId: number, field: 'entered_balance' | 'price', value: string) => void
  onAddDisposal: (lineId: number, type: string, qty: number, clientId: number | null, notes: string) => Promise<void>
  onDeleteDisposal: (lineId: number, disposalId: number) => Promise<void>
}) {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  const [disposalOpen, setDisposalOpen]   = useState<number | null>(null)
  const [expandedLines, setExpandedLines] = useState<Set<number>>(new Set())
  const [dispType, setDispType]           = useState<'writeoff' | 'ration' | 'client'>('writeoff')
  const [dispQty, setDispQty]             = useState('')
  const [dispClientId, setDispClientId]   = useState<number | null>(null)
  const [dispNotes, setDispNotes]         = useState('')
  const [dispSaving, setDispSaving]       = useState(false)

  const toggleExpanded = (lineId: number) =>
    setExpandedLines((prev) => {
      const next = new Set(prev)
      next.has(lineId) ? next.delete(lineId) : next.add(lineId)
      return next
    })

  const openDisposal = (lineId: number) => {
    setDisposalOpen(lineId)
    setExpandedLines((prev) => new Set(prev).add(lineId))  // автоматично розгортаємо
    setDispType('writeoff')
    setDispQty('')
    setDispClientId(null)
    setDispNotes('')
  }

  const handleAddDisposal = async (lineId: number) => {
    const qty = parseFloat(dispQty)
    if (!qty || qty <= 0) return
    if (dispType === 'client' && !dispClientId) return
    setDispSaving(true)
    try {
      await onAddDisposal(lineId, dispType, qty, dispType === 'client' ? dispClientId : null, dispNotes)
      setDispQty('')
      setDispNotes('')
    } finally { setDispSaving(false) }
  }

  const handleKey = (e: KeyboardEvent<HTMLInputElement>, nextIdx: number) => {
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      inputRefs.current[nextIdx]?.focus()
    }
  }

  const lines    = rec.lines
  const disabled = !!rec.closed
  const totalSold = lines.reduce((s, l) => s + (l.calculated_sold ?? 0), 0)
  const totalCash = lines.reduce((s, l) => s + (l.expected_cash ?? 0), 0)

  const clientLabel = (id: number | null) =>
    id ? (clients.find((c) => c.id === id)?.label ?? `#${id}`) : ''

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={tableStyle}>
        <thead>
          <tr style={{ background: '#e8eef5' }}>
            <Th>Виріб</Th>
            <Th right>Відкр.</Th>
            <Th right>Надійшло</Th>
            <Th right>Доступно</Th>
            <Th right>Залишок</Th>
            <Th right>Списано</Th>
            <Th right>Продано</Th>
            <Th right>Ціна</Th>
            <Th right>Сума</Th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, idx) => {
            const available      = line.opening_balance + line.received
            const balIdx         = idx * 2
            const priceIdx       = idx * 2 + 1
            const ageDays        = calcAgeDays(line.batch_date, workDate)
            const isDisposalOpen = disposalOpen === line.id
            // POS-інфо показуємо лише в першому рядку для кожного продукту
            const isFirstRowForProduct = idx === 0 || lines[idx - 1].product_id !== line.product_id
            const posInfo = isFirstRowForProduct ? posSales[line.product_id] : undefined

            return (
              <React.Fragment key={line.id}>
                {/* ── Основний рядок ── */}
                <tr style={{ background: idx % 2 === 0 ? '#fff' : '#fafafa' }}>
                  <Td>
                    <span>{productName(line.product_id)}</span>
                    {line.batch_date
                      ? <span style={{ marginLeft: '0.35rem', fontSize: '0.72rem', color: '#888' }}>
                          {line.batch_date}
                        </span>
                      : <span style={{ marginLeft: '0.35rem', fontSize: '0.72rem', color: '#bbb' }}>
                          (поч.)
                        </span>
                    }
                    {ageDays != null && ageDays > 1 && <AgeBadge days={ageDays} />}
                    {posInfo && (
                      <span style={{ display: 'block', fontSize: '0.72rem', color: '#0369a1', marginTop: '1px' }}>
                        📱 {posInfo.qty} шт · {posInfo.amount.toFixed(2)} грн
                      </span>
                    )}
                  </Td>
                  <Td right dim>{line.opening_balance.toFixed(1)}</Td>
                  <Td right dim>{line.received > 0 ? `+${line.received.toFixed(1)}` : '—'}</Td>
                  <Td right><strong>{available.toFixed(1)}</strong></Td>
                  <Td right>
                    <StreamInput
                      ref={(el) => { inputRefs.current[balIdx] = el }}
                      value={line.entered_balance ?? ''}
                      disabled={disabled}
                      placeholder="введіть"
                      onCommit={(v) => onUpdate(line.id, 'entered_balance', v)}
                      onKeyDown={(e) => handleKey(e, priceIdx)}
                    />
                  </Td>

                  {/* Списано: ▶/▼ стрілка + підсумок + ⊕ */}
                  <Td right>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.25rem' }}>
                      {line.disposal_lines.length > 0 && (
                        <button
                          onClick={() => toggleExpanded(line.id)}
                          title={expandedLines.has(line.id) ? 'Сховати деталі' : 'Показати деталі'}
                          style={{
                            padding: '0 3px', fontSize: '0.6rem', lineHeight: '1',
                            background: 'none', border: 'none', cursor: 'pointer',
                            color: '#888', opacity: 0.7,
                          }}
                        >{expandedLines.has(line.id) ? '▼' : '▶'}</button>
                      )}
                      {line.written_off > 0 && (
                        <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#c62828' }}>
                          {line.written_off.toFixed(1)}
                        </span>
                      )}
                      {!disabled && (
                        <button
                          onClick={() => isDisposalOpen ? setDisposalOpen(null) : openDisposal(line.id)}
                          title="Додати списання"
                          style={{
                            padding: '1px 5px', fontSize: '0.72rem', lineHeight: '1.4',
                            background: isDisposalOpen ? '#1a3a5c' : '#f0f4f8',
                            color: isDisposalOpen ? '#fff' : '#1a3a5c',
                            border: '1px solid #c0d0e0', borderRadius: '3px', cursor: 'pointer',
                          }}
                        >⊕</button>
                      )}
                    </div>
                  </Td>

                  <Td right>
                    <strong style={{ color: line.calculated_sold != null ? '#1a3a5c' : '#aaa' }}>
                      {line.calculated_sold != null ? line.calculated_sold.toFixed(1) : '—'}
                    </strong>
                  </Td>
                  <Td right>
                    <StreamInput
                      ref={(el) => { inputRefs.current[priceIdx] = el }}
                      value={line.price ?? ''}
                      disabled={disabled}
                      placeholder="0.00"
                      onCommit={(v) => onUpdate(line.id, 'price', v)}
                      onKeyDown={(e) => handleKey(e, balIdx + 2)}
                      step="0.01"
                    />
                  </Td>
                  <Td right>
                    {line.expected_cash != null && line.expected_cash > 0
                      ? line.expected_cash.toFixed(2)
                      : '—'}
                  </Td>
                </tr>

                {/* ── Рядки disposal (розгорнуті) ── */}
                {expandedLines.has(line.id) && line.disposal_lines.map((d) => (
                  <tr key={`d-${d.id}`} style={{ background: '#fff8f0', borderLeft: '2px solid #e8c090' }}>
                    <td colSpan={4} style={{ ...tdStyle, paddingLeft: '1.8rem', color: '#999', fontSize: '0.78rem' }}>
                      <span style={{ marginRight: '0.3rem', color: '#ccc' }}>└</span>
                      {DISPOSAL_LABELS[d.disposal_type] ?? d.disposal_type}
                      {d.client_id && (
                        <span style={{ marginLeft: '0.3rem' }}>→ {clientLabel(d.client_id)}</span>
                      )}
                      {d.notes && (
                        <span style={{ marginLeft: '0.3rem', fontStyle: 'italic' }}>{d.notes}</span>
                      )}
                    </td>
                    <td style={tdStyle} />
                    <td style={{ ...tdStyle, textAlign: 'right', color: '#c62828', fontSize: '0.8rem' }}>
                      {d.qty.toFixed(1)}
                    </td>
                    <td colSpan={2} style={tdStyle} />
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      {!disabled && (
                        <button onClick={() => onDeleteDisposal(line.id, d.id)}
                          style={deleteBtnSmall} title="Видалити">✕</button>
                      )}
                    </td>
                  </tr>
                ))}

                {/* ── Inline форма додавання disposal ── */}
                {isDisposalOpen && !disabled && (
                  <tr style={{ background: '#f0f6ff', borderLeft: '3px solid #1a3a5c' }}>
                    <td colSpan={9} style={{ padding: '0.5rem 0.7rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.8rem', color: '#555', fontWeight: 600 }}>Тип:</span>
                        <select
                          value={dispType}
                          onChange={(e) => setDispType(e.target.value as 'writeoff' | 'ration' | 'client')}
                          style={{ ...inputStyle, width: 'auto', padding: '0.2rem 0.4rem' }}
                        >
                          <option value="writeoff">Списання</option>
                          <option value="ration">Пайок</option>
                          <option value="client">До клієнта</option>
                        </select>

                        {dispType === 'client' && (
                          <>
                            <span style={{ fontSize: '0.8rem', color: '#555', fontWeight: 600 }}>Кому:</span>
                            <select
                              value={dispClientId ?? ''}
                              onChange={(e) => setDispClientId(Number(e.target.value) || null)}
                              style={{ ...inputStyle, width: '160px', padding: '0.2rem 0.4rem' }}
                            >
                              <option value="">— оберіть клієнта —</option>
                              {clients.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                            </select>
                          </>
                        )}

                        <span style={{ fontSize: '0.8rem', color: '#555', fontWeight: 600 }}>Кількість:</span>
                        <input
                          type="number" min="0.001" step="0.001" value={dispQty}
                          onChange={(e) => setDispQty(e.target.value)}
                          placeholder="0"
                          style={{ ...inputStyle, width: '80px', padding: '0.2rem 0.4rem' }}
                        />
                        <input
                          placeholder="Примітка" value={dispNotes}
                          onChange={(e) => setDispNotes(e.target.value)}
                          style={{ ...inputStyle, width: '140px', padding: '0.2rem 0.4rem' }}
                        />
                        <button
                          onClick={() => handleAddDisposal(line.id)}
                          disabled={dispSaving || !dispQty || (dispType === 'client' && !dispClientId)}
                          style={{ ...primaryBtn, padding: '0.25rem 0.75rem', fontSize: '0.82rem' }}
                        >{dispSaving ? '…' : 'Додати'}</button>
                        <button onClick={() => setDisposalOpen(null)}
                          style={{ ...secondaryBtn, padding: '0.25rem 0.6rem', fontSize: '0.82rem' }}
                        >Скасувати</button>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            )
          })}
        </tbody>
        <tfoot>
          <tr style={{ background: '#f0f4f8', fontWeight: 700 }}>
            <td colSpan={6} style={{ ...tdStyle, fontWeight: 700 }}>Разом:</td>
            <td style={{ ...tdStyle, textAlign: 'right' }}>{totalSold.toFixed(1)}</td>
            <td style={tdStyle} />
            <td style={{ ...tdStyle, textAlign: 'right', color: '#b45309' }}>{totalCash.toFixed(2)} грн</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

// ─── StreamInput ─────────────────────────────────────────────────────────────

const StreamInput = forwardRef<
  HTMLInputElement,
  {
    value: number | string
    disabled?: boolean
    placeholder?: string
    step?: string
    onCommit: (v: string) => void
    onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void
  }
>(({ value, disabled, placeholder, step = '0.001', onCommit, onKeyDown }, ref) => {
  const [local, setLocal] = useState(value.toString())
  useEffect(() => setLocal(value.toString()), [value])
  return (
    <input
      ref={ref} type="number" min="0" step={step}
      value={local} disabled={disabled} placeholder={placeholder}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => onCommit(local)}
      onKeyDown={onKeyDown as any}
      style={{
        width: '80px', padding: '0.2rem 0.4rem',
        border: '1px solid ' + (disabled ? '#e0e0e0' : '#bbb'),
        borderRadius: '3px', fontSize: '0.875rem', textAlign: 'right',
        background: disabled ? '#f5f5f5' : '#fff', outline: 'none',
      }}
    />
  )
})
StreamInput.displayName = 'StreamInput'

// ─── Допоміжні компоненти ────────────────────────────────────────────────────

const Th = ({ children, right }: { children?: React.ReactNode; right?: boolean }) => (
  <th style={{ padding: '0.45rem 0.7rem', textAlign: right ? 'right' : 'left', fontWeight: 600, fontSize: '0.82rem', whiteSpace: 'nowrap' }}>
    {children}
  </th>
)
const tdStyle: React.CSSProperties = {
  padding: '0.35rem 0.7rem', borderBottom: '1px solid #f0f0f0', fontSize: '0.88rem', whiteSpace: 'nowrap',
}
const Td = ({ children, right, dim }: { children?: React.ReactNode; right?: boolean; dim?: boolean }) => (
  <td style={{ ...tdStyle, textAlign: right ? 'right' : 'left', color: dim ? '#999' : undefined }}>
    {children}
  </td>
)

// ─── Стилі ───────────────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  background: '#fff', border: '1px solid #e0e8f0', borderRadius: '10px',
  padding: '1.1rem 1.25rem', minWidth: '320px', maxWidth: '420px',
  flex: '1 1 320px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
}
const tableStyle: React.CSSProperties = {
  width: '100%', borderCollapse: 'collapse', background: '#fff',
  borderRadius: '6px', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.07)',
}
const miniTableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }
const miniTh: React.CSSProperties = { padding: '0.3rem 0.5rem', fontWeight: 600, textAlign: 'left', fontSize: '0.78rem' }
const miniTd: React.CSSProperties = { padding: '0.25rem 0.5rem', borderBottom: '1px solid #f0f0f0' }
const primaryBtn: React.CSSProperties = {
  padding: '0.4rem 1rem', background: '#1a3a5c', color: '#fff',
  border: 'none', borderRadius: '5px', cursor: 'pointer', fontSize: '0.875rem',
}
const secondaryBtn: React.CSSProperties = {
  padding: '0.35rem 0.7rem', background: '#f0f4f8', color: '#1a3a5c',
  border: '1px solid #c0d0e0', borderRadius: '5px', cursor: 'pointer', fontSize: '0.82rem',
}
const delBtn: React.CSSProperties = {
  padding: '0.35rem 0.7rem', background: '#fff0f0', color: '#c00',
  border: '1px solid #f5b8b8', borderRadius: '5px', cursor: 'pointer', fontSize: '0.82rem',
}
const deleteBtnSmall: React.CSSProperties = {
  padding: '0.1rem 0.4rem', background: 'transparent', color: '#c00',
  border: '1px solid #f5b8b8', borderRadius: '3px', cursor: 'pointer', fontSize: '0.75rem',
}
const inputStyle: React.CSSProperties = {
  padding: '0.3rem 0.5rem', border: '1px solid #ccc', borderRadius: '4px', fontSize: '0.82rem', width: '100%',
}
const labelStyle: React.CSSProperties = {
  fontSize: '0.75rem', color: '#888', display: 'block', marginBottom: '0.15rem',
}
const sectionBox: React.CSSProperties = {
  border: '1px solid #e0e8f0', borderRadius: '6px', padding: '0.6rem 0.75rem', background: '#fafcff',
}
const sectionTitle: React.CSSProperties = {
  fontSize: '0.72rem', fontWeight: 700, color: '#1a3a5c',
  textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.5rem',
}
const badgeOpen: React.CSSProperties = {
  display: 'inline-block', padding: '2px 8px', background: '#fff3e0', color: '#b45309',
  border: '1px solid #f0c070', borderRadius: '10px', fontSize: '0.72rem', fontWeight: 700,
}
const badgeClosed: React.CSSProperties = {
  display: 'inline-block', padding: '2px 8px', background: '#e8f5e9', color: '#2e7d32',
  border: '1px solid #a5d6a7', borderRadius: '10px', fontSize: '0.72rem', fontWeight: 700,
}
const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}
const modalStyle: React.CSSProperties = {
  background: '#fff', borderRadius: '10px', width: '97vw', maxWidth: '1300px',
  height: '92vh', padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column',
  boxShadow: '0 8px 32px rgba(0,0,0,0.2)', overflow: 'hidden',
}
const closeBtnStyle: React.CSSProperties = {
  background: 'none', border: 'none', fontSize: '1.2rem', cursor: 'pointer', color: '#888',
}
