import { useState } from 'react'
import { useWorkDate } from '../context/DateContext'

function localDateISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function ReportsPage() {
  const { workDate } = useWorkDate()
  const [date, setDate] = useState(workDate)

  const openReport = () => {
    window.open(`/api/v1/print/daily-report?date=${date}`, '_blank')
  }

  return (
    <div style={{ padding: '24px', maxWidth: 480 }}>
      <h2 style={{ marginTop: 0, marginBottom: 20, fontSize: '1.1rem', fontWeight: 700 }}>
        Звіти
      </h2>

      <div style={{
        background: '#fff', border: '1px solid #dde3ea', borderRadius: 8,
        padding: '20px 24px',
      }}>
        <div style={{ fontWeight: 600, marginBottom: 14, fontSize: '0.97rem' }}>
          Денний звіт пекарні
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <label style={{ fontSize: '0.88rem', color: '#555', whiteSpace: 'nowrap' }}>
            Дата звіту:
          </label>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            style={{
              padding: '5px 8px', border: '1px solid #bcc6d4',
              borderRadius: 4, fontSize: '0.92rem',
            }}
          />
          <button
            onClick={() => setDate(localDateISO(new Date()))}
            style={{
              padding: '5px 10px', background: 'none', border: '1px solid #bcc6d4',
              borderRadius: 4, cursor: 'pointer', fontSize: '0.85rem', color: '#555',
            }}
          >
            Сьогодні
          </button>
        </div>
        <p style={{ fontSize: '0.83rem', color: '#666', margin: '0 0 16px' }}>
          Включає: продукцію (замовлено / спечено / обмін / магазин),
          агрегацію по маршрутах та фінансовий підсумок дня.
        </p>
        <button
          onClick={openReport}
          style={{
            padding: '8px 20px', background: '#1a3a5c', color: '#fff',
            border: 'none', borderRadius: 5, cursor: 'pointer',
            fontSize: '0.92rem', fontWeight: 600,
          }}
        >
          🖨 Відкрити PDF
        </button>
      </div>
    </div>
  )
}
