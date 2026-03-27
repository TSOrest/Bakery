import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { api } from '../api/client'
import { useWorkDate } from '../context/DateContext'

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

interface RecLine {
  id: number
  reconciliation_id: number
  product_id: number
  opening_balance: number
  received: number
  entered_balance: number | null
  written_off: number
  calculated_sold: number | null
  price: number | null
  expected_cash: number | null
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

// ─── Головний компонент ───────────────────────────────────────────────────────

export default function ShopPage() {
  const { workDate } = useWorkDate()
  const [shops, setShops]         = useState<ShopClient[]>([])
  const [summaries, setSummaries] = useState<ShopSummary[]>([])
  const [loading, setLoading]     = useState(false)
  const [modal, setModal]         = useState<{ shopId: number; shopName: string } | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const sh = await api.get<ShopClient[]>('/shop/shops')
      setShops(sh)
      // Summary завантажуємо окремо — щоб список магазинів не зникав при помилці
      try {
        const sm = await api.get<ShopSummary[]>(`/shop/summary?date=${workDate}`)
        setSummaries(sm)
      } catch {
        // summary failed — показуємо магазини без даних
        setSummaries(sh.map((s) => ({
          shop_client_id: s.id,
          shop_name: s.name,
          last_reconciliation_id: null,
          last_reconciliation_from: null,
          last_reconciliation_to: null,
          last_closed: 0,
          products: [],
        })))
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [workDate])

  const openModal = (shopId: number, shopName: string) =>
    setModal({ shopId, shopName })

  const closeModal = () => {
    setModal(null)
    load()
  }

  if (loading) return <p style={{ padding: '1.5rem' }}>Завантаження...</p>

  return (
    <div style={{ padding: '1.5rem' }}>
      <h2 style={{ marginTop: 0, marginBottom: '1.25rem' }}>Магазин</h2>

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
              onOpen={() => openModal(s.shop_client_id, s.shop_name)}
            />
          ))}
        </div>
      )}

      {modal && (
        <ReconciliationModal
          shopId={modal.shopId}
          shopName={modal.shopName}
          workDate={workDate}
          onClose={closeModal}
        />
      )}
    </div>
  )
}

// ─── Картка магазину ──────────────────────────────────────────────────────────

