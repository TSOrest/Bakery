import React, { forwardRef, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { api } from '../api/client'
import { useWorkDate } from '../context/DateContext'

// ─── Типи ────────────────────────────────────────────────────────────────────

interface ShopClient {
  id: number
  name: string
  short_name: string | null
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
  rec_type: string   // 'regular' | 'opening' | 'archive'
  lines: RecLine[]
  prev_cash_balance: number | null  // обчислюється бекендом динамічно
  prev_stock_value: number | null   // вартість товару на кінець попередньої звірки
  terminal_cash: number | null      // термінальна частина cash_actual
  opening_prices: Record<string, number> | null  // ціни до початку звірки {pid: price}
  revaluation_sum: number | null   // переоцінка через зміну ціни
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
  const [shops, setShops]               = useState<ShopClient[]>([])
  const [loading, setLoading]           = useState(false)
  const [loadError, setLoadError]       = useState<string | null>(null)
  const [activeShopId, setActiveShopId] = useState<number | null>(null)

  const load = async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const sh = await api.get<ShopClient[]>('/shop/shops')
      setShops(sh)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [workDate]) // eslint-disable-line react-hooks/exhaustive-deps

  // Авто-вибір першого магазину
  useEffect(() => {
    if (shops.length > 0 && !activeShopId) setActiveShopId(shops[0].id)
  }, [shops]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <p style={{ padding: '1.5rem' }}>Завантаження...</p>

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '1.5rem', boxSizing: 'border-box' }}>
      <h2 style={{ marginTop: 0, marginBottom: '1rem', flexShrink: 0 }}>Магазин</h2>

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
        <>
          {/* Горизонтальні вкладки магазинів */}
          <div style={{ ...shopTabsBarStyle, flexShrink: 0 }}>
            {shops.map((shop) => (
              <button
                key={shop.id}
                onClick={() => setActiveShopId(shop.id)}
                style={activeShopId === shop.id ? shopTabActiveStyle : shopTabStyle}
              >
                🏪 {shop.short_name ?? shop.name}
              </button>
            ))}
          </div>

          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
            {activeShopId && (
              <ShopTabContent
                key={activeShopId}
                shopId={activeShopId}
                shopName={shops.find((s) => s.id === activeShopId)?.name ?? ''}
                workDate={workDate}
                onRefresh={load}
              />
            )}
          </div>
        </>
      )}
    </div>
  )
}



