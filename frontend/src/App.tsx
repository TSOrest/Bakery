import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { DateProvider } from './context/DateContext'
import Layout from './components/Layout'
import OrdersPage from './pages/OrdersPage'
import BakingPage from './pages/BakingPage'
import RoutesPage from './pages/RoutesPage'
import ShopPage from './pages/ShopPage'
import FinancesPage from './pages/FinancesPage'
import AdminPage from './pages/AdminPage'

export default function App() {
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
            <Route path="finances" element={<FinancesPage />} />
            <Route path="admin"    element={<AdminPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </DateProvider>
  )
}
