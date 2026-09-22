import { useRef, useState } from 'react'
import HelpPage from '../pages/HelpPage'

const POPUP_WIDTH = 560
const MARGIN = 16

/** Спливаюче, а не повноекранне, вікно довідки — поверх поточної сторінки,
 * не блокує решту екрана (без темного фону-оверлея) і переміщується
 * перетягуванням за шапку, щоб оператор міг відсунути його й підглянути
 * дані під ним. Закривається лише кнопкою "✕" (навмисно без закриття по
 * кліку поза вікном — інакше перетягування втрачало б сенс). */
export default function HelpPopup({ onClose }: { onClose: () => void }) {
  const [pos, setPos] = useState(() => ({
    top: 64,
    left: Math.max(MARGIN, window.innerWidth - POPUP_WIDTH - MARGIN),
  }))
  const dragState = useRef<{ startX: number; startY: number; origTop: number; origLeft: number } | null>(null)

  const onHeaderMouseDown = (e: React.MouseEvent) => {
    dragState.current = { startX: e.clientX, startY: e.clientY, origTop: pos.top, origLeft: pos.left }
    const onMove = (ev: MouseEvent) => {
      if (!dragState.current) return
      const { startX, startY, origTop, origLeft } = dragState.current
      setPos({
        top: Math.max(0, origTop + (ev.clientY - startY)),
        left: Math.max(0, origLeft + (ev.clientX - startX)),
      })
    }
    const onUp = () => {
      dragState.current = null
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  return (
    <div
      style={{
        position: 'fixed', top: pos.top, left: pos.left, zIndex: 2000,
        width: POPUP_WIDTH, maxWidth: '92vw', maxHeight: '82vh',
        background: '#fff', borderRadius: 10,
        boxShadow: '0 10px 40px rgba(0,0,0,0.28)', border: '1px solid #d0dce8',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}
    >
      <div
        onMouseDown={onHeaderMouseDown}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0.5rem 0.5rem 0.5rem 0.9rem', background: '#1a3a5c', color: '#fff',
          cursor: 'move', flexShrink: 0, userSelect: 'none',
        }}
      >
        <span style={{ fontWeight: 700, fontSize: '0.88rem' }}>📖 Довідник користувача</span>
        <button
          onClick={onClose}
          title="Закрити"
          aria-label="Закрити"
          style={{
            background: 'none', border: 'none', color: '#fff', fontSize: '1.05rem',
            cursor: 'pointer', lineHeight: 1, padding: '0.2rem 0.4rem', borderRadius: 4,
          }}
        >
          ✕
        </button>
      </div>
      <div style={{ overflowY: 'auto', flex: 1 }}>
        <HelpPage />
      </div>
    </div>
  )
}
