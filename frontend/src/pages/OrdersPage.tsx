import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useWorkDate } from '../context/DateContext'
import { api } from '../api/client'
import type { BotBroadcastResult, BotPendingOrder, Category, Client, Order, Product, Route } from '../types'
import OrderModal from '../components/OrderModal'
import styles from './OrdersPage.module.css'

type CellKey = `${number}-${number}`
type SavingMap = Record<CellKey, 'saving' | 'saved' | 'error'>

// effectivePrices[clientId][productId] = price
type PricesCache = Record<number, Record<number, number>>

const fmt = (n: number) =>
  n.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function BotPendingRow({
  order,
  onVerify,
}: {
  order: BotPendingOrder
  onVerify: (id: number, action: 'confirm' | 'reject' | 'modify', newQty?: number, reason?: string) => void
}) {
  const [rejectReason, setRejectReason] = useState('')
  const [newQty, setNewQty] = useState(order.qty)
  const [mode, setMode] = useState<'idle' | 'reject' | 'modify'>('idle')

  return (
    <>
      <tr className={styles.botPendingRow}>
        <td className={styles.botTd}>{order.client_name}</td>
        <td className={styles.botTd}>{order.product_name}</td>
        <td className={styles.botTd} style={{ textAlign: 'right' }}>{order.qty}</td>
        <td className={styles.botTd} style={{ textAlign: 'right' }}>{fmt(order.sum)}</td>
        <td className={styles.botTd}>
          <div className={styles.botActions}>
            <button className={styles.botBtnConfirm} title="Підтвердити" onClick={() => onVerify(order.id, 'confirm')}>✓</button>
            <button className={styles.botBtnModify} title="Змінити кількість" onClick={() => setMode(mode === 'modify' ? 'idle' : 'modify')}>✏️</button>
            <button className={styles.botBtnReject} title="Відхилити" onClick={() => setMode(mode === 'reject' ? 'idle' : 'reject')}>✗</button>
          </div>
        </td>
      </tr>
      {mode === 'reject' && (
        <tr>
          <td colSpan={5} className={styles.botExpandRow}>
            <input
              placeholder="Причина відхилення"
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              className={styles.botInput}
              autoFocus
            />
            <button className={styles.botBtnRejectWide}
              onClick={() => onVerify(order.id, 'reject', undefined, rejectReason)}>
              Відхилити
            </button>
          </td>
        </tr>
      )}
      {mode === 'modify' && (
        <tr>
          <td colSpan={5} className={styles.botExpandRow}>
            <span style={{ fontSize: '0.82rem', whiteSpace: 'nowrap' }}>К-сть:</span>
            <input
              type="number" min={1} step={1}
              value={newQty}
              onChange={e => setNewQty(Number(e.target.value))}
              className={styles.botInputQty}
              autoFocus
            />
            <input
              placeholder="Примітка (необов'язково)"
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              className={styles.botInput}
            />
            <button className={styles.botBtnModifyWide}
              onClick={() => onVerify(order.id, 'modify', newQty, rejectReason)}>
              Підтвердити зі змінами
            </button>
          </td>
        </tr>
      )}
    </>
  )
}

export default function OrdersPage() {
  const { workDate } = useWorkDate()

  const [routes,     setRoutes]     = useState<Route[]>([])
  const [clients,    setClients]    = useState<Client[]>([])
  const [products,   setProducts]   = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [orders,     setOrders]     = useState<Order[]>([])
  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState<SavingMap>({})
  const [prices,   setPrices]   = useState<PricesCache>({})

  const [selectedRouteId,  setSelectedRouteId]  = useState<number | null>(null)
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null)
  const [modalClientId,    setModalClientId]    = useState<number | null>(null)

  const [pendingBotOrders,  setPendingBotOrders]  = useState<BotPendingOrder[]>([])
  const [broadcastMsg,      setBroadcastMsg]      = useState<string | null>(null)
  const [broadcastLoading,  setBroadcastLoading]  = useState(false)
  const [printNotice,       setPrintNotice]       = useState<string | null>(null)
  const [printDropdownOpen, setPrintDropdownOpen] = useState(false)

  const [botStatus,        setBotStatus]        = useState<{ accepting: boolean; closed_until: string | null } | null>(null)
  const [botStatusLoading, setBotStatusLoading] = useState(false)
  const [lockedClientIds,  setLockedClientIds]  = useState<Set<number>>(new Set())
  const [expandedIds,      setExpandedIds]      = useState<Set<number>>(new Set())