function ShopCard({
  summary, onOpen,
}: {
  summary: ShopSummary
  onOpen: () => void
}) {
  const totalBalance = summary.products.reduce((s, p) => s + p.current_balance, 0)
  const totalSold    = summary.products.reduce((s, p) => s + p.sold, 0)
  const totalCash    = summary.products.reduce(
    (s, p) => s + p.sold * (p.price ?? 0), 0
  )
  const lastDate = summary.last_reconciliation_to

  return (
    <div style={cardStyle}>
      {/* Заголовок */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: '1.05rem', color: '#1a3a5c' }}>
            🏪 {summary.shop_name}
          </div>
          <div style={{ fontSize: '0.8rem', color: '#888', marginTop: '0.2rem' }}>
            {lastDate
              ? `Остання звірка: ${lastDate} ${summary.last_closed ? '✓' : '(незакрита)'}`
              : 'Звірок не проводилось'}
          </div>
        </div>
        {summary.last_closed === 0 && summary.last_reconciliation_id && (
          <span style={badgeOpen}>Відкрита</span>
        )}
        {summary.last_closed === 1 && (
          <span style={badgeClosed}>Закрита</span>
        )}
      </div>

      {/* Підсумки */}
      <div style={{ display: 'flex', gap: '1.5rem', marginTop: '0.9rem', flexWrap: 'wrap' }}>
        <Metric label="Залишок" value={`${totalBalance.toFixed(1)} од.`} />
        <Metric label="Продано" value={`${totalSold.toFixed(1)} од.`} color="#2e7d32" />
        <Metric label="Виручка" value={`${totalCash.toFixed(2)} грн`} color="#b45309" />
      </div>

      {/* Таблиця виробів (компактна) */}
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
            {summary.products.map((p) => (
              <tr key={p.product_id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                <td style={miniTd}>{p.product_name}</td>
                <td style={{ ...miniTd, textAlign: 'right', fontWeight: 600 }}>
                  {p.current_balance.toFixed(1)}
                </td>
                <td style={{ ...miniTd, textAlign: 'right', color: '#2e7d32' }}>
                  {p.sold > 0 ? p.sold.toFixed(1) : '—'}
                </td>
                <td style={{ ...miniTd, textAlign: 'right', color: '#555' }}>
                  {p.price != null ? `${p.price.toFixed(2)}` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Кнопка */}
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

function ReconciliationModal({
  shopId, shopName, workDate, onClose,
}: {
  shopId: number
  shopName: string
  workDate: string
  onClose: () => void
}) {
  const [recs, setRecs]       = useState<Reconciliation[]>([])
  const [activeRec, setActiveRec] = useState<Reconciliation | null>(null)
  const [periodFrom, setPeriodFrom] = useState(workDate)
  const [periodTo,   setPeriodTo]   = useState(workDate)
  const [creating, setCreating]     = useState(false)
  const [cashActual, setCashActual] = useState('')
  const [confirmNotes, setConfirmNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [receipts, setReceipts] = useState<ShopReceipt[]>([])
  const [recForm, setRecForm] = useState({ product_id: '', qty: '', purchase_price: '', notes: '', receipt_date: workDate })

  // Пошук виробу для форми надходжень
  const [products, setProducts] = useState<{ id: number; name: string }[]>([])

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
  }, [shopId])

  // Синхронізуємо activeRec після оновлення списку
  useEffect(() => {
    if (activeRec) {
      const fresh = recs.find((r) => r.id === activeRec.id)
      if (fresh) setActiveRec(fresh)
    }
  }, [recs])

  const handleCreate = async () => {
    setCreating(true)
    try {
      const rec = await api.post<Reconciliation>('/shop/reconciliations', {
        shop_client_id: shopId,
        period_from: periodFrom,
        period_to: periodTo,
      })
      await loadRecs()
      setActiveRec(rec)
    } finally {
      setCreating(false)
    }
  }

  const handleRefreshReceived = async () => {
    if (!activeRec) return
    const updated = await api.post<Reconciliation>(`/shop/reconciliations/${activeRec.id}/refresh-received`, {})
    setActiveRec(updated)
    await loadRecs()
  }

  const handleLineUpdate = async (
    lineId: number,
    field: 'entered_balance' | 'written_off' | 'price',
    value: string,
  ) => {
    if (!activeRec) return
    const num = value === '' ? null : Number(value)
    const updated = await api.put<RecLine>(
      `/shop/reconciliations/${activeRec.id}/lines/${lineId}`,
      { [field]: num },
    )
    setActiveRec((prev) =>
      prev ? { ...prev, lines: prev.lines.map((l) => l.id === updated.id ? updated : l) } : prev
    )
    // Оновити cash_expected
    await loadRecs()
  }

  const handleConfirm = async () => {
    if (!activeRec) return
    if (!confirm(`Підтвердити звірку за ${activeRec.period_from}–${activeRec.period_to}? Редагування буде заблоковано.`)) return
    setSaving(true)
    try {
      const confirmed = await api.post<Reconciliation>(
        `/shop/reconciliations/${activeRec.id}/confirm`,
        {
          cash_actual: cashActual !== '' ? Number(cashActual) : null,
          notes: confirmNotes || null,
        },
      )
      setActiveRec(confirmed)
      await loadRecs()
    } finally {
      setSaving(false)
    }
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
  }

  const handleDeleteReceipt = async (id: number) => {
    await api.delete(`/shop/receipts/${id}`)
    await loadReceipts()
  }

  const productName = (id: number) => products.find((p) => p.id === id)?.name ?? `#${id}`

  return (
    <div style={overlayStyle} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={modalStyle}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ margin: 0, color: '#1a3a5c' }}>🏪 {shopName} — Звірка</h3>
          <button onClick={onClose} style={closeBtnStyle}>✕</button>
        </div>

        <div style={{ display: 'flex', gap: '1.25rem', height: 'calc(100% - 56px)', overflow: 'hidden' }}>

          {/* ── Ліва панель: список звірок + нова ────────────────────────── */}
          <div style={{ width: '200px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '0.75rem', overflowY: 'auto' }}>
            {/* Нова звірка */}
            <div style={sectionBox}>
              <div style={sectionTitle}>Нова звірка</div>
              <label style={labelStyle}>Від</label>
              <input type="date" value={periodFrom}
                onChange={(e) => setPeriodFrom(e.target.value)} style={inputStyle} />
              <label style={labelStyle}>До</label>
              <input type="date" value={periodTo}
                onChange={(e) => setPeriodTo(e.target.value)} style={inputStyle} />
              <button onClick={handleCreate} disabled={creating} style={{ ...primaryBtn, marginTop: '0.35rem' }}>
                {creating ? '…' : '+ Створити'}
              </button>
            </div>

            {/* Список існуючих звірок */}
            {recs.length > 0 && (
              <div style={sectionBox}>
                <div style={sectionTitle}>Попередні</div>
                {recs.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => setActiveRec(r)}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left', padding: '0.35rem 0.5rem',
                      background: activeRec?.id === r.id ? '#e8eef5' : 'transparent',
                      border: '1px solid ' + (activeRec?.id === r.id ? '#1a3a5c' : '#e0e0e0'),
                      borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem', marginBottom: '0.3rem',
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>{r.period_from === r.period_to ? r.period_from : `${r.period_from} – ${r.period_to}`}</div>
                    <div style={{ color: r.closed ? '#2e7d32' : '#b45309', fontSize: '0.72rem' }}>
                      {r.closed ? '✓ Закрита' : '○ Відкрита'}
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Надходження ззовні */}
            <div style={sectionBox}>
              <div style={sectionTitle}>Надходження</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <input type="date" value={recForm.receipt_date}
                  onChange={(e) => setRecForm({ ...recForm, receipt_date: e.target.value })}
                  style={inputStyle} />
                <select value={recForm.product_id}
                  onChange={(e) => setRecForm({ ...recForm, product_id: e.target.value })}
                  style={inputStyle}>
                  <option value="">— виріб —</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <input type="number" placeholder="Кількість" min="0" step="0.001"
                  value={recForm.qty}
                  onChange={(e) => setRecForm({ ...recForm, qty: e.target.value })}
                  style={inputStyle} />
                <input type="number" placeholder="Ціна закупки" min="0" step="0.01"
                  value={recForm.purchase_price}
                  onChange={(e) => setRecForm({ ...recForm, purchase_price: e.target.value })}
                  style={inputStyle} />
                <input placeholder="Примітка"
                  value={recForm.notes}
                  onChange={(e) => setRecForm({ ...recForm, notes: e.target.value })}
                  style={inputStyle} />
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
                      <button onClick={() => handleDeleteReceipt(r.id)} style={deleteBtnSmall}>✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── Права панель: активна звірка ──────────────────────────────── */}
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {!activeRec ? (
              <div style={{ color: '#aaa', padding: '2rem', textAlign: 'center' }}>
                Оберіть або створіть звірку
              </div>
            ) : (
              <>
                {/* Заголовок звірки */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>
                      {activeRec.period_from === activeRec.period_to
                        ? activeRec.period_from
                        : `${activeRec.period_from} – ${activeRec.period_to}`}
                    </span>
                    {activeRec.closed ? (
                      <span style={{ ...badgeClosed, marginLeft: '0.5rem' }}>Закрита</span>
                    ) : (
                      <span style={{ ...badgeOpen, marginLeft: '0.5rem' }}>Відкрита</span>
                    )}
                  </div>
                  {!activeRec.closed && (
                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                      <button onClick={handleRefreshReceived} style={secondaryBtn} title="Оновити дані надходжень">⟳ Оновити</button>
                      <button onClick={handleDelete} style={delBtn}>Видалити</button>
                    </div>
                  )}
                </div>

                {/* Таблиця потокового вводу */}
                <ReconciliationTable
                  rec={activeRec}
                  onUpdate={handleLineUpdate}
                  productName={productName}
                />

                {/* Блок каси */}
                <div style={{ ...sectionBox, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <div style={sectionTitle}>Каса</div>
                  <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                    <div>
                      <div style={labelStyle}>Очікувана виручка (авто)</div>
                      <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#1a3a5c' }}>
                        {activeRec.cash_expected.toFixed(2)} грн
                      </div>
                    </div>
                    {!activeRec.closed && (
                      <div>
                        <label style={labelStyle}>Фактична виручка</label>
                        <input
                          type="number" min="0" step="0.01"
                          value={cashActual}
                          onChange={(e) => setCashActual(e.target.value)}
                          placeholder="0.00"
                          style={{ ...inputStyle, width: '130px' }}
                        />
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
                          <div style={{
                            fontSize: '1rem', fontWeight: 700,
                            color: (activeRec.cash_diff ?? 0) >= 0 ? '#2e7d32' : '#c00',
                          }}>
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
                        <input
                          value={confirmNotes}
                          onChange={(e) => setConfirmNotes(e.target.value)}
                          style={{ ...inputStyle, width: '100%' }}
                        />
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

// ─── Таблиця звірки з потоковим вводом ───────────────────────────────────────

function ReconciliationTable({
  rec, onUpdate, productName,
}: {
  rec: Reconciliation
  onUpdate: (lineId: number, field: 'entered_balance' | 'written_off' | 'price', value: string) => void
  productName: (id: number) => string
}) {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  const handleKey = (e: KeyboardEvent<HTMLInputElement>, nextIdx: number) => {
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      inputRefs.current[nextIdx]?.focus()
    }
  }

  const lines = rec.lines
  const totalSold     = lines.reduce((s, l) => s + (l.calculated_sold ?? 0), 0)
  const totalCash     = lines.reduce((s, l) => s + (l.expected_cash ?? 0), 0)

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={tableStyle}>
        <thead>
          <tr style={{ background: '#e8eef5' }}>
            <Th>Виріб</Th>
            <Th right>Відкриваючий</Th>
            <Th right>Надійшло</Th>
            <Th right>Доступно</Th>
            <Th right>Фактичний залишок</Th>
            <Th right>Списано</Th>
            <Th right>Продано</Th>
            <Th right>Ціна</Th>
            <Th right>Сума</Th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, idx) => {
            const available = line.opening_balance + line.received
            const disabled  = !!rec.closed
            const balIdx    = idx * 3
            const woffIdx   = idx * 3 + 1
            const priceIdx  = idx * 3 + 2
            return (
              <tr key={line.id} style={{ background: idx % 2 === 0 ? '#fff' : '#fafafa' }}>
                <Td>{productName(line.product_id)}</Td>
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
                    onKeyDown={(e) => handleKey(e, woffIdx)}
                  />
                </Td>
                <Td right>
                  <StreamInput
                    ref={(el) => { inputRefs.current[woffIdx] = el }}
                    value={line.written_off}
                    disabled={disabled}
                    placeholder="0"
                    onCommit={(v) => onUpdate(line.id, 'written_off', v)}
                    onKeyDown={(e) => handleKey(e, priceIdx)}
                  />
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
                    onKeyDown={(e) => handleKey(e, balIdx + 3)}
                    step="0.01"
                  />
                </Td>
                <Td right>
                  {line.expected_cash != null && line.expected_cash > 0
                    ? line.expected_cash.toFixed(2)
                    : '—'}
                </Td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr style={{ background: '#f0f4f8', fontWeight: 700 }}>
            <td colSpan={6} style={{ ...tdStyle, fontWeight: 700 }}>Разом:</td>
            <td style={{ ...tdStyle, textAlign: 'right' }}>{totalSold.toFixed(1)}</td>
            <td style={tdStyle}></td>
            <td style={{ ...tdStyle, textAlign: 'right', color: '#b45309' }}>
              {totalCash.toFixed(2)} грн
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

// ─── StreamInput (Enter/Tab навігація) ────────────────────────────────────────

import { forwardRef } from 'react'

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
      ref={ref}
      type="number"
      min="0"
      step={step}
      value={local}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => onCommit(local)}
      onKeyDown={onKeyDown as any}
      style={{
        width: '80px',
        padding: '0.2rem 0.4rem',
        border: '1px solid ' + (disabled ? '#e0e0e0' : '#bbb'),
        borderRadius: '3px',
        fontSize: '0.875rem',
        textAlign: 'right',
        background: disabled ? '#f5f5f5' : '#fff',
        outline: 'none',
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
const Td = ({
  children, right, dim,
}: {
  children?: React.ReactNode; right?: boolean; dim?: boolean
}) => (
  <td style={{ ...tdStyle, textAlign: right ? 'right' : 'left', color: dim ? '#999' : undefined }}>
    {children}
  </td>
)

// ─── Стилі ───────────────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e0e8f0',
  borderRadius: '10px',
  padding: '1.1rem 1.25rem',
  minWidth: '320px',
  maxWidth: '420px',
  flex: '1 1 320px',
  boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
}
const tableStyle: React.CSSProperties = {
  width: '100%', borderCollapse: 'collapse', background: '#fff',
  borderRadius: '6px', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.07)',
}
const miniTableStyle: React.CSSProperties = {
  width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem',
}
const miniTh: React.CSSProperties = {
  padding: '0.3rem 0.5rem', fontWeight: 600, textAlign: 'left', fontSize: '0.78rem',
}
const miniTd: React.CSSProperties = {
  padding: '0.25rem 0.5rem', borderBottom: '1px solid #f0f0f0',
}
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
  padding: '0.1rem 0.4rem', background: '#fff0f0', color: '#c00',
  border: '1px solid #f5b8b8', borderRadius: '3px', cursor: 'pointer', fontSize: '0.75rem',
}
const inputStyle: React.CSSProperties = {
  padding: '0.3rem 0.5rem', border: '1px solid #ccc', borderRadius: '4px',
  fontSize: '0.875rem', width: '100%', boxSizing: 'border-box',
}
const labelStyle: React.CSSProperties = {
  fontSize: '0.75rem', color: '#888', display: 'block', marginBottom: '0.1rem',
}
const sectionBox: React.CSSProperties = {
  background: '#f8fafc', border: '1px solid #e8eef5', borderRadius: '7px', padding: '0.7rem 0.85rem',
}
const sectionTitle: React.CSSProperties = {
  fontSize: '0.75rem', fontWeight: 700, color: '#1a3a5c', textTransform: 'uppercase',
  letterSpacing: '0.07em', marginBottom: '0.5rem',
}
const badgeOpen: React.CSSProperties = {
  background: '#fff8e1', border: '1px solid #f59e0b', color: '#92400e',
  borderRadius: '10px', padding: '0.1rem 0.5rem', fontSize: '0.72rem', fontWeight: 600,
}
const badgeClosed: React.CSSProperties = {
  background: '#e8f5e9', border: '1px solid #a5d6a7', color: '#2e7d32',
  borderRadius: '10px', padding: '0.1rem 0.5rem', fontSize: '0.72rem', fontWeight: 600,
}
const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
}
const modalStyle: React.CSSProperties = {
  background: '#fff', borderRadius: '12px', padding: '1.5rem',
  width: 'min(95vw, 1100px)', height: 'min(92vh, 800px)',
  boxShadow: '0 8px 40px rgba(0,0,0,0.25)', display: 'flex', flexDirection: 'column',
  overflow: 'hidden',
}
const closeBtnStyle: React.CSSProperties = {
  background: 'none', border: 'none', fontSize: '1.2rem', cursor: 'pointer', color: '#888', lineHeight: 1,
}
