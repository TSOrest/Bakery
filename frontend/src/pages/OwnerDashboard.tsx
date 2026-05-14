/**
 * Дашборд власника.
 * Верхній рядок — накопичувальні KPI (фінансовий стан, боржники).
 * Нижня секція — календар (ліворуч) + деталі обраного дня (праворуч).
 * За замовчуванням обраний день = робоча дата; клік по клітинці змінює деталі.
 */

import { useEffect, useState, useCallback } from 'react'
import { api } from '../api/client'
import { useWorkDate } from '../context/DateContext'
import DashboardCharts from './DashboardCharts'
import styles from './OwnerDashboard.module.css'

// ── Інтерфейси ────────────────────────────────────────────────────────────────

interface CalDay {
  clients?:      number
  invoices_sum?: number
  payments_sum?: number
}
interface CalData {
  year:  number
  month: number
  days:  Record<string, CalDay>
}
interface ShopSummary {
  available: boolean
  shop_count?: number
  turnover?: number
  cash_to_bakery?: number
  shop_balance?: number
  pos_sales?: number
  stock_value?: number
  stock_date?: string
}

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
    products:        number
    ordered:         number
    baked:           number
    fulfillment_pct: number
  }
  margin: {
    avg_pct:        number
    products_count: number
    top: { name: string; cost: number; price: number; margin_grn: number; margin_pct: number }[]
  }
}

// ── Утиліти ───────────────────────────────────────────────────────────────────

const MONTH_NAMES = ['Січень','Лютий','Березень','Квітень','Травень','Червень',
                     'Липень','Серпень','Вересень','Жовтень','Листопад','Грудень']
const DAY_HEADS   = ['Пн','Вт','Ср','Чт','Пт','Сб','Нд']