function SummaryCard({ label, value, color, highlight }: { label: string; value: number; color?: string; highlight?: boolean }) {
  const isZero = value === 0
  return (
    <div style={{
      background: highlight ? '#f0f6ff' : '#f8f9fb',
      border: `1px solid ${highlight ? '#b0c8e8' : '#e0e8f0'}`,
      borderRadius: 5,
      padding: '0.28rem 0.4rem',
      minWidth: 0,
    }}>
      <div style={{ fontSize: '0.62rem', color: '#999', lineHeight: 1.25, marginBottom: '0.1rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
      <div style={{ fontSize: '0.82rem', fontWeight: highlight ? 800 : 700, color: isZero ? '#c0c8d0' : (color ?? '#1a3a5c') }}>
        {isZero ? '0.00 грн' : `${value.toFixed(2)} грн`}
      </div>
    </div>
  )
}

// ─── Вміст вкладки магазину ───────────────────────────────────────────────────

function ShopTabContent({
  shopId, shopName, workDate, onRefresh,
}: {
  shopId: number
  shopName: string
  workDate: string
  onRefresh: () => void
}) {
  const [selectedDate, setSelectedDate]       = useState(workDate)
  const [showRecModal, setShowRecModal]       = useState(false)
  const [showOpeningModal, setShowOpeningModal] = useState(false)
  const [addReceiptOpen, setAddReceiptOpen]   = useState(false)
  const [receiptRefresh, setReceiptRefresh]   = useState(0)
  const [allReceipts, setAllReceipts]         = useState<ShopReceipt[]>([])
  const [products, setProducts]               = useState<{ id: number; name: string; category_id: number | null }[]>([])
  const [categories, setCategories]           = useState<{ id: number; name: string }[]>([])
  const [hasOpeningRec, setHasOpeningRec]     = useState(false)

  useEffect(() => { setSelectedDate(workDate) }, [workDate])

  const loadReceipts = () =>
    api.get<ShopReceipt[]>(`/shop/receipts?shop_client_id=${shopId}`)
      .then(setAllReceipts).catch(() => {})

  const checkOpeningRec = () =>
    api.get<Reconciliation[]>(`/shop/reconciliations?shop_client_id=${shopId}&include_lines=false`)
      .then((recs) => setHasOpeningRec(recs.some((r) => r.rec_type === 'opening')))
      .catch(() => {})

  useEffect(() => {
    loadReceipts()
    checkOpeningRec()
    // Завантажуємо всі продукти (включно з неактивними — у звірках можуть бути старі)
    api.get<{ id: number; name: string; category_id: number | null }[]>('/products/').then(setProducts)
    api.get<{ id: number; name: string }[]>('/categories').then(setCategories)
  }, [shopId, receiptRefresh]) // eslint-disable-line react-hooks/exhaustive-deps

  const dateReceipts  = allReceipts.filter((r) => r.receipt_date === selectedDate)
  const productName   = (id: number) => products.find((p) => p.id === id)?.name ?? `#${id}`

  const handleDeleteReceipt = (id: number) =>
    api.delete(`/shop/receipts/${id}`).then(() => setReceiptRefresh((n) => n + 1))

  // Підвал лівої колонки календаря: кнопка звірки + надходження на обрану дату
  const calendarLeftFooter = (
    <div>
      <button
        onClick={() => setShowRecModal(true)}
        style={{ ...primaryBtn, width: '100%', marginTop: '0.6rem', marginBottom: '0.35rem' }}
      >
        Відкрити звірку
      </button>
      {!hasOpeningRec && (
        <button
          onClick={() => setShowOpeningModal(true)}
          style={{ ...secondaryBtn, width: '100%', marginBottom: '0.5rem', fontSize: '0.78rem', color: '#5b21b6', borderColor: '#c4b5fd' }}
        >
          ◈ Початковий залишок
        </button>
      )}
      <div style={{ borderTop: '1px solid #e0e8f0', paddingTop: '0.55rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
          <span style={{ ...sectionTitle, margin: 0 }}>Надходження · {selectedDate}</span>
          <button
            onClick={() => setAddReceiptOpen(true)}
            style={{ ...primaryBtn, fontSize: '0.75rem', padding: '0.18rem 0.6rem' }}
          >+ Додати</button>
        </div>
        {dateReceipts.length > 0 ? (
          <div>
            {dateReceipts.map((r) => (
              <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.78rem', padding: '0.18rem 0', borderBottom: '1px solid #f0f0f0' }}>
                <div>
                  <span style={{ fontWeight: 600 }}>{productName(r.product_id)}</span>
                  <span style={{ color: '#777', marginLeft: '0.4rem' }}>{r.qty} од.{r.purchase_price > 0 ? ` · ${r.purchase_price.toFixed(2)} грн` : ''}</span>
                </div>
                <button onClick={() => handleDeleteReceipt(r.id)} style={deleteBtnSmall}>✕</button>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ color: '#bbb', fontSize: '0.78rem' }}>Надходжень немає</div>
        )}
      </div>
    </div>
  )

  return (
    <>
      {/* Календар звірок (кнопка + надходження в лівій колонці, деталі у правій) */}
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <ReconciliationCalendar
          shopId={shopId}
          products={products}
          categories={categories}
          onSelectDate={setSelectedDate}
          leftFooter={calendarLeftFooter}
        />
      </div>

      {showRecModal && (
        <ReconciliationModal
          shopId={shopId}
          shopName={shopName}
          workDate={workDate}
          onClose={() => { setShowRecModal(false); onRefresh() }}
        />
      )}


      {addReceiptOpen && (
        <AddReceiptModal
          shopId={shopId}
          defaultDate={selectedDate}
          products={products}
          onClose={() => setAddReceiptOpen(false)}
          onSaved={() => setReceiptRefresh((n) => n + 1)}
        />
      )}

      {showOpeningModal && (
        <OpeningRecModal
          shopId={shopId}
          products={products}
          workDate={workDate}
          onClose={() => setShowOpeningModal(false)}
          onSaved={() => { setHasOpeningRec(true); setShowOpeningModal(false); onRefresh() }}
        />
      )}
    </>
  )
}

// ─── Модальне вікно додавання надходження ─────────────────────────────────────

function AddReceiptModal({
  shopId, defaultDate, products, onClose, onSaved,
}: {
  shopId: number
  defaultDate: string
  products: { id: number; name: string }[]
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState({
    product_id: '', qty: '', purchase_price: '', notes: '', receipt_date: defaultDate,
  })
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!form.product_id || !form.qty) return
    setSaving(true)
    try {
      await api.post('/shop/receipts', {
        shop_client_id: shopId,
        receipt_date: form.receipt_date,
        product_id: Number(form.product_id),
        qty: Number(form.qty),
        purchase_price: form.purchase_price ? Number(form.purchase_price) : 0,
        notes: form.notes || null,
      })
      onSaved()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={overlayStyle} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{ background: '#fff', borderRadius: '10px', padding: '1.5rem', width: '400px', maxWidth: '95vw', boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ margin: 0, color: '#1a3a5c', fontSize: '1rem' }}>Надходження у магазин</h3>
          <button onClick={onClose} style={closeBtnStyle}>✕</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
          <div>
            <label style={labelStyle}>Дата</label>
            <input type="date" value={form.receipt_date}
              onChange={(e) => setForm({ ...form, receipt_date: e.target.value })}
              style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Виріб</label>
            <select value={form.product_id}
              onChange={(e) => setForm({ ...form, product_id: e.target.value })}
              style={inputStyle}>
              <option value="">— оберіть —</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Кількість</label>
            <input type="number" min="0" step="0.001" placeholder="0"
              value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })}
              style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Ціна закупки</label>
            <input type="number" min="0" step="0.01" placeholder="0.00"
              value={form.purchase_price} onChange={(e) => setForm({ ...form, purchase_price: e.target.value })}
              style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Примітка</label>
            <input placeholder="необов'язково"
              value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
              style={inputStyle} />
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.3rem' }}>
            <button onClick={onClose} style={secondaryBtn}>Скасувати</button>
            <button
              onClick={handleSave}
              disabled={saving || !form.product_id || !form.qty}
              style={primaryBtn}
            >{saving ? '…' : 'Зберегти'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Модаль стартового залишку ────────────────────────────────────────────────

function OpeningRecModal({ shopId, products, workDate, onClose, onSaved }: {
  shopId: number
  products: { id: number; name: string }[]
  workDate: string
  onClose: () => void
  onSaved: () => void
}) {
  const [startDate, setStartDate] = useState(workDate)
  const [qtys, setQtys]           = useState<Record<number, string>>({})
  const [cashMode, setCashMode]   = useState<'auto' | 'manual'>('auto')
  const [cashVal, setCashVal]     = useState('')
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState<string | null>(null)

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      const lines = products
        .filter((p) => parseFloat(qtys[p.id] || '0') > 0)
        .map((p) => ({ product_id: p.id, qty: parseFloat(qtys[p.id]) }))
      await api.post('/shop/reconciliations/opening', {
        shop_client_id: shopId,
        start_date: startDate,
        lines,
        cash_actual: cashMode === 'manual' ? (parseFloat(cashVal) || 0) : null,
      })
      onSaved()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Помилка збереження')
      setSaving(false)
    }
  }

  return (
    <div style={overlayStyle} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{ ...modalStyle, maxWidth: '520px', height: 'auto', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem' }}>
          <h3 style={{ margin: 0, color: '#5b21b6' }}>◈ Початковий залишок магазину</h3>
          <button onClick={onClose} style={closeBtnStyle}>✕</button>
        </div>
        <p style={{ margin: '0 0 0.75rem', fontSize: '0.82rem', color: '#555' }}>
          Вкажіть дату першого дня реального обліку і фактичні залишки товару на той момент.
          Звірка буде датована попереднім днем і стане якорем ланцюжка.
        </p>

        <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.75rem', alignItems: 'flex-end' }}>
          <div>
            <label style={labelStyle}>Перший день обліку</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
              style={{ ...inputStyle, width: '140px' }} />
          </div>
          <div>
            <label style={labelStyle}>Каса</label>
            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
              <label style={{ fontSize: '0.78rem', cursor: 'pointer' }}>
                <input type="radio" checked={cashMode === 'auto'} onChange={() => setCashMode('auto')} /> авто
              </label>
              <label style={{ fontSize: '0.78rem', cursor: 'pointer' }}>
                <input type="radio" checked={cashMode === 'manual'} onChange={() => setCashMode('manual')} /> вручну
              </label>
              {cashMode === 'manual' && (
                <input type="number" min="0" step="0.01" placeholder="0.00"
                  value={cashVal} onChange={(e) => setCashVal(e.target.value)}
                  style={{ ...inputStyle, width: '90px' }} />
              )}
            </div>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', border: '1px solid #e0e8f0', borderRadius: '4px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            <thead style={{ position: 'sticky', top: 0, background: '#f0f4f8', zIndex: 1 }}>
              <tr>
                <th style={{ ...miniTh, textAlign: 'left', borderBottom: '1px solid #d0dce8' }}>Виріб</th>
                <th style={{ ...miniTh, textAlign: 'right', borderBottom: '1px solid #d0dce8', width: '90px' }}>Кількість</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id}>
                  <td style={miniTd}>{p.name}</td>
                  <td style={{ ...miniTd, textAlign: 'right' }}>
                    <input type="number" min="0" step="0.001" placeholder="0"
                      value={qtys[p.id] ?? ''}
                      onChange={(e) => setQtys((prev) => ({ ...prev, [p.id]: e.target.value }))}
                      style={{ ...inputStyle, width: '80px', textAlign: 'right' }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {error && <div style={{ color: '#c00', fontSize: '0.8rem', marginTop: '0.4rem' }}>{error}</div>}

        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.75rem' }}>
          <button onClick={onClose} style={secondaryBtn}>Скасувати</button>
          <button onClick={handleSave} disabled={saving || !startDate} style={primaryBtn}>
            {saving ? '…' : 'Зберегти'}
          </button>
        </div>
      </div>
    </div>
  )
}


// ─── Календар звірок ─────────────────────────────────────────────────────────

function ReconciliationCalendar({
  shopId, products, categories, onSelectDate, leftFooter,
}: {
  shopId: number
  products: { id: number; name: string; category_id: number | null }[]
  categories: { id: number; name: string }[]
  onSelectDate?: (date: string) => void
  leftFooter?: React.ReactNode
}) {
  const today = new Date()
  const [year, setYear]               = useState(today.getFullYear())
  const [month, setMonth]             = useState(today.getMonth())
  const [recs, setRecs]               = useState<Reconciliation[]>([])
  const [selectedRec, setSelectedRec] = useState<Reconciliation | null>(null)
  const [loadingRec, setLoadingRec]   = useState(false)
  const [priceAlert, setPriceAlert]   = useState<{has_alert: boolean; products: {id:number;name:string}[]}>({has_alert: false, products: []})

  const loadRecDetail = (id: number) => {
    setLoadingRec(true)
    api.get<Reconciliation>(`/shop/reconciliations/${id}`)
      .then((full) => { setSelectedRec(full); setLoadingRec(false) })
      .catch(() => setLoadingRec(false))
  }

  useEffect(() => {
    api.get<{has_alert: boolean; products: {id:number;name:string}[]}>('/shop/price-change-alert')
      .then(setPriceAlert).catch(() => {})
  }, [shopId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // Завантажуємо список без рядків (50 KB замість 3.6 MB)
    api.get<Reconciliation[]>(`/shop/reconciliations?shop_client_id=${shopId}&include_lines=false`)
      .then((data) => {
        setRecs(data)
        if (data.length > 0) {
          setSelectedRec(data[0])      // slim для підсвічування
          loadRecDetail(data[0].id)    // повні рядки для правої панелі
        }
      })
      .catch(() => {})
  }, [shopId]) // eslint-disable-line react-hooks/exhaustive-deps

  const dayRecMap = useMemo(() => {
    const map = new Map<string, Reconciliation>()
    for (const rec of recs) {
      const cur = new Date(rec.period_from)
      const end = new Date(rec.period_to)
      while (cur <= end) {
        map.set(cur.toISOString().slice(0, 10), rec)
        cur.setDate(cur.getDate() + 1)
      }
    }
    return map
  }, [recs])

  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const startPad    = (new Date(year, month, 1).getDay() + 6) % 7  // Monday-first

  const prevMonth = () => month === 0 ? (setYear((y) => y - 1), setMonth(11)) : setMonth((m) => m - 1)
  const nextMonth = () => month === 11 ? (setYear((y) => y + 1), setMonth(0)) : setMonth((m) => m + 1)

  const monthLabel = new Date(year, month, 1)
    .toLocaleString('uk-UA', { month: 'long', year: 'numeric' })

  const productName = (id: number) => products.find((p) => p.id === id)?.name ?? `#${id}`
  const todayStr = today.toISOString().slice(0, 10)

  if (recs.length === 0) return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ display: 'flex', gap: '1.5rem', flex: 1, minHeight: 0, overflow: 'hidden', alignItems: 'flex-start', padding: '0.5rem 0' }}>
        <div style={{ minWidth: '200px', flex: '0 0 auto' }}>
          {leftFooter}
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#aaa', padding: '2rem' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📋</div>
            <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>Звірок ще немає</div>
            <div style={{ fontSize: '0.82rem' }}>Натисніть «◈ Початковий залишок» щоб розпочати облік</div>
          </div>
        </div>
      </div>
    </div>
  )

  return (
    <div style={{ ...sectionBox, flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      {priceAlert.has_alert && (
        <div style={{ background: '#fffbe6', border: '1.5px solid #f59e0b', borderRadius: 6, padding: '0.5rem 1rem', marginBottom: '0.5rem', fontSize: '0.82rem', color: '#92400e', display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
          <span>⚠️</span>
          <span>
            <strong>Рекомендується провести звірку</strong> — змінились ціни на товар що є на залишку:&nbsp;
            {priceAlert.products.map((p: {id:number;name:string}) => p.name).join(', ')}.
          </span>
        </div>
      )}
      <div style={{ ...sectionTitle, flexShrink: 0 }}>Звірки (календар)</div>
      <div style={{ display: 'flex', gap: '2rem', flex: 1, minHeight: 0, overflow: 'hidden', alignItems: 'stretch' }}>

        {/* ── Календар ── */}
        <div style={{ minWidth: '240px', flex: '0 0 auto', overflowY: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <button onClick={prevMonth} style={{ ...secondaryBtn, padding: '0.2rem 0.6rem' }}>←</button>
            <span style={{ fontWeight: 600, fontSize: '0.88rem', textTransform: 'capitalize' }}>{monthLabel}</span>
            <button onClick={nextMonth} style={{ ...secondaryBtn, padding: '0.2rem 0.6rem' }}>→</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px' }}>
            {['Пн','Вт','Ср','Чт','Пт','Сб','Нд'].map((d) => (
              <div key={d} style={{ textAlign: 'center', fontWeight: 600, color: '#999', padding: '2px 0', fontSize: '0.68rem' }}>{d}</div>
            ))}
            {Array(startPad).fill(null).map((_, i) => <div key={`pad${i}`} />)}
            {Array.from({ length: daysInMonth }, (_, i) => {
              const day = i + 1
              const ds  = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
              const rec = dayRecMap.get(ds)
              const sel = !!rec && selectedRec?.id === rec.id
              const isToday = ds === todayStr
              const bg = rec
                ? (rec.rec_type === 'opening' ? '#f3f0ff' : rec.closed ? '#e8f5e9' : '#fff3e0')
                : 'transparent'
              const border = sel
                ? '2px solid #1a3a5c'
                : isToday ? '1px solid #b45309' : '1px solid transparent'
              return (
                <div
                  key={day}
                  onClick={() => {
                    if (rec) {
                      if (selectedRec?.id !== rec.id) {
                        setSelectedRec(rec)   // slim для підсвічування
                        loadRecDetail(rec.id) // повні рядки
                      }
                      onSelectDate?.(ds)
                    }
                  }}
                  style={{
                    textAlign: 'center', padding: '3px 1px', lineHeight: '1.6',
                    background: bg, border, borderRadius: '3px', fontSize: '0.78rem',
                    cursor: rec ? 'pointer' : 'default',
                    fontWeight: isToday ? 700 : 400,
                    color: rec ? '#000' : '#ccc',
                  }}
                >{day}</div>
              )
            })}
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem', fontSize: '0.7rem', color: '#888', flexWrap: 'wrap' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
              <span style={{ display: 'inline-block', width: '10px', height: '10px', background: '#e8f5e9', border: '1px solid #a5d6a7', borderRadius: '2px' }} />
              Закрита
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
              <span style={{ display: 'inline-block', width: '10px', height: '10px', background: '#fff3e0', border: '1px solid #f0c070', borderRadius: '2px' }} />
              Відкрита
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
              <span style={{ display: 'inline-block', width: '10px', height: '10px', background: '#f3f0ff', border: '1px solid #c4b5fd', borderRadius: '2px' }} />
              Початок
            </span>
          </div>
          {leftFooter}
        </div>

        {/* ── Права панель: деталізація обраної звірки ── */}
        {selectedRec && (
        <div style={{ flex: '1 1 400px', minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Заголовок звірки */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem', flexShrink: 0 }}>
            <span style={{ fontWeight: 700, fontSize: '0.95rem', color: '#1a3a5c' }}>
              {selectedRec.period_from === selectedRec.period_to
                ? selectedRec.period_from
                : `${selectedRec.period_from} – ${selectedRec.period_to}`}
            </span>
            {selectedRec.rec_type === 'opening'
              ? <span style={badgeOpening}>Початок</span>
              : selectedRec.closed
                ? <span style={badgeClosed}>Закрита</span>
                : <span style={badgeOpen}>Відкрита</span>}
          </div>

          {loadingRec ? (
            <div style={{ color: '#999', fontSize: '0.82rem', padding: '0.5rem 0' }}>Завантаження…</div>
          ) : selectedRec.lines.length === 0 ? (
            <div style={{ color: '#aaa', fontSize: '0.82rem' }}>Рядків немає</div>
          ) : (() => {
            // Агрегуємо по product_id (кілька рядків з різними batch_date → один рядок)
            const byProduct = new Map<number, {
              opening: number; received: number; entered: number
              sold: number; writtenOff: number; price: number | null
            }>()
            for (const line of selectedRec.lines) {
              const e = byProduct.get(line.product_id) ?? {
                opening: 0, received: 0, entered: 0, sold: 0, writtenOff: 0, price: line.price ?? null,
              }
              e.opening    += line.opening_balance
              e.received   += line.received
              e.entered    += line.entered_balance ?? 0
              e.sold       += line.calculated_sold ?? 0
              e.writtenOff += line.written_off ?? 0
              if (line.price != null && e.price == null) e.price = line.price
              byProduct.set(line.product_id, e)
            }

            // Фільтр: показуємо лише рядки де є хоч якийсь рух
            type Row = { pid: number; opening: number; received: number; entered: number; sold: number; writtenOff: number; price: number | null }
            const allRows: Row[] = [...byProduct.entries()]
              .map(([pid, v]) => ({ pid, ...v }))
              .filter((r) => r.opening > 0 || r.received > 0 || r.entered > 0 || r.sold > 0)

            // Ціни до початку звірки (для операційних колонок при переоцінці)
            const openingPricesMap = selectedRec.opening_prices ?? {}
            const opPrice = (pid: number, fallback: number | null) =>
              openingPricesMap[String(pid)] ?? fallback ?? 0
            // val: для рядків деталізації (по поточній ціні рядка)
            const val = (qty: number, price: number | null) => qty * (price ?? 0)

            // Грошові підсумки — операційні колонки по ціні ДО звірки, залишок — по поточній
            const totOpeningVal   = allRows.reduce((s, r) => s + r.opening    * opPrice(r.pid, r.price), 0)
            const totReceivedVal  = allRows.reduce((s, r) => s + r.received   * opPrice(r.pid, r.price), 0)
            const totSoldVal      = allRows.reduce((s, r) => s + r.sold       * opPrice(r.pid, r.price), 0)
            const totWrittenOffVal= allRows.reduce((s, r) => s + r.writtenOff * opPrice(r.pid, r.price), 0)
            const totClosingVal   = allRows.reduce((s, r) => s + r.entered    * (r.price ?? 0), 0)
            const revaluation     = selectedRec.revaluation_sum ?? 0

            // Залишок в касі: бекенд обчислює prev_cash_balance динамічно з фінансів
            const prevCashBalance = selectedRec.prev_cash_balance ?? 0
            // "Товар поч." = вартість залишку на кінець попередньої звірки (ціни того дня)
            const prevStockValue  = selectedRec.prev_stock_value ?? totOpeningVal
            const cashExtracted   = selectedRec.cash_actual ?? 0
            const terminalCash    = selectedRec.terminal_cash ?? 0
            const cashWithdrawn   = cashExtracted - terminalCash   // чиста готівка (без термінала)
            const cashBalance     = prevCashBalance + totSoldVal - cashExtracted

            // Групуємо по категоріях
            const catMap = new Map<number | null, Row[]>()
            for (const row of allRows) {
              const prod = products.find((p) => p.id === row.pid)
              const catId = prod?.category_id ?? null
              if (!catMap.has(catId)) catMap.set(catId, [])
              catMap.get(catId)!.push(row)
            }
            // Сортуємо групи за порядком у довіднику (sort_order), null — в кінець
            const sortedGroups = [...catMap.entries()].sort(([a], [b]) => {
              if (a === null && b !== null) return 1
              if (a !== null && b === null) return -1
              const idxA = categories.findIndex((c) => c.id === a)
              const idxB = categories.findIndex((c) => c.id === b)
              return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB)
            })

            const fmt  = (v: number) => v.toFixed(2)
            // Q: ціле без ".0", дробове з 1 знаком; невидимий ".0" вирівнює позицію крапки
            const Q = (v: number): React.ReactNode => (
              v % 1 === 0
                ? <span style={{ fontVariantNumeric: 'tabular-nums' }}>{Math.round(v)}<span style={{ visibility: 'hidden' }}>.0</span></span>
                : <span style={{ fontVariantNumeric: 'tabular-nums' }}>{v.toFixed(1)}</span>
            )
            const clr  = (v: number, activeColor: string) => v === 0 ? '#c8ced6' : activeColor

            // Стилі колонок
            const BG_OPEN = '#f0f4f8'
            const BG_RECV = '#e8f4fb'
            const BG_SOLD = '#e8f5e9'
            const BG_WOFF = '#fff0f0'
            const BG_CLOS = '#fffae8'
            const tdR = { ...miniTd, textAlign: 'right' as const }
            const tdQ = { ...tdR, fontWeight: 700 as const }                          // кількість — жирний
            const tdM = { ...tdR, fontStyle: 'italic' as const, fontVariantNumeric: 'tabular-nums' as const } // гроші — курсив

            return (
              <>
                {/* ── Грошовий підсумок — поза скролом, залишається зверху ── */}
                {selectedRec.rec_type === 'opening' ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem', flexShrink: 0, flexWrap: 'wrap' }}>
                    <div style={{ background: '#f3f0ff', border: '1px solid #c4b5fd', borderRadius: '8px', padding: '0.4rem 1rem' }}>
                      <div style={{ fontSize: '0.7rem', color: '#7c3aed', marginBottom: '2px' }}>Товар на початок</div>
                      <div style={{ fontWeight: 700, fontSize: '1.05rem', color: '#5b21b6' }}>{totClosingVal.toFixed(2)} грн</div>
                    </div>
                    <div style={{ background: '#f3f0ff', border: '1px solid #c4b5fd', borderRadius: '8px', padding: '0.4rem 1rem' }}>
                      <div style={{ fontSize: '0.7rem', color: '#7c3aed', marginBottom: '2px' }}>Каса на початок</div>
                      <div style={{ fontWeight: 700, fontSize: '1.05rem', color: '#5b21b6' }}>
                        {(selectedRec.cash_actual ?? 0).toFixed(2)} грн
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: `repeat(${(terminalCash > 0 ? 1 : 0) + (revaluation !== 0 ? 1 : 0) + 8}, minmax(78px, 1fr))`, gap: '0.3rem', marginBottom: '0.5rem', flexShrink: 0 }}>
                    <SummaryCard label="Каса поч." value={prevCashBalance} color="#555" />
                    <SummaryCard label="Товар поч." value={prevStockValue} color="#555" />
                    <SummaryCard label="Прийнято" value={totReceivedVal} color="#0369a1" />
                    <SummaryCard label="Продано" value={totSoldVal} color="#2e7d32" highlight />
                    <SummaryCard label="Списано" value={totWrittenOffVal} color="#c00" />
                    {revaluation !== 0 && <SummaryCard label="Переоцінка" value={revaluation} color="#7c3aed" />}
                    <SummaryCard label="Товар кін." value={totClosingVal} color="#7a5800" />
                    <SummaryCard label="Виведено" value={cashWithdrawn} color="#b45309" />
                    {terminalCash > 0 && <SummaryCard label="Термінал" value={terminalCash} color="#0369a1" />}
                    <SummaryCard label="Каса кін." value={cashBalance} color="#1a3a5c" highlight />
                  </div>
                )}

                {/* ── Таблиця деталізації — власний скрол-контейнер ── */}
                {selectedRec.rec_type === 'opening' ? (
                  <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'auto' }}>
                    <table style={{ ...miniTableStyle, borderCollapse: 'collapse', fontSize: '0.76rem' }}>
                      <thead style={{ position: 'sticky', top: 0, zIndex: 3 }}>
                        <tr style={{ background: '#f3f0ff' }}>
                          <th style={{ ...miniTh, textAlign: 'left', minWidth: '110px', background: '#f3f0ff', boxShadow: 'inset 0 -1px 0 #c4b5fd' }}>Назва</th>
                          <th style={{ ...miniTh, textAlign: 'right', minWidth: '50px', background: '#f3f0ff', boxShadow: 'inset 0 -1px 0 #c4b5fd' }}>Ціна</th>
                          <th style={{ ...miniTh, textAlign: 'right', minWidth: '50px', background: BG_CLOS, boxShadow: 'inset 0 -1px 0 #c4b5fd' }}>Кіл</th>
                          <th style={{ ...miniTh, textAlign: 'right', minWidth: '60px', background: BG_CLOS, boxShadow: 'inset 0 -1px 0 #c4b5fd' }}>Вартість</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedGroups.map(([catId, rows]) => {
                          const catName = catId != null ? (categories.find((c) => c.id === catId)?.name ?? `Категорія #${catId}`) : 'Без категорії'
                          const catRows = rows.sort((a, b) => productName(a.pid).localeCompare(productName(b.pid), 'uk'))
                          return (
                            <React.Fragment key={catId ?? 'null'}>
                              <tr>
                                <td colSpan={4} style={{ ...miniTd, fontWeight: 700, color: '#5b21b6', fontSize: '0.75rem', padding: '3px 6px', background: '#ede9fe', position: 'sticky', top: '1.8rem', zIndex: 2, boxShadow: '0 1px 0 #c4b5fd' }}>
                                  {catName}
                                </td>
                              </tr>
                              {catRows.map((r, idx) => (
                                <tr key={r.pid} style={{ background: idx % 2 === 0 ? '#fff' : '#fafcff' }}>
                                  <td style={{ ...miniTd, fontWeight: 500 }}>{productName(r.pid)}</td>
                                  <td style={{ ...tdM, color: '#999' }}>{r.price != null ? r.price.toFixed(2) : '—'}</td>
                                  <td style={{ ...tdQ, background: BG_CLOS, color: clr(r.entered, '#7a5800') }}>{Q(r.entered)}</td>
                                  <td style={{ ...tdM, background: BG_CLOS, color: clr(val(r.entered, r.price), '#7a5800') }}>{fmt(val(r.entered, r.price))}</td>
                                </tr>
                              ))}
                            </React.Fragment>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'auto' }}>
                <table style={{ ...miniTableStyle, borderCollapse: 'collapse', fontSize: '0.76rem' }}>
                  <thead style={{ position: 'sticky', top: 0, zIndex: 3 }}>
                    <tr style={{ background: '#f0f4f8' }}>
                      <th style={{ ...miniTh, textAlign: 'left', minWidth: '110px', borderRight: '1px solid #d0dce8', background: '#f0f4f8', boxShadow: 'inset 0 -1px 0 #d0dce8' }} rowSpan={2}>Назва</th>
                      <th style={{ ...miniTh, textAlign: 'right', borderRight: '1px solid #d0dce8', minWidth: '44px', background: '#f0f4f8', boxShadow: 'inset 0 -1px 0 #d0dce8' }} rowSpan={2}>Ціна</th>
                      <th style={{ ...miniTh, textAlign: 'center', background: BG_OPEN, borderRight: '1px solid #d0dce8' }} colSpan={2}>Відкриття</th>
                      <th style={{ ...miniTh, textAlign: 'center', background: BG_RECV, borderRight: '1px solid #d0dce8' }} colSpan={2}>Надійшло</th>
                      <th style={{ ...miniTh, textAlign: 'center', background: BG_SOLD, borderRight: '1px solid #d0dce8' }} colSpan={2}>Продано</th>
                      <th style={{ ...miniTh, textAlign: 'center', background: BG_WOFF, borderRight: '1px solid #d0dce8' }} colSpan={2}>Списано</th>
                      <th style={{ ...miniTh, textAlign: 'center', background: BG_CLOS }} colSpan={2}>Залишок</th>
                    </tr>
                    <tr style={{ fontSize: '0.7rem', color: '#666' }}>
                      <th style={{ ...miniTh, background: BG_OPEN, textAlign: 'right', boxShadow: 'inset 0 -1px 0 #d0dce8' }}>Кіл</th>
                      <th style={{ ...miniTh, background: BG_OPEN, textAlign: 'right', borderRight: '1px solid #d0dce8', boxShadow: 'inset 0 -1px 0 #d0dce8' }}>Вар</th>
                      <th style={{ ...miniTh, background: BG_RECV, textAlign: 'right', boxShadow: 'inset 0 -1px 0 #d0dce8' }}>Кіл</th>
                      <th style={{ ...miniTh, background: BG_RECV, textAlign: 'right', borderRight: '1px solid #d0dce8', boxShadow: 'inset 0 -1px 0 #d0dce8' }}>Вар</th>
                      <th style={{ ...miniTh, background: BG_SOLD, textAlign: 'right', boxShadow: 'inset 0 -1px 0 #d0dce8' }}>Кіл</th>
                      <th style={{ ...miniTh, background: BG_SOLD, textAlign: 'right', borderRight: '1px solid #d0dce8', boxShadow: 'inset 0 -1px 0 #d0dce8' }}>Вар</th>
                      <th style={{ ...miniTh, background: BG_WOFF, textAlign: 'right', boxShadow: 'inset 0 -1px 0 #d0dce8' }}>Кіл</th>
                      <th style={{ ...miniTh, background: BG_WOFF, textAlign: 'right', borderRight: '1px solid #d0dce8', boxShadow: 'inset 0 -1px 0 #d0dce8' }}>Вар</th>
                      <th style={{ ...miniTh, background: BG_CLOS, textAlign: 'right', boxShadow: 'inset 0 -1px 0 #d0dce8' }}>Кіл</th>
                      <th style={{ ...miniTh, background: BG_CLOS, textAlign: 'right', boxShadow: 'inset 0 -1px 0 #d0dce8' }}>Вар</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedGroups.map(([catId, rows]) => {
                      const catName = catId != null
                        ? (categories.find((c) => c.id === catId)?.name ?? `Категорія #${catId}`)
                        : 'Без категорії'
                      const catRows = rows.sort((a, b) => {
                        const na = products.find((p) => p.id === a.pid)?.name ?? ''
                        const nb = products.find((p) => p.id === b.pid)?.name ?? ''
                        return na.localeCompare(nb, 'uk')
                      })
                      const catTot = catRows.reduce(
                        (s, r) => ({
                          opening: s.opening + r.opening,
                          received: s.received + r.received,
                          sold: s.sold + r.sold,
                          writtenOff: s.writtenOff + r.writtenOff,
                          entered: s.entered + r.entered,
                          openingV: s.openingV + val(r.opening, r.price),
                          receivedV: s.receivedV + val(r.received, r.price),
                          soldV: s.soldV + val(r.sold, r.price),
                          writtenOffV: s.writtenOffV + val(r.writtenOff, r.price),
                          enteredV: s.enteredV + val(r.entered, r.price),
                        }),
                        { opening:0, received:0, sold:0, writtenOff:0, entered:0, openingV:0, receivedV:0, soldV:0, writtenOffV:0, enteredV:0 },
                      )
                      return (
                        <React.Fragment key={catId ?? 'null'}>
                          {/* Рядок категорії — sticky під шапкою таблиці */}
                          <tr>
                            <td colSpan={12} style={{ ...miniTd, fontWeight: 700, color: '#1a3a5c', fontSize: '0.75rem', padding: '3px 6px', letterSpacing: '0.03em', background: '#e0e8f4', position: 'sticky', top: '3.2rem', zIndex: 2, boxShadow: '0 1px 0 #c8d8ec' }}>
                              {catName}
                            </td>
                          </tr>
                          {/* Рядки виробів */}
                          {catRows.map((r, idx) => {
                            const openV = val(r.opening, r.price)
                            const recvV = val(r.received, r.price)
                            const soldV = val(r.sold, r.price)
                            const woffV = val(r.writtenOff, r.price)
                            const cloV  = val(r.entered, r.price)
                            return (
                              <tr key={r.pid} style={{ background: idx % 2 === 0 ? '#fff' : '#fafcff' }}>
                                <td style={{ ...miniTd, borderRight: '1px solid #eee', fontWeight: 500 }}>{productName(r.pid)}</td>
                                <td style={{ ...tdM, borderRight: '1px solid #eee', color: '#999' }}>
                                  {r.price != null ? r.price.toFixed(2) : '—'}
                                </td>
                                <td style={{ ...tdQ, background: BG_OPEN, color: clr(r.opening,  '#555') }}>{Q(r.opening)}</td>
                                <td style={{ ...tdM, background: BG_OPEN, borderRight: '1px solid #d0dce8', color: clr(openV, '#555') }}>{fmt(openV)}</td>
                                <td style={{ ...tdQ, background: BG_RECV, color: clr(r.received,  '#0369a1') }}>{Q(r.received)}</td>
                                <td style={{ ...tdM, background: BG_RECV, borderRight: '1px solid #d0dce8', color: clr(recvV, '#0369a1') }}>{fmt(recvV)}</td>
                                <td style={{ ...tdQ, background: BG_SOLD, color: clr(r.sold,  '#2e7d32') }}>{Q(r.sold)}</td>
                                <td style={{ ...tdM, background: BG_SOLD, borderRight: '1px solid #d0dce8', color: clr(soldV, '#2e7d32') }}>{fmt(soldV)}</td>
                                <td style={{ ...tdQ, background: BG_WOFF, color: clr(r.writtenOff, '#c00') }}>{Q(r.writtenOff)}</td>
                                <td style={{ ...tdM, background: BG_WOFF, borderRight: '1px solid #d0dce8', color: clr(woffV, '#c00') }}>{fmt(woffV)}</td>
                                <td style={{ ...tdQ, background: BG_CLOS, color: clr(r.entered, '#7a5800') }}>{Q(r.entered)}</td>
                                <td style={{ ...tdM, background: BG_CLOS, color: clr(cloV, '#7a5800') }}>{fmt(cloV)}</td>
                              </tr>
                            )
                          })}
                          {/* Підсумок категорії (якщо > 1 рядок) */}
                          {catRows.length > 1 && (
                            <tr style={{ background: '#ecf3fb', borderTop: '1px solid #c8d8ec' }}>
                              <td style={{ ...miniTd, fontStyle: 'italic', color: '#666', borderRight: '1px solid #eee' }}>Разом по групі</td>
                              <td style={{ ...miniTd, borderRight: '1px solid #eee' }} />
                              <td style={{ ...tdQ, background: BG_OPEN, color: clr(catTot.opening,  '#555') }}>{Q(catTot.opening)}</td>
                              <td style={{ ...tdM, background: BG_OPEN, borderRight: '1px solid #d0dce8', color: clr(catTot.openingV,  '#555') }}>{fmt(catTot.openingV)}</td>
                              <td style={{ ...tdQ, background: BG_RECV, color: clr(catTot.received,  '#0369a1') }}>{Q(catTot.received)}</td>
                              <td style={{ ...tdM, background: BG_RECV, borderRight: '1px solid #d0dce8', color: clr(catTot.receivedV, '#0369a1') }}>{fmt(catTot.receivedV)}</td>
                              <td style={{ ...tdQ, background: BG_SOLD, color: clr(catTot.sold, '#2e7d32') }}>{Q(catTot.sold)}</td>
                              <td style={{ ...tdM, background: BG_SOLD, borderRight: '1px solid #d0dce8', color: clr(catTot.soldV, '#2e7d32') }}>{fmt(catTot.soldV)}</td>
                              <td style={{ ...tdQ, background: BG_WOFF, color: clr(catTot.writtenOff, '#c00') }}>{Q(catTot.writtenOff)}</td>
                              <td style={{ ...tdM, background: BG_WOFF, borderRight: '1px solid #d0dce8', color: clr(catTot.writtenOffV, '#c00') }}>{fmt(catTot.writtenOffV)}</td>
                              <td style={{ ...tdQ, background: BG_CLOS, color: clr(catTot.entered, '#7a5800') }}>{Q(catTot.entered)}</td>
                              <td style={{ ...tdM, background: BG_CLOS, color: clr(catTot.enteredV, '#7a5800') }}>{fmt(catTot.enteredV)}</td>
                            </tr>
                          )}
                        </React.Fragment>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: '2px solid #c0d0e0', background: '#eef2f8' }}>
                      <td style={{ ...miniTd, fontWeight: 700, color: '#1a3a5c', borderRight: '1px solid #eee' }}>Всього</td>
                      <td style={{ ...miniTd, borderRight: '1px solid #eee' }} />
                      {(() => {
                        const tO = allRows.reduce((s,r)=>s+r.opening,0)
                        const tRc = allRows.reduce((s,r)=>s+r.received,0)
                        const tS = allRows.reduce((s,r)=>s+r.sold,0)
                        const tW = allRows.reduce((s,r)=>s+r.writtenOff,0)
                        const tE = allRows.reduce((s,r)=>s+r.entered,0)
                        return (<>
                          <td style={{ ...tdQ, background: BG_OPEN, color: clr(tO,  '#555') }}>{Q(tO)}</td>
                          <td style={{ ...tdM, background: BG_OPEN, borderRight: '1px solid #d0dce8', color: clr(totOpeningVal, '#555') }}>{fmt(totOpeningVal)}</td>
                          <td style={{ ...tdQ, background: BG_RECV, color: clr(tRc, '#0369a1') }}>{Q(tRc)}</td>
                          <td style={{ ...tdM, background: BG_RECV, borderRight: '1px solid #d0dce8', color: clr(totReceivedVal, '#0369a1') }}>{fmt(totReceivedVal)}</td>
                          <td style={{ ...tdQ, background: BG_SOLD, color: clr(tS, '#2e7d32') }}>{Q(tS)}</td>
                          <td style={{ ...tdM, background: BG_SOLD, borderRight: '1px solid #d0dce8', color: clr(totSoldVal, '#2e7d32') }}>{fmt(totSoldVal)}</td>
                          <td style={{ ...tdQ, background: BG_WOFF, color: clr(tW, '#c00') }}>{Q(tW)}</td>
                          <td style={{ ...tdM, background: BG_WOFF, borderRight: '1px solid #d0dce8', color: clr(totWrittenOffVal, '#c00') }}>{fmt(totWrittenOffVal)}</td>
                          <td style={{ ...tdQ, background: BG_CLOS, color: clr(tE, '#7a5800') }}>{Q(tE)}</td>
                          <td style={{ ...tdM, background: BG_CLOS, color: clr(totClosingVal, '#7a5800') }}>{fmt(totClosingVal)}</td>
                        </>)
                      })()}
                    </tr>
                  </tfoot>
                </table>
                </div>
                )}{/* /else: opening */}
              </>
            )
          })()}
        </div>
        )}
      </div>
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

  useEffect(() => {
    loadRecs()
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

const shopTabsBarStyle: React.CSSProperties = {
  display: 'flex', gap: 0,
  borderBottom: '2px solid #d0dce8',
  marginBottom: '1.25rem',
}
const shopTabStyle: React.CSSProperties = {
  padding: '0.45rem 1.25rem', background: '#f0f4f8', color: '#666',
  border: '1px solid #d0dce8', borderBottom: '2px solid #d0dce8',
  marginBottom: '-2px', cursor: 'pointer', fontWeight: 400,
  fontSize: '0.88rem', borderRadius: '6px 6px 0 0',
}
const shopTabActiveStyle: React.CSSProperties = {
  ...shopTabStyle,
  background: '#fff', color: '#1a3a5c', fontWeight: 700,
  borderBottom: '2px solid #fff', borderColor: '#d0dce8',
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
const badgeOpening: React.CSSProperties = {
  display: 'inline-block', padding: '2px 8px', background: '#ede9fe', color: '#5b21b6',
  border: '1px solid #c4b5fd', borderRadius: '10px', fontSize: '0.72rem', fontWeight: 700,
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
