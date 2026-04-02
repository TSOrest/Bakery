/**
 * Мобільний дашборд для власника — read-only, оптимізований для телефону.
 * Показує фінансовий стан, замовлення, випічку і маржу за поточну дату.
 */

import { useEffect, useState, useCallback } from 'react'
import { api } from '../api/client'
import { useWorkDate } from '../context/DateContext'
import styles from './OwnerDashboard.module.css'

interface DashboardData {
  date: string
  finance: {
    total_debt:          number
    total_credit:        number
    net_balance:         number
    clients_in_debt:     number
    clients_with_credit: number
    payments_week:       number
    payments_month:      number
  }
  today: {
    revenue:        number
    payments_sum:   number
    payments_count: number
  }
  top_debtors: { client_id: number; client_name: string; balance: number }[]
  orders: {
    today_clients: number
    today_qty:     number
    week_count:    number
    week_qty:      number
    top_products:  { name: string; qty: number }[]
  }
  baking: {
    products:         number
    ordered:          number
    baked:            number
    fulfillment_pct:  number
  }
  margin: {
    avg_pct:        number
    products_count: number
    top: { name: string; cost: number; price: number; margin_grn: number; margin_pct: number }[]
  }
}

function fmt(n: number) {
  return n.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function Card({ title, children, accent }: {
  title: string
  children: React.ReactNode
  accent?: 'danger' | 'success' | 'warning'
}) {
  const borderColor = accent === 'danger' ? '#e74c3c' : accent === 'success' ? '#27ae60' : accent === 'warning' ? '#e67e22' : '#dde3ea'
  return (
    <div className={styles.card} style={{ borderLeft: `4px solid ${borderColor}` }}>
      <div className={styles.cardTitle}>{title}</div>
      {children}
    </div>
  )
}

function StatRow({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className={styles.statRow}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue} style={color ? { color } : undefined}>
        {value}
        {sub && <span className={styles.statSub}> {sub}</span>}
      </span>
    </div>
  )
}

