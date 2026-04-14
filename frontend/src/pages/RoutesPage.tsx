import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useWorkDate } from '../context/DateContext'
import { api } from '../api/client'
import type {
  Category, Client, Finance, Invoice, InvoiceLine, Order, OrderWithChildren,
  Product, Route, RouteKpi, ClientState,
} from '../types'
import styles from './RoutesPage.module.css'
import PriceTypeBadge from '../components/PriceTypeBadge'

// ─── Лейбли статусів ───────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  draft:         'Чернетка',
  sent:          'Відправлено',
  processing:    'Опрацювання',
  accepted:      'Прийнято',
  cancelled:     'Скасовано',
  virtual_draft: 'Чернетка',
}

// ─── Форматування дати ─────────────────────────────────────────────────────────

function formatDate(d: string) {
  const [y, m, day] = d.split('-')
  const months = ['','січня','лютого','березня','квітня','травня','червня',
                  'липня','серпня','вересня','жовтня','листопада','грудня']
  return `${parseInt(day)} ${months[parseInt(m)]} ${y}`
}

// ─── VirtualDraftPanel ─────────────────────────────────────────────────────────

interface VirtualDraftProps {
  client: Client
  clientOrders: Order[]
  allOrders: Order[]
  products: Product[]
  allClients: Client[]
  routes: Route[]
  lockedClientIds: Set<number>
  workDate: string
  onSent: (inv: Invoice) => void
  onOrdersChanged: () => void
}

