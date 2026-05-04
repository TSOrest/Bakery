import { useState, useRef, useEffect } from 'react'

interface Props {
  children: React.ReactNode
  width?: number
}

/**
 * Маленька кнопка «?» з підказкою що відкривається по кліку.
 * Використовується для точкової допомоги в інтерфейсі.
 *
 * <HelpTip>Текст підказки тут</HelpTip>
 */
export default function HelpTip({ children, width = 260 }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('keydown', esc) }
  }, [open])

  return (
    <div ref={ref} style={{ display: 'inline-block', position: 'relative', verticalAlign: 'middle' }}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        title="Довідка"
        style={{
          width: 16, height: 16,
          borderRadius: '50%',
          border: '1px solid #93b4d4',
          background: open ? '#1a3a5c' : '#e8f0f8',
          color: open ? '#fff' : '#1a3a5c',
          fontSize: '0.65rem',
          fontWeight: 700,
          lineHeight: 1,
          cursor: 'pointer',
          padding: 0,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >?</button>
      {open && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          zIndex: 9999,
          marginTop: 4,
          width,
          background: '#fff',
          border: '1px solid #c8d8ea',
          borderRadius: 6,
          boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
          padding: '0.6rem 0.8rem',
          fontSize: '0.8rem',
          lineHeight: 1.5,
          color: '#2c3e50',
        }}>
          <div style={{ position: 'absolute', top: -6, left: 6, width: 10, height: 10, background: '#fff', border: '1px solid #c8d8ea', borderRight: 'none', borderBottom: 'none', transform: 'rotate(45deg)' }} />
          {children}
        </div>
      )}
    </div>
  )
}
