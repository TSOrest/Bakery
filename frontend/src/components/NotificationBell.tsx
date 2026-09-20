import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { notificationsApi, type AppNotification } from '../api/notifications'
import { useToast } from './Toast'
import { useAuth } from '../context/AuthContext'

const POLL_MS = 25_000

// Синтезований звук "дзінь" через Web Audio API — без окремого mp3/wav
// asset-файлу (менше залежностей, немає ризику зламаного/відсутнього файлу
// при апдейті). Автоплей браузер може заблокувати до першої взаємодії
// користувача — тоді просто тихо, без помилки.
let _audioCtx: AudioContext | null = null
function playChime() {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!Ctx) return
    if (!_audioCtx) _audioCtx = new Ctx()
    const ctx = _audioCtx
    const now = ctx.currentTime
    ;[1046.5, 1568].forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, now + i * 0.06)
      gain.gain.exponentialRampToValueAtTime(0.22, now + i * 0.06 + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.06 + 0.5)
      osc.connect(gain).connect(ctx.destination)
      osc.start(now + i * 0.06)
      osc.stop(now + i * 0.06 + 0.55)
    })
  } catch { /* автоплей заблоковано — без звуку */ }
}

function fmtDate(iso: string): string {
  return iso.replace('T', ' ').slice(0, 16)
}

function parseMeta(raw?: string | null): Record<string, string> {
  if (!raw) return {}
  try { return JSON.parse(raw) } catch { return {} }
}

export default function NotificationBell() {
  const { can } = useAuth()
  const toast = useToast()
  const [items, setItems]   = useState<AppNotification[]>([])
  const [unread, setUnread] = useState(0)
  const [open, setOpen]     = useState(false)
  const [installingId, setInstallingId] = useState<number | null>(null)
  const seenIds   = useRef<Set<number>>(new Set())
  const firstLoad = useRef(true)
  const rootRef   = useRef<HTMLDivElement>(null)

  const canInstallUpdate = can('can_install_update')

  const poll = useCallback(async () => {
    try {
      const list = await notificationsApi.list()
      if (!firstLoad.current) {
        const newOnes = list.filter(n => !seenIds.current.has(n.id))
        if (newOnes.length > 0) {
          playChime()
          newOnes.forEach(n => toast.info(n.body ? `${n.title}\n${n.body}` : n.title, 6000))
        }
      }
      list.forEach(n => seenIds.current.add(n.id))
      firstLoad.current = false
      setItems(list)
      setUnread(list.filter(n => !n.read_at).length)
    } catch { /* сервер тимчасово недоступний — тихо, наступний poll спробує знову */ }
  }, [toast])

  useEffect(() => {
    poll()
    const t = setInterval(poll, POLL_MS)
    return () => clearInterval(t)
  }, [poll])

  // Закриття панелі при кліку поза нею
  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  const handleToggle = async () => {
    const willOpen = !open
    setOpen(willOpen)
    if (willOpen && unread > 0) {
      const now = new Date().toISOString()
      setItems(prev => prev.map(n => (n.read_at ? n : { ...n, read_at: now })))
      setUnread(0)
      try { await notificationsApi.markAllRead() } catch { /* ignore */ }
    }
  }

  const handleInstall = async (n: AppNotification) => {
    const meta = parseMeta(n.meta)
    if (!meta.version) return
    setInstallingId(n.id)
    try {
      const res = await notificationsApi.requestUpdate(meta.version, meta.changelog ?? '')
      toast.success(
        res.delayed
          ? `Оновлення розпочнеться через 1 хв — інші користувачі попереджені (${res.other_sessions}).`
          : 'Оновлення розпочинається зараз — сервер тимчасово зупиниться.',
      )
    } catch {
      toast.error('Не вдалося запланувати оновлення')
    } finally {
      setInstallingId(null)
    }
  }

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        onClick={() => { void handleToggle() }}
        title="Сповіщення"
        style={{
          position: 'relative', background: 'none', border: 'none', cursor: 'pointer',
          fontSize: '1.15rem', padding: '0.3rem 0.4rem', lineHeight: 1,
        }}
      >
        🔔
        {unread > 0 && (
          <span style={{
            position: 'absolute', top: -2, right: -2, background: '#e74c3c', color: '#fff',
            borderRadius: '50%', fontSize: 10, fontWeight: 700, minWidth: 15, height: 15,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px',
          }}>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && createPortal(
        <div style={{
          position: 'fixed', top: 54, right: 16, width: 360, maxHeight: '70vh', overflowY: 'auto',
          background: '#fff', borderRadius: 10, boxShadow: '0 8px 28px rgba(0,0,0,0.18)',
          border: '1px solid #e2e8f0', zIndex: 2147483000,
        }}>
          <div style={{
            padding: '0.6rem 0.9rem', fontWeight: 700, borderBottom: '1px solid #eef1f5',
            fontSize: '0.9rem', color: '#333',
          }}>
            Сповіщення
          </div>
          {items.length === 0 && (
            <div style={{ padding: '1.2rem', textAlign: 'center', color: '#999', fontSize: '0.85rem' }}>
              Немає сповіщень
            </div>
          )}
          {items.map(n => {
            const meta = parseMeta(n.meta)
            return (
              <div key={n.id} style={{
                padding: '0.6rem 0.9rem', borderBottom: '1px solid #f3f5f8',
                background: n.read_at ? '#fff' : '#f0f7ff',
              }}>
                <div style={{ fontWeight: 600, fontSize: '0.86rem', color: '#222' }}>{n.title}</div>
                {n.body && (
                  <div style={{ fontSize: '0.8rem', color: '#555', marginTop: 2, whiteSpace: 'pre-wrap' }}>
                    {n.body}
                  </div>
                )}
                <div style={{ fontSize: '0.72rem', color: '#999', marginTop: 4 }}>{fmtDate(n.created_at)}</div>
                {n.type === 'new_version' && canInstallUpdate && meta.version && (
                  <button
                    onClick={() => { void handleInstall(n) }}
                    disabled={installingId === n.id}
                    style={{
                      marginTop: 6, fontSize: '0.78rem', padding: '0.3rem 0.6rem',
                      background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6,
                      cursor: installingId === n.id ? 'default' : 'pointer',
                      opacity: installingId === n.id ? 0.6 : 1,
                    }}
                  >
                    {installingId === n.id ? 'Плануємо…' : '⬇ Встановити оновлення'}
                  </button>
                )}
              </div>
            )
          })}
        </div>,
        document.body,
      )}
    </div>
  )
}