function fmt(n: number)  { return n.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
function fmtK(n: number) { return Math.round(n).toLocaleString('uk-UA') }
function fmtDate(iso: string) { return iso.split('-').reverse().join('.') }

// ── Базові UI-компоненти ──────────────────────────────────────────────────────

function Card({ title, children, accent }: {
  title: string; children: React.ReactNode; accent?: 'danger' | 'success' | 'warning'
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
        {value}{sub && <span className={styles.statSub}> {sub}</span>}
      </span>
    </div>
  )
}

// ── Календар ──────────────────────────────────────────────────────────────────

function CalendarView({ selectedDay, onSelectDay }: {
  selectedDay: string
  onSelectDay: (iso: string) => void
}) {
  const systemToday = new Date()
  const [calYear,  setCalYear]  = useState(systemToday.getFullYear())
  const [calMonth, setCalMonth] = useState(systemToday.getMonth() + 1)
  const [calData,  setCalData]  = useState<CalData | null>(null)
  const [calLoad,  setCalLoad]  = useState(false)

  useEffect(() => {
    let cancelled = false
    setCalLoad(true)
    api.get<CalData>(`/dashboard/calendar/?year=${calYear}&month=${calMonth}`)
      .then(data => { if (!cancelled) setCalData(data) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setCalLoad(false) })
    return () => { cancelled = true }
  }, [calYear, calMonth])

  function prevMonth() {
    if (calMonth === 1) { setCalYear(y => y - 1); setCalMonth(12) }
    else setCalMonth(m => m - 1)
  }
  function nextMonth() {
    if (calMonth === 12) { setCalYear(y => y + 1); setCalMonth(1) }
    else setCalMonth(m => m + 1)
  }
  function goToday() {
    const t = new Date()
    setCalYear(t.getFullYear())
    setCalMonth(t.getMonth() + 1)
    onSelectDay(t.toISOString().slice(0, 10))
  }

  const todayISO    = systemToday.toISOString().slice(0, 10)
  const daysInMonth = new Date(calYear, calMonth, 0).getDate()
  const firstDow    = (new Date(calYear, calMonth - 1, 1).getDay() + 6) % 7
  const cells: (number | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  return (
    <div className={styles.calCard} style={{ marginBottom: 0 }}>
      <div className={styles.calHeader}>
        <button className={styles.calNavBtn} onClick={prevMonth}>‹</button>
        <div className={styles.calTitle}>
          {MONTH_NAMES[calMonth - 1]} {calYear}
          {calLoad && <span className={styles.calLoading}>↻</span>}
        </div>
        <button className={styles.calNavBtn} onClick={nextMonth}>›</button>
        <button className={styles.calTodayBtn} onClick={goToday}>Сьогодні</button>
      </div>

      <div className={styles.calGrid}>
        {DAY_HEADS.map(d => (
          <div key={d} className={`${styles.calDayHead} ${d === 'Сб' || d === 'Нд' ? styles.calWeekend : ''}`}>
            {d}
          </div>
        ))}

        {cells.map((day, i) => {
          if (!day) return <div key={`e${i}`} className={styles.calDayEmpty} />
          const iso      = `${calYear}-${String(calMonth).padStart(2,'0')}-${String(day).padStart(2,'0')}`
          const d        = calData?.days[iso]
          const isToday  = iso === todayISO
          const isSelected = iso === selectedDay
          const hasData  = d && (d.clients || d.invoices_sum || d.payments_sum)
          const hasPay   = (d?.payments_sum ?? 0) > 0
          return (
            <div
              key={iso}
              onClick={() => onSelectDay(iso)}
              className={[
                styles.calDayCell,
                isToday    ? styles.calToday    : '',
                isSelected ? styles.calSelected : '',
                hasData    ? styles.calActive   : '',
                hasPay     ? styles.calHasPay   : '',
              ].join(' ')}
              style={{ cursor: 'pointer' }}
            >
              <div className={isToday ? styles.calNumToday : styles.calNum}>{day}</div>
              {(d?.clients ?? 0) > 0 && (
                <div className={styles.calClients}>{d!.clients} кл.</div>
              )}
              {(d?.invoices_sum ?? 0) > 0 && (
                <div className={styles.calInv}>₴&nbsp;{fmtK(d!.invoices_sum!)}</div>
              )}
              {(d?.payments_sum ?? 0) > 0 && (
                <div className={styles.calPay}>+{fmtK(d!.payments_sum!)}</div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Деталі обраного дня ───────────────────────────────────────────────────────

function DayDetailPanel({ date }: { date: string }) {
  const [dayData,  setDayData]  = useState<DashboardData | null>(null)
  const [shopData, setShopData] = useState<ShopSummary | null>(null)
  const [loading,  setLoading]  = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.allSettled([
      api.get<DashboardData>(`/dashboard/?date_param=${date}`),
      api.get<ShopSummary>(`/dashboard/shop-summary/?date=${date}`),
    ])
      .then(([dRes, sRes]) => {
        if (!cancelled) {
          if (dRes.status === 'fulfilled') setDayData(dRes.value)
          if (sRes.status === 'fulfilled') setShopData(sRes.value)
        }
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [date])

  const label = fmtDate(date)

  if (loading) return (
    <div style={{ padding: '1.5rem', color: '#9aabb8', fontSize: '0.88rem', textAlign: 'center' }}>
      Завантаження...
    </div>
  )
  if (!dayData) return null

  const { today: t, orders, baking } = dayData
  const bakingOk = baking.fulfillment_pct >= 95
  const isEmpty  = t.revenue === 0 && t.payments_sum === 0 && orders.today_clients === 0 && baking.products === 0

  return (
    <div>

      {/* Заголовок */}
      <div style={{
        fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase',
        letterSpacing: '0.08em', color: '#7a8899', marginBottom: 10,
      }}>
        Деталі — {label}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

        {/* Якщо немає торгових даних — коротка заглушка */}
        {isEmpty && (
          <div style={{
            background: '#fff', border: '1px solid #dde3ea', borderRadius: 10,
            padding: '1.2rem 1rem', textAlign: 'center', color: '#9aabb8', fontSize: '0.88rem',
          }}>
            Даних за цей день немає
          </div>
        )}

        {!isEmpty && (
          <>
          {/* Виручка і оплати */}
          <Card
            title={`Виручка і оплати — ${label}`}
            accent={t.payments_sum > 0 ? 'success' : t.revenue > 0 ? 'warning' : undefined}
          >
            <div className={styles.twoCol}>
              <div>
                <div className={styles.bigNumber} style={{ color: '#1a3a5c', fontSize: '1.5rem' }}>
                  {fmt(t.revenue)}
                </div>
                <div className={styles.bigLabel}>виставлено грн</div>
              </div>
              <div>
                <div className={styles.bigNumber} style={{ color: '#27ae60', fontSize: '1.5rem' }}>
                  {fmt(t.payments_sum)}
                </div>
                <div className={styles.bigLabel}>надійшло грн</div>
              </div>
            </div>
            {t.payments_count > 0 && (
              <>
                <div className={styles.divider} />
                <StatRow label="Оплат отримано" value={String(t.payments_count)} sub="шт" />
              </>
            )}
          </Card>

          {/* Замовлення */}
          {(orders.today_clients > 0 || orders.today_qty > 0) && (
            <Card title="Замовлення" accent={orders.today_clients > 0 ? 'success' : 'warning'}>
              <div className={styles.twoCol}>
                <div>
                  <div className={styles.bigNumber} style={{ color: '#1a3a5c', fontSize: '1.5rem' }}>
                    {orders.today_clients}
                  </div>
                  <div className={styles.bigLabel}>клієнтів</div>
                </div>
                <div>
                  <div className={styles.bigNumber} style={{ color: '#1a3a5c', fontSize: '1.5rem' }}>
                    {orders.today_qty % 1 === 0 ? orders.today_qty.toFixed(0) : orders.today_qty.toFixed(1)}
                  </div>
                  <div className={styles.bigLabel}>одиниць</div>
                </div>
              </div>
            </Card>
          )}

          {/* Випічка */}
          {baking.products > 0 && (
            <Card title="Випічка" accent={bakingOk ? 'success' : 'danger'}>
              <div className={styles.twoCol}>
                <div>
                  <div className={styles.bigNumber} style={{ color: '#1a3a5c', fontSize: '1.5rem' }}>
                    {baking.ordered.toFixed(0)}
                  </div>
                  <div className={styles.bigLabel}>замовлено</div>
                </div>
                <div>
                  <div className={styles.bigNumber} style={{ color: bakingOk ? '#27ae60' : '#e67e22', fontSize: '1.5rem' }}>
                    {baking.baked.toFixed(0)}
                  </div>
                  <div className={styles.bigLabel}>спечено</div>
                </div>
              </div>
              <div className={styles.divider} />
              <StatRow
                label="Виконання плану"
                value={`${baking.fulfillment_pct}%`}
                color={bakingOk ? '#27ae60' : '#e67e22'}
              />
              <div className={styles.progressBar}>
                <div
                  className={styles.progressFill}
                  style={{
                    width: `${Math.min(baking.fulfillment_pct, 100)}%`,
                    background: bakingOk ? '#27ae60' : '#e67e22',
                  }}
                />
              </div>
            </Card>
          )}

          </>
        )}

        {/* Магазин — завжди показуємо; нулі якщо даних за день немає */}
        {shopData !== null && (
          <Card title="Магазин" accent={
            (shopData.cash_to_bakery ?? 0) > 0 ? 'success'
            : (shopData.turnover ?? 0) > 0    ? 'warning'
            : undefined
          }>
            {/* Оборот і передано в касу */}
            <div className={styles.twoCol}>
              <div>
                <div className={styles.bigNumber} style={{ color: '#1a3a5c', fontSize: '1.4rem' }}>
                  {fmt(shopData.turnover ?? 0)}
                </div>
                <div className={styles.bigLabel}>оборот грн</div>
              </div>
              <div>
                <div className={styles.bigNumber} style={{ color: '#27ae60', fontSize: '1.4rem' }}>
                  {fmt(shopData.cash_to_bakery ?? 0)}
                </div>
                <div className={styles.bigLabel}>передано в касу</div>
              </div>
            </div>

            <div className={styles.divider} />

            {/* Залишок в касі магазину (накопичений баланс) */}
            <StatRow
              label="Залишок в касі магазину"
              value={`${fmt(Math.abs(shopData.shop_balance ?? 0))} грн`}
              color={(shopData.shop_balance ?? 0) < 0 ? '#e74c3c' : '#27ae60'}
            />
            {(shopData.shop_balance ?? 0) < 0 && (
              <div style={{ fontSize: '0.72rem', color: '#e74c3c', marginTop: 1 }}>
                борг перед пекарнею
              </div>
            )}

            {/* POS-продажі (якщо є) */}
            {(shopData.pos_sales ?? 0) > 0 && (
              <StatRow
                label="POS-продажі"
                value={`${fmt(shopData.pos_sales!)} грн`}
              />
            )}

            {/* Залишок у товарі */}
            <div className={styles.divider} />
            <StatRow
              label={`Залишок у товарі${shopData.stock_date ? ` (на ${fmtDate(shopData.stock_date)})` : ''}`}
              value={`${fmt(shopData.stock_value ?? 0)} грн`}
              color={(shopData.stock_value ?? 0) > 0 ? '#7a5c1e' : '#9aabb8'}
            />
          </Card>
        )}

      </div>
    </div>
  )
}

// ── Головний компонент ────────────────────────────────────────────────────────

export default function OwnerDashboard() {
  const { workDate } = useWorkDate()
  const today = workDate ?? new Date().toISOString().slice(0, 10)

  const [data,       setData]       = useState<DashboardData | null>(null)
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState('')
  const [lastUpdate, setLastUpdate] = useState('')
  const [selectedDay, setSelectedDay] = useState(today)

  // Синхронізація обраного дня з робочою датою
  useEffect(() => { setSelectedDay(today) }, [today])

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

  const { finance, top_debtors } = data
  const netColor = finance.net_balance >= 0 ? '#27ae60' : '#e74c3c'

  return (
    <div className={styles.embedded}>

      {/* Рядок оновлення */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: '0.82rem', color: '#6b7280' }}>
          {today !== new Date().toISOString().slice(0, 10)
            ? `Дані на ${fmtDate(today)}`
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

      {/* ── KPI + Календар + Деталі (єдина 4-колонкова сітка) ─────────── */}
      <div className={styles.grid}>

        <Card title="Фінансовий стан" accent={finance.net_balance < 0 ? 'danger' : 'success'}>
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

        <Card title="Топ боржники" accent={top_debtors.length > 0 ? 'danger' : 'success'}>
          {top_debtors.length === 0 ? (
            <div className={styles.emptyNote}>Боргів немає</div>
          ) : (
            <div className={styles.debtorList}>
              {top_debtors.map(d => (
                <div key={d.client_id} className={styles.debtorRow}>
                  <span className={styles.debtorName}>{d.client_name}</span>
                  <span className={styles.debtorBalance}>−{fmt(Math.abs(d.balance))} грн</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Замовлення (7 днів) */}
        <Card title="Замовлення (7 днів)" accent={data.orders.week_count > 0 ? 'success' : undefined}>
          <div className={styles.twoCol}>
            <div>
              <div className={styles.bigNumber} style={{ color: '#1a3a5c' }}>
                {data.orders.week_count}
              </div>
              <div className={styles.bigLabel}>накладних</div>
            </div>
            <div>
              <div className={styles.bigNumber} style={{ color: '#1a3a5c' }}>
                {fmtK(data.orders.week_qty)}
              </div>
              <div className={styles.bigLabel}>одиниць</div>
            </div>
          </div>
          {data.orders.top_products.length > 0 && (
            <>
              <div className={styles.divider} />
              <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#7a8899', marginBottom: 4 }}>
                Топ за день
              </div>
              {data.orders.top_products.slice(0, 4).map(p => (
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

        {/* Надходження */}
        <Card title="Надходження" accent={finance.payments_month > 0 ? 'success' : undefined}>
          <div className={styles.bigNumber} style={{ color: '#27ae60' }}>
            {fmt(finance.payments_week)} грн
          </div>
          <div className={styles.bigLabel}>за 7 днів</div>
          <div className={styles.divider} />
          <StatRow label="За 30 днів" value={`${fmt(finance.payments_month)} грн`} />
          <StatRow
            label="Середнє / день"
            value={`${fmt(finance.payments_month / 30)} грн`}
            color="#27ae60"
          />
        </Card>

        {/* Календар — span 2 колонки = 2 KPI wide */}
        <div style={{ gridColumn: 'span 2' }}>
          <CalendarView selectedDay={selectedDay} onSelectDay={setSelectedDay} />
        </div>

        {/* Деталі обраного дня — span 2 колонки = 2 KPI wide, праворуч */}
        <div style={{ gridColumn: 'span 2' }}>
          <DayDetailPanel date={selectedDay} />
        </div>

      </div>

      {/* ── Графічна аналітика ───────────────────────────────────────── */}
      <div style={{ marginTop: 16 }}>
        <DashboardCharts />
      </div>

    </div>
  )
}
