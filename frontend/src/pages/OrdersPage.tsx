import { useEffect, useRef, useState } from 'react'
import { useWorkDate } from '../context/DateContext'
import { api } from '../api/client'
import type { Client, Order, Product, Route } from '../types'
import styles from './OrdersPage.module.css'

// ─── Типи ────────────────────────────────────────────────────────────────────

type CellKey = `${number}-${number}` // `${clientId}-${productId}`
type SavingMap = Record<CellKey, 'saving' | 'saved' | 'error'>

// ─── Головний компонент ───────────────────────────────────────────────────────

export default function OrdersPage() {
  const { workDate } = useWorkDate()

  const [routes,   setRoutes]   = useState<Route[]>([])
  const [clients,  setClients]  = useState<Client[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [orders,   setOrders]   = useState<Order[]>([])
  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState<SavingMap>({})

  // Для "копіювати з дати"
  const [showCopy,     setShowCopy]     = useState(false)
  const [copyFromDate, setCopyFromDate] = useState('')
  const [copyLoading,  setCopyLoading]  = useState(false)
  const [copyResult,   setCopyResult]   = useState<string | null>(null)

  // Дебаунс: таймери по кожній комірці
  const timers = useRef<Record<CellKey, ReturnType<typeof setTimeout>>>({})

  // ─── Завантаження ───────────────────────────────────────────────────────────

  const loadAll = (date: string) => {
    setLoading(true)
    Promise.all([
      api.get<Route[]>('/routes/'),
      api.get<Client[]>('/clients/'),
      api.get<Product[]>('/products/'),
      api.get<Order[]>(`/orders/?order_date=${date}`),
    ]).then(([r, c, p, o]) => {
      setRoutes(r)
      setClients(c)
      setProducts(p)
      setOrders(o)
      setLoading(false)
    })
  }

  useEffect(() => {
    loadAll(workDate)
  }, [workDate])

  // ─── Читання поточної кількості ─────────────────────────────────────────────

  const getQty = (clientId: number, productId: number): number =>
    orders.find((o) => o.client_id === clientId && o.product_id === productId)?.qty ?? 0

  // ─── Збереження з дебаунсом ─────────────────────────────────────────────────
  // Чекаємо 600 мс після останньої зміни в комірці — тільки тоді шлемо запит.
  // Це потрібно щоб при наборі "100" не летіло три запити (1, 10, 100).

  const handleQtyChange = (clientId: number, productId: number, qty: number) => {
    const key: CellKey = `${clientId}-${productId}`

    // Оновлюємо відображення одразу (без очікування API)
    setOrders((prev) => {
      const exists = prev.find((o) => o.client_id === clientId && o.product_id === productId)
      if (exists) {
        return prev.map((o) =>
          o.client_id === clientId && o.product_id === productId ? { ...o, qty } : o,
        )
      }
      if (qty <= 0) return prev
      // Заглушка до відповіді від сервера
      return [...prev, { id: -1, client_id: clientId, product_id: productId, qty, order_date: workDate,
        status: 'draft', source: 'phone', exchange_type: 'none', exchange_qty: 0,
        exchange_price: null, exchange_notes: null, price_override: null, notes: null, created_at: null }]
    })

    // Скидаємо попередній таймер для цієї комірки
    if (timers.current[key]) clearTimeout(timers.current[key])

    timers.current[key] = setTimeout(async () => {
      setSaving((s) => ({ ...s, [key]: 'saving' }))
      try {
        const existing = orders.find(
          (o) => o.client_id === clientId && o.product_id === productId,
        )
        if (existing && existing.id !== -1) {
          if (qty <= 0) {
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
          // Замінюємо заглушку (-1) реальним записом
          setOrders((prev) =>
            prev.map((o) =>
              o.client_id === clientId && o.product_id === productId && o.id === -1 ? created : o,
            ),
          )
        }
        setSaving((s) => ({ ...s, [key]: 'saved' }))
        // Прибираємо позначку через 1.5 с
        setTimeout(() => setSaving((s) => { const n = { ...s }; delete n[key]; return n }), 1500)
      } catch {
        setSaving((s) => ({ ...s, [key]: 'error' }))
      }
    }, 600)
  }

  // ─── Копіювання замовлень ───────────────────────────────────────────────────

  const handleCopy = async () => {
    if (!copyFromDate) return
    setCopyLoading(true)
    setCopyResult(null)
    try {
      const res = await api.post<{ copied: number }>(
        `/orders/copy?source_date=${copyFromDate}&target_date=${workDate}`, {}
      )
      setCopyResult(`Скопійовано: ${res.copied} замовлень`)
      loadAll(workDate)
    } catch (e) {
      setCopyResult('Помилка копіювання')
    } finally {
      setCopyLoading(false)
    }
  }

  // ─── Підсумки по продуктах ──────────────────────────────────────────────────

  const productTotal = (productId: number): number =>
    orders.reduce((sum, o) => (o.product_id === productId ? sum + o.qty : sum), 0)

  const routeTotal = (routeId: number, productId: number): number => {
    const routeClientIds = clients.filter((c) => c.route_id === routeId).map((c) => c.id)
    return orders
      .filter((o) => routeClientIds.includes(o.client_id) && o.product_id === productId)
      .reduce((sum, o) => sum + o.qty, 0)
  }

  // ─── Рендер ─────────────────────────────────────────────────────────────────

  if (loading) return <p style={{ padding: '1rem' }}>Завантаження...</p>

  const activeProducts = products.filter((p) => p.is_active)

  return (
    <div className={styles.page}>

      {/* Заголовок і кнопки */}
      <div className={styles.toolbar}>
        <h2 className={styles.title}>Замовлення — {workDate}</h2>
        <button className={styles.btnCopy} onClick={() => { setShowCopy((v) => !v); setCopyResult(null) }}>
          Скопіювати з дати
        </button>
      </div>

      {/* Панель копіювання */}
      {showCopy && (
        <div className={styles.copyPanel}>
          <span>Скопіювати замовлення з:</span>
          <input
            type="date"
            value={copyFromDate}
            onChange={(e) => setCopyFromDate(e.target.value)}
            className={styles.dateInput}
          />
          <button
            className={styles.btnPrimary}
            onClick={handleCopy}
            disabled={!copyFromDate || copyLoading}
          >
            {copyLoading ? 'Копіюю...' : 'Копіювати'}
          </button>
          <button className={styles.btnSecondary} onClick={() => setShowCopy(false)}>
            Скасувати
          </button>
          {copyResult && <span className={styles.copyResult}>{copyResult}</span>}
        </div>
      )}

      {/* Таблиці по маршрутах */}
      {routes.map((route) => {
        const routeClients = clients.filter((c) => c.route_id === route.id && c.is_active)
        if (routeClients.length === 0) return null

        return (
          <section key={route.id} className={styles.section}>
            <h3 className={styles.routeTitle}>{route.name}</h3>

            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.thClient}>Клієнт</th>
                    {activeProducts.map((p) => (
                      <th key={p.id} className={styles.thProduct}>
                        {p.short_name ?? p.name}
                      </th>
                    ))}
                    <th className={styles.thSum}>Разом</th>
                  </tr>
                </thead>
                <tbody>
                  {routeClients.map((client) => {
                    const rowTotal = activeProducts.reduce(
                      (s, p) => s + getQty(client.id, p.id), 0
                    )
                    return (
                      <tr key={client.id} className={styles.row}>
                        <td className={styles.tdClient}>
                          {client.short_name ?? client.full_name}
                        </td>
                        {activeProducts.map((product) => {
                          const key: CellKey = `${client.id}-${product.id}`
                          const state = saving[key]
                          return (
                            <td key={product.id} className={styles.tdQty}>
                              <input
                                type="number"
                                min={0}
                                step={1}
                                value={getQty(client.id, product.id) || ''}
                                placeholder="—"
                                className={
                                  styles.qtyInput +
                                  (state === 'saving' ? ' ' + styles.saving : '') +
                                  (state === 'saved'  ? ' ' + styles.saved  : '') +
                                  (state === 'error'  ? ' ' + styles.error  : '')
                                }
                                onFocus={(e) => e.target.select()}
                                onChange={(e) =>
                                  handleQtyChange(client.id, product.id, Number(e.target.value))
                                }
                              />
                            </td>
                          )
                        })}
                        <td className={styles.tdSum}>
                          {rowTotal > 0 ? rowTotal : ''}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>

                {/* Підсумок по маршруту */}
                <tfoot>
                  <tr className={styles.footerRow}>
                    <td className={styles.tdClient}>
                      <strong>Разом по маршруту</strong>
                    </td>
                    {activeProducts.map((p) => {
                      const t = routeTotal(route.id, p.id)
                      return (
                        <td key={p.id} className={styles.tdQty} style={{ fontWeight: 600 }}>
                          {t > 0 ? t : ''}
                        </td>
                      )
                    })}
                    <td className={styles.tdSum}>
                      <strong>
                        {activeProducts.reduce((s, p) => s + routeTotal(route.id, p.id), 0) || ''}
                      </strong>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
        )
      })}

      {/* Загальний підсумок */}
      {routes.length > 1 && (
        <section className={styles.grandTotal}>
          <table className={styles.table}>
            <tbody>
              <tr className={styles.grandRow}>
                <td className={styles.tdClient}><strong>ВСЬОГО</strong></td>
                {activeProducts.map((p) => {
                  const t = productTotal(p.id)
                  return (
                    <td key={p.id} className={styles.tdQty} style={{ fontWeight: 700 }}>
                      {t > 0 ? t : ''}
                    </td>
                  )
                })}
                <td className={styles.tdSum}>
                  <strong>{orders.reduce((s, o) => s + o.qty, 0) || ''}</strong>
                </td>
              </tr>
            </tbody>
          </table>
        </section>
      )}
    </div>
  )
}
