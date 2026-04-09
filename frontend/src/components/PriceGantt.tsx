/**
 * PriceGantt — CSS-based Gantt chart for price history.
 * Reused for base prices and client price overrides.
 */

import React, { useMemo, useState } from 'react'
import styles from './PriceGantt.module.css'

export interface GanttPriceSegment {
  price_id:   number
  price:      number
  valid_from: string        // YYYY-MM-DD
  valid_to:   string | null // null = open-ended
}

export interface GanttRow {
  product_id:   number
  product_name: string
  prices:       GanttPriceSegment[]
}

interface PriceGanttProps {
  rows:      GanttRow[]
  timeFrom:  string   // YYYY-MM-DD
  timeTo:    string   // YYYY-MM-DD
  today:     string   // YYYY-MM-DD
  onEdit:    (priceId: number) => void
  onDelete:  (priceId: number) => void
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function daysBetween(a: string, b: string): number {
  return (new Date(b).getTime() - new Date(a).getTime()) / 86_400_000
}

/** valid_to є включним — бар має закінчуватись на початку НАСТУПНОГО дня. */
function nextDay(iso: string): string {
  const d = new Date(iso)
  d.setDate(d.getDate() + 1)
  return d.toISOString().slice(0, 10)
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

/** Build month-marker positions (percentage along the timeline). */
function buildMonthMarkers(timeFrom: string, timeTo: string) {
  const total = daysBetween(timeFrom, timeTo)
  if (total <= 0) return []
  const markers: { label: string; pct: number }[] = []

  const d = new Date(timeFrom)
  d.setDate(1)
  d.setMonth(d.getMonth() + 1) // first full month boundary

  while (true) {
    const iso = d.toISOString().slice(0, 10)
    if (iso >= timeTo) break
    const pct = (daysBetween(timeFrom, iso) / total) * 100
    markers.push({ label: `${d.getMonth() + 1}/${d.getFullYear()}`, pct })
    d.setMonth(d.getMonth() + 1)
  }
  return markers
}

// ─── Tooltip mini-chart ───────────────────────────────────────────────────────

function PriceTooltip({ row, x, y, today }: {
  row:   GanttRow
  x:     number
  y:     number
  today: string
}) {
  const sorted = [...row.prices].sort((a, b) => a.valid_from.localeCompare(b.valid_from))
  if (sorted.length === 0) return null

  const SVG_W = 440
  const SVG_H = 180
  const PAD   = { top: 12, right: 12, bottom: 24, left: 46 }
  const plotW = SVG_W - PAD.left - PAD.right
  const plotH = SVG_H - PAD.top - PAD.bottom

  const chartFrom = sorted[0].valid_from
  const rawTo     = sorted[sorted.length - 1].valid_to ?? today
  const chartTo   = rawTo < today ? today : rawTo
  const totalDays = daysBetween(chartFrom, chartTo)
  if (totalDays <= 0) return null

  const xPos = (iso: string) => PAD.left + clamp(daysBetween(chartFrom, iso) / totalDays, 0, 1) * plotW

  const allPrices = sorted.map(s => s.price)
  const rawMin = Math.min(...allPrices)
  const rawMax = Math.max(...allPrices)
  const span   = rawMax - rawMin || rawMax * 0.1 || 1
  const minP   = rawMin - span * 0.15
  const maxP   = rawMax + span * 0.15
  const yPos   = (p: number) => PAD.top + (1 - (p - minP) / (maxP - minP)) * plotH

  // Step path
  let path = ''
  for (let i = 0; i < sorted.length; i++) {
    const seg = sorted[i]
    const x1  = xPos(seg.valid_from)
    const x2  = xPos(seg.valid_to ?? chartTo)
    const yv  = yPos(seg.price)
    if (i === 0) path += `M ${x1.toFixed(1)} ${yv.toFixed(1)}`
    else         path += ` L ${x1.toFixed(1)} ${yv.toFixed(1)}`
    path += ` L ${x2.toFixed(1)} ${yv.toFixed(1)}`
  }

  const todayX = xPos(today)
  const showToday = todayX > PAD.left + 1 && todayX < PAD.left + plotW - 1

  const currentSeg = sorted.find(
    s => s.valid_from <= today && (s.valid_to === null || s.valid_to >= today)
  ) ?? sorted[sorted.length - 1]

  // Clamp tooltip to viewport
  const TW = 480
  const TH = 260
  const tx = Math.min(x + 14, window.innerWidth  - TW - 8)
  const ty = Math.min(y - TH / 2, window.innerHeight - TH - 8)

  const yGridVals = [maxP, (maxP + minP) / 2, minP]

  return (
    <div style={{
      position: 'fixed', left: tx, top: Math.max(8, ty),
      width: TW, zIndex: 9999, pointerEvents: 'none',
      background: '#1e293b', color: '#f1f5f9',
      borderRadius: 10, padding: '10px 12px',
      boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      fontSize: 12,
    }}>
      <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 13, color: '#f8fafc',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {row.product_name}
      </div>
      <svg width={SVG_W} height={SVG_H} style={{ display: 'block' }}>
        {/* grid lines + y-axis labels */}
        {yGridVals.map((pv, i) => (
          <g key={i}>
            <line
              x1={PAD.left} y1={yPos(pv).toFixed(1)}
              x2={PAD.left + plotW} y2={yPos(pv).toFixed(1)}
              stroke="#334155" strokeWidth="1"
            />
            <text
              x={PAD.left - 4} y={(yPos(pv) + 4).toFixed(1)}
              textAnchor="end" fontSize="9" fill="#64748b"
            >
              {pv.toFixed(1)}
            </text>
          </g>
        ))}
        {/* step line */}
        <path d={path} stroke="#22c55e" strokeWidth="2" fill="none" strokeLinejoin="round" />
        {/* dots at price change points */}
        {sorted.map(seg => (
          <circle
            key={seg.price_id}
            cx={xPos(seg.valid_from).toFixed(1)}
            cy={yPos(seg.price).toFixed(1)}
            r="3" fill="#22c55e"
          />
        ))}
        {/* today line */}
        {showToday && (
          <line
            x1={todayX.toFixed(1)} y1={PAD.top}
            x2={todayX.toFixed(1)} y2={PAD.top + plotH}
            stroke="#ef4444" strokeWidth="1" strokeDasharray="3,2"
          />
        )}
        {/* x-axis date labels */}
        <text x={PAD.left} y={SVG_H - 4} fontSize="9" fill="#475569">
          {chartFrom.slice(0, 7)}
        </text>
        <text x={PAD.left + plotW} y={SVG_H - 4} textAnchor="end" fontSize="9" fill="#475569">
          {chartTo.slice(0, 7)}
        </text>
      </svg>
      <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 4, display: 'flex', justifyContent: 'space-between' }}>
        <span>
          Поточна:{' '}
          <span style={{ color: '#22c55e', fontWeight: 700 }}>
            {currentSeg.price.toFixed(2)} ₴
          </span>
        </span>
        <span>{sorted.length} {sorted.length === 1 ? 'запис' : sorted.length < 5 ? 'записи' : 'записів'}</span>
      </div>
    </div>
  )
}

