import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useWorkDate } from '../context/DateContext'
import { api } from '../api/client'
import type {
  Category, Client, Finance, Invoice, InvoiceLine, Order,
  Product, Route, RouteKpi, ClientState,
} from '../types'
import styles from './RoutesPage.module.css'
import PriceTypeBadge from '../components/PriceTypeBadge'
import HelpTip from '../components/HelpTip'
import { useToast } from '../components/Toast'

// ─── Лейбли статусів ───────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  draft:         'Чернетка',
  sent:          'Відправлено',
  processing:    'Опрацювання',
  accepted:      'Прийнято',
  cancelled:     'Скасовано',
}

// Префікс-позначка типу клієнта у дропдауні переміщення
const CLIENT_KIND_PREFIX: Record<string, string> = {
  shop:     '🏪 ',
  writeoff: '🗑 ',
  ration:   '🍞 ',
  customer: '',
}

// ─── Форматування дати ─────────────────────────────────────────────────────────

function formatDate(d: string) {
  const [y, m, day] = d.split('-')
  const months = ['','січня','лютого','березня','квітня','травня','червня',
                  'липня','серпня','вересня','жовтня','листопада','грудня']
  return `${parseInt(day)} ${months[parseInt(m)]} ${y}`
}

// ─── InvoiceDetailPanel ────────────────────────────────────────────────────────

interface DetailPanelProps {
  invoice: Invoice
  client: Client
  allClients: Client[]
  products: Product[]
  categories: Category[]
  routes: Route[]
  bakeryName: string
  director: string
  accountant: string
  paymentAmount: number
  onStatusChange: (inv: Invoice) => void
  onRefresh: () => void
}

