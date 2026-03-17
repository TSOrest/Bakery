import { useEffect, useState, type FormEvent } from 'react'
import { api } from '../api/client'
import { useWorkDate } from '../context/DateContext'
import type { Product } from '../types'

// ─── Типи ────────────────────────────────────────────────────────────────────

interface ShopCount {
  id: number
  count_date: string
  product_id: number
  product_type: string
  yesterday_balance: number
  received_today: number
  entered_balance: number | null
  written_off_entered: number
  calculated_sold: number | null
  price: number | null
  saved: number
}

interface OtherProduct {
  id: number
  name: string
  unit_id: number | null
  purchase_price: number
  sell_price: number
  is_active: number
}

interface OtherStockIn {
  id: number
  stock_date: string
  other_product_id: number
  qty: number
  purchase_price: number | null
  notes: string | null
}

type Tab = 'bread' | 'other'

// ─── Головний компонент ───────────────────────────────────────────────────────

export default function ShopPage() {
  const { workDate } = useWorkDate()
  const [tab, setTab] = useState<Tab>('bread')

  return (
    <div>
      <h2>Магазин</h2>

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem' }}>
        {([['bread', 'Свіжий хліб'], ['other', 'Товари ІНШЕ']] as [Tab, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              padding: '0.4rem 1.1rem',
              borderRadius: '4px',
              border: '1px solid #ccc',
              background: tab === key ? '#1a3a5c' : '#fff',
              color: tab === key ? '#fff' : '#333',
              cursor: 'pointer',
              fontWeight: tab === key ? 600 : 400,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'bread' && <BreadTab workDate={workDate} />}
      {tab === 'other' && <OtherTab workDate={workDate} />}
    </div>
  )
}

// ─── Вкладка Свіжий хліб ─────────────────────────────────────────────────────

function BreadTab({ workDate }: { workDate: string }) {
  const [counts, setCounts]   = useState<ShopCount[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving]   = useState<Record<number, boolean>>({})
  const [confirmed, setConfirmed] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const [c, p] = await Promise.all([
        api.get<ShopCount[]>(`/shop/counts?count_date=${workDate}`),
        api.get<Product[]>('/products/?active_only=true'),
      ])
      setCounts(c)
      setProducts(p)
      setConfirmed(c.length > 0 && c.every((r) => r.saved === 1))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [workDate])

  const handleInit = async () => {
    setLoading(true)
    try {
      const c = await api.post<ShopCount[]>(`/shop/counts/init`, null, `count_date=${workDate}`)
      setCounts(c)
    } finally {
      setLoading(false)
    }
  }

  const handleUpdate = async (
    count: ShopCount,
    field: 'entered_balance' | 'written_off_entered' | 'price',
    value: string,
  ) => {
    const num = value === '' ? null : Number(value)
    setSaving((s) => ({ ...s, [count.id]: true }))
    try {
      const updated = await api.put<ShopCount>(`/shop/counts/${count.id}`, { [field]: num })
      setCounts((prev) => prev.map((c) => c.id === updated.id ? updated : c))
    } finally {
      setSaving((s) => ({ ...s, [count.id]: false }))
    }
  }

  const handleConfirm = async () => {
    if (!confirm(`Підтвердити звірку за ${workDate}? Після підтвердження редагування буде заблоковано.`)) return
    await api.post(`/shop/counts/confirm`, null, `count_date=${workDate}`)
    load()
  }

  const productName = (id: number) => products.find((p) => p.id === id)?.name ?? `#${id}`

  const totalSold = counts.reduce((s, c) => s + (c.calculated_sold ?? 0) * (c.price ?? 0), 0)

  if (loading) return <p>Завантаження...</p>

  return (
    <section>
      {counts.length === 0 ? (
        <div style={{ padding: '2rem 0' }}>
          <p style={{ color: '#666', marginBottom: '1rem' }}>
            Звірку за <strong>{workDate}</strong> ще не розпочато.
          </p>
          <button onClick={handleInit} style={primaryBtn}>
            Ініціалізувати звірку
          </button>
        </div>
      ) : (
        <>
          {confirmed && (
            <div style={{ background: '#e8f5e9', border: '1px solid #a5d6a7', borderRadius: '6px', padding: '0.6rem 1rem', marginBottom: '1rem', color: '#2e7d32' }}>
              ✓ Звірку підтверджено
            </div>
          )}

          <table style={tableStyle}>
            <thead>
              <tr style={{ background: '#e8eef5' }}>
                <Th>Виріб</Th>
                <Th right>Залишок вчора</Th>
                <Th right>Надійшло</Th>
                <Th right>Доступно</Th>
                <Th right>Списано</Th>
                <Th right>Фактичний залишок</Th>
                <Th right>Продано</Th>
                <Th right>Ціна, грн</Th>
                <Th right>Сума</Th>
              </tr>
            </thead>
            <tbody>
              {counts.map((c) => {
                const available = c.yesterday_balance + c.received_today
                const sum = (c.calculated_sold ?? 0) * (c.price ?? 0)
                return (
                  <tr key={c.id} style={{ opacity: saving[c.id] ? 0.6 : 1 }}>
                    <Td>{productName(c.product_id)}</Td>
                    <Td right>{c.yesterday_balance}</Td>
                    <Td right>{c.received_today}</Td>
                    <Td right><strong>{available}</strong></Td>
                    <Td right>
                      <NumInput
                        value={c.written_off_entered}
                        disabled={!!c.saved}
                        onBlur={(v) => handleUpdate(c, 'written_off_entered', v)}
                      />
                    </Td>
                    <Td right>
                      <NumInput
                        value={c.entered_balance ?? ''}
                        disabled={!!c.saved}
                        placeholder="введіть"
                        onBlur={(v) => handleUpdate(c, 'entered_balance', v)}
                      />
                    </Td>
                    <Td right>
                      <strong style={{ color: c.calculated_sold !== null ? '#1a3a5c' : '#aaa' }}>
                        {c.calculated_sold !== null ? c.calculated_sold : '—'}
                      </strong>
                    </Td>
                    <Td right>
                      <NumInput
                        value={c.price ?? ''}
                        disabled={!!c.saved}
                        placeholder="0.00"
                        onBlur={(v) => handleUpdate(c, 'price', v)}
                      />
                    </Td>
                    <Td right>{sum > 0 ? sum.toFixed(2) : '—'}</Td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr style={{ background: '#f5f8fb', fontWeight: 600 }}>
                <td colSpan={8} style={tdStyle}>Разом продажів магазину:</td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>{totalSold.toFixed(2)} грн</td>
              </tr>
            </tfoot>
          </table>

          {!confirmed && (
            <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={handleConfirm} style={primaryBtn}>
                Підтвердити звірку
              </button>
            </div>
          )}
        </>
      )}
    </section>
  )
}

// ─── Вкладка Товари ІНШЕ ─────────────────────────────────────────────────────

function OtherTab({ workDate }: { workDate: string }) {
  const [otherProducts, setOtherProducts] = useState<OtherProduct[]>([])
  const [stockIns, setStockIns]           = useState<OtherStockIn[]>([])
  const [form, setForm] = useState({ other_product_id: '', qty: '', purchase_price: '', notes: '' })
  const [saving, setSaving] = useState(false)

  const load = async () => {
    const [op, si] = await Promise.all([
      api.get<OtherProduct[]>('/shop/other-products'),
      api.get<OtherStockIn[]>(`/shop/stock-in?stock_date=${workDate}`),
    ])
    setOtherProducts(op)
    setStockIns(si)
  }

  useEffect(() => { load() }, [workDate])

  const productName = (id: number) => otherProducts.find((p) => p.id === id)?.name ?? `#${id}`

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault()
    if (!form.other_product_id || !form.qty) return
    setSaving(true)
    try {
      await api.post(`/shop/stock-in`, {
        other_product_id: Number(form.other_product_id),
        qty: Number(form.qty),
        purchase_price: form.purchase_price ? Number(form.purchase_price) : null,
        notes: form.notes || null,
      }, `stock_date=${workDate}`)
      setForm({ other_product_id: '', qty: '', purchase_price: '', notes: '' })
      load()
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: number) => {
    await api.delete(`/shop/stock-in/${id}`)
    load()
  }

  const total = stockIns.reduce((s, si) => {
    const price = si.purchase_price ?? otherProducts.find((p) => p.id === si.other_product_id)?.purchase_price ?? 0
    return s + si.qty * price
  }, 0)

  return (
    <section>
      {/* Форма додавання надходження */}
      <form onSubmit={handleAdd} style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={fieldGroup}>
          <label style={labelStyle}>Товар</label>
          <select
            required
            value={form.other_product_id}
            onChange={(e) => setForm({ ...form, other_product_id: e.target.value })}
            style={selectStyle}
          >
            <option value="">— оберіть —</option>
            {otherProducts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div style={fieldGroup}>
          <label style={labelStyle}>Кількість</label>
          <input
            required type="number" min="0" step="0.001"
            value={form.qty}
            onChange={(e) => setForm({ ...form, qty: e.target.value })}
            style={{ ...inputStyle, width: '90px' }}
            placeholder="0"
          />
        </div>
        <div style={fieldGroup}>
          <label style={labelStyle}>Ціна закупки</label>
          <input
            type="number" min="0" step="0.01"
            value={form.purchase_price}
            onChange={(e) => setForm({ ...form, purchase_price: e.target.value })}
            style={{ ...inputStyle, width: '100px' }}
            placeholder="0.00"
          />
        </div>
        <div style={fieldGroup}>
          <label style={labelStyle}>Примітка</label>
          <input
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            style={{ ...inputStyle, width: '160px' }}
          />
        </div>
        <button type="submit" disabled={saving} style={primaryBtn}>+ Додати</button>
      </form>

      {stockIns.length === 0 ? (
        <p style={{ color: '#888' }}>Надходжень за {workDate} не зафіксовано</p>
      ) : (
        <table style={tableStyle}>
          <thead>
            <tr style={{ background: '#e8eef5' }}>
              <Th>Товар</Th>
              <Th right>Кількість</Th>
              <Th right>Ціна закупки</Th>
              <Th right>Сума</Th>
              <Th>Примітка</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {stockIns.map((si) => {
              const price = si.purchase_price ?? otherProducts.find((p) => p.id === si.other_product_id)?.purchase_price ?? 0
              return (
                <tr key={si.id}>
                  <Td>{productName(si.other_product_id)}</Td>
                  <Td right>{si.qty}</Td>
                  <Td right>{price.toFixed(2)}</Td>
                  <Td right>{(si.qty * price).toFixed(2)}</Td>
                  <Td>{si.notes ?? '—'}</Td>
                  <Td>
                    <button onClick={() => handleDelete(si.id)} style={delBtn}>✕</button>
                  </Td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr style={{ background: '#f5f8fb', fontWeight: 600 }}>
              <td colSpan={3} style={tdStyle}>Разом:</td>
              <td style={{ ...tdStyle, textAlign: 'right' }}>{total.toFixed(2)} грн</td>
              <td colSpan={2} style={tdStyle}></td>
            </tr>
          </tfoot>
        </table>
      )}

      {otherProducts.length === 0 && (
        <p style={{ color: '#aaa', marginTop: '1rem', fontSize: '0.875rem' }}>
          Немає товарів групи ІНШЕ. Додайте їх у Довідниках.
        </p>
      )}
    </section>
  )
}

// ─── Допоміжні компоненти ────────────────────────────────────────────────────

function NumInput({
  value, disabled, placeholder, onBlur,
}: {
  value: number | string
  disabled?: boolean
  placeholder?: string
  onBlur: (v: string) => void
}) {
  const [local, setLocal] = useState(value.toString())
  useEffect(() => setLocal(value.toString()), [value])

  return (
    <input
      type="number"
      min="0"
      step="0.001"
      value={local}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => onBlur(local)}
      style={{
        width: '80px',
        padding: '0.2rem 0.4rem',
        border: '1px solid #ccc',
        borderRadius: '3px',
        fontSize: '0.875rem',
        textAlign: 'right',
        background: disabled ? '#f5f5f5' : '#fff',
      }}
    />
  )
}

const Th = ({ children, right }: { children?: React.ReactNode; right?: boolean }) => (
  <th style={{ padding: '0.45rem 0.8rem', textAlign: right ? 'right' : 'left', fontWeight: 600, fontSize: '0.875rem' }}>
    {children}
  </th>
)
const tdStyle: React.CSSProperties = { padding: '0.4rem 0.8rem', borderBottom: '1px solid #f0f0f0', fontSize: '0.9rem' }
const Td = ({ children, right }: { children?: React.ReactNode; right?: boolean }) => (
  <td style={{ ...tdStyle, textAlign: right ? 'right' : 'left' }}>{children}</td>
)

const tableStyle: React.CSSProperties = {
  width: '100%', borderCollapse: 'collapse', background: '#fff',
  borderRadius: '6px', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
}
const primaryBtn: React.CSSProperties = {
  padding: '0.4rem 1.1rem', background: '#1a3a5c', color: '#fff',
  border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.9rem',
}
const delBtn: React.CSSProperties = {
  padding: '0.1rem 0.5rem', background: '#fff0f0', border: '1px solid #f5b8b8',
  borderRadius: '3px', cursor: 'pointer', color: '#c00', fontSize: '0.8rem',
}
const fieldGroup: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.2rem' }
const labelStyle: React.CSSProperties = { fontSize: '0.8rem', color: '#555' }
const inputStyle: React.CSSProperties = { padding: '0.35rem 0.5rem', border: '1px solid #ccc', borderRadius: '4px', fontSize: '0.9rem' }
const selectStyle: React.CSSProperties = { ...inputStyle, minWidth: '160px' }