const timers = useRef<Record<CellKey, ReturnType<typeof setTimeout>>>({})

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
      api.get<Category[]>('/categories?active_only=false'),
      api.get<Order[]>(`/orders/?order_date=${date}`),
    ]).then(([r, c, p, cats, o]) => {
      setRoutes(r.filter(rt => rt.is_active).sort((a, b) => a.sort_order - b.sort_order))
      setClients(c)
      setProducts(p)
      setCategories(cats)
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

  const loadPending = () => {
    api.get<BotPendingOrder[]>(`/bot/pending-orders?order_date=${workDate}`)
      .then(setPendingBotOrders).catch(() => {})
  }
  useEffect(() => {
    loadPending()
    const interval = setInterval(loadPending, 30_000)
    return () => clearInterval(interval)
  }, [workDate])

  const fetchBotStatus = () => {
    api.get<{ accepting: boolean; closed_until: string | null }>('/bot/order-status')
      .then(setBotStatus).catch(() => {})
  }
  const fetchLockedClients = (date: string) => {
    api.get<number[]>(`/invoices/locked-clients?date=${date}`)
      .then(ids => setLockedClientIds(new Set(ids))).catch(() => {})
  }
  useEffect(() => { fetchBotStatus(); fetchLockedClients(workDate) }, [workDate])

  const handleVerify = async (orderId: number, action: 'confirm' | 'reject' | 'modify', newQty?: number, reason?: string) => {
    await api.put(`/bot/orders/${orderId}/verify`, { action, new_qty: newQty, reason })
    loadPending()
    loadAll(workDate)
  }

  const handleBroadcast = async (type: 'reminder' | 'deadline') => {
    setBroadcastLoading(true)
    setBroadcastMsg(null)
    try {
      const r = await api.post<BotBroadcastResult>(`/bot/broadcast-${type}?order_date=${workDate}`, {})
      setBroadcastMsg(`Надіслано: ${r.sent}, пропущено (вже є замовлення): ${r.skipped}`)
    } catch {
      setBroadcastMsg('Помилка розсилки')
    } finally {
      setBroadcastLoading(false)
      setTimeout(() => setBroadcastMsg(null), 5000)
    }
  }

  const handleBotStop = async () => {
    setBotStatusLoading(true)
    try {
      await api.post('/bot/order-status/stop', {})
      fetchBotStatus()
    } finally { setBotStatusLoading(false) }
  }

  const handleBotResume = async () => {
    setBotStatusLoading(true)
    try {
      await api.post('/bot/order-status/resume', {})
      fetchBotStatus()
    } finally { setBotStatusLoading(false) }
  }

  // Якщо відкривається модалка для клієнта без завантажених цін — підвантажуємо
  useEffect(() => {
    if (modalClientId != null) fetchPricesForClients([modalClientId], workDate)
  }, [modalClientId, workDate])

  // ─── Збереження з дебаунсом ────────────────────────────────────────────────

  const handleQtyChange = (clientId: number, productId: number, qty: number) => {
    const key: CellKey = `${clientId}-${productId}`

    // Знаходимо тільки основне замовлення (не exchange і не price_override рядки)
    const isMainOrder = (o: Order) =>
      o.client_id === clientId &&
      o.product_id === productId &&
      o.parent_order_id == null &&
      o.origin_id == null &&
      o.exchange_type === 'none' &&
      o.price_override == null

    setOrders(prev => {
      const exists = prev.find(isMainOrder)
      if (exists) {
        return prev.map(o => isMainOrder(o) ? { ...o, qty } : o)
      }
      if (qty <= 0) return prev
      return [...prev, {
        id: -1, client_id: clientId, product_id: productId, qty, order_date: workDate,
        source: 'phone', exchange_type: 'none', exchange_qty: 0,
        exchange_price: null, exchange_notes: null, price_override: null, notes: null,
        created_at: null, parent_order_id: null, delivered_qty: null, origin_id: null,
        bot_status: null, bot_rejection_reason: null, bot_original_qty: null,
      } as Order]
    })

    if (timers.current[key]) clearTimeout(timers.current[key])

    timers.current[key] = setTimeout(async () => {
      setSaving(s => ({ ...s, [key]: 'saving' }))
      try {
        const existing = orders.find(isMainOrder)
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
            isMainOrder(o) && o.id === -1 ? created : o
          ))
        }
        setSaving(s => ({ ...s, [key]: 'saved' }))
        setTimeout(() => setSaving(s => { const n = { ...s }; delete n[key]; return n }), 1500)
      } catch {
        setSaving(s => ({ ...s, [key]: 'error' }))
      }
    }, 600)
  }


  // ─── Індекси ──────────────────────────────────────────────────────────────

  const clientMap  = useMemo(() => new Map(clients.map(c => [c.id, c])),  [clients])
  const routeMap   = useMemo(() => new Map(routes.map(r => [r.id, r])),   [routes])
  const productMap = useMemo(() => new Map(products.map(p => [p.id, p])), [products])

  // Дочірні рядки: зняття нестачі (parent_order_id != null, origin_id == null)
  const childOrdersMap = useMemo(() => {
    const map = new Map<number, Order[]>()
    for (const o of orders) {
      if (o.parent_order_id != null && o.origin_id == null) {
        const arr = map.get(o.parent_order_id) ?? []
        arr.push(o)
        map.set(o.parent_order_id, arr)
      }
    }
    return map
  }, [orders])

  const toggleExpand = (id: number) =>
    setExpandedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  // ─── Підрахунки по клієнту ────────────────────────────────────────────────

  const bakedCategories = useMemo(
    () => [...categories].filter(c => c.is_baked).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'uk')),
    [categories]
  )

  const clientCategoryQty = (clientId: number, categoryId: number) =>
    orders
      .filter(o =>
        o.client_id === clientId &&
        o.parent_order_id == null &&
        (o.origin_id == null || o.origin_id === 0) &&
        o.exchange_type === 'none' &&
        o.price_override == null
      )
      .reduce((s, o) => s + (productMap.get(o.product_id)?.category_id === categoryId ? o.qty : 0), 0)

  // ─── Рендер ────────────────────────────────────────────────────────────────

  if (loading) return <p style={{ padding: '1rem' }}>Завантаження...</p>

  const isShop = (c: Client) => c.client_kind === 'shop'

  const sidebarClients = clients
    .filter(c => {
      if (!c.is_active) return false
      if (c.client_kind === 'writeoff' || c.client_kind === 'ration' || c.client_kind === 'underbaked') return false
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
      // Тільки кореневі рядки — виключаємо лише знімання нестачі (дочірні)
      if (o.parent_order_id != null) return false
      if (o.qty <= 0) return false
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
      c.is_active && c.client_kind !== 'writeoff' && c.client_kind !== 'ration' && c.client_kind !== 'underbaked'
    const rc = routeId == null
      ? clients.filter(visible)
      : clients.filter(c => visible(c) && (c.client_kind === 'shop' || c.route_id === routeId))
    const withOrders = rc.filter(c => orders.some(o =>
      o.client_id === c.id && o.qty > 0 &&
      o.parent_order_id == null && (o.origin_id == null || o.origin_id === 0) &&
      o.exchange_type === 'none' && o.price_override == null
    ))
    return `${withOrders.length}/${rc.length}`
  }

  const modalClient = modalClientId != null ? clientMap.get(modalClientId) : undefined

  const colCount = 7

  const openBakingPrint = async (categoryId: number) => {
    if (pendingBotOrders.length > 0) {
      const ok = window.confirm(
        `⚠️ Є ${pendingBotOrders.length} непідтверджених замовлень через бота.\n\n` +
        `Вони будуть проігноровані при друку.\n\nПродовжити?`
      )
      if (!ok) return
    }
    const url = `/api/v1/print/baking?task_date=${workDate}&category_id=${categoryId}`
    const res = await fetch(url, { headers: { Authorization: `Bearer ${localStorage.getItem('bakery_token')}` } })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setPrintNotice(data.detail ?? 'Немає даних для друку')
      setTimeout(() => setPrintNotice(null), 4000)
    } else {
      window.open(url, '_blank')
    }
  }

  return (
    <div className={styles.page}>

      {/* ── Toolbar ── */}
      <div className={styles.toolbar}>
        <h2 className={styles.title}>Замовлення — {workDate}</h2>
        <div className={styles.bakingBtns}>
          {/* Дропдаун друку завдань */}
          {bakedCategories.length > 0 && (
            <div className={styles.printDropdown}>
              {/* Прозорий backdrop — закриває дропдаун при кліку поза ним */}
              {printDropdownOpen && (
                <div
                  style={{ position: 'fixed', inset: 0, zIndex: 199 }}
                  onClick={() => setPrintDropdownOpen(false)}
                />
              )}
              <button
                className={styles.btnBaking}
                onClick={() => setPrintDropdownOpen(v => !v)}
              >
                Друк завдання ▾
              </button>
              {printDropdownOpen && (
                <div className={styles.printDropdownMenu}>
                  {bakedCategories.map(cat => (
                    <button
                      key={cat.id}
                      className={styles.printDropdownItem}
                      onClick={() => { openBakingPrint(cat.id); setPrintDropdownOpen(false) }}
                    >
                      {cat.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <button
            className={styles.btnBaking}
            disabled={broadcastLoading}
            title="Нагадати клієнтам у боті, що не подали замовлення на вибрану дату"
            onClick={() => handleBroadcast('reminder')}
          >🔔 Нагадування</button>
          {botStatus && (
            <>
              <span
                className={botStatus.accepting ? styles.botStatusOn : styles.botStatusOff}
                title={botStatus.accepting ? 'Бот приймає замовлення' : `Прийом зупинено до ${botStatus.closed_until?.slice(11, 16) ?? '—'}`}
              >
                {botStatus.accepting ? '● Бот — прийом відкрито' : '● Бот — прийом зупинено'}
              </span>
              {botStatus.accepting ? (
                <button
                  className={`${styles.btnBaking} ${styles.btnBotStop}`}
                  disabled={botStatusLoading}
                  title="Зупинити прийом замовлень через бота до ранку наступного дня"
                  onClick={handleBotStop}
                >🚫 Стоп-прийом</button>
              ) : (
                <button
                  className={`${styles.btnBaking} ${styles.btnBotResume}`}
                  disabled={botStatusLoading}
                  title="Відновити прийом замовлень через бота"
                  onClick={handleBotResume}
                >▶ Відновити прийом</button>
              )}
            </>
          )}
        </div>
        {broadcastMsg && <span style={{ fontSize: '0.82rem', color: '#1a5c3a' }}>{broadcastMsg}</span>}
        {printNotice && (
          <span style={{ fontSize: '0.85rem', color: '#856404', background: '#fff3cd', border: '1px solid #ffc107', borderRadius: '6px', padding: '0.3rem 0.8rem' }}>
            ⚠️ {printNotice}
          </span>
        )}
      </div>


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
              {bakedCategories.map(cat => (
                <span key={cat.id} className={styles.chNum} title={cat.name}>
                  {cat.name.substring(0, 3)}
                </span>
              ))}
              <span className={styles.chBtn}></span>
            </div>
            <div className={styles.clientList}>
              {sidebarClients.map(client => {
                const catQtys = bakedCategories.map(cat => clientCategoryQty(client.id, cat.id))
                const totalQty = catQtys.reduce((s, q) => s + q, 0)
                const isSel = client.id === selectedClientId
                return (
                  <div
                    key={client.id}
                    className={[
                      styles.clientItem,
                      isSel ? styles.clientSel : '',
                      client.client_kind === 'shop' ? styles.clientShop : '',
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
                    {catQtys.map((qty, i) => (
                      <span key={bakedCategories[i].id} className={`${styles.ciNum} ${qty === 0 && totalQty > 0 ? styles.cellYellow : qty === 0 ? styles.cellRed : ''}`}>
                        {qty || ''}
                      </span>
                    ))}
                    <button
                      className={`${styles.ciAddBtn} ${lockedClientIds.has(client.id) ? styles.ciLocked : ''}`}
                      title={lockedClientIds.has(client.id) ? 'Накладна сформована — замовлення заблоковані' : 'Відкрити замовлення'}
                      onClick={e => { e.stopPropagation(); setModalClientId(client.id) }}
                    >{lockedClientIds.has(client.id) ? '🔒' : '+'}</button>
                  </div>
                )
              })}
            </div>
          </div>
        </aside>

        {/* ── Таблиця замовлень ── */}
        <main className={styles.main}>

          {/* ── Pending bot orders ── */}
          {pendingBotOrders.length > 0 && (
            <div className={styles.botPendingPanel}>
              <div className={styles.botPendingTitle}>
                🤖 Замовлення через бота — очікують підтвердження ({pendingBotOrders.length})
              </div>
              <table className={styles.botPendingTable}>
                <thead>
                  <tr>
                    <th>Клієнт</th>
                    <th>Виріб</th>
                    <th style={{ textAlign: 'right' }}>К-сть</th>
                    <th style={{ textAlign: 'right' }}>Сума</th>
                    <th style={{ width: 200 }}>Дії</th>
                  </tr>
                </thead>
                <tbody>
                  {[...pendingBotOrders]
                    .sort((a, b) => a.client_name.localeCompare(b.client_name, 'uk'))
                    .map(o => (
                      <BotPendingRow key={o.id} order={o} onVerify={handleVerify} />
                    ))}
                </tbody>
              </table>
            </div>
          )}

          <table className={styles.ordersTable}>
            <thead>
              <tr>
                <th className={styles.thRoute}>Маршрут</th>
                <th className={styles.thClient}>Клієнт</th>
                <th className={styles.thProduct}>Виріб</th>
                <th className={styles.thNum}>К-сть</th>
                <th className={styles.thNum}>Ціна</th>
                <th className={styles.thNum}>Сума</th>
                <th className={styles.thSrc} title="Джерело / статус"></th>
              </tr>
            </thead>
            <tbody>
              {ordersToShow.map(order => {
                const client  = clientMap.get(order.client_id)
                const route   = routeMap.get(client?.route_id ?? 0)
                const product = productMap.get(order.product_id)
                const isExchange = order.exchange_type !== 'none'
                const isDiscount = order.exchange_type === 'none' && order.price_override != null
                const displayPrice = isExchange
                  ? 0
                  : (order.price_override ?? prices[order.client_id]?.[order.product_id])

                // Дочірні рядки (знімання нестачі)
                const children   = childOrdersMap.get(order.id) ?? []
                const reduction  = children.reduce((s, c) => s + c.qty, 0)
                const adjQty     = order.qty - reduction
                const hasChildren = children.length > 0
                const isExpanded  = expandedIds.has(order.id)

                const sum = displayPrice != null ? adjQty * displayPrice : null
                const isSel      = order.client_id === selectedClientId
                const isPending  = order.source === 'bot' && order.bot_status === 'pending'
                const isRejected = order.source === 'bot' && order.bot_status === 'rejected'
                const isSurplus  = order.origin_id === 0
                const isMoved    = order.origin_id != null && order.origin_id > 0

                return (
                  <Fragment key={order.id}>
                    <tr
                      className={[
                        styles.orderRow,
                        isExchange ? styles.orderRowExchange : '',
                        isDiscount ? styles.orderRowDiscount : '',
                        isSurplus  ? styles.orderRowSurplus  : '',
                        isMoved    ? styles.orderRowMoved    : '',
                        isSel      ? styles.orderRowSel     : '',
                        isPending  ? styles.orderRowPending  : '',
                        isRejected ? styles.orderRowRejected : '',
                      ].join(' ')}
                    >
                      <td className={styles.tdRoute}>{route?.name ?? '—'}</td>
                      <td className={styles.tdClient}>
                        {client?.short_name ?? client?.full_name ?? '—'}
                      </td>
                      <td className={styles.tdProduct}>
                        {hasChildren && (
                          <button
                            className={styles.expandBtn}
                            onClick={() => toggleExpand(order.id)}
                            title={isExpanded ? 'Згорнути' : 'Розгорнути деталі'}
                          >{isExpanded ? '▼' : '▶'}</button>
                        )}
                        {isExchange && <span className={styles.exchangeTag}>↔ </span>}
                        {isDiscount && <span className={styles.discountTag}>% </span>}
                        {product?.name ?? '—'}
                      </td>
                      <td className={styles.tdNum}>
                        {hasChildren ? (
                          <span>
                            <span className={reduction > 0 ? styles.adjQty : ''}>{adjQty}</span>
                            {reduction > 0 && (
                              <span className={styles.origQty}> із {order.qty}</span>
                            )}
                          </span>
                        ) : order.qty}
                      </td>
                      <td className={styles.tdPrice}>
                        {isExchange ? '0.00' : displayPrice != null ? fmt(displayPrice) : '—'}
                      </td>
                      <td className={styles.tdSum}>
                        {isExchange ? '—' : sum != null ? fmt(sum) : '—'}
                      </td>
                      <td className={styles.tdSrc} title={(() => {
                        if (isSurplus) return 'Розподіл надлишку випічки'
                        if (isMoved)   return 'Переміщено з іншого замовлення'
                        if (order.source !== 'bot') return order.source === 'paper' ? 'Паперове замовлення' : 'Оператор'
                        const lines: string[] = []
                        if (order.bot_status === 'pending')   lines.push('Очікує підтвердження оператора')
                        if (order.bot_status === 'confirmed') lines.push('Підтверджено оператором')
                        if (order.bot_status === 'modified')  lines.push(`Змінено оператором\nБуло: ${order.bot_original_qty ?? '?'} шт → стало: ${order.qty} шт`)
                        if (order.bot_status === 'rejected')  lines.push('Відхилено оператором')
                        if (order.bot_rejection_reason)       lines.push(`Примітка: ${order.bot_rejection_reason}`)
                        return lines.join('\n') || 'Бот'
                      })()}>
                        {isSurplus ? (
                          <span className={styles.srcSurplus}>⚖</span>
                        ) : isMoved ? (
                          <span className={styles.srcMoved}>↗</span>
                        ) : order.source === 'bot' ? (
                          <span style={{ display: 'inline-flex', gap: '0.1rem' }}>
                            <span>🤖</span>
                            {order.bot_status === 'pending'   && <span>⏳</span>}
                            {order.bot_status === 'confirmed' && <span>✅</span>}
                            {order.bot_status === 'modified'  && <span>✏️</span>}
                            {order.bot_status === 'rejected'  && <span>❌</span>}
                          </span>
                        ) : order.source === 'paper' ? '📄' : null}
                      </td>
                    </tr>

                    {/* ── Дочірні рядки (знімання нестачі) ── */}
                    {isExpanded && children.map(child => {
                      const childClient = clientMap.get(child.client_id)
                      const childName   = childClient?.short_name ?? childClient?.full_name ?? `#${child.client_id}`
                      return (
                        <tr key={child.id} className={styles.childRow}>
                          <td />
                          <td />
                          <td className={styles.childLabel}>↳ {childName}</td>
                          <td className={styles.childQty}>−{child.qty}</td>
                          <td />
                          <td className={styles.childNotes} colSpan={2}>{child.notes ?? ''}</td>
                        </tr>
                      )
                    })}
                  </Fragment>
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
          categories={categories}
          orders={orders}
          saving={saving}
          locked={lockedClientIds.has(modalClient.id)}
          onQtyChange={handleQtyChange}
          onOrdersChange={() => loadAll(workDate)}
          onClose={() => setModalClientId(null)}
        />
      )}

    </div>
  )
}
