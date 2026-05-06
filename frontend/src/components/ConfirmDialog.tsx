import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'

interface ConfirmOptions {
  title?: string
  message: string
  confirmText?: string
  cancelText?: string
  danger?: boolean   // червона кнопка для деструктивних дій
}

type ConfirmFn = (opts: ConfirmOptions | string) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn | null>(null)

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider')
  return ctx
}

interface DialogState {
  opts: ConfirmOptions
  resolve: (v: boolean) => void
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<DialogState | null>(null)

  const confirm: ConfirmFn = useCallback((opts) => {
    const normalized: ConfirmOptions = typeof opts === 'string' ? { message: opts } : opts
    return new Promise(resolve => {
      setState({ opts: normalized, resolve })
    })
  }, [])

  const close = (result: boolean) => {
    if (state) state.resolve(result)
    setState(null)
  }

  // Esc / Enter обробка
  useEffect(() => {
    if (!state) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(false)
      if (e.key === 'Enter') close(true)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [state])

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && createPortal(
        <div
          onClick={() => close(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 2147483600,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 20,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: 8, maxWidth: 440, width: '100%',
              padding: '1.25rem 1.5rem 1rem',
              boxShadow: '0 10px 40px rgba(0,0,0,0.25)',
              fontFamily: 'system-ui, sans-serif',
            }}
          >
            <h3 style={{ margin: '0 0 0.6rem', fontSize: '1.05rem', color: '#1a3a5c' }}>
              {state.opts.title ?? 'Підтвердіть дію'}
            </h3>
            <p style={{ margin: '0 0 1.25rem', fontSize: '0.92rem', lineHeight: 1.5, color: '#333', whiteSpace: 'pre-wrap' }}>
              {state.opts.message}
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                onClick={() => close(false)}
                style={{
                  padding: '0.45rem 1rem', border: '1px solid #c0d0e0',
                  background: '#fff', color: '#333', borderRadius: 6,
                  cursor: 'pointer', fontSize: '0.88rem',
                }}
              >
                {state.opts.cancelText ?? 'Скасувати'}
              </button>
              <button
                autoFocus
                onClick={() => close(true)}
                style={{
                  padding: '0.45rem 1rem', border: 'none', borderRadius: 6,
                  cursor: 'pointer', fontSize: '0.88rem', fontWeight: 600,
                  background: state.opts.danger ? '#dc2626' : '#1a3a5c',
                  color: '#fff',
                }}
              >
                {state.opts.confirmText ?? 'Підтвердити'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </ConfirmContext.Provider>
  )
}
