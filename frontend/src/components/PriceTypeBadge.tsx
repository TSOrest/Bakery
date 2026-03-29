/**
 * PriceTypeBadge — маленький кольоровий бейдж що показує джерело ціни.
 * Відображається як надрядковий символ поруч з ціною.
 *
 * Типи:
 *   base        — Б  зелений   Базова ціна
 *   discounted  — %  оранжевий Базова ціна зі знижкою клієнта
 *   individual  — І  синій     Індивідуальна ціна клієнта
 *   manual      — Р  червоний  Ручна ціна (перевизначена в рядку)
 */

export type PriceSource = 'base' | 'discounted' | 'individual' | 'manual'

interface BadgeCfg {
  letter: string
  color:  string
  bg:     string
  border: string
  label:  string
}

const CFG: Record<PriceSource, BadgeCfg> = {
  base:       { letter: 'Б', color: '#16a34a', bg: '#f0fdf4', border: '#86efac', label: 'Базова ціна' },
  discounted: { letter: '%', color: '#ea580c', bg: '#fff7ed', border: '#fed7aa', label: 'Базова ціна зі знижкою клієнта' },
  individual: { letter: 'І', color: '#2563eb', bg: '#eff6ff', border: '#93c5fd', label: 'Індивідуальна ціна клієнта' },
  manual:     { letter: 'Р', color: '#dc2626', bg: '#fef2f2', border: '#fca5a5', label: 'Ручна ціна (перевизначена в рядку)' },
}

interface Props {
  source: PriceSource
  style?: React.CSSProperties
}

export default function PriceTypeBadge({ source, style }: Props) {
  const c = CFG[source]
  if (!c) return null
  return (
    <span
      title={c.label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 13,
        height: 13,
        borderRadius: '50%',
        background: c.bg,
        color: c.color,
        border: `1px solid ${c.border}`,
        fontSize: 8,
        fontWeight: 700,
        cursor: 'default',
        verticalAlign: 'super',
        marginLeft: 2,
        lineHeight: 1,
        flexShrink: 0,
        userSelect: 'none',
        ...style,
      }}
    >{c.letter}</span>
  )
}
