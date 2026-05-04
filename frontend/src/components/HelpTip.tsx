import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'

interface Props {
  children: React.ReactNode
  width?: number
}

/**
 * Кнопка «?» з підказкою що рендериться через portal у body.
 * position:fixed — не обмежується overflow/z-index батьківських контейнерів.
 */
export default function HelpTip({ children, width = 260 }: Props) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const btnRef = useRef<HTMLButtonElement>(null)

  const toggle = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setPos({ top: r.bottom + 6, left: r.left })
    }
    setOpen(v => !v)
  }

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

  const popup = open ? createPortal(
    <div style={{
      position: 'fixed',
      top: pos.top,
      left: Math.min(pos.left, window.innerWidth - width - 12),
      zIndex: 2147483647,   // максимально можливий z-index
      width,
      background: '#fff',
      border: '1px solid #c8d8ea',
      borderRadius: 6,
      boxShadow: '0 6px 20px rgba(0,0,0,0.16)',
      padding: '0.6rem 0.8rem',
      fontSize: '0.8rem',
      lineHeight: 1.5,
      color: '#2c3e50',
    }}>
      <div style={{ position: 'absolute', top: -6, left: 6, width: 10, height: 10, background: '#fff', border: '1px solid #c8d8ea', borderRight: 'none', borderBottom: 'none', transform: 'rotate(45deg)' }} />
      {children}
    </div>,
    document.body
  ) : null

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
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
          verticalAlign: 'middle',
        }}
      >?</button>
      {popup}
    </>
  )
}
