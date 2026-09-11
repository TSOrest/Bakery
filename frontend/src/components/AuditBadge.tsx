import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { fetchAuditLog, AuditLogEntry } from '../api/audit'

interface Props {
  entityTable: string
  entityId: number
  width?: number
}

const FIELD_LABELS: Record<string, string> = {
  amount:         'сума',
  notes:          'примітка',
  qty:            'к-сть',
  price_override: 'ціна (override)',
  baked_qty:      'спечено',
  recommended_qty:'рекомендовано',
  delivered_qty:  'передано',
  discount_pct:   'знижка %',
  is_active:      'активний',
}

function formatDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  const dd   = String(d.getDate()).padStart(2, '0')
  const mm   = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  const hh   = String(d.getHours()).padStart(2, '0')
  const min  = String(d.getMinutes()).padStart(2, '0')
  return `${dd}.${mm}.${yyyy} ${hh}:${min}`
}

function renderValue(field: string, val: string | null): string {
  if (val === null || val === undefined) return '—'
  const numericFields = ['amount', 'qty', 'price_override', 'baked_qty', 'recommended_qty', 'delivered_qty', 'discount_pct']
  if (numericFields.includes(field)) {
    const n = parseFloat(val)
    return isNaN(n) ? val : n.toFixed(2)
  }
  return val || '—'
}

export default function AuditBadge({ entityTable, entityId, width = 340 }: Props) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  // null = ще не завантажено; [] = пусто (іконку не показуємо); [...] = є записи
  const [entries, setEntries] = useState<AuditLogEntry[] | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  // Авто-перевірка при монтуванні: завантажуємо записи щоб знати чи показувати іконку
  useEffect(() => {
    let cancelled = false
    fetchAuditLog(entityTable, entityId)
      .then(data => { if (!cancelled) setEntries(data) })
      .catch(() => { if (!cancelled) setEntries([]) })
    return () => { cancelled = true }
  }, [entityTable, entityId])

  // Закриття попапу кліком поза ним або Escape
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (btnRef.current && btnRef.current.contains(e.target as Node)) return
      setOpen(false)
    }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  // Не показуємо іконку поки не знаємо результат, або якщо записів немає
  if (!entries || entries.length === 0) return null

  const toggle = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setPos({ top: r.bottom + 6, left: r.left })
    }
    setOpen(v => !v)
  }

  const popup = open ? createPortal(
    <div style={{
      position: 'fixed',
      top: pos.top,
      left: Math.min(pos.left, window.innerWidth - width - 12),
      zIndex: 2147483647,
      width,
      background: 'var(--bg, #fff)',
      border: '1px solid #d4a017',
      borderRadius: 6,
      boxShadow: '0 6px 20px rgba(0,0,0,0.18)',
      padding: '0.5rem 0.7rem',
      fontSize: '0.78rem',
      lineHeight: 1.55,
      color: 'var(--text, #2c3e50)',
    }}>
      <div style={{ position: 'absolute', top: -6, left: 8, width: 10, height: 10, background: 'var(--bg,#fff)', border: '1px solid #d4a017', borderRight: 'none', borderBottom: 'none', transform: 'rotate(45deg)' }} />
      <div style={{ fontWeight: 600, marginBottom: '0.3rem', color: '#b8860b' }}>Історія змін</div>
      {entries.map(e => (
        <div key={e.id} style={{ borderTop: '1px solid #f0e4b0', padding: '0.2rem 0' }}>
          <span style={{ color: '#888', marginRight: 6 }}>{formatDate(e.changed_at)}</span>
          <span style={{ fontWeight: 500 }}>{FIELD_LABELS[e.changed_field] ?? e.changed_field}:</span>
          {' '}
          <span style={{ color: '#c0392b' }}>{renderValue(e.changed_field, e.old_value)}</span>
          {' → '}
          <span style={{ color: '#27ae60' }}>{renderValue(e.changed_field, e.new_value)}</span>
          <span style={{ color: '#888', marginLeft: 6 }}>({e.changed_by})</span>
        </div>
      ))}
    </div>,
    document.body
  ) : null

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        title="Є зміни — переглянути історію"
        aria-label="Переглянути історію змін"
        style={{
          width: 18, height: 18,
          border: 'none',
          background: 'transparent',
          color: open ? '#e67e22' : '#f0a500',
          fontSize: '1rem',
          cursor: 'pointer',
          padding: 0,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          verticalAlign: 'middle',
          lineHeight: 1,
        }}
      >⚠</button>
      {popup}
    </>
  )
}