function VirtualDraftPanel({
  client, clientOrders, allOrders, products, allClients, routes,
  lockedClientIds, workDate, onSent, onOrdersChanged,
}: VirtualDraftProps) {
  const productName = (id: number) => {
    const p = products.find((p) => p.id === id)
    return p?.short_name ?? p?.name ?? `#${id}`
  }

  // Обчислення переміщеної кількості для ордера
  const transferredOut = (orderId: number) =>
    allOrders
      .filter((o) => o.parent_order_id === orderId && o.client_id !== client.id)
      .reduce((s, o) => s + o.qty, 0)

  const clientLabel = (id: number) => {
    const c = allClients.find((c) => c.id === id)
    return c?.short_name ?? c?.full_name ?? `#${id}`
  }

  // Стан форми переміщення
  const [transferOpen, setTransferOpen] = useState<number | null>(null)
  const [transferQty, setTransferQty] = useState(0)
  const [transferToClientId, setTransferToClientId] = useState<number | null>(null)
  const [transferNotes, setTransferNotes] = useState('')
  const [transferring, setTransferring] = useState(false)

  const openTransfer = (orderId: number, maxQty: number) => {
    setTransferOpen(orderId)
    setTransferQty(Math.max(1, Math.floor(maxQty)))
    setTransferToClientId(null)
    setTransferNotes('')
  }

  const handleTransfer = async (orderId: number) => {
    if (!transferToClientId || transferQty <= 0) return
    setTransferring(true)
    try {
      await api.post<OrderWithChildren>(`/orders/${orderId}/transfer`, {
        to_client_id: transferToClientId,
        qty: transferQty,
        notes: transferNotes || undefined,
      })
      setTransferOpen(null)
      onOrdersChanged()
    } finally {
      setTransferring(false)
    }
  }

  // Відправити → створити накладну зі статусом sent
  const [sending, setSending] = useState(false)

  const handleSend = async () => {
    setSending(true)
    try {
      const res = await api.post<{ invoice_ids: number[] }>(
        `/invoices/generate-from-orders?invoice_date=${workDate}&client_id=${client.id}`,
        {}
      )
      if (res.invoice_ids.length > 0) {
        const inv = await api.get<Invoice>(`/invoices/${res.invoice_ids[0]}`)
        window.open(`/api/v1/print/invoice/${res.invoice_ids[0]}`, '_blank')
        onSent(inv)
      }
    } finally {
      setSending(false)
    }
  }

  // Список клієнтів для переміщення: без джерела, без "Недопечено", тільки доступні (не відправлені)
  const KIND_ORDER: Record<string, number> = { shop: 0, writeoff: 1, ration: 2, customer: 3 }
  const destinationClients = allClients
    .filter((c) => c.id !== client.id && c.client_kind !== 'underbaked' && !lockedClientIds.has(c.id))
    .sort((a, b) => {
      const ka = KIND_ORDER[a.client_kind] ?? 99
      const kb = KIND_ORDER[b.client_kind] ?? 99
      if (ka !== kb) return ka - kb
      if (a.route_id !== b.route_id) return (a.route_id ?? 0) - (b.route_id ?? 0)
      return (a.short_name ?? a.full_name).localeCompare(b.short_name ?? b.full_name, 'uk')
    })

  const activeRoutes = routes.filter((r) => r.is_active)

  return (
    <div className={styles.paper}>
      {/* Шапка */}
      <div className={styles.paperHeader}>
        <div>
          <div className={styles.paperClientName}>
            {client.short_name ?? client.full_name}
          </div>
          {client.address && (
            <div className={styles.paperClientAddr}>{client.address}</div>
          )}
          <div className={styles.paperDate}>{formatDate(workDate)}</div>
        </div>
        <span className={`${styles.statusBadge} ${styles.status_virtual_draft}`}>
          Чернетка (замовлення)
        </span>
      </div>

      {/* Таблиця ордерів */}
      <table className={styles.draftTable}>
        <thead>
          <tr>
            <th>Виріб</th>
            <th className={styles.numTh}>Замовлено</th>
            <th className={styles.numTh}>Передано</th>
            <th className={styles.numTh}>Ефективно</th>
            <th style={{ width: 36 }} />
          </tr>
        </thead>
        <tbody>
          {clientOrders.map((order) => {
            const isTransferIn = order.origin_id !== null && order.origin_id !== 0
            const transferred  = isTransferIn ? 0 : transferredOut(order.id)
            const effective    = order.qty - transferred

            // Вихідні переміщення (гілки від цього ордера)
            const outgoing = isTransferIn ? [] : allOrders.filter(
              (o) => o.parent_order_id === order.id
            )

            // Джерело вхідного переміщення
            const parentOrder = isTransferIn
              ? allOrders.find((o) => o.id === order.parent_order_id)
              : null
            const sourceLabel = parentOrder ? clientLabel(parentOrder.client_id) : null

            return (
              <React.Fragment key={order.id}>
                {/* ── Головний рядок виробу ── */}
                <tr>
                  <td>
                    <span>{productName(order.product_id)}</span>
                    {isTransferIn && (
                      <span className={styles.transferInTag}>переміщення</span>
                    )}
                  </td>
                  <td className={styles.numTd}>
                    {isTransferIn ? <span className={styles.dimDash}>—</span> : order.qty}
                  </td>
                  <td className={`${styles.numTd} ${transferred > 0 ? styles.transferredQty : ''}`}>
                    {transferred > 0 ? transferred : '—'}
                  </td>
                  <td className={`${styles.numTd} ${styles.effectiveQty}`}>{effective}</td>
                  <td>
                    {effective > 0 && (
                      <button
                        className={styles.transferBtn}
                        onClick={() => openTransfer(order.id, effective)}
                        title="Перемістити товар"
                      >
                        ⇄
                      </button>
                    )}
                  </td>
                </tr>

                {/* ── Вхідна гілка: звідки прийшло ── */}
                {isTransferIn && sourceLabel && (
                  <tr className={styles.flowRow}>
                    <td colSpan={2} className={styles.flowCell}>
                      <span className={styles.flowTreeIn}>└</span>
                      <span className={styles.flowArrowIn}>↑</span>
                      <span className={styles.flowLabel}>від {sourceLabel}</span>
                    </td>
                    <td />
                    <td className={`${styles.numTd} ${styles.flowQtyIn}`}>+{order.qty}</td>
                    <td />
                  </tr>
                )}

                {/* ── Вихідні гілки: куди пішло ── */}
                {outgoing.map((child) => (
                  <tr key={`out-${child.id}`} className={styles.flowRow}>
                    <td colSpan={2} className={styles.flowCell}>
                      <span className={styles.flowTreeOut}>└</span>
                      <span className={styles.flowArrowOut}>↓</span>
                      <span className={styles.flowLabel}>→ {clientLabel(child.client_id)}</span>
                    </td>
                    <td className={`${styles.numTd} ${styles.flowQtyOut}`}>-{child.qty}</td>
                    <td />
                    <td />
                  </tr>
                ))}

                {/* ── Inline форма переміщення ── */}
                {transferOpen === order.id && (
                  <tr className={styles.transferFormRow}>
                    <td colSpan={5}>
                      <div className={styles.transferForm}>
                        <span className={styles.transferLabel}>Кількість:</span>
                        <input
                          type="number"
                          min={1}
                          max={Math.floor(effective)}
                          step={1}
                          value={transferQty}
                          onChange={(e) => setTransferQty(Math.min(Math.floor(effective), Math.max(1, Math.floor(Number(e.target.value)))))}
                          className={styles.transferInput}
                        />
                        <span className={styles.transferLabel}>Кому:</span>
                        <select
                          value={transferToClientId ?? ''}
                          onChange={(e) => setTransferToClientId(Number(e.target.value) || null)}
                          className={styles.transferSelect}
                        >
                          <option value="">— оберіть клієнта —</option>
                          {destinationClients
                            .filter((c) => c.client_kind !== 'customer')
                            .map((c) => (
                              <option key={c.id} value={c.id}>{c.short_name ?? c.full_name}</option>
                            ))}
                          {activeRoutes.map((r) => {
                            const group = destinationClients.filter(
                              (c) => c.client_kind === 'customer' && c.route_id === r.id
                            )
                            if (!group.length) return null
                            return (
                              <optgroup key={r.id} label={r.name}>
                                {group.map((c) => (
                                  <option key={c.id} value={c.id}>{c.short_name ?? c.full_name}</option>
                                ))}
                              </optgroup>
                            )
                          })}
                          {(() => {
                            const noRoute = destinationClients.filter(
                              (c) => c.client_kind === 'customer' && c.route_id === null
                            )
                            if (!noRoute.length) return null
                            return (
                              <optgroup label="Без маршруту">
                                {noRoute.map((c) => (
                                  <option key={c.id} value={c.id}>{c.short_name ?? c.full_name}</option>
                                ))}
                              </optgroup>
                            )
                          })()}
                        </select>
                        <button
                          className={styles.btnTransfer}
                          onClick={() => handleTransfer(order.id)}
                          disabled={transferring || !transferToClientId || transferQty <= 0}
                        >
                          {transferring ? '...' : 'Передати'}
                        </button>
                        <button
                          className={styles.btnCancel}
                          onClick={() => setTransferOpen(null)}
                        >
                          Скасувати
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            )
          })}
        </tbody>
      </table>

      <div className={styles.paperActions}>
        <button
          className={styles.btnSend}
          onClick={handleSend}
          disabled={sending || transferOpen !== null || clientOrders.every((o) => o.qty - transferredOut(o.id) <= 0)}
        >
          {sending ? 'Створюємо накладну...' : '▶ Відправити'}
        </button>
      </div>
    </div>
  )
}

// ─── InvoiceDetailPanel ────────────────────────────────────────────────────────

interface DetailPanelProps {
  invoice: Invoice
  corrective: Invoice | null
  client: Client
  products: Product[]
  categories: Category[]
  routes: Route[]
  bakeryName: string
  director: string
  accountant: string
  onStatusChange: (inv: Invoice) => void
  onRefresh: () => void
}

function InvoiceDetailPanel({
  invoice, corrective, client, products, categories, routes,
  bakeryName, director, accountant, onStatusChange, onRefresh,
}: DetailPanelProps) {
  const productName = (id: number) => {
    const p = products.find((p) => p.id === id)
    return p?.short_name ?? p?.name ?? `#${id}`
  }

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
  const [showProc, setShowProc]       = useState(false)
  const [procQtys, setProcQtys]       = useState<Record<number, number>>({})
  const [cashReceived, setCashReceived] = useState(0)
  const [procNotes, setProcNotes]     = useState('')
  const [confirming, setConfirming]   = useState(false)

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

  // ── Групування рядків по категорії ───────────────────────────────────────
  const catMap: Record<number, Category> = {}
  for (const cat of categories) catMap[cat.id] = cat

  const mainLines = invoice.lines.filter((l) => !l.is_exchange)
  const exchLines = invoice.lines.filter((l) => l.is_exchange === 1)

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
        {!showProc && (
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              className={styles.btnPrintSingle}
              onClick={() => window.open(`/api/v1/print/invoice/${invoice.id}`, '_blank')}
            >
              🖨 Друкувати
            </button>
            {status === 'draft' && (
              <button className={styles.btnSend} onClick={handleSend} disabled={sending}>
                {sending ? 'Відправляємо...' : '▶ Відправити'}
              </button>
            )}
            {status === 'sent' && (
              <>
                <button className={styles.btnProcess} onClick={handleProcess}>
                  📦 Опрацювати
                </button>
                <button className={styles.btnAccept} onClick={handleAccept} disabled={accepting}>
                  {accepting ? '...' : '✓ Прийнято'}
                </button>
              </>
            )}
            {status === 'processing' && (
              <>
                <button className={styles.btnProcess} onClick={openProc}>
                  ✏ Внести корекції
                </button>
                <button className={styles.btnAccept} onClick={handleAccept} disabled={accepting}>
                  {accepting ? '...' : '✓ Прийнято'}
                </button>
              </>
            )}
          </div>
        )}
      </div>

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
                <tr key={line.id}>
                  <td>{productName(line.product_id)}</td>
                  <td className={styles.numTd}>{line.qty}</td>
                  <td className={styles.numTd}>
                    {(line.price_override ?? line.price).toFixed(2)} ₴
                    {line.price_override != null && <PriceTypeBadge source="manual" />}
                  </td>
                  <td className={styles.numTd}>{line.sum.toFixed(2)} ₴</td>
                </tr>
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

      {/* ── Панель Опрацювання ── */}
      {showProc && (
        <div className={styles.processingPanel} style={{ maxWidth: 640, margin: '1rem auto 0' }}>
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
            <button className={styles.btnConfirm} onClick={handleConfirmProc} disabled={confirming}>
              {confirming ? 'Збереження...' : '✓ Підтвердити'}
            </button>
          </div>
          {/* Кнопки дій у режимі опрацювання */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
            <button
              className={styles.btnAccept}
              onClick={handleAccept}
              disabled={accepting}
            >
              {accepting ? '...' : '✓ Прийнято (без корекцій)'}
            </button>
          </div>
        </div>
      )}

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

const SYSTEM_KINDS = ['writeoff', 'ration', 'underbaked']

export default function RoutesPage() {
  const { workDate } = useWorkDate()

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
  const [checkedDraftIds,  setCheckedDraftIds]  = useState<Set<number>>(new Set())
  const [sendingDrafts,    setSendingDrafts]    = useState(false)

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

  // Автовибір галочок
  useEffect(() => {
    const ids = new Set(
      invoices
        .filter((i) => i.corrective_for_id === null && i.status !== 'cancelled')
        .map((i) => i.id)
    )
    setCheckedIds(ids)
  }, [invoices])

  // ── Допоміжні ─────────────────────────────────────────────────────────────────

  const baseInvoices = invoices.filter((i) => i.corrective_for_id === null)

  const clientInvoice = (clientId: number) =>
    baseInvoices.find((i) => i.client_id === clientId && i.status !== 'cancelled')

  const correctiveFor = (invoiceId: number) =>
    invoices.find((i) => i.corrective_for_id === invoiceId) ?? null

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
    return (ordersForClient[clientId]?.length ?? 0) > 0 ? 'virtual_draft' : 'no_activity'
  }

  // Клієнти з відправленою (не чернетковою) накладною — недоступні для переміщення
  const lockedClientIds = useMemo(() => {
    const ids = new Set<number>()
    for (const inv of invoices) {
      if (inv.corrective_for_id !== null) continue
      if (inv.status !== 'draft' && inv.status !== 'cancelled') ids.add(inv.client_id)
    }
    return ids
  }, [invoices])

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
        no_activity: 0, virtual_draft: 0, sent: 0, processing: 0, accepted: 0,
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

    // "Всі" включає всіх не-системних активних клієнтів (маршрутні + внутрішні)
    const allNonSystemClients = clients.filter(
      (c) => c.is_active && !SYSTEM_KINDS.includes(c.client_kind)
    )
    const internalClients = clients.filter(
      (c) => c.is_active && c.route_id === null && !SYSTEM_KINDS.includes(c.client_kind)
    )
    const customerClients = clients.filter(
      (c) => c.is_active && c.client_kind === 'customer'
    )

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
      return clients.filter((c) => c.is_active && !SYSTEM_KINDS.includes(c.client_kind))
    }
    if (activeRouteId === -1) {
      return clients.filter(
        (c) => c.is_active && c.route_id === null && !SYSTEM_KINDS.includes(c.client_kind)
      )
    }
    return clients.filter((c) => c.route_id === activeRouteId && c.is_active)
  }, [clients, activeRouteId])

  // Сортування: virtual_draft першими, потім invoice-клієнти, потім no_activity
  const sortedClients = useMemo(() => [...listClients].sort((a, b) => {
    const order = { virtual_draft: 0, sent: 1, processing: 1, accepted: 1, draft: 1, cancelled: 2, no_activity: 3 }
    const sa = order[clientState(a.id)] ?? 2
    const sb = order[clientState(b.id)] ?? 2
    return sa - sb
  }), [listClients, invoices, orders])

  // ── Checkbox-логіка ───────────────────────────────────────────────────────────

  const allCheckable = sortedClients
    .map((c) => clientInvoice(c.id))
    .filter((i): i is Invoice => !!i && i.status !== 'cancelled')

  const allDraftCheckable = sortedClients.filter((c) => clientState(c.id) === 'virtual_draft')

  // Авто-вибір чернеток при завантаженні та зміні фільтру
  useEffect(() => {
    setCheckedDraftIds(new Set(allDraftCheckable.map((c) => c.id)))
  }, [sortedClients, ordersForClient])

  const hasAny      = allCheckable.length > 0 || allDraftCheckable.length > 0
  const allChecked  = hasAny
    && allCheckable.every((i) => checkedIds.has(i.id))
    && allDraftCheckable.every((c) => checkedDraftIds.has(c.id))
  const someChecked = allCheckable.some((i) => checkedIds.has(i.id))
    || allDraftCheckable.some((c) => checkedDraftIds.has(c.id))
  const checkedCount = [...checkedIds].filter((id) => invoices.some((i) => i.id === id)).length

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
      setCheckedDraftIds((prev) => {
        const next = new Set(prev)
        allDraftCheckable.forEach((c) => next.delete(c.id))
        return next
      })
    } else {
      setCheckedIds((prev) => {
        const next = new Set(prev)
        allCheckable.forEach((i) => next.add(i.id))
        return next
      })
      setCheckedDraftIds((prev) => {
        const next = new Set(prev)
        allDraftCheckable.forEach((c) => next.add(c.id))
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

  // ── Масова відправка чернеток ─────────────────────────────────────────────────

  const toggleOneDraft = (clientId: number) => {
    setCheckedDraftIds((prev) => {
      const next = new Set(prev)
      if (next.has(clientId)) next.delete(clientId)
      else next.add(clientId)
      return next
    })
  }

  const sendCheckedDrafts = async () => {
    if (checkedDraftIds.size === 0) return
    setSendingDrafts(true)
    await Promise.all(
      [...checkedDraftIds].map((clientId) =>
        api.post(`/invoices/generate-from-orders?invoice_date=${workDate}&client_id=${clientId}`, {})
      )
    )
    setSendingDrafts(false)
    setCheckedDraftIds(new Set())
    await load(workDate)
  }

  // ── Друк вибраних ──────────────────────────────────────────────────────────────

  const printChecked = async () => {
    if (checkedIds.size === 0) return
    const ids = [...checkedIds].join(',')
    window.open(`/api/v1/print/invoices?invoice_date=${workDate}&ids=${ids}`, '_blank')
    // draft → sent для вибраних
    await Promise.all(
      [...checkedIds].map(async (id) => {
        const inv = invoices.find((i) => i.id === id)
        if (inv?.status === 'draft') {
          await api.put(`/invoices/${id}/status?status=sent`, {})
        }
      })
    )
    await load(workDate)
  }

  // ── Оновлення одного invoice ──────────────────────────────────────────────────

  const handleStatusChange = (updated: Invoice) => {
    setInvoices((prev) => prev.map((i) => (i.id === updated.id ? updated : i)))
  }

  const handleClientSent = (inv: Invoice) => {
    setInvoices((prev) => [...prev, inv])
    setSelectedClient((c) => c) // зберегти вибір → панель перемкнеться на InvoiceDetailPanel
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
                  {card.clientCount > 0 && (['no_activity','virtual_draft','sent','processing','accepted'] as const).map((st) => {
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
              {checkedDraftIds.size > 0 && (
                <button className={styles.sendDraftsBtn} onClick={sendCheckedDrafts} disabled={sendingDrafts}>
                  {sendingDrafts ? '...' : `▶ Відправити (${checkedDraftIds.size})`}
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
                      {client.short_name ?? client.full_name}
                    </span>
                    <span style={{ fontSize: '0.72rem', color: '#bbb', marginLeft: 'auto' }}>
                      немає замовлень
                    </span>
                  </div>
                )
              }

              if (state === 'virtual_draft') {
                return (
                  <div
                    key={client.id}
                    className={`${styles.invoiceRowVirtualDraft} ${isActive ? styles.invoiceRowVirtualDraftActive : ''}`}
                    onClick={() => setSelectedClient(client)}
                  >
                    <input
                      type="checkbox"
                      className={styles.rowCheck}
                      checked={checkedDraftIds.has(client.id)}
                      onChange={(e) => { e.stopPropagation(); toggleOneDraft(client.id) }}
                    />
                    <span className={styles.rowClientName}>
                      {client.short_name ?? client.full_name}
                    </span>
                    <span className={styles.rowInvNum} />
                    <span className={styles.rowStatusCol}>
                      <span className={`${styles.statusBadge} ${styles.status_virtual_draft}`}>
                        Чернетка
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
                  {inv ? (
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
                    {client.short_name ?? client.full_name}
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
                </div>
              )
            })}

            {sortedClients.length === 0 && (
              <div style={{ padding: '1rem', color: '#aaa', fontSize: '0.88rem' }}>
                {activeRouteId !== null ? 'Немає клієнтів' : 'Немає даних за цей день'}
              </div>
            )}
          </div>
        </div>

        {/* ── Розділювач ───────────────────────────────────────────────────────── */}
        <div className={styles.resizeDivider} onMouseDown={startDrag} />

        {/* ── Права панель ─────────────────────────────────────────────────────── */}
        <div className={styles.invoiceDetail}>
          {selectedClient && selectedState === 'virtual_draft' ? (
            <VirtualDraftPanel
              key={selectedClient.id}
              client={selectedClient}
              clientOrders={ordersForClient[selectedClient.id] ?? []}
              allOrders={orders}
              products={products}
              allClients={clients.filter((c) => c.is_active)}
              routes={routes}
              lockedClientIds={lockedClientIds}
              workDate={workDate}
              onSent={handleClientSent}
              onOrdersChanged={() => load(workDate)}
            />
          ) : selectedClient && selectedInvoice ? (
            <InvoiceDetailPanel
              key={selectedInvoice.id}
              invoice={selectedInvoice}
              corrective={correctiveFor(selectedInvoice.id)}
              client={selectedClient}
              products={products}
              categories={categories}
              routes={routes}
              bakeryName={bakeryName}
              director={director}
              accountant={accountant}
              onStatusChange={handleStatusChange}
              onRefresh={() => load(workDate)}
            />
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
