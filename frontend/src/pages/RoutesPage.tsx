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

// ─── Модальне вікно повернення (post-delivery) ────────────────────────────────

interface ReturnModalProps {
  invoice: Invoice
  products: Product[]
  clientName: string
  onClose: () => void
  onConfirm: (invoiceId: number, returns: ReturnLine[], cash: number, notes: string) => Promise<void>
}

interface ReturnLine {
  lineId: number
  productId: number
  productName: string
  delivered: number
  returned: number
  stalePrice: number | null
}

function ReturnModal({ invoice, products, clientName, onClose, onConfirm }: ReturnModalProps) {
  const productName = (id: number) => {
    const p = products.find((p) => p.id === id)
    return p?.short_name ?? p?.name ?? `#${id}`
  }

  const [lines, setLines] = useState<ReturnLine[]>(
    invoice.lines.map((l: InvoiceLine) => ({
      lineId: l.id,
      productId: l.product_id,
      productName: productName(l.product_id),
      delivered: l.qty,
      returned: 0,
      stalePrice: null,
    }))
  )
  const [cash, setCash] = useState(0)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const setReturned = (lineId: number, val: number) => {
    setLines((prev) =>
      prev.map((l) => l.lineId === lineId ? { ...l, returned: Math.max(0, Math.min(val, l.delivered)) } : l)
    )
  }

  const setStalePrice = (lineId: number, val: string) => {
    setLines((prev) =>
      prev.map((l) => l.lineId === lineId ? { ...l, stalePrice: val === '' ? null : Number(val) } : l)
    )
  }

  const hasReturns = lines.some((l) => l.returned > 0)
  const totalReturned = lines.reduce((s, l) => s + l.returned, 0)

  const handleConfirm = async () => {
    setSaving(true)
    await onConfirm(invoice.id, lines, cash, notes)
    setSaving(false)
  }

  return (
    <Modal title={`Повернення — ${invoice.invoice_number}`} onClose={onClose}>
      <div className={styles.returnDetail}>
        <div className={styles.invoiceMeta}>
          <span><strong>Клієнт:</strong> {clientName}</span>
          <span><strong>Сума накладної:</strong> {invoice.total_sum.toFixed(2)} ₴</span>
        </div>

        <p className={styles.returnHint}>
          Повернений товар перейде до магазину як несвіжий.
        </p>

        <table className={styles.linesTable}>
          <thead>
            <tr>
              <th>Виріб</th>
              <th>Відвант.</th>
              <th>Повернуто</th>
              <th>Ціна несвіж., ₴</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.lineId}>
                <td>{l.productName}</td>
                <td className={styles.numCell}>{l.delivered}</td>
                <td className={styles.numCell}>
                  <input
                    type="number"
                    min={0}
                    max={l.delivered}
                    value={l.returned || ''}
                    onChange={(e) => setReturned(l.lineId, Number(e.target.value))}
                    className={styles.returnInput}
                  />
                </td>
                <td className={styles.numCell}>
                  {l.returned > 0 && (
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={l.stalePrice ?? ''}
                      onChange={(e) => setStalePrice(l.lineId, e.target.value)}
                      className={styles.returnInput}
                      placeholder="—"
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          {hasReturns && (
            <tfoot>
              <tr>
                <td colSpan={2} style={{ textAlign: 'right', fontWeight: 600 }}>Всього повернуто:</td>
                <td className={styles.numCell} style={{ fontWeight: 600 }}>{totalReturned}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>

        <div className={styles.returnForm}>
          <label className={styles.returnLabel}>
            Готівка від водія (₴):
            <input
              type="number"
              min={0}
              step="0.01"
              value={cash || ''}
              onChange={(e) => setCash(Number(e.target.value))}
              className={styles.cashInput}
              placeholder="0.00"
            />
          </label>
          <label className={styles.returnLabel}>
            Нотатка:
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className={styles.notesInput}
              placeholder="необов'язково"
            />
          </label>
        </div>

        <div className={styles.returnActions}>
          <button className={styles.btnCancel} onClick={onClose}>
            Скасувати
          </button>
          <button
            className={styles.btnConfirmReturn}
            onClick={handleConfirm}
            disabled={saving}
          >
            {saving ? 'Збереження...' : 'Підтвердити доставку'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Модальне вікно скасування рейсу ─────────────────────────────────────────

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
  const [activeClientId, setActiveClientId] = useState<number | null>(null)

  const [generating,     setGenerating]     = useState(false)
  const [genResult,      setGenResult]      = useState<string | null>(null)

  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null)
  const [returnInvoice,   setReturnInvoice]   = useState<Invoice | null>(null)
  // Вибрані накладні для друку (id → boolean)
  const [checkedIds, setCheckedIds] = useState<Set<number>>(new Set())

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

  // При зміні маршруту — скидаємо вибраного клієнта
  const selectRoute = (routeId: number) => {
    setActiveRouteId(routeId)
    setActiveClientId(null)
    setGenResult(null)
  }

  // ─── Генерація накладних ─────────────────────────────────────────────────────

  const handleGenerate = async () => {
    if (!activeRouteId) return
    setGenerating(true)
    setGenResult(null)
    const res = await api.post<{ created: number; skipped: number; no_orders: number }>(
      `/invoices/generate-from-orders?invoice_date=${workDate}&route_id=${activeRouteId}`, {}
    )
    setGenResult(`Створено: ${res.created}, вже існували: ${res.skipped}, без замовлень: ${res.no_orders}`)
    const inv = await api.get<Invoice[]>(`/invoices/?invoice_date=${workDate}`)
    setInvoices(inv)
    setGenerating(false)
  }

  // ─── Зміна статусу ──────────────────────────────────────────────────────────

  const handleStatusAdvance = async (invoice: Invoice) => {
    const map: Partial<Record<Invoice['status'], Invoice['status']>> = { draft: 'printed', printed: 'delivered' }
    const next = map[invoice.status]
    if (!next) return
    await api.put(`/invoices/${invoice.id}/status?status=${next}`, {})
    setInvoices((prev) =>
      prev.map((inv) => (inv.id === invoice.id ? { ...inv, status: next } : inv))
    )
  }

  // ─── Друк вибраних ─────────────────────────────────────────────────────────

  const printChecked = async () => {
    if (checkedIds.size === 0) return
    const ids = [...checkedIds].join(',')
    window.open(`/api/v1/print/invoices?invoice_date=${workDate}&ids=${ids}`, '_blank')
    // Переводимо в printed
    await Promise.all(
      [...checkedIds].map(async (id) => {
        const inv = invoices.find((i) => i.id === id)
        if (inv && inv.status === 'draft') {
          await api.put(`/invoices/${id}/status?status=printed`, {})
        }
      })
    )
    const inv = await api.get<Invoice[]>(`/invoices/?invoice_date=${workDate}`)
    setInvoices(inv)
  }

  // ─── Обробка повернення ──────────────────────────────────────────────────────

  const handleConfirmReturn = async (
    invoiceId: number,
    returns: ReturnLine[],
    _cash: number,
    _notes: string
  ) => {
    // Відправляємо повернення → backend записує несвіжий товар у shop_counts
    await api.post(`/invoices/${invoiceId}/process-return`, { returns })
    setInvoices((prev) =>
      prev.map((inv) => (inv.id === invoiceId ? { ...inv, status: 'delivered' } : inv))
    )
    setReturnInvoice(null)
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

  // При зміні накладних — вибрати всі (хуки МАЮТЬ бути до умовного return)
  useEffect(() => {
    if (invoices.length > 0) {
      const allInvIds = new Set(
        invoices.filter((i) => i.status !== 'cancelled').map((i) => i.id)
      )
      setCheckedIds(allInvIds)
    }
  }, [invoices])

  if (loading) return <p style={{ padding: '1rem' }}>Завантаження...</p>

  const activeRoute = routes.find((r) => r.id === activeRouteId)
  const activeClients = activeRouteId ? routeClients(activeRouteId) : []

  // Фільтрація по клієнту (якщо обраний)
  const visibleClients = activeClientId
    ? activeClients.filter((c) => c.id === activeClientId)
    : activeClients

  // Накладні маршруту
  const routeInvoices = invoices.filter(
    (inv) => inv.route_id === activeRouteId && inv.status !== 'cancelled'
  )
  const routeTotal = routeInvoices.reduce((s, i) => s + i.total_sum, 0)

  // Накладні вибраних клієнтів
  const visibleInvoices = visibleClients
    .map((c) => clientInvoice(c.id))
    .filter((inv): inv is Invoice => !!inv)

  // Управління галочками
  const allChecked = visibleInvoices.length > 0 &&
    visibleInvoices.every((inv) => checkedIds.has(inv.id))
  const someChecked = visibleInvoices.some((inv) => checkedIds.has(inv.id))

  const toggleAll = () => {
    if (allChecked) {
      setCheckedIds((prev) => {
        const next = new Set(prev)
        visibleInvoices.forEach((inv) => next.delete(inv.id))
        return next
      })
    } else {
      setCheckedIds((prev) => {
        const next = new Set(prev)
        visibleInvoices.forEach((inv) => next.add(inv.id))
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

  const checkedCount = visibleInvoices.filter((inv) => checkedIds.has(inv.id)).length

  return (
    <div className={styles.page}>

      {/* ── Ліва панель ────────────────────────────────────────────────────── */}
      <aside className={styles.sidebar}>

        {/* Маршрути */}
        <div className={styles.sidebarSection}>
          <div className={styles.sidebarTitle}>Маршрути</div>
          {routes.map((route) => {
            const rc = routeClients(route.id)
            const rInvoices = invoices.filter(
              (inv) => inv.route_id === route.id && inv.status !== 'cancelled'
            )
            const rTotal = rInvoices.reduce((s, i) => s + i.total_sum, 0)
            const withInv = rc.filter((c) => !!clientInvoice(c.id)).length
            const withOrd = rc.filter((c) => clientOrders(c.id).length > 0).length

            return (
              <button
                key={route.id}
                className={`${styles.routeBtn} ${activeRouteId === route.id ? styles.routeBtnActive : ''}`}
                onClick={() => selectRoute(route.id)}
              >
                <span className={styles.routeName}>{route.name}</span>
                <span className={styles.routeStats}>
                  <>
                      <span title="Накладних / із замовленнями">{withInv}/{withOrd}</span>
                      {rTotal > 0 && (
                        <span className={styles.routeSum}>{rTotal.toFixed(0)} ₴</span>
                      )}
                  </>
                </span>
              </button>
            )
          })}
        </div>

        {/* Клієнти вибраного маршруту */}
        {activeRouteId && activeClients.length > 0 && (
          <div className={styles.sidebarSection}>
            <div className={styles.sidebarTitle}>Клієнти</div>
            <button
              className={`${styles.clientBtn} ${activeClientId === null ? styles.clientBtnActive : ''}`}
              onClick={() => setActiveClientId(null)}
            >
              <span className={styles.clientName}>Всі</span>
              <span className={styles.clientStats}>{routeInvoices.length} накл.</span>
            </button>
            {activeClients.map((client) => {
              const inv = clientInvoice(client.id)
              const ord = clientOrders(client.id)
              return (
                <button
                  key={client.id}
                  className={`${styles.clientBtn} ${activeClientId === client.id ? styles.clientBtnActive : ''} ${!ord.length ? styles.clientNoOrder : ''}`}
                  onClick={() => setActiveClientId(client.id)}
                >
                  <span className={styles.clientName}>
                    {client.short_name ?? client.full_name}
                  </span>
                  <span className={styles.clientStats}>
                    {inv ? (
                      <span className={`${styles.clientStatus} ${styles[`cs_${inv.status}`]}`}>
                        {inv.total_sum.toFixed(0)} ₴
                      </span>
                    ) : ord.length > 0 ? (
                      <span className={styles.clientNoInv}>—</span>
                    ) : null}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </aside>

      {/* ── Права панель ───────────────────────────────────────────────────── */}
      <main className={styles.main}>
        {activeRoute ? (
          <>
            {/* Тулбар */}
            <div className={styles.toolbar}>
              <h2 className={styles.title}>
                {activeRoute.name}
                {activeClientId && (
                  <span className={styles.titleClient}>
                    {' / '}{clientName(activeClientId)}
                  </span>
                )}
              </h2>

              <div className={styles.toolbarRight}>
                {routeTotal > 0 && (
                  <span className={styles.routeTotalLabel}>
                    Сума: <strong>{routeTotal.toFixed(2)} ₴</strong>
                  </span>
                )}
                <button
                  className={styles.btnGenerate}
                  onClick={handleGenerate}
                  disabled={generating}
                >
                  {generating ? 'Генерую...' : '⟳ Генерувати накладні'}
                </button>
                {checkedCount > 0 && (
                  <button
                    className={styles.btnPrint}
                    onClick={printChecked}
                  >
                    🖨 Друкувати вибрані ({checkedCount})
                  </button>
                )}
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
                    <th className={styles.thCheck}>
                      <input
                        type="checkbox"
                        checked={allChecked}
                        ref={(el) => { if (el) el.indeterminate = !allChecked && someChecked }}
                        onChange={toggleAll}
                      />
                    </th>
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
                  {visibleClients.map((client) => {
                    const ord = clientOrders(client.id)
                    const inv = clientInvoice(client.id)
                    const totalQty = ord.reduce((s, o) => s + o.qty, 0)
                    const hasOrders = ord.length > 0
                    const isChecked = inv ? checkedIds.has(inv.id) : false

                    return (
                      <tr
                        key={client.id}
                        className={`${styles.row} ${!hasOrders ? styles.rowNoOrder : ''}`}
                      >
                        <td className={styles.tdCheck}>
                          {inv && (
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleOne(inv.id)}
                            />
                          )}
                        </td>
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
                              <button
                                className={styles.btnPrintSingle}
                                onClick={() => window.open(`/api/v1/print/invoice/${inv.id}`, '_blank')}
                                title="Друкувати накладну"
                              >
                                🖨
                              </button>
                              {inv.status === 'printed' && (
                                <button
                                  className={styles.btnReturn}
                                  onClick={() => setReturnInvoice(inv)}
                                  title="Обробити повернення"
                                >
                                  Повернення
                                </button>
                              )}
                              {inv.status === 'draft' && (
                                <button
                                  className={styles.btnAdvance}
                                  onClick={() => handleStatusAdvance(inv)}
                                >
                                  → Надруковано
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

            {visibleClients.length === 0 && (
              <p className={styles.empty}>Немає клієнтів у маршруті</p>
            )}
          </>
        ) : (
          <p className={styles.empty}>Оберіть маршрут</p>
        )}
      </main>

      {/* ── Модальне вікно: деталі накладної ──────────────────────────────── */}
      {selectedInvoice && (
        <InvoiceModal
          invoice={selectedInvoice}
          products={products}
          clientName={clientName(selectedInvoice.client_id)}
          onClose={() => setSelectedInvoice(null)}
        />
      )}

      {/* ── Модальне вікно: повернення ─────────────────────────────────────── */}
      {returnInvoice && (
        <ReturnModal
          invoice={returnInvoice}
          products={products}
          clientName={clientName(returnInvoice.client_id)}
          onClose={() => setReturnInvoice(null)}
          onConfirm={handleConfirmReturn}
        />
      )}

    </div>
  )
}
