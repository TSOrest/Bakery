import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { DateProvider } from './context/DateContext'
import { AuthProvider, useAuth } from './context/AuthContext'
import Layout from './components/Layout'
import LoginPage from './pages/LoginPage'
import OrdersPage from './pages/OrdersPage'
import BakingPage from './pages/BakingPage'
import RoutesPage from './pages/RoutesPage'
import ShopPage from './pages/ShopPage'
import FinancesPage from './pages/FinancesPage'
import AdminPage from './pages/AdminPage'
import DbEditorPage from './pages/DbEditorPage'
import PosPage from './pages/PosPage'

// ── Редірект на першу доступну вкладку ───────────────────────────────────────

// Порядок вкладок і ключі — мають збігатись з Layout.tsx ALL_TABS
const NAV_TABS = [
  { path: '/orders',   key: 'orders'   },
  { path: '/baking',   key: 'baking'   },
  { path: '/routes',   key: 'routes'   },
  { path: '/shop',     key: 'shop'     },
  { path: '/finances', key: 'finances' },
  { path: '/admin',    key: 'admin'    },
]
const ROLE_FALLBACK: Record<string, string[]> = {
  operator:   ['orders', 'baking', 'routes', 'shop', 'reports'],
  accountant: ['orders', 'finances', 'reports'],
  admin:      NAV_TABS.map(t => t.key),
  owner:      ['finances'],
}

function DefaultRedirect() {
  const { user, permissions } = useAuth()
  if (!user) return <Navigate to="/" replace />
  const role = user.role
  const allowed: string[] = role === 'admin'
    ? NAV_TABS.map(t => t.key)
    : (permissions[role] ?? ROLE_FALLBACK[role] ?? [])
  const first = NAV_TABS.find(({ key }) => {
    if (key === 'admin')    return allowed.includes('admin') || allowed.some(k => k.startsWith('admin_'))
    if (key === 'finances') return allowed.includes('finances') || allowed.includes('reports') || allowed.includes('dashboard')
    return allowed.includes(key)
  })
  return <Navigate to={first?.path ?? '/finances'} replace />
}

// ── Монітор підключення до сервера ────────────────────────────────────────────

const HEALTH_URL  = '/api/health'
const POLL_MS     = 3_000   // інтервал опитування
const FAIL_BEFORE = 2       // скільки збоїв поспіль перед показом overlay

function ServerConnectionOverlay() {
  const [offline,   setOffline]   = useState(false)
  const [dots,      setDots]      = useState('.')
  const failCount   = useRef(0)
  const wasOffline  = useRef(false)

  // Анімація крапок
  useEffect(() => {
    if (!offline) return
    const t = setInterval(() => setDots(d => d.length >= 3 ? '.' : d + '.'), 500)
    return () => clearInterval(t)
  }, [offline])

  // Опитування health
  useEffect(() => {
    const check = async () => {
      try {
        const r = await fetch(HEALTH_URL, { cache: 'no-store' })
        if (r.ok) {
          failCount.current = 0
          if (wasOffline.current) {
            // Сервер відновився — перезавантажити сторінку
            // (нові дані, нові сесії, редірект на логін якщо токен застарів)
            window.location.reload()
          }
          setOffline(false)
        } else {
          throw new Error('not ok')
        }
      } catch {
        failCount.current += 1
        if (failCount.current >= FAIL_BEFORE) {
          wasOffline.current = true
          setOffline(true)
        }
      }
    }

    check()
    const t = setInterval(check, POLL_MS)
    return () => clearInterval(t)
  }, [])

  if (!offline) return null

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(10, 20, 40, 0.72)',
      backdropFilter: 'blur(3px)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: 16,
    }}>
      {/* Спінер */}
      <div style={{
        width: 48, height: 48, borderRadius: '50%',
        border: '4px solid rgba(255,255,255,0.2)',
        borderTopColor: '#60a5fa',
        animation: 'spin 0.9s linear infinite',
      }} />
      <div style={{ color: '#e2e8f0', fontSize: 18, fontWeight: 600 }}>
        Спроба підключення{dots}
      </div>
      <div style={{ color: '#94a3b8', fontSize: 13 }}>
        Сервер недоступний або перезапускається
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function AppRoutes() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#888' }}>
        Завантаження...
      </div>
    )
  }

  if (!user) return <LoginPage />

  // Продавець: тільки POS-інтерфейс
  if (user.role === 'seller') {
    return (
      <Routes>
        <Route path="/pos" element={<PosPage />} />
        <Route path="*" element={<Navigate to="/pos" replace />} />
      </Routes>
    )
  }

  return (
    <DateProvider>
      <Routes>
        <Route path="db-editor" element={<DbEditorPage />} />
        <Route path="pos" element={<PosPage />} />
        <Route path="/" element={<Layout />}>
          <Route index element={<DefaultRedirect />} />
          <Route path="dashboard" element={<Navigate to="/finances" replace />} />
          <Route path="orders"    element={<OrdersPage />} />
          <Route path="baking"    element={<BakingPage />} />
          <Route path="routes"    element={<RoutesPage />} />
          <Route path="shop"      element={<ShopPage />} />
          <Route path="finances"  element={<FinancesPage />} />
          <Route path="admin"     element={<AdminPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </DateProvider>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ServerConnectionOverlay />
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  )
}
