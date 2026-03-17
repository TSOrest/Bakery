import { useEffect, useRef, useState } from 'react'
import { useWorkDate } from '../context/DateContext'
import { api } from '../api/client'
import type { Client, Order, Product, Route } from '../types'
import styles from './OrdersPage.module.css'

type CellKey = `${number}-${number}` // `${clientId}-${productId}`
type SavingMap = Record<CellKey, 'saving' | 'saved' | 'error'>

export default function OrdersPage() {
  const { workDate } = useWorkDate()

  const [routes,   setRoutes]   = useState<Route[]>([])
  const [clients,  setClients]  = useState<Client[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [orders,   setOrders]   = useState<Order[]>([])
  const [averages, setAverages] = useState<Record<number, number>>({})
  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState<SavingMap>({})

  // Навігація
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null)
  const [expandedRoutes,   setExpandedRoutes]   = useState<Set<number>>(new Set())

  // Копіювання
  const [showCopy,     setShowCopy]     = useState(false)
  const [copyFromDate, setCopyFromDate] = useState('')
  const [copyLoading,  setCopyLoading]  = useState(false)
  const [copyResult,   setCopyResult]   = useState<string | null>(null)

  const timers = useRef<Record<CellKey, ReturnType<typeof setTimeout>>>({})

  // ─── Завантаження ─────────────────────────────────────────────────────────

  const loadAll = (date: string) => {
    setLoading(true)
    Promise.all([
      api.get<Route[]>('/routes/'),
      api.get<Client[]>('/clients/'),
      api.get<Product[]>('/products/'),
      api.get<Order[]>(`/orders/?order_date=${date}`),
      api.get<Record<number, number>>('/orders/averages'),
    ]).then(([r, c, p, o, avg]) => {
      setRoutes(r.filter(rt => rt.is_active).sort((a, b) => a.sort_order - b.sort_order))
      setClients(c)
      setProducts(p)
      setOrders(o)
      setAverages(avg)
      // Розкриваємо перший маршрут з клієнтами
      const firstActive = r.find(rt => rt.is_active && c.some(cl => cl.route_id === rt.id && cl.is_active))
      if (firstActive) setExpandedRoutes(new Set([firstActive.id]))
      setLoading(false)
    })
  }

  useEffect(() => { loadAll(workDate) }, [workDate])

  // ─── Допоміжні ─────────────────────────────────────────────────────────────

  const getOrder = (clientId: number, productId: number): Order | undefined =>
    orders.find(o => o.client_id === clientId && o.product_id === productId && o.parent_order_id == null)

  const getQty = (clientId: number, productId: number): number =>
    getOrder(clientId, productId)?.qty ?? 0

  // Дочірні рядки для даного parent order id
  const getChildren = (parentId: number): Order[] =>
    orders.filter(o => o.parent_order_id === parentId)

  // Перевірка на потенційний дублікат
  const isDuplicate = (clientId: number, productId: number): boolean => {
    const matches = orders.filter(o =>
      o.client_id === clientId && o.product_id === productId && o.parent_order_id == null
    )
    return matches.length > 1
  }

  // ─── Збереження з дебаунсом ────────────────────────────────────────────────

  const handleQtyChange = (clientId: number, productId: number, qty: number) => {
    const key: CellKey = `${clientId}-${productId}`

    setOrders(prev => {
      const exists = prev.find(o => o.client_id === clientId && o.product_id === productId && o.parent_order_id == null)
      if (exists) {
        return prev.map(o =>
          o.client_id === clientId && o.product_id === productId && o.parent_order_id == null
            ? { ...o, qty } : o
        )
      }
      if (qty <= 0) return prev
      return [...prev, {
        id: -1, client_id: clientId, product_id: productId, qty, order_date: workDate,
        status: 'draft', source: 'phone', exchange_type: 'none', exchange_qty: 0,
        exchange_price: null, exchange_notes: null, price_override: null, notes: null,
        created_at: null, parent_order_id: null, delivered_qty: null,
      } as Order]
    })

    if (timers.current[key]) clearTimeout(timers.current[key])

    timers.current[key] = setTimeout(async () => {
      setSaving(s => ({ ...s, [key]: 'saving' }))
      try {
        const existing = orders.find(o => o.client_id === clientId && o.product_id === productId && o.parent_order_id == null)
        if (existing && existing.id !== -1) {
          if (qty <= 0) {
            await api.delete(`/orders/${existing.id}`)
            setOrders(prev => prev.filter(o => o.id !== existing.id))
          } else {
            const updated = await api.put<Order>(`/orders/${existing.id}`, { qty })
            setOrders(prev => prev.map(o => o.id === existing.id ? updated : o))
          }
        } else if (qty > 0) {
          const created = await api.post<Order>('/orders/', {
            client_id: clientId, product_id: productId, qty, order_date: workDate,
          })
          setOrders(prev => prev.map(o =>
            o.client_id === clientId && o.product_id === productId && o.id === -1 ? created : o
          ))
        }
        setSaving(s => ({ ...s, [key]: 'saved' }))
        setTimeout(() => setSaving(s => { const n = { ...s }; delete n[key]; return n }), 1500)
      } catch {
        setSaving(s => ({ ...s, [key]: 'error' }))
      }
    }, 600)
  }

  // ─── Копіювання ────────────────────────────────────────────────────────────

  const handleCopy = async () => {
    if (!copyFromDate) return
    setCopyLoading(true); setCopyResult(null)
    try {
      const res = await api.post<{ copied: number }>(`/orders/copy?source_date=${copyFromDate}&target_date=${workDate}`, {})
      setCopyResult(`Скопійовано: ${res.copied} замовлень`)
      loadAll(workDate)
    } catch { setCopyResult('Помилка копіювання') }
    finally { setCopyLoading(false) }
  }

  // ─── Підсумки ──────────────────────────────────────────────────────────────

  const clientTotal = (clientId: number): number =>
    orders.filter(o => o.client_id === clientId && o.parent_order_id == null).reduce((s, o) => s + o.qty, 0)

  const hasOrders = (clientId: number): boolean =>
    orders.some(o => o.client_id === clientId && o.qty > 0 && o.parent_order_id == null)

  // ─── Рендер ────────────────────────────────────────────────────────────────

  if (loading) return <p style={{ padding: '1rem' }}>Завантаження...</p>

  const activeProducts = products.filter(p => p.is_active)
  const selectedClient = clients.find(c => c.id === selectedClientId)
  const selId = selectedClientId ?? 0  // non-null alias for use inside JSX

  // Вироби впорядковані: з замовленнями → решта, в межах кожної групи за назвою
  const sortedProducts = selectedClientId
    ? [...activeProducts].sort((a, b) => {
        const aHas = getQty(selId, a.id) > 0 ? 0 : 1
        const bHas = getQty(selId, b.id) > 0 ? 0 : 1
        if (aHas !== bHas) return aHas - bHas
        return a.name.localeCompare(b.name, 'uk')
      })
    : activeProducts

  return (
    <div className={styles.page}>

      {/* Toolbar */}
      <div className={styles.toolbar}>
        <h2 className={styles.title}>Замовлення — {workDate}</h2>
        <button className={styles.btnCopy} onClick={() => { setShowCopy(v => !v); setCopyResult(null) }}>
          Скопіювати з дати
        </button>
      </div>

      {showCopy && (
        <div className={styles.copyPanel}>
          <span>Скопіювати з:</span>
          <input type="date" value={copyFromDate} onChange={e => setCopyFromDate(e.target.value)} className={styles.dateInput} />
          <button className={styles.btnPrimary} onClick={handleCopy} disabled={!copyFromDate || copyLoading}>
            {copyLoading ? 'Копіюю...' : 'Копіювати'}
          </button>
          <button className={styles.btnSecondary} onClick={() => setShowCopy(false)}>Скасувати</button>
          {copyResult && <span className={styles.copyResult}>{copyResult}</span>}
        </div>
      )}

      <div className={styles.layout}>

        {/* ── Ліва панель: маршрути → клієнти ── */}
        <aside className={styles.sidebar}>
          {routes.map(route => {
            const routeClients = clients.filter(c => c.route_id === route.id && c.is_active)
            if (routeClients.length === 0) return null
            const isExpanded = expandedRoutes.has(route.id)

            // Групуємо клієнтів по client_group
            const grouped: Record<string, Client[]> = {}
            for (const c of routeClients) {
              const g = c.client_group ?? ''
              if (!grouped[g]) grouped[g] = []
              grouped[g].push(c)
            }

            return (
              <div key={route.id} className={styles.routeGroup}>
                <button
                  className={styles.routeHeader}
                  onClick={() => setExpandedRoutes(prev => {
                    const n = new Set(prev)
                    n.has(route.id) ? n.delete(route.id) : n.add(route.id)
                    return n
                  })}
                >
                  <span className={styles.routeArrow}>{isExpanded ? '▾' : '▸'}</span>
                  <span className={styles.routeName}>{route.name}</span>
                  <span className={styles.routeBadge}>
                    {routeClients.filter(c => hasOrders(c.id)).length}/{routeClients.length}
                  </span>
                </button>

                {isExpanded && Object.entries(grouped).map(([group, gClients]) => (
                  <div key={group}>
                    {group && <div className={styles.groupLabel}>{group}</div>}
                    {gClients.map(client => {
                      const total = clientTotal(client.id)
                      const isSelected = client.id === selectedClientId
                      return (
                        <button
                          key={client.id}
                          className={`${styles.clientRow} ${isSelected ? styles.clientSelected : ''} ${total > 0 ? styles.clientHasOrders : ''}`}
                          onClick={() => setSelectedClientId(client.id)}
                        >
                          <span className={styles.clientName}>
                            {client.short_name ?? client.full_name}
                          </span>
                          {total > 0 && <span className={styles.clientTotal}>{total}</span>}
                        </button>
                      )
                    })}
                  </div>
                ))}
              </div>
            )
          })}
        </aside>

        {/* ── Права панель: замовлення клієнта ── */}
        <main className={styles.main}>
          {!selectedClient ? (
            <div className={styles.placeholder}>← Оберіть клієнта зі списку</div>
          ) : (
            <>
              <div className={styles.clientHeader}>
                <div>
                  <strong>{selectedClient.full_name}</strong>
                  {selectedClient.short_name && <span className={styles.clientAlt}> ({selectedClient.short_name})</span>}
                  {selectedClient.address && <span className={styles.clientAddr}> · {selectedClient.address}</span>}
                </div>
                <div className={styles.clientMeta}>
                  {selectedClient.is_own_shop ? <span className={styles.ownShopBadge}>🏪 Власний магазин</span> : null}
                  {selectedClient.phone && <span>{selectedClient.phone}</span>}
                </div>
              </div>

              <table className={styles.productTable}>
                <thead>
                  <tr>
                    <th className={styles.thProd}>Виріб</th>
                    <th className={styles.thAvg} title="Середнє за 30 днів">~30д</th>
                    <th className={styles.thQty}>Кількість</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedProducts.map(product => {
                    const key: CellKey = `${selId}-${product.id}`
                    const state = saving[key]
                    const qty = getQty(selId, product.id)
                    const avg = averages[product.id]
                    const order = getOrder(selId, product.id)
                    const children = order ? getChildren(order.id) : []
                    const dup = isDuplicate(selId, product.id)

                    return (
                      <>
                        <tr key={product.id} className={`${styles.productRow} ${qty > 0 ? styles.hasQty : ''}`}>
                          <td className={styles.tdProd}>
                            <span className={styles.prodName}>{product.name}</span>
                            {product.weight ? <span className={styles.prodWeight}> {product.weight}кг</span> : null}
                            {dup && <span className={styles.dupWarn} title="Можливий дублікат">⚠</span>}
                          </td>
                          <td className={styles.tdAvg}>
                            {avg ? <span className={styles.avgHint}>{avg}</span> : null}
                          </td>
                          <td className={styles.tdQty}>
                            <input
                              type="number"
                              min={0}
                              step={1}
                              value={qty || ''}
                              placeholder="—"
                              className={
                                styles.qtyInput +
                                (state === 'saving' ? ' ' + styles.saving : '') +
                                (state === 'saved'  ? ' ' + styles.saved  : '') +
                                (state === 'error'  ? ' ' + styles.error  : '')
                              }
                              onFocus={e => e.target.select()}
                              onChange={e => handleQtyChange(selId, product.id, Number(e.target.value))}
                            />
                          </td>
                        </tr>
                        {/* Дочірні рядки (переміщення) */}
                        {children.map(child => {
                          const childClient = clients.find(c => c.id === child.client_id)
                          return (
                            <tr key={`child-${child.id}`} className={styles.childRow}>
                              <td className={styles.tdProd} style={{ paddingLeft: '2rem' }}>
                                <span className={styles.childArrow}>↳</span>
                                {childClient ? (childClient.short_name ?? childClient.full_name) : `Клієнт #${child.client_id}`}
                              </td>
                              <td className={styles.tdAvg} />
                              <td className={styles.tdQty}>
                                <span className={styles.childQty}>{child.qty}</span>
                              </td>
                            </tr>
                          )
                        })}
                      </>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className={styles.totalRow}>
                    <td colSpan={2}><strong>Разом</strong></td>
                    <td className={styles.tdQty}>
                      <strong>{clientTotal(selId)}</strong>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </>
          )}
        </main>

      </div>
    </div>
  )
}
