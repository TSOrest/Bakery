import { useEffect, useRef, useState } from 'react'
import { useWorkDate } from '../context/DateContext'
import { api } from '../api/client'
import type { Client, Invoice, InvoiceLine, Product, Route } from '../types'
import styles from './RoutesPage.module.css'

// ─── Лейбли статусів ───────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  draft:      'Чернетка',
  sent:       'Відправлено',
  processing: 'Опрацювання',
  accepted:   'Прийнято',
  cancelled:  'Скасовано',
}

// ─── Панель деталей накладної (права 50%) ──────────────────────────────────────

interface DetailPanelProps {
  invoice: Invoice
  corrective: Invoice | null
  client: Client
  products: Product[]
  onStatusChange: (inv: Invoice) => void
  onRefresh: () => void
}

function InvoiceDetailPanel({
  invoice, corrective, client, products, onStatusChange, onRefresh,
}: DetailPanelProps) {
  const productName = (id: number) => {
    const p = products.find((p) => p.id === id)
    return p?.short_name ?? p?.name ?? `#${id}`
  }

  // ── Стан редагування qty (draft-режим) ──────────────────────────────────────
  const [editMode,    setEditMode]    = useState(false)
  const [editQtys,    setEditQtys]    = useState<Record<number, number>>({})
  const [savingEdit,  setSavingEdit]  = useState(false)

  const startEdit = () => {
    const qtys: Record<number, number> = {}
    invoice.lines.forEach((l) => { qtys[l.id] = l.qty })
    setEditQtys(qtys)
    setEditMode(true)
  }

  const saveEdit = async () => {
    setSavingEdit(true)
    const lines = Object.entries(editQtys).map(([id, qty]) => ({ id: Number(id), qty }))
    await api.put<Invoice>(`/invoices/${invoice.id}/lines`, { lines })
    setSavingEdit(false)
    setEditMode(false)
    onRefresh()
  }

  // ── Відправити (draft → sent) ────────────────────────────────────────────────
  const [sending, setSending] = useState(false)

  const handleSend = async () => {
    setSending(true)
    const updated = await api.put<Invoice>(`/invoices/${invoice.id}/status?status=sent`, {})
    setSending(false)
    onStatusChange(updated)
    // Відкриваємо друк
    window.open(`/api/v1/print/invoice/${invoice.id}`, '_blank')
  }

  // ── Пряме прийняття (sent/processing → accepted) ─────────────────────────────
  const [accepting, setAccepting] = useState(false)

  const handleAccept = async () => {
    setAccepting(true)
    const updated = await api.put<Invoice>(`/invoices/${invoice.id}/status?status=accepted`, {})
    setAccepting(false)
    onStatusChange(updated)
  }

  // ── Перехід в Опрацювання (sent → processing) ────────────────────────────────
  const handleProcess = async () => {
    const updated = await api.put<Invoice>(`/invoices/${invoice.id}/status?status=processing`, {})
    onStatusChange(updated)
  }

  // ── Форма Опрацювання ─────────────────────────────────────────────────────────
  const [showProc,    setShowProc]    = useState(false)
  const [procQtys,    setProcQtys]    = useState<Record<number, number>>({})
  const [cashReceived, setCashReceived] = useState(0)
  const [procNotes,   setProcNotes]   = useState('')
  const [confirming,  setConfirming]  = useState(false)

  const openProc = () => {
    const qtys: Record<number, number> = {}
    invoice.lines.forEach((l) => { qtys[l.product_id] = l.qty })
    setProcQtys(qtys)
    setShowProc(true)
  }

  const handleConfirmProc = async () => {
    setConfirming(true)
    const lines = Object.entries(procQtys).map(([pid, qty]) => ({
      product_id: Number(pid),
      qty_delivered: qty,
    }))
    await api.post<Invoice>(`/invoices/${invoice.id}/corrective`, {
      cash_received: cashReceived,
      notes: procNotes,
      lines,
    })
    setConfirming(false)
    setShowProc(false)
    onRefresh()
  }

  const { status } = invoice

  // ── Форматування дати ─────────────────────────────────────────────────────────
  const formatDate = (d: string) => {
    const [y, m, day] = d.split('-')
    const months = ['','січня','лютого','березня','квітня','травня','червня',
                    'липня','серпня','вересня','жовтня','листопада','грудня']
    return `${parseInt(day)} ${months[parseInt(m)]} ${y}`
  }

  return (
    <>
      <div className={styles.paper}>
        {/* ── Шапка ── */}
        <div className={styles.paperHeader}>
          <div>
            <div className={styles.paperInvNum}>
              Накладна №{invoice.invoice_number}
              {invoice.corrective_for_id && (
                <span className={styles.correctiveBadge}>↩ коригуюча</span>
              )}
            </div>
            <div className={styles.paperDate}>{formatDate(invoice.invoice_date)}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <span className={`${styles.statusBadge} ${styles[`status_${status}`]}`}>
              {STATUS_LABELS[status] ?? status}
            </span>
            <div className={styles.paperClientName}>
              {client.short_name ?? client.full_name}
            </div>
            {client.address && (
              <div className={styles.paperClientAddr}>{client.address}</div>
            )}
          </div>
        </div>

        {/* ── Рядки ── */}
        <table className={styles.paperTable}>
          <thead>
            <tr>
              <th>Виріб</th>
              <th className={styles.numTh}>Кільк.</th>
              <th className={styles.numTh}>Ціна</th>
              <th className={styles.numTh}>Сума</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((line: InvoiceLine) => (
              <tr key={line.id}>
                <td>
                  {productName(line.product_id)}
                  {line.is_exchange === 1 && (
                    <span style={{ color: '#e67e22', fontSize: '0.75rem', marginLeft: '0.3rem' }}>
                      (обмін)
                    </span>
                  )}
                </td>
                <td className={styles.numTd}>
                  {editMode ? (
                    <input
                      type="number"
                      min={0}
                      step={0.1}
                      value={editQtys[line.id] ?? line.qty}
                      onChange={(e) =>
                        setEditQtys((p) => ({ ...p, [line.id]: Number(e.target.value) }))
                      }
                      className={styles.qtyInput}
                    />
                  ) : line.qty}
                </td>
                <td className={styles.numTd}>
                  {(line.price_override ?? line.price).toFixed(2)} ₴
                </td>
                <td className={styles.numTd}>{line.sum.toFixed(2)} ₴</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} style={{ textAlign: 'right' }}>Разом:</td>
              <td className={styles.numTd}>{invoice.total_sum.toFixed(2)} ₴</td>
            </tr>
          </tfoot>
        </table>

        {/* ── Панель Опрацювання ── */}
        {showProc && (
          <div className={styles.processingPanel}>
            <div className={styles.processingTitle}>Опрацювання після повернення водія</div>

            <div className={styles.cashRow}>
              <span className={styles.cashLabel}>Готівка від водія (₴):</span>
              <input
                type="number"
                min={0}
                step={0.01}
                value={cashReceived || ''}
                onChange={(e) => setCashReceived(Number(e.target.value))}
                className={styles.cashInput}
                placeholder="0.00"
              />
              <span className={styles.cashLabel}>Нотатка:</span>
              <input
                type="text"
                value={procNotes}
                onChange={(e) => setProcNotes(e.target.value)}
                className={styles.notesInput}
                placeholder="необов'язково"
              />
            </div>

            <table className={styles.procTable}>
              <thead>
                <tr>
                  <th>Виріб</th>
                  <th className={styles.numTh}>Відправлено</th>
                  <th className={styles.numTh}>Прийнято</th>
                  <th className={styles.numTh}>Різниця</th>
                </tr>
              </thead>
              <tbody>
                {invoice.lines.map((line: InvoiceLine) => {
                  const delivered = procQtys[line.product_id] ?? line.qty
                  const diff = line.qty - delivered
                  return (
                    <tr key={line.id}>
                      <td>{productName(line.product_id)}</td>
                      <td className={styles.numTd}>{line.qty}</td>
                      <td className={styles.numTd}>
                        <input
                          type="number"
                          min={0}
                          step={0.1}
                          value={delivered}
                          onChange={(e) =>
                            setProcQtys((p) => ({
                              ...p,
                              [line.product_id]: Math.max(0, Number(e.target.value)),
                            }))
                          }
                          className={styles.procInput}
                        />
                      </td>
                      <td className={`${styles.numTd} ${diff > 0 ? styles.diffPos : diff < 0 ? styles.diffNeg : ''}`}>
                        {diff !== 0 ? (diff > 0 ? `−${diff}` : `+${Math.abs(diff)}`) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            <div className={styles.procActions}>
              <button className={styles.btnCancel} onClick={() => setShowProc(false)}>
                Скасувати
              </button>
              <button
                className={styles.btnConfirm}
                onClick={handleConfirmProc}
                disabled={confirming}
              >
                {confirming ? 'Збереження...' : '✓ Підтвердити'}
              </button>
            </div>
          </div>
        )}

        {/* ── Кнопки дій ── */}
        {!showProc && (
          <div className={styles.paperActions}>
            <button
              className={styles.btnPrintSingle}
              onClick={() => window.open(`/api/v1/print/invoice/${invoice.id}`, '_blank')}
              title="Друкувати накладну"
            >
              🖨 Друкувати
            </button>

            {status === 'draft' && !editMode && (
              <>
                <button className={styles.btnEdit} onClick={startEdit}>
                  ✏ Редагувати
                </button>
                <button className={styles.btnSend} onClick={handleSend} disabled={sending}>
                  {sending ? 'Відправляємо...' : '▶ Відправити'}
                </button>
              </>
            )}

            {status === 'draft' && editMode && (
              <>
                <button className={styles.btnCancel} onClick={() => setEditMode(false)}>
                  Скасувати
                </button>
                <button className={styles.btnSaveEdit} onClick={saveEdit} disabled={savingEdit}>
                  {savingEdit ? 'Збереження...' : '💾 Зберегти'}
                </button>
              </>
            )}

            {status === 'sent' && !showProc && (
              <>
                <button className={styles.btnProcess} onClick={handleProcess}>
                  📦 Опрацювати
                </button>
                <button
                  className={styles.btnAccept}
                  onClick={handleAccept}
                  disabled={accepting}
                >
                  {accepting ? '...' : '✓ Прийнято'}
                </button>
              </>
            )}

            {status === 'processing' && !showProc && (
              <>
                <button className={styles.btnProcess} onClick={openProc}>
                  ✏ Внести корекції
                </button>
                <button
                  className={styles.btnAccept}
                  onClick={handleAccept}
                  disabled={accepting}
                >
                  {accepting ? '...' : '✓ Прийнято'}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Коригуюча накладна ── */}
      {corrective && (
        <div className={styles.correctivePaper}>
          <div className={styles.correctiveHeader}>
            ↩ Коригуюча накладна №{corrective.invoice_number}
          </div>
          <table className={styles.paperTable}>
            <thead>
              <tr>
                <th>Виріб</th>
                <th className={styles.numTh}>Різниця</th>
                <th className={styles.numTh}>Ціна</th>
                <th className={styles.numTh}>Сума</th>
              </tr>
            </thead>
            <tbody>
              {corrective.lines.map((line: InvoiceLine) => (
                <tr key={line.id}>
                  <td>{productName(line.product_id)}</td>
                  <td className={styles.numTd}>{line.qty}</td>
                  <td className={styles.numTd}>{line.price.toFixed(2)} ₴</td>
                  <td className={styles.numTd}>{line.sum.toFixed(2)} ₴</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} style={{ textAlign: 'right' }}>Різниця:</td>
                <td className={styles.numTd}>{corrective.total_sum.toFixed(2)} ₴</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </>
  )
}

// ─── Головна сторінка ──────────────────────────────────────────────────────────

export default function RoutesPage() {
  const { workDate } = useWorkDate()

  const [routes,   setRoutes]   = useState<Route[]>([])
  const [clients,  setClients]  = useState<Client[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading,  setLoading]  = useState(true)

  const [activeRouteId,  setActiveRouteId]  = useState<number | null>(null)
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)

  const [generating,  setGenerating]  = useState(false)
  const [checkedIds,  setCheckedIds]  = useState<Set<number>>(new Set())

  // ── Завантаження ─────────────────────────────────────────────────────────────

  const load = async (date: string) => {
    setLoading(true)
    const [r, c, p, inv] = await Promise.all([
      api.get<Route[]>('/routes/'),
      api.get<Client[]>('/clients/'),
      api.get<Product[]>('/products/'),
      api.get<Invoice[]>(`/invoices/?invoice_date=${date}`),
    ])
    setRoutes(r)
    setClients(c)
    setProducts(p)
    setInvoices(inv)
    if (r.length > 0 && activeRouteId === null) setActiveRouteId(r[0].id)
    setLoading(false)
  }

  useEffect(() => { load(workDate) }, [workDate])

  // ── Автовибір галочок після завантаження ─────────────────────────────────────
  useEffect(() => {
    const ids = new Set(
      invoices
        .filter((i) => i.corrective_for_id === null && i.status !== 'cancelled')
        .map((i) => i.id)
    )
    setCheckedIds(ids)
  }, [invoices])

  // ── Генерація накладних ───────────────────────────────────────────────────────

  const handleGenerate = async () => {
    if (!activeRouteId) return
    setGenerating(true)
    await api.post(`/invoices/generate-from-orders?invoice_date=${workDate}&route_id=${activeRouteId}`, {})
    await load(workDate)
    setGenerating(false)
  }

  // ── Друк вибраних ──────────────────────────────────────────────────────────────

  const printChecked = async () => {
    if (checkedIds.size === 0) return
    const ids = [...checkedIds].join(',')
    window.open(`/api/v1/print/invoices?invoice_date=${workDate}&ids=${ids}`, '_blank')
    // Переводимо draft → sent
    await Promise.all(
      [...checkedIds].map(async (id) => {
        const inv = invoices.find((i) => i.id === id)
        if (inv && inv.status === 'draft') {
          await api.put(`/invoices/${id}/status?status=sent`, {})
        }
      })
    )
    await load(workDate)
  }

  // ── Оновлення одного invoice в стані ─────────────────────────────────────────

  const handleStatusChange = (updated: Invoice) => {
    setInvoices((prev) => prev.map((i) => (i.id === updated.id ? updated : i)))
  }

  // ── Допоміжні ─────────────────────────────────────────────────────────────────

  const baseInvoices  = invoices.filter((i) => i.corrective_for_id === null)
  const clientInvoice = (clientId: number) =>
    baseInvoices.find((i) => i.client_id === clientId && i.status !== 'cancelled')

  const correctiveFor = (invoiceId: number) =>
    invoices.find((i) => i.corrective_for_id === invoiceId) ?? null

  const routeClients = (routeId: number) =>
    clients.filter((c) => c.route_id === routeId && c.is_active)

  // ── Список клієнтів у лівій панелі ───────────────────────────────────────────

  const listClients: Client[] = activeRouteId
    ? routeClients(activeRouteId)
    : clients.filter((c) => !!clientInvoice(c.id))

  // Сортуємо: спочатку ті з накладними
  const sortedClients = [...listClients].sort((a, b) => {
    const ai = clientInvoice(a.id)
    const bi = clientInvoice(b.id)
    if (ai && !bi) return -1
    if (!ai && bi) return 1
    return 0
  })

  // Підрахунок для "Друкувати вибрані"
  const checkedCount = [...checkedIds].filter((id) =>
    invoices.some((i) => i.id === id)
  ).length

  // Сума по маршруту/всіх
  const routeTotal = (activeRouteId
    ? baseInvoices.filter((i) => i.route_id === activeRouteId)
    : baseInvoices
  )
    .filter((i) => i.status !== 'cancelled')
    .reduce((s, i) => s + i.total_sum, 0)

  // Чи є клієнти без накладних в активному маршруті
  const hasMissing = activeRouteId
    ? routeClients(activeRouteId).some((c) => !clientInvoice(c.id))
    : false

  // Checkbox "Виділити всі"
  const allCheckable = sortedClients
    .map((c) => clientInvoice(c.id))
    .filter((i): i is Invoice => !!i && i.status !== 'cancelled')

  const allChecked = allCheckable.length > 0 &&
    allCheckable.every((i) => checkedIds.has(i.id))
  const someChecked = allCheckable.some((i) => checkedIds.has(i.id))

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

  if (loading) return <p style={{ padding: '1rem' }}>Завантаження...</p>

  const selectedInvoice = selectedClient ? clientInvoice(selectedClient.id) : null

  return (
    <div className={styles.page}>

      {/* ── Горизонтальний фільтр маршрутів ──────────────────────────────────── */}
      <div className={styles.routeFilters}>
        <button
          className={`${styles.filterBtn} ${activeRouteId === null ? styles.filterBtnActive : ''}`}
          onClick={() => { setActiveRouteId(null); setSelectedClient(null) }}
        >
          Всі
        </button>

        {routes.map((route) => {
          const rInv = baseInvoices.filter(
            (i) => i.route_id === route.id && i.status !== 'cancelled'
          )
          const rTotal = rInv.reduce((s, i) => s + i.total_sum, 0)
          return (
            <button
              key={route.id}
              className={`${styles.filterBtn} ${activeRouteId === route.id ? styles.filterBtnActive : ''}`}
              onClick={() => { setActiveRouteId(route.id); setSelectedClient(null) }}
            >
              {route.name}
              {rTotal > 0 && <span style={{ marginLeft: '0.35rem', opacity: 0.8 }}>
                {rTotal.toFixed(0)} ₴
              </span>}
            </button>
          )
        })}

        <div className={styles.filterSep} />

        {routeTotal > 0 && (
          <span style={{ fontSize: '0.82rem', color: '#555' }}>
            Разом: <strong>{routeTotal.toFixed(2)} ₴</strong>
          </span>
        )}

        {activeRouteId && hasMissing && (
          <button
            className={styles.genBtn}
            onClick={handleGenerate}
            disabled={generating}
          >
            {generating ? 'Генерую...' : '⟳ Генерувати накладні'}
          </button>
        )}

        {checkedCount > 0 && (
          <button className={styles.printSelBtn} onClick={printChecked}>
            🖨 Друкувати вибрані ({checkedCount})
          </button>
        )}
      </div>

      {/* ── Основний layout 50/50 ────────────────────────────────────────────── */}
      <div className={styles.body}>

        {/* ── Ліва панель: список клієнтів ────────────────────────────────────── */}
        <div className={styles.invoiceList}>
          <div className={styles.listHeader}>
            <span className={styles.listTitle}>
              {activeRouteId
                ? routes.find((r) => r.id === activeRouteId)?.name ?? 'Клієнти'
                : 'Всі накладні'}
            </span>
            <input
              ref={headerCheckRef}
              type="checkbox"
              checked={allChecked}
              onChange={toggleAll}
              title="Виділити всі"
            />
          </div>

          <div className={styles.listScroll}>
            {sortedClients.map((client) => {
              const inv = clientInvoice(client.id)
              const hasInv = !!inv
              const isActive = selectedClient?.id === client.id

              return (
                <div
                  key={client.id}
                  className={`${styles.invoiceRow}
                    ${isActive ? styles.invoiceRowActive : ''}
                    ${!hasInv ? styles.invoiceRowDimmed : ''}`}
                  onClick={() => hasInv || activeRouteId
                    ? setSelectedClient(client)
                    : undefined
                  }
                >
                  {hasInv ? (
                    <input
                      type="checkbox"
                      className={styles.rowCheck}
                      checked={checkedIds.has(inv!.id)}
                      onChange={(e) => { e.stopPropagation(); toggleOne(inv!.id) }}
                    />
                  ) : (
                    <span className={styles.rowCheck} style={{ width: 16 }} />
                  )}

                  <span className={styles.rowClientName}>
                    {client.short_name ?? client.full_name}
                  </span>

                  {hasInv ? (
                    <>
                      <span className={styles.rowInvNum}>{inv!.invoice_number}</span>
                      <span className={`${styles.statusBadge} ${styles[`status_${inv!.status}`]}`}>
                        {STATUS_LABELS[inv!.status]}
                      </span>
                      <span className={styles.rowSum}>{inv!.total_sum.toFixed(2)} ₴</span>
                    </>
                  ) : (
                    <span style={{ fontSize: '0.75rem', color: '#aaa', marginLeft: 'auto' }}>
                      немає накладної
                    </span>
                  )}
                </div>
              )
            })}

            {sortedClients.length === 0 && (
              <div style={{ padding: '1rem', color: '#aaa', fontSize: '0.88rem' }}>
                {activeRouteId ? 'Немає клієнтів у маршруті' : 'Немає накладних за цей день'}
              </div>
            )}
          </div>
        </div>

        {/* ── Права панель: деталь накладної ──────────────────────────────────── */}
        <div className={styles.invoiceDetail}>
          {selectedClient && selectedInvoice ? (
            <InvoiceDetailPanel
              key={selectedInvoice.id}
              invoice={selectedInvoice}
              corrective={correctiveFor(selectedInvoice.id)}
              client={selectedClient}
              products={products}
              onStatusChange={handleStatusChange}
              onRefresh={() => load(workDate)}
            />
          ) : selectedClient && !selectedInvoice ? (
            <div className={styles.emptyDetail}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ marginBottom: '0.75rem', color: '#666' }}>
                  Накладну не знайдено для{' '}
                  <strong>{selectedClient.short_name ?? selectedClient.full_name}</strong>
                </div>
                {activeRouteId && (
                  <button
                    className={styles.genBtn}
                    onClick={handleGenerate}
                    disabled={generating}
                    style={{ borderRadius: 4 }}
                  >
                    {generating ? 'Генерую...' : '⟳ Створити накладні для маршруту'}
                  </button>
                )}
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