function InvoiceDetailPanel({
  invoice: invoiceProp, client, allClients, products, categories, routes,
  bakeryName, director, accountant, paymentAmount, onStatusChange, onRefresh,
}: DetailPanelProps) {
  const productName = (id: number) => {
    const p = products.find((p) => p.id === id)
    return p?.short_name ?? p?.name ?? `#${id}`
  }

  // Локальна копія накладної з transfers (GET /{id} збагачує). Оновлюється
  // після кожного переміщення без перезавантаження всієї сторінки.
  const [invoice, setInvoice] = useState<Invoice>(invoiceProp)
  useEffect(() => { setInvoice(invoiceProp) }, [invoiceProp])

  const reloadInvoice = async () => {
    const fresh = await api.get<Invoice>(`/invoices/${invoiceProp.id}`)
    setInvoice(fresh)
    return fresh
  }
  // Підвантажити transfers при першому показі (список не містить transfers)
  useEffect(() => {
    let cancel = false
    api.get<Invoice>(`/invoices/${invoiceProp.id}`)
      .then((fresh) => { if (!cancel) setInvoice(fresh) })
      .catch(() => {})
    return () => { cancel = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceProp.id])

  // ── Відправити (draft → sent) ────────────────────────────────────────────────
  const [sending, setSending] = useState(false)

  const handleSend = async () => {
    setSending(true)
    const updated = await api.put<Invoice>(`/invoices/${invoice.id}/status?status=sent`, {})
    setSending(false)
    onStatusChange(updated)
    window.open(`/api/v1/print/invoice/${invoice.id}`, '_blank')
  }

  // ── Пряме прийняття (sent/processing → accepted) ─────────────────────────────
  const [accepting, setAccepting] = useState(false)

  const handleAccept = async () => {
    setAccepting(true)
    const updated = await api.put<Invoice>(`/invoices/${invoice.id}/status?status=accepted`, { payment_amount: paymentAmount })
    setAccepting(false)
    onStatusChange(updated)
  }


  // ── Корекція: переміщення товару (замість коригуючих накладних) ──────────────
  const [showCorrect, setShowCorrect] = useState(false)
  const [moveProductId, setMoveProductId] = useState<number | null>(null)  // який рядок переміщуємо
  const [moveQty, setMoveQty]           = useState(0)
  const [moveToClientId, setMoveTo]     = useState<number | null>(null)
  const [moving, setMoving]             = useState(false)

  // Дропдаун цілей: магазини + системні + клієнти (без самого себе, без "недопечено")
  const KIND_ORDER: Record<string, number> = { shop: 0, writeoff: 1, ration: 2, customer: 3 }
  const moveDestinations = allClients
    .filter((c) => c.id !== client.id && c.client_kind !== 'underbaked')
    .sort((a, b) => {
      const ka = KIND_ORDER[a.client_kind] ?? 99
      const kb = KIND_ORDER[b.client_kind] ?? 99
      if (ka !== kb) return ka - kb
      if (a.route_id !== b.route_id) return (a.route_id ?? 0) - (b.route_id ?? 0)
      return (a.short_name ?? a.full_name).localeCompare(b.short_name ?? b.full_name, 'uk')
    })

  const openMove = (productId: number, maxQty: number) => {
    setMoveProductId(productId)
    setMoveQty(Math.max(1, Math.floor(maxQty)))
    setMoveTo(null)
  }

  const handleMove = async () => {
    if (moveProductId == null || !moveToClientId || moveQty <= 0) return
    setMoving(true)
    try {
      await api.post(`/invoices/${invoice.id}/transfer`, {
        product_id: moveProductId,
        qty: moveQty,
        to_client_id: moveToClientId,
      })
      setMoveProductId(null)
      await reloadInvoice()
      onRefresh()
    } finally {
      setMoving(false)
    }
  }

  const { status } = invoice
  // Магазин: накладна закривається у Випічці («Закрити накладну магазину»),
  // тому кнопки зміни стану (Відправити/Прийнято) для нього не показуємо.
  const isShop = isShopClient(client)

  // Анотації переміщень за продуктом
  const transfersFor = (productId: number) =>
    (invoice.transfers ?? []).filter((t) => t.product_id === productId)

  // ── Групування рядків по категорії ───────────────────────────────────────
  const catMap: Record<number, Category> = {}
  for (const cat of categories) catMap[cat.id] = cat

  const mainLines = invoice.lines.filter((l) => l.line_kind !== 'exchange')
  const exchLines = invoice.lines.filter((l) => l.line_kind === 'exchange')

  const groups: Record<string, InvoiceLine[]> = {}
  const catOrder: (number | null)[] = []
  for (const line of mainLines) {
    const p = products.find((p) => p.id === line.product_id)
    const cid = p?.category_id ?? null
    const key = String(cid)
    if (!groups[key]) { groups[key] = []; catOrder.push(cid) }
    groups[key].push(line)
  }
  catOrder.sort((a, b) => {
    const sa = a !== null && catMap[a] ? catMap[a].sort_order : 999
    const sb = b !== null && catMap[b] ? catMap[b].sort_order : 999
    return sa - sb
  })
  const catLabel = (cid: number | null) => cid !== null && catMap[cid] ? catMap[cid].name : 'Інше'
  const groupSum  = (cid: number | null) =>
    (groups[String(cid)] ?? []).reduce((s, l) => s + l.sum, 0)

  const routeName = invoice.route_id
    ? (routes.find((r) => r.id === invoice.route_id)?.name ?? '')
    : ''
  const totalNames = mainLines.length
  const totalQty   = mainLines.reduce((s, l) => s + l.qty, 0)

  return (
    <>
      {/* ── Панель управління: бейдж статусу + кнопки ── */}
      <div className={styles.paperControlBar}>
        <div className={styles.paperControlLeft}>
          <span className={`${styles.statusBadge} ${styles[`status_${status}`]}`}>
            {STATUS_LABELS[status] ?? status}
          </span>
          {invoice.corrective_for_id && (
            <span className={styles.correctiveBadge}>↩ коригуюча</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            className={styles.btnPrintSingle}
            onClick={() => window.open(`/api/v1/print/invoice/${invoice.id}`, '_blank')}
          >
            🖨 Друкувати
          </button>
          {status === 'draft' && !isShop && (
            <button className={styles.btnSend} onClick={handleSend} disabled={sending}>
              {sending ? 'Відправляємо...' : '▶ Відправити'}
            </button>
          )}
          {/* Корекція доступна доки накладна не скасована — включно з чернеткою
              (зменшити недопечене перед відправкою) і accepted (правка пізніше) */}
          {status !== 'cancelled' && (
            <button
              className={`${styles.btnProcess} ${showCorrect ? styles.btnProcessActive : ''}`}
              onClick={() => setShowCorrect((v) => !v)}
            >
              {showCorrect ? '✕ Закрити корекцію' : '✏ Корекція / переміщення'}
            </button>
          )}
          {(status === 'sent' || status === 'processing') && !isShop && (
            <button className={styles.btnAccept} onClick={handleAccept} disabled={accepting}>
              {accepting ? '...' : '✓ Прийнято'}
            </button>
          )}
          {isShop && status !== 'accepted' && (
            <span style={{ fontSize: '0.78rem', color: '#888' }}>
              Накладна магазину закривається у Випічці
            </span>
          )}
        </div>
      </div>

      {/* ── Секція корекції (переміщення товару) — НАД накладною ── */}
      {showCorrect && (
        <div className={styles.correctPanel}>
          <div className={styles.correctTitle}>
            Корекція накладної — переміщення товару
          </div>
          <div className={styles.correctHint}>
            Вкажіть скільки товару передати і кому. Кількість у накладній зменшиться,
            у цільовій — збільшиться. Суми й оплата перерахуються автоматично.
          </div>
          <table className={styles.correctTable}>
            <thead>
              <tr>
                <th>Виріб</th>
                <th className={styles.numTh}>Залишок</th>
                <th>Перемістити</th>
              </tr>
            </thead>
            <tbody>
              {mainLines.map((line) => (
                <tr key={line.id}>
                  <td>{productName(line.product_id)}</td>
                  <td className={styles.numTd}>{line.qty}</td>
                  <td>
                    {moveProductId === line.product_id ? (
                      <div className={styles.moveForm}>
                        <input
                          type="number" min={1} max={line.qty} step={1}
                          value={moveQty}
                          onChange={(e) => setMoveQty(Math.max(0, Math.min(line.qty, Number(e.target.value))))}
                          className={styles.moveQtyInput}
                        />
                        <select
                          value={moveToClientId ?? ''}
                          onChange={(e) => setMoveTo(e.target.value ? Number(e.target.value) : null)}
                          className={styles.moveSelect}
                        >
                          <option value="">— куди —</option>
                          {moveDestinations.map((c) => (
                            <option key={c.id} value={c.id}>
                              {CLIENT_KIND_PREFIX[c.client_kind] ?? ''}{c.short_name ?? c.full_name}
                            </option>
                          ))}
                        </select>
                        <button className={styles.moveConfirm} onClick={handleMove}
                          disabled={moving || !moveToClientId || moveQty <= 0}>
                          {moving ? '...' : 'Перемістити'}
                        </button>
                        <button className={styles.moveCancel} onClick={() => setMoveProductId(null)}>✕</button>
                      </div>
                    ) : (
                      <button className={styles.moveOpenBtn}
                        onClick={() => openMove(line.product_id, line.qty)}
                        disabled={line.qty <= 0}>
                        ⇄ перемістити
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Документна накладна ── */}
      <div className={styles.paper}>
        {/* Шапка документу */}
        <div className={styles.docTop}>
          <span><strong>{routeName}</strong></span>
          <span style={{ fontStyle: 'italic' }}>{formatDate(invoice.invoice_date)}</span>
        </div>
        <div className={styles.docTitle}>
          Накладна №&nbsp;<span className={styles.docInvNum}>{invoice.invoice_number}</span>
        </div>

        {/* Мета-поля */}
        <table className={styles.metaTable}>
          <tbody>
            <tr>
              <td className={styles.metaLabel}>Від кого:</td>
              <td className={styles.metaValue}><strong>{bakeryName}</strong></td>
            </tr>
            <tr>
              <td className={styles.metaLabel}>Кому:</td>
              <td className={styles.metaValue}>
                <strong>{client.short_name ?? client.full_name}</strong>
              </td>
            </tr>
            <tr>
              <td className={styles.metaLabel}>Через:</td>
              <td className={styles.metaValue}>
                {client.delivery_agent || client.address || ''}
              </td>
            </tr>
            <tr>
              <td className={styles.metaLabel}>Довіреність №:</td>
              <td className={styles.metaValue}>
                {client.delivery_note_number || '____________'}
                &nbsp;від&nbsp;
                {client.delivery_note_date || '____________'}
              </td>
            </tr>
          </tbody>
        </table>

        {/* Таблиця рядків, згрупована по категорії */}
        <table className={styles.paperTable}>
          <thead>
            <tr>
              <th>Назва</th>
              <th className={styles.numTh}>Кільк.</th>
              <th className={styles.numTh}>Ціна</th>
              <th className={styles.numTh}>Сума</th>
            </tr>
          </thead>
          {catOrder.map((cid) => (
            <tbody key={cid ?? 'other'}>
              {(groups[String(cid)] ?? []).map((line: InvoiceLine) => (
                <React.Fragment key={line.id}>
                  <tr>
                    <td>{productName(line.product_id)}</td>
                    <td className={styles.numTd}>{line.qty}</td>
                    <td className={styles.numTd}>
                      {(line.price_override ?? line.price).toFixed(2)} ₴
                      {line.price_override != null && <PriceTypeBadge source="manual" />}
                    </td>
                    <td className={styles.numTd}>{line.sum.toFixed(2)} ₴</td>
                  </tr>
                  {transfersFor(line.product_id).map((t) => (
                    <tr key={`t${t.id}`} className={styles.transferAnnotRow}>
                      <td colSpan={4} className={
                        t.direction === 'out' ? styles.transferOutAnnot : styles.transferInAnnot
                      }>
                        {t.counterparty_kind === 'underbaked'
                          ? `└ ↓ Знято недопечене −${t.qty}`
                          : t.direction === 'out'
                          ? `└ ↓ передано → ${t.counterparty_name} −${t.qty}`
                          : `└ ↑ отримано від ${t.counterparty_name} +${t.qty}`}
                      </td>
                    </tr>
                  ))}
                </React.Fragment>
              ))}
              <tr className={styles.subtotalRow}>
                <td colSpan={3} className={styles.numTd}>
                  Сума по <strong>{catLabel(cid)}</strong>
                </td>
                <td className={styles.numTd}>
                  <strong>{groupSum(cid).toFixed(2)} ₴</strong>
                </td>
              </tr>
            </tbody>
          ))}
        </table>

        {/* Секція обміну */}
        {exchLines.length > 0 && (
          <div className={styles.exchSection}>
            <div className={styles.exchTitle}>Обмін</div>
            <table className={styles.paperTable}>
              <thead>
                <tr>
                  <th>Назва</th>
                  <th className={styles.numTh}>Кільк.</th>
                  <th className={styles.numTh}>Ціна</th>
                  <th className={styles.numTh}>Сума</th>
                </tr>
              </thead>
              <tbody>
                {exchLines.map((line: InvoiceLine) => (
                  <tr key={line.id}>
                    <td>{productName(line.product_id)}</td>
                    <td className={styles.numTd}>{line.qty}</td>
                    <td className={styles.numTd}>
                      {(line.price_override ?? line.price).toFixed(2)} ₴
                    </td>
                    <td className={styles.numTd}>{line.sum.toFixed(2)} ₴</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Підсумок */}
        <div className={styles.totalLine}>
          Усього&nbsp;<strong>{totalNames}</strong>&nbsp;найменувань,&nbsp;
          <strong>{totalQty}</strong>&nbsp;штук, на суму:
          <span className={styles.totalBox}>{invoice.total_sum.toFixed(2)} ₴</span>
        </div>
        <div className={styles.kopiyky}>грн.&nbsp;____&nbsp;коп.</div>

        {/* Підписи */}
        <div className={styles.sigsRow}>
          <div>Директор:&nbsp;<em>{director || '________________'}</em></div>
          <div>Бухгалтер:&nbsp;<em>{accountant || '________________'}</em></div>
        </div>
        <div className={styles.sigsRow}>
          <div>Прийняв:&nbsp;________________</div>
          <div>Відпускає:&nbsp;<em>Диспетчер</em></div>
        </div>
      </div>
    </>
  )
}

// ─── Головна сторінка ──────────────────────────────────────────────────────────

// Власний магазин (показується у Маршрутах, але без масових операцій і кнопок
// зміни стану — його накладна закривається у Випічці).
const isShopClient = (c: Client) =>
  c.client_kind === 'shop' || c.is_own_shop === 1
// Клієнт, який показується у списку Маршрутів: активний customer АБО власний магазин.
// Системні (writeoff/ration/underbaked) — ні.
const isRouteClient = (c: Client) =>
  !!c.is_active && (c.client_kind === 'customer' || isShopClient(c))

export default function RoutesPage() {
  const { workDate } = useWorkDate()
  const toast = useToast()

  const [routes,     setRoutes]     = useState<Route[]>([])
  const [clients,    setClients]    = useState<Client[]>([])
  const [products,   setProducts]   = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [invoices,   setInvoices]   = useState<Invoice[]>([])
  const [orders,     setOrders]     = useState<Order[]>([])
  const [finances,   setFinances]   = useState<Finance[]>([])
  const [loading,    setLoading]    = useState(true)
  const [bakeryName, setBakeryName] = useState('Пекарня')
  const [director,   setDirector]   = useState('')
  const [accountant, setAccountant] = useState('')

  const [activeRouteId,    setActiveRouteId]    = useState<number | null>(null)
  const [selectedClient,   setSelectedClient]   = useState<Client | null>(null)
  const [checkedIds,       setCheckedIds]       = useState<Set<number>>(new Set())
  const [generatingDrafts, setGeneratingDrafts] = useState(false)
  const [sendingDrafts,    setSendingDrafts]    = useState(false)
  const [paymentAmounts,   setPaymentAmounts]   = useState<Record<number, number>>({})
  const [acceptingBulk,    setAcceptingBulk]    = useState(false)

  // ── Resizable split ───────────────────────────────────────────────────────────
  const [leftWidth, setLeftWidth] = useState(50)
  const bodyRef = useRef<HTMLDivElement>(null)

  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault()
    const onMove = (ev: MouseEvent) => {
      if (!bodyRef.current) return
      const rect = bodyRef.current.getBoundingClientRect()
      const pct = ((ev.clientX - rect.left) / rect.width) * 100
      setLeftWidth(Math.min(75, Math.max(25, pct)))
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  // ── Завантаження ─────────────────────────────────────────────────────────────

  const load = async (date: string) => {
    setLoading(true)
    try {
      const [r, c, p, cats, inv, ord, fin, cfg] = await Promise.all([
        api.get<Route[]>('/routes/'),
        api.get<Client[]>('/clients/?active_only=false'),
        api.get<Product[]>('/products/?active_only=false'),
        api.get<Category[]>('/categories?active_only=false'),
        api.get<Invoice[]>(`/invoices/?invoice_date=${date}`),
        api.get<Order[]>(`/orders/?order_date=${date}`),
        api.get<Finance[]>(`/finances/?date_from=${date}&date_to=${date}`),
        api.get<Record<string, { value: string }>>('/settings/'),
      ])
      setRoutes(r)
      setClients(c)
      setProducts(p)
      setCategories(cats)
      setInvoices(inv)
      setOrders(ord)
      setFinances(fin)
      if (cfg.bakery_name?.value)     setBakeryName(cfg.bakery_name.value)
      if (cfg.director?.value)        setDirector(cfg.director.value)
      if (cfg.accountant_name?.value) setAccountant(cfg.accountant_name.value)
    } catch (e) {
      console.error('RoutesPage load failed:', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load(workDate) }, [workDate])

  // Засіяні total_sum — щоб відрізнити "ручну правку оплати" від "зміни суми накладної"
  const seededTotals = useRef<Record<number, number>>({})

  // Автовибір галочок (магазини виключені — на них масові операції не діють)
  useEffect(() => {
    const shopIds = new Set(clients.filter(isShopClient).map((c) => c.id))
    const ids = new Set(
      invoices
        .filter((i) => i.corrective_for_id === null && i.status !== 'cancelled' && !shopIds.has(i.client_id))
        .map((i) => i.id)
    )
    setCheckedIds(ids)
    // Суми оплат: для нових накладних — total_sum. Якщо total_sum накладної
    // змінився (корекція/переміщення) — оновлюємо оплату на новий total
    // (немає сенсу пропонувати стару суму). Ручні правки при незмінному
    // total зберігаються (seededTotals[id] === inv.total_sum).
    setPaymentAmounts(prev => {
      const next = { ...prev }
      invoices.forEach(inv => {
        const seeded = seededTotals.current[inv.id]
        if (!(inv.id in next) || seeded !== inv.total_sum) {
          next[inv.id] = inv.total_sum
          seededTotals.current[inv.id] = inv.total_sum
        }
      })
      return next
    })
  }, [invoices, clients])

  // ── Допоміжні ─────────────────────────────────────────────────────────────────

  const baseInvoices = invoices.filter((i) => i.corrective_for_id === null)

  const clientInvoice = (clientId: number) =>
    baseInvoices.find((i) => i.client_id === clientId && i.status !== 'cancelled')

  // Ордери клієнта: батьківські + отримані переміщення, без надлишків і pending
  const ordersForClient = useMemo(() => {
    const map: Record<number, Order[]> = {}
    for (const o of orders) {
      if (o.origin_id === 0 && o.parent_order_id != null) continue   // дочірні надлишки — пропустити
      if (o.bot_status === 'pending') continue
      if (!map[o.client_id]) map[o.client_id] = []
      map[o.client_id].push(o)
    }
    return map
  }, [orders])

  const clientState = (clientId: number): ClientState => {
    const inv = clientInvoice(clientId)
    if (inv) return inv.status as ClientState
    return (ordersForClient[clientId]?.length ?? 0) > 0 ? 'needs_invoice' : 'no_activity'
  }

  // ── KPI картки ────────────────────────────────────────────────────────────────

  const kpiCards = useMemo((): RouteKpi[] => {
    const makeCard = (
      routeId: number | null,
      routeName: string,
      filterClients: Client[],
      filterInvoices: Invoice[],
    ): RouteKpi => {
      const clientIdSet = new Set(filterClients.map((c) => c.id))
      const correctives = filterInvoices.filter((i) => i.corrective_for_id !== null)
      const baseNonCancelled = filterInvoices.filter(
        (i) => i.corrective_for_id === null && i.status !== 'cancelled'
      )
      const debitSum = finances
        .filter((f) => f.client_id !== null && clientIdSet.has(f.client_id!) && f.sign === 1)
        .reduce((s, f) => s + f.amount, 0)
      const counts: RouteKpi['statusCounts'] = {
        no_activity: 0, needs_invoice: 0, draft: 0, sent: 0, processing: 0, accepted: 0,
      }
      for (const c of filterClients) {
        const st = clientState(c.id)
        if (st === 'cancelled') counts.no_activity++
        else if (st in counts) (counts as Record<string, number>)[st]++
      }
      return {
        routeId,
        routeName,
        clientCount: filterClients.length,
        invoiceSum: baseNonCancelled.reduce((s, i) => s + i.total_sum, 0),
        correctionSum: correctives.reduce((s, i) => s + i.total_sum, 0),
        debitSum,
        statusCounts: counts,
      }
    }

    // "Всі" включає всіх активних клієнтів-customer (маршрутні + внутрішні); магазини виключені
    const allNonSystemClients = clients.filter(isRouteClient)
    const internalClients = clients.filter(
      (c) => isRouteClient(c) && c.route_id === null
    )
    const customerClients = clients.filter(isRouteClient)

    return [
      makeCard(null, 'Всі', allNonSystemClients, invoices),
      makeCard(-1, 'Внутрішні', internalClients,
        invoices.filter((i) => internalClients.some((c) => c.id === i.client_id))),
      ...routes
        .filter((r) => r.is_active)
        .map((r) =>
          makeCard(
            r.id,
            r.name,
            customerClients.filter((c) => c.route_id === r.id),
            invoices.filter((i) => i.route_id === r.id),
          )
        ),
    ]
  }, [clients, routes, invoices, orders, finances])

  // ── Список клієнтів для активного фільтру ────────────────────────────────────

  const listClients: Client[] = useMemo(() => {
    if (activeRouteId === null) {
      return clients.filter(isRouteClient)
    }
    if (activeRouteId === -1) {
      return clients.filter((c) => isRouteClient(c) && c.route_id === null)
    }
    return clients.filter((c) => c.route_id === activeRouteId && isRouteClient(c))
  }, [clients, activeRouteId])

  // Сортування: магазини завжди першими; потім без накладної (needs_invoice),
  // далі накладні, потім no_activity
  const sortedClients = useMemo(() => [...listClients].sort((a, b) => {
    const aShop = isShopClient(a) ? 0 : 1
    const bShop = isShopClient(b) ? 0 : 1
    if (aShop !== bShop) return aShop - bShop
    const order = { needs_invoice: 0, draft: 1, sent: 1, processing: 1, accepted: 1, cancelled: 2, no_activity: 3 }
    const sa = order[clientState(a.id)] ?? 2
    const sb = order[clientState(b.id)] ?? 2
    return sa - sb
  }), [listClients, invoices, orders])

  // ── Checkbox-логіка ───────────────────────────────────────────────────────────

  // Накладні для масових операцій (друк/відправка/прийняття) — БЕЗ магазинів
  const allCheckable = sortedClients
    .filter((c) => !isShopClient(c))
    .map((c) => clientInvoice(c.id))
    .filter((i): i is Invoice => !!i && i.status !== 'cancelled')

  // Клієнти з замовленнями, але без сформованої накладної (для кнопки «Сформувати накладні»)
  // Включає магазини — їх накладні-чернетки створюються разом з усіма.
  const needsInvoiceClients = sortedClients.filter((c) => clientState(c.id) === 'needs_invoice')

  const hasAny      = allCheckable.length > 0
  const allChecked  = hasAny && allCheckable.every((i) => checkedIds.has(i.id))
  const someChecked = allCheckable.some((i) => checkedIds.has(i.id))
  // Лічильники для масових операцій враховують ТІЛЬКИ клієнтів видимих у поточному фільтрі.
  // sortedClients вже відфільтрований за обраним маршрутом — використовуємо його client_id.
  const visibleInvoiceIds = useMemo(() => {
    const ids = new Set<number>()
    for (const c of sortedClients) {
      const inv = clientInvoice(c.id)
      if (inv) ids.add(inv.id)
    }
    return ids
    // clientInvoice — closure-stable lookup в межах render по invoices;
    // вже включений побічно через invoices у deps
  }, [sortedClients, invoices]) // eslint-disable-line react-hooks/exhaustive-deps

  const checkedCount = [...checkedIds].filter((id) => visibleInvoiceIds.has(id)).length

  const acceptableChecked = [...checkedIds].filter(id => {
    if (!visibleInvoiceIds.has(id)) return false
    const inv = invoices.find(i => i.id === id)
    return inv && (inv.status === 'sent' || inv.status === 'processing')
  })

  // Відмічені чернетки (draft) у поточному фільтрі — для «Відправити машини»
  const sendableDraftInvoiceIds = [...checkedIds].filter(id => {
    if (!visibleInvoiceIds.has(id)) return false
    const inv = invoices.find(i => i.id === id)
    return inv?.status === 'draft'
  })

  const headerCheckRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (headerCheckRef.current) {
      headerCheckRef.current.indeterminate = !allChecked && someChecked
    }
  }, [allChecked, someChecked])

  const toggleAll = () => {
    if (allChecked) {
      setCheckedIds((prev) => {
        const next = new Set(prev)
        allCheckable.forEach((i) => next.delete(i.id))
        return next
      })
    } else {
      setCheckedIds((prev) => {
        const next = new Set(prev)
        allCheckable.forEach((i) => next.add(i.id))
        return next
      })
    }
  }

  const toggleOne = (id: number) => {
    setCheckedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // ── Сформувати накладні-чернетки із замовлень (завершити прийом) ────────────────

  const generateInvoices = async () => {
    if (needsInvoiceClients.length === 0) return
    setGeneratingDrafts(true)
    try {
      // route_id: конкретний маршрут якщо вибраний; інакше всі customer-клієнти
      const qs = activeRouteId && activeRouteId > 0 ? `&route_id=${activeRouteId}` : ''
      const res = await api.post<{ created: number }>(
        `/invoices/generate-drafts?date=${workDate}${qs}`, {}
      )
      toast.success(`Сформовано накладних: ${res.created}`)
    } catch {
      toast.error('Не вдалось сформувати накладні. Спробуйте ще раз.')
    } finally {
      setGeneratingDrafts(false)
      await load(workDate)
    }
  }

  // ── Відправити машини: відмічені чернетки → відправлено ─────────────────────────

  const sendMachines = async () => {
    if (sendableDraftInvoiceIds.length === 0) return
    setSendingDrafts(true)
    // Послідовно (не Promise.all): уникаємо гонок зі статусами.
    const failed: number[] = []
    let okCount = 0
    try {
      for (const id of sendableDraftInvoiceIds) {
        try {
          await api.put(`/invoices/${id}/status?status=sent`, {})
          okCount++
        } catch {
          failed.push(id)
        }
      }
      if (failed.length > 0) {
        toast.error(`Не вдалось відправити ${failed.length} з ${failed.length + okCount} накладних. Спробуйте ще раз.`)
      } else if (okCount > 0) {
        toast.success(`Відправлено накладних: ${okCount}`)
      }
    } finally {
      setSendingDrafts(false)
      await load(workDate)
    }
  }

  // ── Друк вибраних ──────────────────────────────────────────────────────────────

  const printChecked = async () => {
    // Друк НЕ змінює статус: чернетки лишаються чернетками (розкладають по ящиках,
    // коригують недопечене), відправка машин — окремою дією.
    const visibleChecked = [...checkedIds].filter(id => visibleInvoiceIds.has(id))
    if (visibleChecked.length === 0) return
    const ids = visibleChecked.join(',')
    window.open(`/api/v1/print/invoices?invoice_date=${workDate}&ids=${ids}`, '_blank')
  }

  // ── Масове прийняття ─────────────────────────────────────────────────────────────

  const acceptChecked = async () => {
    // acceptableChecked вже відфільтрований по видимих
    if (!acceptableChecked.length) return
    setAcceptingBulk(true)
    for (const id of acceptableChecked) {
      const paymentAmount = paymentAmounts[id] ?? 0
      await api.put(`/invoices/${id}/status?status=accepted`, { payment_amount: paymentAmount })
    }
    await load(workDate)
    setAcceptingBulk(false)
  }

  // ── Оновлення одного invoice ──────────────────────────────────────────────────

  const handleStatusChange = (updated: Invoice) => {
    setInvoices((prev) => prev.map((i) => (i.id === updated.id ? updated : i)))
  }

  if (loading) return <p style={{ padding: '1rem' }}>Завантаження...</p>

  const selectedInvoice = selectedClient ? clientInvoice(selectedClient.id) : null
  const selectedState   = selectedClient ? clientState(selectedClient.id) : null

  return (
    <div className={styles.page}>

      {/* ── Основний layout ──────────────────────────────────────────────────── */}
      <div className={styles.body} ref={bodyRef}>

        {/* ── Ліва панель: список клієнтів ────────────────────────────────────── */}
        <div className={styles.invoiceList} style={{ width: `${leftWidth}%` }}>

          {/* ── KPI картки ──────────────────────────────────────────────────────── */}
          <div className={styles.kpiStrip}>
            {kpiCards.map((card) => {
          const isActive = activeRouteId === card.routeId
          const balance = card.debitSum - card.invoiceSum
          return (
            <div
              key={card.routeId ?? 'all'}
              className={`${styles.kpiCard} ${isActive ? styles.kpiCardActive : ''}`}
              onClick={() => { setActiveRouteId(card.routeId); setSelectedClient(null) }}
            >
              {/* Заголовок з фоном і смугою статусів */}
              <div className={styles.kpiCardHeader}>
                <div className={styles.kpiCardTitle}>
                  {card.routeName} ({card.clientCount})
                </div>
                <div className={styles.kpiStatusBar}>
                  {card.clientCount > 0 && (['no_activity','needs_invoice','draft','sent','processing','accepted'] as const).map((st) => {
                    const pct = (card.statusCounts[st] / card.clientCount) * 100
                    if (pct === 0) return null
                    return (
                      <div
                        key={st}
                        className={styles.kpiBarSegment}
                        data-state={st}
                        style={{ width: `${pct.toFixed(1)}%` }}
                      />
                    )
                  })}
                </div>
              </div>

              {/* Тіло: баланс + дві колонки */}
              <div className={styles.kpiCardBody}>
                <div className={`${styles.kpiBalance} ${balance >= 0 ? styles.kpiBalancePos : styles.kpiBalanceNeg}`}>
                  {balance >= 0 ? '+' : ''}{balance.toFixed(0)} ₴
                </div>
                <div className={styles.kpiColumns}>
                  <div className={styles.kpiCredit}>
                    <span className={styles.kpiColLabel}>Кредит</span>
                    <span className={styles.kpiColValue}>
                      {card.invoiceSum > 0 ? `${card.invoiceSum.toFixed(0)} ₴` : '—'}
                    </span>
                  </div>
                  <div className={styles.kpiDebit}>
                    <span className={styles.kpiColLabel}>Дебет</span>
                    <span className={styles.kpiColValue}>
                      {card.debitSum > 0 ? `${card.debitSum.toFixed(0)} ₴` : '—'}
                    </span>
                  </div>
                </div>
                {card.correctionSum !== 0 && (
                  <div className={styles.kpiCorrectionLine}>
                    {card.correctionSum > 0 ? '+' : ''}{card.correctionSum.toFixed(2)} ₴ кор.
                  </div>
                )}
              </div>
            </div>
          )
            })}
          </div>

          <div className={styles.listHeader}>
            <span className={styles.listTitle}>
              {activeRouteId === null
                ? 'Всі клієнти'
                : activeRouteId === -1
                  ? 'Внутрішні'
                  : routes.find((r) => r.id === activeRouteId)?.name ?? 'Клієнти'}
            </span>
            <div className={styles.listActions}>
              {needsInvoiceClients.length > 0 && (
                <button className={styles.sendDraftsBtn} onClick={generateInvoices} disabled={generatingDrafts}>
                  {generatingDrafts ? '...' : `📄 Сформувати накладні (${needsInvoiceClients.length})`}
                </button>
              )}
              {sendableDraftInvoiceIds.length > 0 && (
                <button className={styles.sendDraftsBtn} onClick={sendMachines} disabled={sendingDrafts}>
                  {sendingDrafts ? '...' : `▶ Відправити машини (${sendableDraftInvoiceIds.length})`}
                </button>
              )}
              {acceptableChecked.length > 0 && (
                <button className={styles.acceptSelBtn} onClick={acceptChecked} disabled={acceptingBulk}>
                  {acceptingBulk ? '...' : `✓ Прийняти (${acceptableChecked.length})`}
                </button>
              )}
              {checkedCount > 0 && (
                <button className={styles.printSelBtn} onClick={printChecked}>
                  🖨 Друкувати ({checkedCount})
                </button>
              )}
              <input
                ref={headerCheckRef}
                type="checkbox"
                checked={allChecked}
                onChange={toggleAll}
                title="Виділити всі"
              />
              <HelpTip width={300}>
                <strong>📄 Сформувати накладні</strong> — будує з замовлень накладні-чернетки (з номером). Після цього замовлення клієнтів блокуються.<br /><br />
                <strong>🖨 Друкувати</strong> — друкує відмічені накладні. Статус не змінюється — чернетки лишаються чернетками.<br /><br />
                <strong>▶ Відправити машини</strong> — переводить відмічені чернетки у «Відправлено» (рейси поїхали).<br /><br />
                <strong>✓ Прийняти</strong> — масово приймає відмічені накладні і записує оплату (зелене поле) у баланс клієнта.<br /><br />
                <strong>✏ Корекція</strong> — змінити фактично доставлену кількість прямо в накладній (зменшити недопечене).
              </HelpTip>
            </div>
          </div>

          <div className={styles.listScroll}>
            {sortedClients.map((client) => {
              const inv = clientInvoice(client.id)
              const state = clientState(client.id)
              const isActive = selectedClient?.id === client.id

              if (state === 'no_activity') {
                return (
                  <div key={client.id} className={styles.invoiceRowNoActivity}>
                    <span className={styles.rowCheck} style={{ width: 16 }} />
                    <span className={styles.rowClientName}>
                      {isShopClient(client) ? '🏪 ' : ''}{client.short_name ?? client.full_name}
                    </span>
                    <span style={{ fontSize: '0.72rem', color: '#bbb', marginLeft: 'auto' }}>
                      немає замовлень
                    </span>
                  </div>
                )
              }

              if (state === 'needs_invoice') {
                return (
                  <div
                    key={client.id}
                    className={`${styles.invoiceRowVirtualDraft} ${isActive ? styles.invoiceRowVirtualDraftActive : ''}`}
                    onClick={() => setSelectedClient(client)}
                  >
                    <span className={styles.rowCheck} style={{ width: 16 }} />
                    <span className={styles.rowClientName}>
                      {isShopClient(client) ? '🏪 ' : ''}{client.short_name ?? client.full_name}
                    </span>
                    <span className={styles.rowInvNum} />
                    <span className={styles.rowStatusCol}>
                      <span className={`${styles.statusBadge} ${styles.status_virtual_draft}`}>
                        Накладну не сформовано
                      </span>
                    </span>
                    <span className={styles.rowSum} />
                  </div>
                )
              }

              // Має накладну
              return (
                <div
                  key={client.id}
                  className={`${styles.invoiceRow} ${isActive ? styles.invoiceRowActive : ''}`}
                  onClick={() => setSelectedClient(client)}
                >
                  {inv && !isShopClient(client) ? (
                    <input
                      type="checkbox"
                      className={styles.rowCheck}
                      checked={checkedIds.has(inv.id)}
                      onChange={(e) => { e.stopPropagation(); toggleOne(inv.id) }}
                    />
                  ) : (
                    <span className={styles.rowCheck} style={{ width: 16 }} />
                  )}
                  <span className={styles.rowClientName}>
                    {isShopClient(client) ? '🏪 ' : ''}{client.short_name ?? client.full_name}
                  </span>
                  <span className={styles.rowInvNum}>{inv?.invoice_number}</span>
                  <span className={styles.rowStatusCol}>
                    {inv && (
                      <span className={`${styles.statusBadge} ${styles[`status_${inv.status}`]}`}>
                        {STATUS_LABELS[inv.status]}
                      </span>
                    )}
                  </span>
                  <span className={styles.rowSum}>{inv ? `${inv.total_sum.toFixed(2)} ₴` : ''}</span>
                  {inv && (() => {
                    // Поле оплати: для магазину НЕ показуємо (приховане), але колонку
                    // лишаємо щоб рядок магазину вирівнювався з рештою.
                    const showPayment = !isShopClient(client)
                      && (inv.status === 'sent' || inv.status === 'processing' || inv.status === 'accepted')
                    return (
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        value={paymentAmounts[inv.id] ?? inv.total_sum}
                        disabled={inv.status === 'accepted' || !showPayment}
                        tabIndex={showPayment ? 0 : -1}
                        aria-hidden={!showPayment}
                        className={styles.paymentInput}
                        style={{
                          background: (paymentAmounts[inv.id] ?? inv.total_sum) > 0 ? '#f0fdf4' : '#f9fafb',
                          visibility: showPayment ? 'visible' : 'hidden',
                        }}
                        onClick={e => e.stopPropagation()}
                        onChange={e => {
                          const v = Math.max(0, Number(e.target.value))
                          setPaymentAmounts(prev => ({ ...prev, [inv.id]: v }))
                        }}
                      />
                    )
                  })()}
                </div>
              )
            })}

            {sortedClients.length === 0 && (
              <div style={{ padding: '1rem', color: '#aaa', fontSize: '0.88rem' }}>
                {activeRouteId !== null ? 'Немає клієнтів' : 'Немає даних за цей день'}
              </div>
            )}
          </div>

          {/* ── Друковані форми (sticky bottom) ─────────────────────────────── */}
          <div className={styles.printFormsBar}>
            <span className={styles.printFormsLabel} title="Друковані форми" aria-label="Друковані форми">🖨</span>
            <button
              className={styles.printFormsBtn}
              onClick={() => window.open(`/api/v1/print/group-sort?date=${workDate}`, '_blank')}
              title="Сортування виробів по групах клієнтів — для завантаження машини"
            >
              Сортування
            </button>
            <button
              className={styles.printFormsBtn}
              onClick={() => window.open(`/api/v1/print/route-sheet?date=${workDate}`, '_blank')}
              title="Маршрутний лист водія — підсумки по групах клієнтів"
            >
              Маршрутний лист
            </button>
            <button
              className={styles.printFormsBtn}
              onClick={() => window.open(`/api/v1/print/address-sheet?date=${workDate}`, '_blank')}
              title="Адресний лист — адреси, телефони і суми замовлень клієнтів"
            >
              Адресний лист
            </button>
          </div>
        </div>

        {/* ── Розділювач ───────────────────────────────────────────────────────── */}
        <div className={styles.resizeDivider} onMouseDown={startDrag} />

        {/* ── Права панель ─────────────────────────────────────────────────────── */}
        <div className={styles.invoiceDetail}>
          {selectedClient && selectedInvoice ? (
            <InvoiceDetailPanel
              key={selectedInvoice.id}
              invoice={selectedInvoice}
              client={selectedClient}
              allClients={clients.filter((c) => c.is_active)}
              products={products}
              categories={categories}
              routes={routes}
              bakeryName={bakeryName}
              director={director}
              accountant={accountant}
              paymentAmount={paymentAmounts[selectedInvoice.id] ?? selectedInvoice.total_sum}
              onStatusChange={handleStatusChange}
              onRefresh={() => load(workDate)}
            />
          ) : selectedClient && selectedState === 'needs_invoice' ? (
            <div className={styles.emptyDetail}>
              <div style={{ textAlign: 'center', color: '#666', display: 'flex', flexDirection: 'column', gap: '0.75rem', alignItems: 'center' }}>
                <div>
                  Накладну для <strong>{selectedClient.short_name ?? selectedClient.full_name}</strong> ще не сформовано.
                </div>
                <button
                  className={styles.sendDraftsBtn}
                  disabled={generatingDrafts}
                  onClick={async () => {
                    setGeneratingDrafts(true)
                    try {
                      await api.post(`/invoices/generate-from-orders?invoice_date=${workDate}&client_id=${selectedClient.id}`, {})
                    } catch {
                      toast.error('Не вдалось сформувати накладну.')
                    } finally {
                      setGeneratingDrafts(false)
                      await load(workDate)
                    }
                  }}
                >
                  📄 Сформувати накладну
                </button>
              </div>
            </div>
          ) : selectedClient ? (
            <div className={styles.emptyDetail}>
              <div style={{ textAlign: 'center', color: '#888' }}>
                Немає накладної для <strong>{selectedClient.short_name ?? selectedClient.full_name}</strong>
              </div>
            </div>
          ) : (
            <div className={styles.emptyDetail}>
              Оберіть клієнта зі списку
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
