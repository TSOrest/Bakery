import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { Client, Product, Route } from '../types'

type Tab = 'products' | 'clients' | 'routes'

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>('products')
  const [products, setProducts] = useState<Product[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [routes, setRoutes] = useState<Route[]>([])

  useEffect(() => {
    api.get<Product[]>('/products/?active_only=false').then(setProducts)
    api.get<Client[]>('/clients/?active_only=false').then(setClients)
    api.get<Route[]>('/routes/?active_only=false').then(setRoutes)
  }, [])

  return (
    <div>
      <h2>Довідники</h2>
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        {(['products', 'clients', 'routes'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '0.4rem 1rem',
              borderRadius: '4px',
              border: '1px solid #ccc',
              background: tab === t ? '#1a3a5c' : '#fff',
              color: tab === t ? '#fff' : '#333',
              cursor: 'pointer',
            }}
          >
            {t === 'products' ? 'Вироби' : t === 'clients' ? 'Клієнти' : 'Маршрути'}
          </button>
        ))}
      </div>

      {tab === 'products' && <ProductsTable products={products} />}
      {tab === 'clients' && <ClientsTable clients={clients} routes={routes} />}
      {tab === 'routes' && <RoutesTable routes={routes} />}
    </div>
  )
}

function ProductsTable({ products }: { products: Product[] }) {
  return (
    <table style={{ borderCollapse: 'collapse', width: '100%' }}>
      <thead>
        <tr style={{ background: '#e8eef5' }}>
          <th style={th}>Назва</th>
          <th style={th}>Скорочена</th>
          <th style={th}>Тип</th>
          <th style={th}>Вага, кг</th>
          <th style={th}>Активний</th>
        </tr>
      </thead>
      <tbody>
        {products.map((p) => (
          <tr key={p.id}>
            <td style={td}>{p.name}</td>
            <td style={td}>{p.short_name ?? '—'}</td>
            <td style={td}>{p.type}</td>
            <td style={td}>{p.weight ?? '—'}</td>
            <td style={td}>{p.is_active ? '✓' : '✗'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function ClientsTable({ clients, routes }: { clients: Client[]; routes: Route[] }) {
  const routeName = (id: number | null) => routes.find((r) => r.id === id)?.name ?? '—'
  return (
    <table style={{ borderCollapse: 'collapse', width: '100%' }}>
      <thead>
        <tr style={{ background: '#e8eef5' }}>
          <th style={th}>Назва</th>
          <th style={th}>Маршрут</th>
          <th style={th}>Знижка %</th>
          <th style={th}>Телефон</th>
          <th style={th}>Активний</th>
        </tr>
      </thead>
      <tbody>
        {clients.map((c) => (
          <tr key={c.id}>
            <td style={td}>{c.full_name}</td>
            <td style={td}>{routeName(c.route_id)}</td>
            <td style={td}>{c.discount_pct}</td>
            <td style={td}>{c.phone ?? '—'}</td>
            <td style={td}>{c.is_active ? '✓' : '✗'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function RoutesTable({ routes }: { routes: Route[] }) {
  return (
    <table style={{ borderCollapse: 'collapse', width: '100%' }}>
      <thead>
        <tr style={{ background: '#e8eef5' }}>
          <th style={th}>Назва</th>
          <th style={th}>Порядок</th>
          <th style={th}>Активний</th>
        </tr>
      </thead>
      <tbody>
        {routes.map((r) => (
          <tr key={r.id}>
            <td style={td}>{r.name}</td>
            <td style={td}>{r.sort_order}</td>
            <td style={td}>{r.is_active ? '✓' : '✗'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

const th: React.CSSProperties = { padding: '0.4rem 0.8rem', textAlign: 'left', fontWeight: 600 }
const td: React.CSSProperties = { padding: '0.35rem 0.8rem', borderBottom: '1px solid #e0e0e0' }
