import { useEffect, useState } from 'react'
import { useWorkDate } from '../context/DateContext'
import { api } from '../api/client'
import type { BakingTask, Product } from '../types'

export default function BakingPage() {
  const { workDate } = useWorkDate()
  const [tasks, setTasks] = useState<BakingTask[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)

  const load = () => {
    Promise.all([
      api.get<BakingTask[]>(`/baking/tasks?task_date=${workDate}`),
      api.get<Product[]>('/products/'),
    ]).then(([t, p]) => {
      setTasks(t)
      setProducts(p)
      setLoading(false)
    })
  }

  useEffect(() => { load() }, [workDate])

  const productName = (id: number) =>
    products.find((p) => p.id === id)?.name ?? `#${id}`

  const handleGenerate = async () => {
    await api.post(`/baking/tasks/generate?task_date=${workDate}`, {})
    load()
  }

  const handleBakedChange = async (task: BakingTask, baked_qty: number) => {
    const updated = await api.put<BakingTask>(`/baking/tasks/${task.id}`, { baked_qty })
    setTasks((prev) => prev.map((t) => (t.id === task.id ? updated : t)))
  }

  if (loading) return <p>Завантаження...</p>

  return (
    <div>
      <h2>Випічка — {workDate}</h2>
      <button onClick={handleGenerate} style={btnStyle}>
        Сформувати завдання із замовлень
      </button>

      {tasks.length === 0 ? (
        <p>Завдань немає. Натисніть кнопку вище.</p>
      ) : (
        <table style={{ marginTop: '1rem', borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr style={{ background: '#e8eef5' }}>
              <th style={thStyle}>Виріб</th>
              <th style={thStyle}>Замовлено</th>
              <th style={thStyle}>Рекомендовано</th>
              <th style={thStyle}>Фактично спечено</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => (
              <tr key={task.id}>
                <td style={tdStyle}>{productName(task.product_id)}</td>
                <td style={{ ...tdStyle, textAlign: 'center' }}>{task.ordered_qty}</td>
                <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 600 }}>
                  {task.recommended_qty}
                </td>
                <td style={{ ...tdStyle, textAlign: 'center' }}>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={task.baked_qty || ''}
                    placeholder="—"
                    style={{ width: '80px', textAlign: 'center' }}
                    onChange={(e) => handleBakedChange(task, Number(e.target.value))}
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

const btnStyle: React.CSSProperties = {
  padding: '0.5rem 1.2rem',
  background: '#1a3a5c',
  color: '#fff',
  border: 'none',
  borderRadius: '4px',
  cursor: 'pointer',
  fontSize: '0.95rem',
}

const thStyle: React.CSSProperties = {
  padding: '0.4rem 0.8rem',
  textAlign: 'left',
  fontWeight: 600,
}

const tdStyle: React.CSSProperties = {
  padding: '0.35rem 0.8rem',
  borderBottom: '1px solid #e0e0e0',
}
