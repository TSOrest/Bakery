/**
 * PriceGantt — CSS-based Gantt chart for price history.
 * Reused for base prices and client price overrides.
 */

import React, { useMemo } from 'react'
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

// ─── component ────────────────────────────────────────────────────────────────

const PriceGantt: React.FC<PriceGanttProps> = ({
  rows, timeFrom, timeTo, today, onEdit, onDelete,
}) => {
  const totalDays = useMemo(() => daysBetween(timeFrom, timeTo), [timeFrom, timeTo])
  const markers   = useMemo(() => buildMonthMarkers(timeFrom, timeTo), [timeFrom, timeTo])

  if (totalDays <= 0 || rows.length === 0) {
    return <div className={styles.empty}>Немає цін для відображення</div>
  }

  /** Convert a date to % offset from timeFrom. */
  const toPct = (iso: string) =>
    clamp((daysBetween(timeFrom, iso) / totalDays) * 100, 0, 100)

  const todayPct = toPct(today)

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
            {/* Today line */}
            {todayPct > 0 && todayPct < 100 && (
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
          <div className={styles.rowLabel} title={row.product_name}>
            {row.product_name}
          </div>
          <div className={styles.barArea}>
            {row.prices.map(seg => {
              const startPct = toPct(seg.valid_from)
              const endPct   = toPct(seg.valid_to ?? timeTo)
              const width    = Math.max(endPct - startPct, 0.5)
              // Поточна: today потрапляє в діапазон [valid_from, valid_to|∞]
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
              const futureSeg = row.prices.find(seg => seg.valid_from > today)
              const currentSeg = row.prices.find(
                seg => seg.valid_from <= today && (seg.valid_to === null || seg.valid_to >= today)
              )
              // Show delete+edit on future price if any; else show edit-only on current price
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
    </div>
  )
}

export default PriceGantt
