import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
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
import OwnerDashboard from './pages/OwnerDashboard'

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

  // Власник бачить тільки свій дашборд (без основного лейауту)
  if (user.role === 'owner') {
    return (
      <BrowserRouter>
        <Routes>
          <Route path="*" element={<OwnerDashboard />} />
        </Routes>
      </BrowserRouter>
    )
  }

  return (
    <DateProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Navigate to="/orders" replace />} />
            <Route path="orders"   element={<OrdersPage />} />
            <Route path="baking"   element={<BakingPage />} />
            <Route path="routes"   element={<RoutesPage />} />
            <Route path="shop"     element={<ShopPage />} />
            {(user.role === 'accountant' || user.role === 'admin') && (
              <Route path="finances" element={<FinancesPage />} />
            )}
            {user.role === 'admin' && (
              <Route path="admin" element={<AdminPage />} />
            )}
            <Route path="*" element={<Navigate to="/orders" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </DateProvider>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  )
}