// ─── component ────────────────────────────────────────────────────────────────

const PriceGantt: React.FC<PriceGanttProps> = ({
  rows, timeFrom, timeTo, today, onEdit, onDelete,
}) => {
  const totalDays = useMemo(() => daysBetween(timeFrom, timeTo), [timeFrom, timeTo])
  const markers   = useMemo(() => buildMonthMarkers(timeFrom, timeTo), [timeFrom, timeTo])

  const [tooltip, setTooltip] = useState<{ row: GanttRow; x: number; y: number } | null>(null)

  if (totalDays <= 0 || rows.length === 0) {
    return <div className={styles.empty}>Немає цін для відображення</div>
  }

  /** Convert a date to % offset from timeFrom. */
  const toPct = (iso: string) =>
    clamp((daysBetween(timeFrom, iso) / totalDays) * 100, 0, 100)

  const todayPct    = toPct(today)
  const showToday   = todayPct > 0 && todayPct < 100

  return (
    <div className={styles.root}>
      {/* ── Timeline header ── */}
      <div className={styles.headerRow}>
        <div className={styles.rowLabel} />
        <div className={styles.barArea}>
          <div className={styles.timeline}>
            {markers.map(m => (
              <div
                key={m.label}
                className={styles.monthMark}
                style={{ left: `${m.pct}%` }}
              >
                <span className={styles.monthLabel}>{m.label}</span>
              </div>
            ))}
            {showToday && (
              <div
                className={styles.todayLine}
                style={{ left: `${todayPct}%` }}
                title={`Сьогодні: ${today}`}
              />
            )}
          </div>
        </div>
        <div className={styles.actionsCol} />
      </div>

      {/* ── Rows ── */}
      {rows.map(row => (
        <div key={row.product_id} className={styles.row}>
          <div
            className={styles.rowLabel}
            onMouseEnter={e => setTooltip({ row, x: e.clientX, y: e.clientY })}
            onMouseMove={e => setTooltip(t => t ? { ...t, x: e.clientX, y: e.clientY } : null)}
            onMouseLeave={() => setTooltip(null)}
          >
            {row.product_name}
          </div>
          <div className={styles.barArea}>
            {/* Today line extended through all rows */}
            {showToday && (
              <div className={styles.todayLineRow} style={{ left: `${todayPct}%` }} />
            )}
            {row.prices.map(seg => {
              const startPct = toPct(seg.valid_from)
              // valid_to включний: відображаємо до початку наступного дня → no gap між суміжними барами
              const endPct   = toPct(seg.valid_to ? nextDay(seg.valid_to) : timeTo)
              const width    = Math.max(endPct - startPct, 0.3)
              const isPast    = (seg.valid_to ?? '9999-12-31') < today
              const isFuture  = seg.valid_from > today
              const isCurrent = !isPast && !isFuture

              return (
                <div
                  key={seg.price_id}
                  className={[
                    styles.bar,
                    isPast    ? styles.barPast    : '',
                    isFuture  ? styles.barFuture  : '',
                    isCurrent ? styles.barCurrent : '',
                  ].join(' ')}
                  style={{ left: `${startPct}%`, width: `${width}%` }}
                  title={`З ${seg.valid_from} до ${seg.valid_to ?? '∞'} — ${seg.price.toFixed(2)} ₴`}
                >
                  <span className={styles.barLabel}>{seg.price.toFixed(2)} ₴</span>
                </div>
              )
            })}
          </div>
          <div className={styles.actionsCol}>
            {(() => {
              const futureSeg  = row.prices.find(seg => seg.valid_from > today)
              const currentSeg = row.prices.find(
                seg => seg.valid_from <= today && (seg.valid_to === null || seg.valid_to >= today)
              )
              if (futureSeg) return (
                <React.Fragment key={futureSeg.price_id}>
                  <button
                    className={styles.actionBtn}
                    onClick={() => onEdit(futureSeg.price_id)}
                    title="Редагувати"
                  >✎</button>
                  <button
                    className={`${styles.actionBtn} ${styles.deleteBtn}`}
                    onClick={() => onDelete(futureSeg.price_id)}
                    title="Видалити"
                  >×</button>
                </React.Fragment>
              )
              if (currentSeg) return (
                <button
                  key={currentSeg.price_id}
                  className={styles.actionBtn}
                  onClick={() => onEdit(currentSeg.price_id)}
                  title="Запланувати зміну ціни"
                >✎</button>
              )
              return null
            })()}
          </div>
        </div>
      ))}

      {/* Floating tooltip */}
      {tooltip && (
        <PriceTooltip
          row={tooltip.row}
          x={tooltip.x}
          y={tooltip.y}
          today={today}
        />
      )}
    </div>
  )
}

export default PriceGantt
