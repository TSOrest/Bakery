import { useState, type CSSProperties } from 'react'

export default function ResetDbSection() {
  const [modal,       setModal]       = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [busy,        setBusy]        = useState(false)
  const [err,         setErr]         = useState('')

  const sectionS: CSSProperties = {
    background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8,
    padding: '1.25rem 1.5rem', marginBottom: '1rem',
  }
  const s: CSSProperties = { fontSize: '0.85rem' }
  const btnS: CSSProperties = {
    background: '#2563eb', color: '#fff', border: 'none',
    padding: '0.4rem 1rem', borderRadius: 5, cursor: 'pointer',
    fontSize: '0.85rem', fontWeight: 600,
  }

  const handleReset = async () => {
    setBusy(true); setErr('')
    try {
      const res = await fetch('/api/v1/settings/reset-db', { method: 'POST' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({ detail: res.statusText }))
        throw new Error(data.detail ?? res.statusText)
      }
      setModal(false)
      window.location.reload()
    } catch (e: any) {
      setErr(String(e.message ?? e))
    } finally { setBusy(false) }
  }

  return (
    <div style={{ ...sectionS, borderColor: '#fde8e8' }}>
      <h3 style={{ margin: '0 0 0.6rem', fontSize: '1rem', fontWeight: 700, color: '#c0392b' }}>
        Скидання бази даних
      </h3>
      <p style={{ ...s, color: '#666', marginTop: 0, marginBottom: '0.75rem', maxWidth: 520, lineHeight: 1.5 }}>
        Видаляє всі вироби, клієнтів, замовлення, накладні, ціни, фінанси та всі інші робочі дані.
        Системні клієнти, користувачі та налаштування залишаться.
      </p>
      <button
        style={{ ...btnS, background: '#fff', border: '1.5px solid #e74c3c', color: '#e74c3c' }}
        onClick={() => { setModal(true); setConfirmText(''); setErr('') }}
      >
        Скинути базу даних...
      </button>

      {modal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div style={{ background: '#fff', borderRadius: 10, padding: '1.75rem',
            maxWidth: 460, width: '90%', boxShadow: '0 8px 32px rgba(0,0,0,0.25)' }}
            onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 1rem', color: '#c0392b', fontSize: '1.1rem' }}>Скидання бази даних</h3>
            <p style={{ fontSize: '0.9rem', marginTop: 0, lineHeight: 1.55 }}>
              Ця дія <strong>незворотна</strong>. Будуть видалені всі вироби, клієнти,
              замовлення, накладні, ціни, фінанси та всі інші робочі дані.
            </p>
            <p style={{ fontSize: '0.9rem', marginTop: 0, lineHeight: 1.55 }}>
              Системні клієнти (магазин, списання, пайок), користувачі та налаштування залишаться.
            </p>
            <p style={{ fontSize: '0.9rem', marginBottom: '0.4rem' }}>
              Щоб підтвердити, введіть <strong>СКИНУТИ</strong>:
            </p>
            <input
              autoFocus
              value={confirmText}
              onChange={e => setConfirmText(e.target.value.toUpperCase())}
              placeholder="СКИНУТИ"
              style={{ padding: '0.4rem 0.7rem', border: '1.5px solid #ccc', borderRadius: 4,
                fontSize: '1rem', width: '100%', marginBottom: '0.85rem', boxSizing: 'border-box' }}
            />
            {err && <div style={{ color: '#c0392b', fontSize: '0.85rem', marginBottom: '0.6rem' }}>
              {err}
            </div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button onClick={() => setModal(false)} disabled={busy}
                style={{ background: '#f3f4f6', border: '1px solid #d1d5db', color: '#374151',
                  padding: '0.4rem 1rem', borderRadius: 4, cursor: 'pointer', fontSize: '0.9rem' }}>
                Скасувати
              </button>
              <button
                onClick={handleReset}
                disabled={confirmText !== 'СКИНУТИ' || busy}
                style={{
                  background: confirmText === 'СКИНУТИ' ? '#e74c3c' : '#ccc',
                  color: '#fff', border: 'none', padding: '0.4rem 1.1rem', borderRadius: 4,
                  cursor: confirmText === 'СКИНУТИ' ? 'pointer' : 'not-allowed',
                  fontWeight: 600, fontSize: '0.9rem',
                }}
              >
                {busy ? 'Очищення...' : 'Скинути'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
