/**
 * Графічна аналітика для дашборду власника.
 *
 * 3 чарти на одній панелі:
 * - LineChart: щоденні виручка + оплати за 30 днів
 * - BarChart: топ-10 виробів за період (qty)
 * - PieChart: розподіл продажів по категоріях (сума)
 *
 * Дані з GET /dashboard/trends?days=30.
 */
import { useEffect, useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer,
  CartesianGrid, BarChart, Bar, PieChart, Pie, Cell,
} from 'recharts'
import { api } from '../api/client'

interface DailyPoint {
  date: string
  revenue: number
  payments: number
  orders_qty: number
}
interface TopProduct {
  name: string
  qty: number
  sum: number
}
interface CategoryRow {
  category: string
  qty: number
  sum: number
}
interface TrendsData {
  from: string
  to: string
  days: number
  daily: DailyPoint[]
  top_products: TopProduct[]
  by_category: CategoryRow[]
}

const PIE_COLORS = ['#1a3a5c', '#27ae60', '#e67e22', '#9b59b6', '#3498db', '#e74c3c', '#f39c12', '#1abc9c']

function fmtK(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return Math.round(n).toString()
}

function fmtMoney(n: number): string {
  return n.toLocaleString('uk-UA', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' ₴'
}

function fmtDateShort(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${d}.${m}`
}

const CARD: React.CSSProperties = {
  background: '#fff', border: '1px solid #dde3ea', borderRadius: 8,
  padding: '14px 16px',
}
const CARD_TITLE: React.CSSProperties = {
  fontSize: '0.85rem', fontWeight: 700, color: '#1a3a5c',
  textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10,
}

/**
 * BarChart: топ виробів за qty з динамічною шириною YAxis
 * (щоб довгі назви на кшталт "Хліб Стрийський особливий"
 * не переносились у два рядки).
 */
function TopProductsChart({ products }: { products: TopProduct[] }) {
  if (products.length === 0) {
    return (
      <div style={CARD}>
        <div style={CARD_TITLE}>📊 Топ-10 виробів (за кількістю)</div>
        <div style={{ color: '#888', fontSize: 13, padding: '40px 0', textAlign: 'center' }}>
          Дані відсутні
        </div>
      </div>
    )
  }
  // Динамічна ширина YAxis за найдовшою назвою (~6.5px на символ для fontSize=11)
  const maxLen = Math.max(...products.map(p => p.name.length))
  const yWidth = Math.min(260, Math.max(100, Math.ceil(maxLen * 6.5) + 8))
  return (
    <div style={CARD}>
      <div style={CARD_TITLE}>📊 Топ-10 виробів (за кількістю)</div>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={products} layout="vertical"
          margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eee" horizontal={false} />
          <XAxis type="number" tickFormatter={fmtK} tick={{ fontSize: 11, fill: '#888' }} />
          <YAxis type="category" dataKey="name"
            tick={{ fontSize: 11, fill: '#444' }} width={yWidth} interval={0} />
          <Tooltip
            formatter={(value, name) => {
              const n = Number(value)
              if (name === 'qty') return [fmtK(n) + ' шт', 'Кількість']
              return [fmtMoney(n), 'Сума']
            }}
            contentStyle={{ fontSize: 12, border: '1px solid #ccc', borderRadius: 4 }}
          />
          <Bar dataKey="qty" fill="#1a3a5c" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export default function DashboardCharts() {
  const [days, setDays]   = useState<7 | 14 | 30 | 90>(30)
  const [data, setData]   = useState<TrendsData | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    api.get<TrendsData>(`/dashboard/trends?days=${days}`)
      .then(d => { if (!cancelled) setData(d) })
      .catch(e => { if (!cancelled) setError(String(e)) })
    return () => { cancelled = true }
  }, [days])

  if (error) return <div style={{ ...CARD, color: '#e74c3c' }}>Помилка: {error}</div>
  if (!data) return <div style={{ ...CARD, color: '#888' }}>Завантаження аналітики...</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* ── Перемикач періоду ────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <span style={{ fontSize: '0.85rem', color: '#666', marginRight: 4 }}>Період:</span>
        {([7, 14, 30, 90] as const).map(d => (
          <button key={d}
            onClick={() => setDays(d)}
            style={{
              padding: '4px 12px', fontSize: '0.82rem',
              background: days === d ? '#1a3a5c' : '#fff',
              color:      days === d ? '#fff'    : '#555',
              border: '1px solid #c5d0dc', borderRadius: 6, cursor: 'pointer',
              fontWeight: days === d ? 600 : 400,
            }}>
            {d} днів
          </button>
        ))}
      </div>

      {/* ── 1. LineChart: виручка і оплати по днях ───────────────────────── */}
      <div style={CARD}>
        <div style={CARD_TITLE}>📈 Виручка і оплати по днях</div>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={data.daily} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
            <XAxis
              dataKey="date"
              tickFormatter={fmtDateShort}
              tick={{ fontSize: 11, fill: '#888' }}
              interval="preserveStartEnd"
            />
            <YAxis tickFormatter={fmtK} tick={{ fontSize: 11, fill: '#888' }} />
            <Tooltip
              labelFormatter={(label) => fmtDateShort(label as string)}
              formatter={(value) => fmtMoney(Number(value))}
              contentStyle={{ fontSize: 12, border: '1px solid #ccc', borderRadius: 4 }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line type="monotone" dataKey="revenue"  stroke="#1a3a5c" name="Виручка"  strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="payments" stroke="#27ae60" name="Оплати"   strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* ── Сітка з двох чартів ───────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14 }}>

        {/* 2. BarChart: топ-10 виробів за qty */}
        <TopProductsChart products={data.top_products} />

        {/* 3. PieChart: розподіл по категоріях */}
        <div style={CARD}>
          <div style={CARD_TITLE}>🥧 Виручка по категоріях</div>
          {data.by_category.length === 0 ? (
            <div style={{ color: '#888', fontSize: 13, padding: '40px 0', textAlign: 'center' }}>
              Дані відсутні
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie data={data.by_category} dataKey="sum" nameKey="category"
                  cx="50%" cy="45%" outerRadius={90}
                  label={(props: { category?: string; percent?: number }) =>
                    `${props.category ?? ''}: ${((props.percent ?? 0) * 100).toFixed(0)}%`
                  }
                  labelLine={false}>
                  {data.by_category.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => fmtMoney(Number(value))}
                  contentStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  )
}
