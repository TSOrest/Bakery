import { useEffect, useState } from 'react'
import { useWorkDate } from '../context/DateContext'
import { api } from '../api/client'
import type { Client, Order, Product, Route } from '../types'

export default function OrdersPage() {
  const { workDate } = useWorkDate()

  const [routes, setRoutes] = useState<Route[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      api.get<Route[]>('/routes/'),
      api.get<Client[]>('/clients/'),
      api.get<Product[]>('/products/'),
      api.get<Order[]>(`/orders/?order_date=${workDate}`),
    ]).then(([r, c, p, o]) => {
      setRoutes(r)
      setClients(c)
      setProducts(p)
      setOrders(o)
      setLoading(false)
    })
  }, [workDate])

  // Кількість замовлення для клієнта+продукт
  const getQty = (clientId: number, productId: number): number => {
    return orders.find((o) => o.client_id === clientId && o.product_id === productId)?.qty ?? 0
  }

  const handleQtyChange = async (
    clientId: number,
    productId: number,
    qty: number,
  ) => {
    const existing = orders.find(
      (o) => o.client_id === clientId && o.product_id === productId,
    )

    if (existing) {
      if (qty === 0) {
        await api.delete(`/orders/${existing.id}`)
        setOrders((prev) => prev.filter((o) => o.id !== existing.id))
      } else {
        const updated = await api.put<Order>(`/orders/${existing.id}`, { qty })
        setOrders((prev) => prev.map((o) => (o.id === existing.id ? updated : o)))
      }
    } else if (qty > 0) {
      const created = await api.post<Order>('/orders/', {
        client_id: clientId,
        product_id: productId,
        qty,
        order_date: workDate,
      })
      setOrders((prev) => [...prev, created])
    }
  }

  if (loading) return <p>Завантаження...</p>

  return (
    <div>
      <h2>Замовлення — {workDate}</h2>
      {routes.map((route) => {
        const routeClients = clients.filter((c) => c.route_id === route.id)
        if (routeClients.length === 0) return null

        return (
          <section key={route.id} style={{ marginBottom: '2rem' }}>
            <h3 style={{ borderBottom: '2px solid #1a3a5c', paddingBottom: '0.25rem' }}>
              {route.name}
            </h3>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#e8eef5' }}>
                  <th style={thStyle}>Клієнт</th>
                  {products.map((p) => (
                    <th key={p.id} style={thStyle}>
                      {p.short_name ?? p.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {routeClients.map((client) => (
                  <tr key={client.id}>
                    <td style={tdStyle}>{client.short_name ?? client.full_name}</td>
                    {products.map((product) => (
                      <td key={product.id} style={{ ...tdStyle, textAlign: 'center' }}>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={getQty(client.id, product.id) || ''}
                          placeholder="—"
                          style={{ width: '60px', textAlign: 'center' }}
                          onChange={(e) =>
                            handleQtyChange(
                              client.id,
                              product.id,
                              Number(e.target.value),
                            )
                          }
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )
      })}
    </div>
  )
}

const thStyle: React.CSSProperties = {
  padding: '0.4rem 0.6rem',
  textAlign: 'left',
  fontWeight: 600,
  fontSize: '0.85rem',
}

const tdStyle: React.CSSProperties = {
  padding: '0.3rem 0.6rem',
  borderBottom: '1px solid #e0e0e0',
}
