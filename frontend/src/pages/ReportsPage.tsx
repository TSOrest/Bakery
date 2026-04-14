import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { useWorkDate } from '../context/DateContext'

function localDateISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function firstDayOfMonth(iso: string): string {
  return iso.slice(0, 7) + '-01'
}

interface ClientOption { id: number; name: string }

const BTN: React.CSSProperties = {
  padding: '8px 20px', background: '#1a3a5c', color: '#fff',
  border: 'none', borderRadius: 5, cursor: 'pointer',
  fontSize: '0.92rem', fontWeight: 600,
}
const CARD: React.CSSProperties = {
  background: '#fff', border: '1px solid #dde3ea',
  borderRadius: 8, padding: '20px 24px', marginBottom: 16,
}
const LABEL: React.CSSProperties = {
  fontSize: '0.88rem', color: '#555', whiteSpace: 'nowrap',
}
const INPUT: React.CSSProperties = {
  padding: '5px 8px', border: '1px solid #bcc6d4',
  borderRadius: 4, fontSize: '0.92rem',
}
const TODAY_BTN: React.CSSProperties = {
  padding: '5px 10px', background: 'none', border: '1px solid #bcc6d4',
  borderRadius: 4, cursor: 'pointer', fontSize: '0.85rem', color: '#555',
}
const DESC: React.CSSProperties = {
  fontSize: '0.83rem', color: '#666', margin: '0 0 16px',
}

export default function ReportsPage() {
  const { workDate } = useWorkDate()
  const today = localDateISO(new Date())

  // ── Денний звіт ────────────────────────────────────────────────────────────
  const [dailyDate, setDailyDate] = useState(workDate)

  // ── Боргова відомість ──────────────────────────────────────────────────────
  const [debtsDate, setDebtsDate] = useState(workDate)

  // ── Місячний звіт ──────────────────────────────────────────────────────────
  const [month, setMonth] = useState(() => today.slice(0, 7)) // YYYY-MM

  // ── Виписка клієнта ────────────────────────────────────────────────────────
  const [clients, setClients] = useState<ClientOption[]>([])
  const [clientId, setClientId] = useState<string>('')
  const [stmtFrom, setStmtFrom] = useState(() => firstDayOfMonth(today))
  const [stmtTo, setStmtTo] = useState(workDate)

  useEffect(() => {
    api.get<{ id: number; full_name: string; short_name?: string; client_kind: string }[]>('/clients/?active_only=false')
      .then(data => {
        const opts = (data || [])
          .filter(c => c.client_kind === 'customer')
          .map(c => ({
            id: c.id,
            name: c.short_name || c.full_name,
          }))
        setClients(opts)
        if (opts.length > 0 && !clientId) setClientId(String(opts[0].id))
      })
      .catch(() => {})
  }, [])

  const open = (url: string) => window.open(url, '_blank')

  return (
    <div style={{ padding: '24px', maxWidth: 560 }}>
      <h2 style={{ marginTop: 0, marginBottom: 20, fontSize: '1.1rem', fontWeight: 700 }}>
        Звіти
      </h2>

      {/* ── Денний звіт ──────────────────────────────────────────────────── */}
      <div style={CARD}>
        <div style={{ fontWeight: 600, marginBottom: 14, fontSize: '0.97rem' }}>
          Денний звіт пекарні
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <label style={LABEL}>Дата:</label>
          <input type="date" value={dailyDate}
            onChange={e => setDailyDate(e.target.value)} style={INPUT} />
          <button onClick={() => setDailyDate(today)} style={TODAY_BTN}>Сьогодні</button>
        </div>
        <p style={DESC}>
          Продукція (замовлено / спечено / обмін / магазин),
          агрегація по маршрутах та фінансовий підсумок дня.
        </p>
        <button style={BTN}
          onClick={() => open(`/api/v1/print/daily-report?date=${dailyDate}`)}>
          🖨 Відкрити PDF
        </button>
      </div>

      {/* ── Боргова відомість ─────────────────────────────────────────────── */}
      <div style={CARD}>
        <div style={{ fontWeight: 600, marginBottom: 14, fontSize: '0.97rem' }}>
          Боргова відомість
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <label style={LABEL}>Станом на:</label>
          <input type="date" value={debtsDate}
            onChange={e => setDebtsDate(e.target.value)} style={INPUT} />
          <button onClick={() => setDebtsDate(today)} style={TODAY_BTN}>Сьогодні</button>
        </div>
        <p style={DESC}>
          Стан розрахунків з усіма клієнтами: борги та переплати,
          згруповані по маршрутах.
        </p>
        <button style={BTN}
          onClick={() => open(`/api/v1/print/debts?date=${debtsDate}`)}>
          🖨 Відкрити PDF
        </button>
      </div>

      {/* ── Місячний звіт ─────────────────────────────────────────────────── */}
      <div style={CARD}>
        <div style={{ fontWeight: 600, marginBottom: 14, fontSize: '0.97rem' }}>
          Місячний звіт продажів
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <label style={LABEL}>Місяць:</label>
          <input type="month" value={month}
            onChange={e => setMonth(e.target.value)} style={INPUT} />
        </div>
        <p style={DESC}>
          Кількість і сума продажів по кожному виробу та маршруту.
          Топ-15 клієнтів за місяць.
        </p>
        <button style={BTN}
          onClick={() => {
            const [y, m] = month.split('-')
            open(`/api/v1/print/monthly-sales?year=${y}&month=${parseInt(m)}`)
          }}>
          🖨 Відкрити PDF
        </button>
      </div>

      {/* ── Виписка клієнта ───────────────────────────────────────────────── */}
      <div style={CARD}>
        <div style={{ fontWeight: 600, marginBottom: 14, fontSize: '0.97rem' }}>
          Виписка по клієнту
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <label style={{ ...LABEL, minWidth: 60 }}>Клієнт:</label>
            <select value={clientId} onChange={e => setClientId(e.target.value)}
              style={{ ...INPUT, flex: 1, maxWidth: 300 }}>
              {clients.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <label style={{ ...LABEL, minWidth: 60 }}>Період:</label>
            <input type="date" value={stmtFrom}
              onChange={e => setStmtFrom(e.target.value)} style={INPUT} />
            <span style={{ color: '#888' }}>—</span>
            <input type="date" value={stmtTo}
              onChange={e => setStmtTo(e.target.value)} style={INPUT} />
          </div>
        </div>
        <p style={DESC}>
          Хронологія всіх фінансових операцій клієнта за обраний
          період з рухом балансу та підсумком боргу / переплати.
        </p>
        <button style={BTN}
          onClick={() => {
            if (!clientId) return
            open(`/api/v1/print/client-statement?client_id=${clientId}&from_date=${stmtFrom}&to_date=${stmtTo}`)
          }}
          disabled={!clientId}>
          🖨 Відкрити PDF
        </button>
      </div>
    </div>
  )
}
