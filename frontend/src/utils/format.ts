/**
 * Спільні форматтери — використовуються в усіх сторінках.
 * Українська локаль, 2 десяткових знаки за замовчуванням.
 */

/** 587.5 → "587,50" */
export function fmt(n: number, decimals = 2): string {
  return n.toLocaleString('uk-UA', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

/** 587 → "587" (ціле число з пробілами як розділювачем тисяч) */
export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString('uk-UA')
}

/** 587.5 → "588" (округлено) */
export function fmtK(n: number): string {
  return Math.round(n).toLocaleString('uk-UA')
}

/** 0.156 → "15,6%" */
export function fmtPercent(ratio: number, decimals = 1): string {
  return `${(ratio * 100).toLocaleString('uk-UA', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}%`
}

/** "2026-04-15" → "15.04.2026" */
export function fmtDate(iso: string): string {
  if (!iso) return ''
  const parts = iso.slice(0, 10).split('-')
  if (parts.length !== 3) return iso
  return `${parts[2]}.${parts[1]}.${parts[0]}`
}

/** "2026-04-15T18:30:00" → "15.04.2026 18:30" */
export function fmtDateTime(iso: string): string {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    return d.toLocaleString('uk-UA', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  } catch {
    return iso
  }
}
