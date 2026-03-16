import { useEffect, useState } from 'react'
import { useWorkDate } from '../context/DateContext'
import { api } from '../api/client'
import type { Client, Invoice, InvoiceLine, Order, Product, Route } from '../types'
import Modal from '../components/Modal'
import styles from './RoutesPage.module.css'

// ─── Статус накладної ─────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  draft:     'Чернетка',
  printed:   'Надруковано',
  delivered: 'Доставлено',
  cancelled: 'Скасовано',
}

const STATUS_NEXT: Record<string, string | null> = {
  draft:     'printed',
  printed:   'delivered',
  delivered: null,
  cancelled: null,
}

const STATUS_NEXT_LABEL: Record<string, string> = {
  draft:   '→ Надруковано',
  printed: '→ Доставлено',
}

// ─── Модальне вікно деталей накладної ────────────────────────────────────────

interface InvoiceModalProps {
  invoice: Invoice
  products: Product[]
  clientName: string
  onClose: () => void
}

function InvoiceModal({ invoice, products, clientName, onClose }: InvoiceModalProps) {
  const productName = (id: number) => {
    const p = products.find((p) => p.id === id)
    return p?.short_name ?? p?.name ?? `#${id}`
  }

  return (
    <Modal title={`Накладна ${invoice.invoice_number}`} onClose={onClose}>
      <div className={styles.invoiceDetail}>
        <div className={styles.invoiceMeta}>
          <span><strong>Клієнт:</strong> {clientName}</span>
          <span><strong>Дата:</strong> {invoice.invoice_date}</span>
          <span><strong>Статус:</strong> {STATUS_LABELS[invoice.status]}</span>
        </div>

        <table className={styles.linesTable}>
          <thead>
            <tr>
              <th>Виріб</th>
              <th>Кількість</th>
              <th>Ціна</th>
              <th>Сума</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((line: InvoiceLine) => (
              <tr key={line.id}>
                <td>{productName(line.product_id)}</td>
                <td className={styles.numCell}>{line.qty}</td>
                <td className={styles.numCell}>
                  {(line.price_override ?? line.price).toFixed(2)} ₴
                </td>
                <td className={styles.numCell}>{line.sum.toFixed(2)} ₴</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} style={{ textAlign: 'right', fontWeight: 700 }}>Разом:</td>
              <td className={styles.numCell} style={{ fontWeight: 700 }}>
                {invoice.total_sum.toFixed(2)} ₴
              </td>
            </tr>
          </tfoot>
        </table>

        {invoice.notes && (
          <p className={styles.invoiceNotes}>Примітка: {invoice.notes}</p>
        )}
      </div>
    </Modal>
  )
}

// ─── Головна сторінка ─────────────────────────────────────────────────────────

export default function RoutesPage() {
  const { workDate } = useWorkDate()

  const [routes,    setRoutes]    = useState<Route[]>([])
  const [clients,   setClients]   = useState<Client[]>([])
  const [products,  setProducts]  = useState<Product[]>([])
  const [orders,    setOrders]    = useState<Order[]>([])
  const [invoices,  setInvoices]  = useState<Invoice[]>([])
  const [loading,   setLoading]   = useState(true)

  const [activeRouteId,  setActiveRouteId]  = useState<number | null>(null)
  const [generating,     setGenerating]     = useState(false)
  const [genResult,      setGenResult]      = useState<string | null>(null)
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null)

  // ─── Завантаження ───────────────────────────────────────────────────────────

  const load = async (date: string) => {
    setLoading(true)
    const [r, c, p, o, inv] = await Promise.all([
      api.get<Route[]>('/routes/'),
      api.get<Client[]>('/clients/'),
      api.get<Product[]>('/products/'),
      api.get<Order[]>(`/orders/?order_date=${date}`),
      api.get<Invoice[]>(`/invoices/?invoice_date=${date}`),
    ])
    setRoutes(r)
    setClients(c)
    setProducts(p)
    setOrders(o)
    setInvoices(inv)
    if (r.length > 0 && activeRouteId === null) setActiveRouteId(r[0].id)
    setLoading(false)
  }

  useEffect(() => { load(workDate) }, [workDate])

  // ─── Генерація накладних ─────────────────────────────────────────────────────

  const handleGenerate = async () => {
    if (!activeRouteId) return
    setGenerating(true)
    setGenResult(null)
    const res = await api.post<{ created: number; skipped: number; no_orders: number }>(
      `/invoices/generate-from-orders?invoice_date=${workDate}&route_id=${activeRouteId}`, {}
    )
    setGenResult(`Створено: ${res.created}, вже існували: ${res.skipped}, без замовлень: ${res.no_orders}`)
    // Перезавантажуємо накладні
    const inv = await api.get<Invoice[]>(`/invoices/?invoice_date=${workDate}`)
    setInvoices(inv)
    setGenerating(false)
  }

  // ─── Зміна статусу ──────────────────────────────────────────────────────────

  const handleStatusAdvance = async (invoice: Invoice) => {
    const next = STATUS_NEXT[invoice.status] as Invoice['status'] | null
    if (!next) return
    await api.put(`/invoices/${invoice.id}/status?status=${next}`, {})
    setInvoices((prev) =>
      prev.map((inv) => (inv.id === invoice.id ? { ...inv, status: next } : inv))
    )
    if (selectedInvoice?.id === invoice.id) {
      setSelectedInvoice((prev) => prev ? { ...prev, status: next } : null)
    }
  }

  // ─── Допоміжні ──────────────────────────────────────────────────────────────

  const clientName = (id: number) => {
    const c = clients.find((c) => c.id === id)
    return c?.short_name ?? c?.full_name ?? `#${id}`
  }

  const routeClients = (routeId: number) =>
    clients.filter((c) => c.route_id === routeId && c.is_active)

  const clientOrders = (clientId: number) =>
    orders.filter((o) => o.client_id === clientId)

  const clientInvoice = (clientId: number) =>
    invoices.find((inv) => inv.client_id === clientId && inv.status !== 'cancelled')

  if (loading) return <p style={{ padding: '1rem' }}>Завантаження...</p>

  const activeRoute = routes.find((r) => r.id === activeRouteId)
  const activeClients = activeRouteId ? routeClients(activeRouteId) : []
  const activeInvoices = invoices.filter((inv) => inv.route_id === activeRouteId)

  const clientsWithOrders = activeClients.filter((c) => clientOrders(c.id).length > 0)
  const clientsWithInvoices = activeClients.filter((c) => !!clientInvoice(c.id))

  return (
    <div className={styles.page}>

      {/* ── Ліва панель: маршрути ─────────────────────────────────────────── */}
      <aside className={styles.sidebar}>
        <div className={styles.sidebarTitle}>Маршрути</div>
        {routes.map((route) => {
          const rc = routeClients(route.id)
          const withInv = rc.filter((c) => !!clientInvoice(c.id)).length
          const withOrd = rc.filter((c) => clientOrders(c.id).length > 0).length
          return (
            <button
              key={route.id}
              className={`${styles.routeBtn} ${activeRouteId === route.id ? styles.routeBtnActive : ''}`}
              onClick={() => { setActiveRouteId(route.id); setGenResult(null) }}
            >
              <span className={styles.routeName}>{route.name}</span>
              <span className={styles.routeStats}>
                <span title="Накладних / із замовленнями">{withInv}/{withOrd}</span>
              </span>
            </button>
          )
        })}
      </aside>

      {/* ── Права панель: клієнти маршруту ────────────────────────────────── */}
      <main className={styles.main}>
        {activeRoute ? (
          <>
            {/* Заголовок */}
            <div className={styles.toolbar}>
              <h2 className={styles.title}>
                {activeRoute.name} — {workDate}
              </h2>
              <div className={styles.toolbarRight}>
                <span className={styles.stats}>
                  Накладних: {clientsWithInvoices.length} / {clientsWithOrders.length}
                </span>
                <button
                  className={styles.btnGenerate}
                  onClick={handleGenerate}
                  disabled={generating}
                >
                  {generating ? 'Генерую...' : '⟳ Генерувати накладні'}
                </button>
              </div>
            </div>

            {genResult && (
              <div className={styles.genResult}>{genResult}</div>
            )}

            {/* Таблиця клієнтів */}
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.thClient}>Клієнт</th>
                    <th className={styles.thNum}>Позицій</th>
                    <th className={styles.thNum}>Штук</th>
                    <th className={styles.thInv}>Накладна</th>
                    <th className={styles.thNum}>Сума</th>
                    <th className={styles.thStatus}>Статус</th>
                    <th className={styles.thActions}>Дії</th>
                  </tr>
                </thead>
                <tbody>
                  {activeClients.map((client) => {
                    const ord = clientOrders(client.id)
                    const inv = clientInvoice(client.id)
                    const totalQty = ord.reduce((s, o) => s + o.qty, 0)
                    const hasOrders = ord.length > 0

                    return (
                      <tr key={client.id} className={`${styles.row} ${!hasOrders ? styles.rowNoOrder : ''}`}>
                        <td className={styles.tdClient}>
                          {client.short_name ?? client.full_name}
                        </td>
                        <td className={styles.tdNum}>
                          {hasOrders ? ord.length : '—'}
                        </td>
                        <td className={styles.tdNum}>
                          {hasOrders ? totalQty : '—'}
                        </td>
                        <td className={styles.tdInv}>
                          {inv ? (
                            <span className={styles.invNumber}>{inv.invoice_number}</span>
                          ) : hasOrders ? (
                            <span className={styles.noInv}>не створено</span>
                          ) : (
                            <span className={styles.noOrder}>—</span>
                          )}
                        </td>
                        <td className={styles.tdNum}>
                          {inv ? `${inv.total_sum.toFixed(2)} ₴` : '—'}
                        </td>
                        <td className={styles.tdStatus}>
                          {inv && (
                            <span className={`${styles.statusBadge} ${styles[`status_${inv.status}`]}`}>
                              {STATUS_LABELS[inv.status]}
                            </span>
                          )}
                        </td>
                        <td className={styles.tdActions}>
                          {inv && (
                            <>
                              <button
                                className={styles.btnView}
                                onClick={() => setSelectedInvoice(inv)}
                              >
                                Переглянути
                              </button>
                              {STATUS_NEXT[inv.status] && (
                                <button
                                  className={styles.btnAdvance}
                                  onClick={() => handleStatusAdvance(inv)}
                                >
                                  {STATUS_NEXT_LABEL[inv.status]}
                                </button>
                              )}
                            </>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Підсумок по маршруту */}
            {activeInvoices.length > 0 && (
              <div className={styles.routeSummary}>
                <span>Всього по маршруту:</span>
                <strong>
                  {activeInvoices
                    .filter((i) => i.status !== 'cancelled')
                    .reduce((s, i) => s + i.total_sum, 0)
                    .toFixed(2)} ₴
                </strong>
              </div>
            )}
          </>
        ) : (
          <p className={styles.empty}>Оберіть маршрут</p>
        )}
      </main>

      {/* ── Модальне вікно накладної ────────────────────────────────────── */}
      {selectedInvoice && (
        <InvoiceModal
          invoice={selectedInvoice}
          products={products}
          clientName={clientName(selectedInvoice.client_id)}
          onClose={() => setSelectedInvoice(null)}
        />
      )}
    </div>
  )
}
