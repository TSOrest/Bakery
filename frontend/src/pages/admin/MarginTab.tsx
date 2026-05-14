import { useEffect, useState } from 'react'
import type { MarginRow, Product } from '../../types'
import { fetchMarginReport, recalculateAllCosts } from '../../api/ingredients'
import { editBtnStyle, tableStyle, Th, Td } from './shared'

export default function MarginTab({ products: _products }: { products: Product[] }) {
  const today = new Date().toISOString().slice(0, 10)
  const [date, setDate]         = useState(today)
  const [rows, setRows]         = useState<MarginRow[]>([])
  const [loading, setLoading]   = useState(false)
  const [recalcMsg, setRecalcMsg] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const data = await fetchMarginReport(date)
      setRows(data.rows)
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [date]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleRecalc = async () => {
    const res = await recalculateAllCosts()
    setRecalcMsg(`Перераховано: ${res.recalculated} виробів`)
    await load()
    setTimeout(() => setRecalcMsg(''), 3000)
  }

  const avgMarginPct = rows.length
    ? rows.filter(r => r.price > 0).reduce((s, r) => s + r.margin_pct, 0) / (rows.filter(r => r.price > 0).length || 1)
    : 0

  return (
    <section>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>Маржинальність виробів</h3>
        <input type="date" value={date} onChange={e => setDate(e.target.value)}
          style={{ padding: '4px 8px', border: '1px solid #ccc', borderRadius: 4 }} />
        <button onClick={handleRecalc} style={{ ...editBtnStyle, background: '#1a3a5c', color: '#fff', border: 'none' }}>
          ↺ Перерахувати собівартість
        </button>
        {recalcMsg && <span style={{ color: '#2e7d32', fontSize: 13 }}>{recalcMsg}</span>}
        {loading && <span style={{ color: '#888', fontSize: 13 }}>Завантаження...</span>}
      </div>

      {rows.length > 0 && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
          {[
            { label: 'Виробів',         value: String(rows.length),                                    color: '#1a3a5c' },
            { label: 'Без собівартості', value: String(rows.filter(r => r.cost_per_unit === 0).length), color: '#e67e22' },
            { label: 'Збиткових',       value: String(rows.filter(r => r.price > 0 && r.margin_grn < 0).length), color: '#c0392b' },
            { label: 'Середня маржа',   value: `${avgMarginPct.toFixed(1)}%`, color: avgMarginPct >= 20 ? '#2e7d32' : '#e67e22' },
          ].map(c => (
            <div key={c.label} style={{
              background: '#f8fafc', border: '1px solid #dde3ea', borderRadius: 8,
              padding: '10px 18px', minWidth: 120,
            }}>
              <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 1 }}>{c.label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: c.color }}>{c.value}</div>
            </div>
          ))}
        </div>
      )}

      <table style={tableStyle}>
        <thead>
          <tr style={{ background: '#e8eef5' }}>
            <Th>Виріб</Th>
            <Th>Собівартість, грн</Th>
            <Th>Ціна продажу, грн</Th>
            <Th>Маржа, грн</Th>
            <Th>Маржа, %</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const noPrice = r.price === 0
            const noCost  = r.cost_per_unit === 0
            const loss    = r.margin_grn < 0
            return (
              <tr key={r.product_id}>
                <Td>{r.product_name}</Td>
                <Td>{noCost ? <span style={{ color: '#e67e22' }}>не задана</span> : r.cost_per_unit.toFixed(4)}</Td>
                <Td>{noPrice ? <span style={{ color: '#e67e22' }}>не задана</span> : r.price.toFixed(2)}</Td>
                <Td>
                  <strong style={{ color: loss ? '#c0392b' : noPrice || noCost ? '#aaa' : '#2e7d32' }}>
                    {noPrice || noCost ? '—' : r.margin_grn.toFixed(4)}
                  </strong>
                </Td>
                <Td>
                  <strong style={{ color: loss ? '#c0392b' : noPrice || noCost ? '#aaa' : '#2e7d32' }}>
                    {noPrice || noCost ? '—' : `${r.margin_pct.toFixed(1)}%`}
                  </strong>
                </Td>
              </tr>
            )
          })}
          {rows.length === 0 && !loading && (
            <tr><td colSpan={5} style={{ textAlign: 'center', padding: '1rem', color: '#888' }}>Дані відсутні</td></tr>
          )}
        </tbody>
      </table>
    </section>
  )
}
