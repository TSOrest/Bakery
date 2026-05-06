import { createContext, useContext, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'

type ToastType = 'success' | 'error' | 'info' | 'warning'

interface Toast {
  id: number
  type: ToastType
  message: string
}

interface ToastContextValue {
  show: (message: string, type?: ToastType, duration?: number) => void
  success: (message: string, duration?: number) => void
  error: (message: string, duration?: number) => void
  info: (message: string, duration?: number) => void
  warning: (message: string, duration?: number) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}

const STYLES: Record<ToastType, { bg: string; border: string; color: string; icon: string }> = {
  success: { bg: '#f0fdf4', border: '#86efac', color: '#15803d', icon: '✓' },
  error:   { bg: '#fef2f2', border: '#fca5a5', color: '#b91c1c', icon: '⚠' },
  info:    { bg: '#eff6ff', border: '#93c5fd', color: '#1e40af', icon: 'ⓘ' },
  warning: { bg: '#fffbeb', border: '#fcd34d', color: '#92400e', icon: '!' },
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const remove = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const show = useCallback((message: string, type: ToastType = 'info', duration = 3500) => {
    const id = Date.now() + Math.random()
    setToasts(prev => [...prev, { id, type, message }])
    if (duration > 0) {
      setTimeout(() => remove(id), duration)
    }
  }, [remove])

  const value: ToastContextValue = {
    show,
    success: (m, d) => show(m, 'success', d),
    error:   (m, d) => show(m, 'error',   d ?? 5000),
    info:    (m, d) => show(m, 'info',    d),
    warning: (m, d) => show(m, 'warning', d),
  }

  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(
        <div style={{
          position: 'fixed',
          bottom: 20,
          right: 20,
          zIndex: 2147483647,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          maxWidth: 'min(420px, calc(100vw - 40px))',
        }}>
          {toasts.map(t => {
            const s = STYLES[t.type]
            return (
              <div
                key={t.id}
                onClick={() => remove(t.id)}
                style={{
                  background: s.bg,
                  border: `1px solid ${s.border}`,
                  color: s.color,
                  borderRadius: 8,
                  padding: '0.6rem 0.9rem',
                  fontSize: '0.88rem',
                  boxShadow: '0 4px 14px rgba(0,0,0,0.12)',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  cursor: 'pointer',
                  animation: 'toastSlideIn 0.2s ease-out',
                }}
              >
                <span style={{ fontWeight: 700, fontSize: '1rem', lineHeight: 1.3, flexShrink: 0 }}>{s.icon}</span>
                <span style={{ flex: 1, lineHeight: 1.4, whiteSpace: 'pre-wrap' }}>{t.message}</span>
              </div>
            )
          })}
          <style>{`
            @keyframes toastSlideIn {
              from { transform: translateX(20px); opacity: 0; }
              to   { transform: translateX(0);    opacity: 1; }
            }
          `}</style>
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  )
}
