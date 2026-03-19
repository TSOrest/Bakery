import { useEffect, useMemo, useRef, useState } from 'react'
import { useWorkDate } from '../context/DateContext'
import { api } from '../api/client'
import type { Client, Order, Product, Route } from '../types'
import OrderModal from '../components/OrderModal'
import styles from './OrdersPage.module.css'

type CellKey = `${number}-${number}`
type SavingMap = Record<CellKey, 'saving' | 'saved' | 'error'>

// effectivePrices[clientId][productId] = price
type PricesCache = Record<number, Record<number, number>>

const fmt = (n: number) =>
  n.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function OrdersPage() {
  const { workDate } = useWorkDate()

  const [routes,   setRoutes]   = useState<Route[]>([])
  const [clients,  setClients]  = useState<Client[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [orders,   setOrders]   = useState<Order[]>([])
  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState<SavingMap>({})
  const [prices,   setPrices]   = useState<PricesCache>({})

  const [selectedRouteId,  setSelectedRouteId]  = useState<number | null>(null)
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null)
  const [modalClientId,    setModalClientId]    = useState<number | null>(null)

  // Копіювання
  const [showCopy,     setShowCopy]     = useState(false)
  const [copyFromDate, setCopyFromDate] = useState('')
  const [copyLoading,  setCopyLoading]  = useState(false)
  const [copyResult,   setCopyResult]   = useState<string | null>(null)

  const timers    = useRef<Record<CellKey, ReturnType<typeof setTimeout>>>({})
  const exTimers  = useRef<Record<string,  ReturnType<typeof setTimeout>>>({})

  // ─── Завантаження ─────────────────────────────────────────────────────────

  const fetchPricesForClients = (clientIds: number[], date: string) => {
    const missing = clientIds.filter(id => !(id in prices))
    if (missing.length === 0) return
    Promise.all(
      missing.map(cid =>
        api.get<Record<number, number>>(`/prices/effective?client_id=${cid}&date=${date}`)
          .then(p => ({ cid, p }))
          .catch(() => ({ cid, p: {} as Record<number, number> }))
      )
    ).then(results => {
      setPrices(prev => {
        const next = { ...prev }
        for (const { cid, p } of results) next[cid] = p
        return next
      })
    })
  }

  const loadAll = (date: string) => {
    setLoading(true)
    setPrices({})
    Promise.all([
      api.get<Route[]>('/routes/'),
      api.get<Client[]>('/clients/'),
      api.get<Product[]>('/products/'),
      api.get<Order[]>(`/orders/?order_date=${date}`),
    ]).then(([r, c, p, o]) => {
      setRoutes(r.filter(rt => rt.is_active).sort((a, b) => a.sort_order - b.sort_order))
      setClients(c)
      setProducts(p)
      setOrders(o)
      setLoading(false)
      // Завантажуємо ціни для всіх клієнтів з замовленнями
      const uniqueIds = [...new Set(o.map(ord => ord.client_id))]
      if (uniqueIds.length > 0) {
        Promise.all(
          uniqueIds.map(cid =>
            api.get<Record<number, number>>(`/prices/effective?client_id=${cid}&date=${date}`)
              .then(pr => ({ cid, pr }))
              .catch(() => ({ cid, pr: {} as Record<number, number> }))
          )
        ).then(results => {
          const cache: PricesCache = {}
          for (const { cid, pr } of results) cache[cid] = pr
          setPrices(cache)
        })
      }
    })
  }

  useEffect(() => { loadAll(workDate) }, [workDate])

  // Якщо відкривається модалка для клієнта без завантажених цін — підвантажуємо
  useEffect(() => {
    if (modalClientId != null) fetchPricesForClients([modalClientId], workDate)
  }, [modalClientId, workDate])

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

  // ─── Зміна exchange_qty ────────────────────────────────────────────────────

  const handleExchangeQtyChange = (clientId: number, productId: number, exQty: number) => {
    setOrders(prev => prev.map(o =>
      o.client_id === clientId && o.product_id === productId && o.parent_order_id == null
        ? { ...o, exchange_qty: exQty }
        : o
    ))
    const timerKey = `ex-${clientId}-${productId}`
    if (exTimers.current[timerKey]) clearTimeout(exTimers.current[timerKey])
    exTimers.current[timerKey] = setTimeout(async () => {
      const existing = orders.find(o =>
        o.client_id === clientId && o.product_id === productId && o.parent_order_id == null && o.id !== -1
      )
      if (existing) {
        try { await api.put(`/orders/${existing.id}`, { exchange_qty: exQty >= 0 ? exQty : 0 }) }
        catch {}
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

  // ─── Індекси ──────────────────────────────────────────────────────────────

  const clientMap  = useMemo(() => new Map(clients.map(c => [c.id, c])),  [clients])
  const routeMap   = useMemo(() => new Map(routes.map(r => [r.id, r])),   [routes])
  const productMap = useMemo(() => new Map(products.map(p => [p.id, p])), [products])

  // ─── Підрахунки по клієнту ────────────────────────────────────────────────

  const clientBread = (id: number) =>
    orders.filter(o => o.client_id === id && o.parent_order_id == null)
      .reduce((s, o) => s + (productMap.get(o.product_id)?.type === 'bread' ? o.qty : 0), 0)

  const clientBun = (id: number) =>
    orders.filter(o => o.client_id === id && o.parent_order_id == null)
      .reduce((s, o) => s + (productMap.get(o.product_id)?.type === 'bun' ? o.qty : 0), 0)

  // ─── Рендер ────────────────────────────────────────────────────────────────

  if (loading) return <p style={{ padding: '1rem' }}>Завантаження...</p>

  const isShop = (c: Client) => c.client_kind === 'shop' || c.is_own_shop === 1

  const sidebarClients = clients
    .filter(c => {
      if (!c.is_active) return false
      if (c.client_kind === 'writeoff' || c.client_kind === 'ration') return false
      if (isShop(c)) return true   // магазин — завжди видно
      return selectedRouteId == null || c.route_id === selectedRouteId
    })
    .sort((a, b) => {
      // Магазини — завжди зверху
      const aShop = isShop(a) ? 0 : 1
      const bShop = isShop(b) ? 0 : 1
      if (aShop !== bShop) return aShop - bShop
      return (a.short_name ?? a.full_name).localeCompare(b.short_name ?? b.full_name, 'uk')
    })

  const ordersToShow = orders
    .filter(o => {
      if (o.parent_order_id != null || o.qty <= 0) return false
      if (selectedRouteId != null) {
        const c = clientMap.get(o.client_id)
        if (!c || c.route_id !== selectedRouteId) return false
      }
      if (selectedClientId != null && o.client_id !== selectedClientId) return false
      return true
    })
    .sort((a, b) => {
      const ca = clientMap.get(a.client_id); const cb = clientMap.get(b.client_id)
      const ra = routeMap.get(ca?.route_id ?? 0); const rb = routeMap.get(cb?.route_id ?? 0)
      const rOrd = (ra?.sort_order ?? 0) - (rb?.sort_order ?? 0)
      if (rOrd !== 0) return rOrd
      const cName = (ca?.short_name ?? ca?.full_name ?? '').localeCompare(cb?.short_name ?? cb?.full_name ?? '', 'uk')
      if (cName !== 0) return cName
      return (productMap.get(a.product_id)?.name ?? '').localeCompare(productMap.get(b.product_id)?.name ?? '', 'uk')
    })

  const routeBadge = (routeId: number | null) => {
    const visible = (c: typeof clients[0]) =>
      c.is_active && c.client_kind !== 'writeoff' && c.client_kind !== 'ration'
    const rc = routeId == null
      ? clients.filter(visible)
      : clients.filter(c => visible(c) && (c.client_kind === 'shop' || c.is_own_shop || c.route_id === routeId))
    const withOrders = rc.filter(c => orders.some(o => o.client_id === c.id && o.qty > 0 && o.parent_order_id == null))
    return `${withOrders.length}/${rc.length}`
  }

  const modalClient = modalClientId != null ? clientMap.get(modalClientId) : undefined

  const showRouteCol  = selectedRouteId == null
  const showClientCol = selectedClientId == null
  const colCount = (showRouteCol ? 1 : 0) + (showClientCol ? 1 : 0) + 6

  const openBakingPrint = (type: 'bread' | 'bun') =>
    window.open(`/api/v1/print/baking?task_date=${workDate}&product_type=${type}`, '_blank')

  // Колір клітинки Хл/Бул: червоний якщо обидва 0, жовтий якщо цей 0 а інший > 0
  const numCellClass = (val: number, other: number) => {
    if (val === 0 && other === 0) return styles.cellRed
    if (val === 0) return styles.cellYellow
    return ''
  }

  return (
    <div className={styles.page}>

      {/* ── Toolbar ── */}
      <div className={styles.toolbar}>
        <h2 className={styles.title}>Замовлення — {workDate}</h2>
        <button className={styles.btnCopy} onClick={() => { setShowCopy(v => !v); setCopyResult(null) }}>
          Скопіювати з дати
        </button>
        <div className={styles.bakingBtns}>
          <button className={styles.btnBaking} onClick={() => openBakingPrint('bread')}>Завдання Хліб</button>
          <button className={styles.btnBaking} onClick={() => openBakingPrint('bun')}>Завдання Булки</button>
        </div>
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

        {/* ── Ліва панель ── */}
        <aside className={styles.sidebar}>

          {/* Маршрути */}
          <div className={styles.routeFilter}>
            <button
              className={`${styles.routeBtn} ${selectedRouteId == null ? styles.routeBtnActive : ''}`}
              onClick={() => { setSelectedRouteId(null); setSelectedClientId(null) }}
            >
              <span className={styles.routeBtnName}>Всі маршрути</span>
              <span className={styles.routeBtnBadge}>{routeBadge(null)}</span>
            </button>
            {routes.map(route => (
              <button
                key={route.id}
                className={`${styles.routeBtn} ${selectedRouteId === route.id ? styles.routeBtnActive : ''}`}
                onClick={() => { setSelectedRouteId(route.id); setSelectedClientId(null) }}
              >
                <span className={styles.routeBtnName}>{route.name}</span>
                <span className={styles.routeBtnBadge}>{routeBadge(route.id)}</span>
              </button>
            ))}
          </div>

          {/* Клієнти */}
          <div className={styles.clientListWrap}>
            <div className={styles.clientListHeader}>
              <span className={styles.chName}>Клієнт</span>
              <span className={styles.chNum} title="Хліб">Хл</span>
              <span className={styles.chNum} title="Булки">Бул</span>
              <span className={styles.chBtn}></span>
            </div>
            <div className={styles.clientList}>
              {sidebarClients.map(client => {
                const bread = clientBread(client.id)
                const bun   = clientBun(client.id)
                const isSel = client.id === selectedClientId
                return (
                  <div
                    key={client.id}
                    className={[
                      styles.clientItem,
                      isSel ? styles.clientSel : '',
                      (client.client_kind === 'shop' || client.is_own_shop) ? styles.clientShop : '',
                    ].join(' ')}
                    onClick={() => {
                      if (isSel) { setSelectedClientId(null) }
                      else {
                        setSelectedClientId(client.id)
                        if (isShop(client)) setSelectedRouteId(null)
                      }
                    }}
                  >
                    <span className={styles.ciName}>{client.short_name ?? client.full_name}</span>
                    <span className={`${styles.ciNum} ${numCellClass(bread, bun)}`}>
                      {bread || ''}
                    </span>
                    <span className={`${styles.ciNum} ${numCellClass(bun, bread)}`}>
                      {bun || ''}
                    </span>
                    <button
                      className={styles.ciAddBtn}
                      title="Відкрити замовлення"
                      onClick={e => { e.stopPropagation(); setModalClientId(client.id) }}
                    >+</button>
                  </div>
                )
              })}
            </div>
          </div>
        </aside>

        {/* ── Таблиця замовлень ── */}
        <main className={styles.main}>
          <table className={styles.ordersTable}>
            <thead>
              <tr>
                {showRouteCol  && <th className={styles.thRoute}>Маршрут</th>}
                {showClientCol && <th className={styles.thClient}>Клієнт</th>}
                <th className={styles.thProduct}>Виріб</th>
                <th className={styles.thNum}>Замовл.</th>
                <th className={styles.thNum}>Ціна</th>
                <th className={styles.thNum}>Обмін</th>
                <th className={styles.thNum}>Всього</th>
                <th className={styles.thNum}>Сума</th>
              </tr>
            </thead>
            <tbody>
              {ordersToShow.map(order => {
                const client  = clientMap.get(order.client_id)
                const route   = routeMap.get(client?.route_id ?? 0)
                const product = productMap.get(order.product_id)
                const price   = prices[order.client_id]?.[order.product_id]
                const exQty   = order.exchange_qty ?? 0
                const total   = order.qty + exQty
                const sum     = price != null ? order.qty * price : null
                const isSel   = order.client_id === selectedClientId
                return (
                  <tr
                    key={order.id}
                    className={`${styles.orderRow} ${isSel ? styles.orderRowSel : ''}`}
                  >
                    {showRouteCol  && <td className={styles.tdRoute}>{route?.name ?? '—'}</td>}
                    {showClientCol && (
                      <td className={styles.tdClient}>
                        {client?.short_name ?? client?.full_name ?? '—'}
                      </td>
                    )}
                    <td className={styles.tdProduct}>{product?.name ?? '—'}</td>
                    <td className={styles.tdNum}>{order.qty}</td>
                    <td className={styles.tdPrice}>
                      {price != null ? fmt(price) : '—'}
                    </td>
                    <td className={styles.tdNum}>{exQty > 0 ? exQty : ''}</td>
                    <td className={styles.tdNum}>{total}</td>
                    <td className={styles.tdSum}>
                      {sum != null ? fmt(sum) : '—'}
                    </td>
                  </tr>
                )
              })}
              {ordersToShow.length === 0 && (
                <tr>
                  <td colSpan={colCount} className={styles.emptyMsg}>— Замовлень немає —</td>
                </tr>
              )}
            </tbody>
          </table>
        </main>

      </div>

      {/* ── Модальне вікно ── */}
      {modalClient && (
        <OrderModal
          client={modalClient}
          workDate={workDate}
          products={products}
          orders={orders}
          saving={saving}
          onQtyChange={handleQtyChange}
          onExchangeQtyChange={handleExchangeQtyChange}
          onClose={() => setModalClientId(null)}
        />
      )}

    </div>
  )
}