export default function OwnerDashboard() {
  const { workDate } = useWorkDate()
  const today = workDate ?? new Date().toISOString().slice(0, 10)

  const [data, setData]       = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [lastUpdate, setLastUpdate] = useState('')

  const load = useCallback(async () => {
    try {
      const d = await api.get<DashboardData>(`/dashboard/?date_param=${today}`)
      setData(d)
      setLastUpdate(new Date().toLocaleTimeString('uk-UA'))
      setError('')
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [today])

  useEffect(() => {
    load()
    const id = setInterval(load, 5 * 60 * 1000)
    return () => clearInterval(id)
  }, [load])

  if (loading) return <div style={{ padding: '2rem', color: '#888' }}>Завантаження...</div>
  if (error)   return <div style={{ padding: '2rem', color: '#e74c3c' }}>{error}</div>
  if (!data)   return null

  const { finance, orders, baking, top_debtors, margin } = data
  const todayStats = data.today

  const netColor = finance.net_balance >= 0 ? '#27ae60' : '#e74c3c'
  const bakingOk = baking.fulfillment_pct >= 95

  return (
    <div className={styles.embedded}>
      {/* Панель оновлення */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: '0.82rem', color: '#6b7280' }}>
          {today !== new Date().toISOString().slice(0, 10)
            ? `Дані на ${today.split('-').reverse().join('.')}`
            : 'Поточний стан'}
        </span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {lastUpdate && <span style={{ fontSize: '0.78rem', color: '#aaa' }}>↻ {lastUpdate}</span>}
          <button onClick={load} style={{
            background: '#f1f5f9', border: '1px solid #d0d7de',
            borderRadius: 5, padding: '3px 10px', fontSize: '0.8rem',
            cursor: 'pointer', color: '#555',
          }}>Оновити</button>
        </div>
      </div>

      <div className={styles.grid}>

        {/* Сьогодні — виручка і оплати */}
        <Card
          title={`Сьогодні — ${today.split('-').reverse().join('.')}`}
          accent={todayStats.payments_sum > 0 ? 'success' : 'warning'}
        >
          <div className={styles.twoCol}>
            <div>
              <div className={styles.bigNumber} style={{ color: '#1a3a5c' }}>
                {fmt(todayStats.revenue)}
              </div>
              <div className={styles.bigLabel}>виставлено грн</div>
            </div>
            <div>
              <div className={styles.bigNumber} style={{ color: '#27ae60' }}>
                {fmt(todayStats.payments_sum)}
              </div>
              <div className={styles.bigLabel}>надійшло грн</div>
            </div>
          </div>
          <div className={styles.divider} />
          <StatRow label="Оплат отримано" value={String(todayStats.payments_count)} sub="шт" />
        </Card>

        {/* Фінанси — загальний стан */}
        <Card
          title="Фінансовий стан"
          accent={finance.net_balance < 0 ? 'danger' : 'success'}
        >
          <div className={styles.bigNumber} style={{ color: netColor }}>
            {finance.net_balance >= 0 ? '+' : ''}{fmt(finance.net_balance)} грн
          </div>
          <div className={styles.bigLabel}>нетто-баланс</div>
          <div className={styles.divider} />
          <StatRow label="Загальний борг клієнтів" value={`${fmt(finance.total_debt)} грн`}
            sub={`(${finance.clients_in_debt} кл.)`} color="#e74c3c" />
          <StatRow label="Аванси / переплата" value={`${fmt(finance.total_credit)} грн`}
            sub={`(${finance.clients_with_credit} кл.)`} color="#27ae60" />
          <div className={styles.divider} />
          <StatRow label="Надійшло за 7 днів"  value={`${fmt(finance.payments_week)} грн`} />
          <StatRow label="Надійшло за 30 днів" value={`${fmt(finance.payments_month)} грн`} />
        </Card>

        {/* Замовлення */}
        <Card title="Замовлення" accent={orders.today_clients > 0 ? 'success' : 'warning'}>
          <div className={styles.twoCol}>
            <div>
              <div className={styles.bigNumber} style={{ color: '#1a3a5c' }}>{orders.today_clients}</div>
              <div className={styles.bigLabel}>клієнтів сьогодні</div>
            </div>
            <div>
              <div className={styles.bigNumber} style={{ color: '#1a3a5c' }}>
                {orders.today_qty % 1 === 0 ? orders.today_qty.toFixed(0) : orders.today_qty.toFixed(1)}
              </div>
              <div className={styles.bigLabel}>одиниць сьогодні</div>
            </div>
          </div>
          <div className={styles.divider} />
          <StatRow label="Замовлень за 7 днів" value={String(orders.week_count)} />
          <StatRow label="Одиниць за 7 днів"  value={orders.week_qty.toFixed(0)} />
          {orders.top_products.length > 0 && (
            <>
              <div className={styles.divider} />
              <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#7a8899', marginBottom: 4 }}>Топ сьогодні</div>
              {orders.top_products.map(p => (
                <StatRow
                  key={p.name}
                  label={p.name}
                  value={p.qty % 1 === 0 ? p.qty.toFixed(0) : p.qty.toFixed(1)}
                  sub="шт"
                />
              ))}
            </>
          )}
        </Card>

        {/* Випічка */}
        <Card title="Випічка сьогодні" accent={baking.products === 0 ? 'warning' : bakingOk ? 'success' : 'danger'}>
          {baking.products === 0 ? (
            <div className={styles.emptyNote}>Завдання на випічку не створені</div>
          ) : (
            <>
              <div className={styles.twoCol}>
                <div>
                  <div className={styles.bigNumber} style={{ color: '#1a3a5c' }}>{baking.ordered.toFixed(0)}</div>
                  <div className={styles.bigLabel}>замовлено</div>
                </div>
                <div>
                  <div className={styles.bigNumber} style={{ color: bakingOk ? '#27ae60' : '#e67e22' }}>
                    {baking.baked.toFixed(0)}
                  </div>
                  <div className={styles.bigLabel}>спечено</div>
                </div>
              </div>
              <div className={styles.divider} />
              <StatRow label="Виконання плану" value={`${baking.fulfillment_pct}%`}
                color={bakingOk ? '#27ae60' : '#e67e22'} />
              <StatRow label="Найменувань" value={String(baking.products)} />
              <div className={styles.progressBar}>
                <div
                  className={styles.progressFill}
                  style={{
                    width: `${Math.min(baking.fulfillment_pct, 100)}%`,
                    background: bakingOk ? '#27ae60' : '#e67e22',
                  }}
                />
              </div>
            </>
          )}
        </Card>

        {/* Топ боржники */}
        <Card title="Топ боржники" accent={top_debtors.length > 0 ? 'danger' : 'success'}>
          {top_debtors.length === 0 ? (
            <div className={styles.emptyNote}>Боргів немає</div>
          ) : (
            <div className={styles.debtorList}>
              {top_debtors.map((d) => (
                <div key={d.client_id} className={styles.debtorRow}>
                  <span className={styles.debtorName}>{d.client_name}</span>
                  <span className={styles.debtorBalance}>−{fmt(Math.abs(d.balance))} грн</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Маржа */}
        <Card
          title="Маржинальність"
          accent={margin.avg_pct >= 20 ? 'success' : margin.avg_pct > 0 ? 'warning' : 'danger'}
        >
          {margin.products_count === 0 ? (
            <div className={styles.emptyNote}>Собівартість не задана</div>
          ) : (
            <>
              <div className={styles.bigNumber} style={{ color: margin.avg_pct >= 20 ? '#27ae60' : '#e67e22' }}>
                {margin.avg_pct.toFixed(1)}%
              </div>
              <div className={styles.bigLabel}>середня маржа ({margin.products_count} виробів)</div>
              <div className={styles.divider} />
              {margin.top.map((r) => (
                <StatRow
                  key={r.name}
                  label={r.name}
                  value={`${r.margin_pct.toFixed(1)}%`}
                  sub={`(+${fmt(r.margin_grn)} грн)`}
                  color={r.margin_pct >= 20 ? '#27ae60' : '#e67e22'}
                />
              ))}
            </>
          )}
        </Card>

      </div>
    </div>
  )
}
