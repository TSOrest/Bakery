import { useEffect, useMemo, useRef, useState, memo } from 'react'
import { useWorkDate } from '../context/DateContext'
import { api } from '../api/client'
import HelpTip from '../components/HelpTip'
import { useConfirm } from '../components/ConfirmDialog'
import { useToast } from '../components/Toast'
import type {
  BakingTask, Category, Client, Invoice, Order, Product,
} from '../types'
import styles from './BakingPage.module.css'

const KIND_ICON: Record<string, string> = {
  shop:     '🏪',
  ration:   '🍞',
  writeoff: '🗑',
  customer: '',
}

// Рядок деталізації недопеченого по клієнту/магазину
interface ClientRow {
  client_id:   number
  name:        string
  is_shop:     boolean
  order_qty:   number       // Заказ
  invoice_qty: number       // В накладних (фактична к-сть у рядку)
  invoice_adj: number       // В накладних без перерозподілів (для «Замовлено»/«Корекцій»)
  invoice_id:  number | null
  line_id:     number | null
}

// Переміщення товару за дату (GET /invoices/transfers-by-date)
interface TransferByDate {
  product_id:       number
  qty:              number
  source_client_id: number | null
  source_kind:      string | null
  target_client_id: number | null
  target_kind:      string | null
}

// Розподілений надлишок — з двох джерел: рядок накладної магазину (line_kind='surplus')
// або Order origin_id=0 (пайок/списання).
interface SurplusLine {
  key:        string                // унікальний (inv-<lineId> / ord-<orderId>)
  client_id:  number
  product_id: number
  qty:        number
  notes:      string | null
  kind:       'invoice' | 'order'
  order_id?:  number                // kind='order'
  invoice_id?: number               // kind='invoice'
  line_id?:   number                // kind='invoice'
}

// ─── Єдина панель розбіжності (надлишок / недопечене) ─────────────────────────

interface DiscrepancyPanelProps {
  task:         BakingTask     // ordered_qty = «Замовлено» (із замовлень)
  productName:  string
  clients:      Client[]
  surplusLines: SurplusLine[]  // розподіл надлишку (накладна магазину + пайок/списання)
  clientRows:   ClientRow[]    // деталізація Заказ / В накладних по клієнтах і магазинах
  shopRemovedDone: number      // фактично знято на «Недопечено» (з переміщень)
  underbakedClientId: number | null
  workDate:     string
  routeReserve: boolean
  onReload:     () => void | Promise<void>   // перечитати дані після зміни
}

const DiscrepancyPanel = memo(function DiscrepancyPanel({
  task, productName, clients, surplusLines, clientRows, shopRemovedDone, underbakedClientId,
  workDate, routeReserve, onReload,
}: DiscrepancyPanelProps) {
  const toast = useToast()
  const [editQty,     setEditQty]     = useState<Record<string, string>>({})
  const [addClientId, setAddClientId] = useState<number | ''>('')
  const [addQty,      setAddQty]      = useState('')
  const [addNotes,    setAddNotes]    = useState('')
  const [addSaving,   setAddSaving]   = useState(false)
  const [reduceQty,   setReduceQty]   = useState<Record<number, string>>({})  // line_id → к-сть зняття
  const [reducing,    setReducing]    = useState(false)

  // ── Обчислення стану: Відхилення = Спечено − Замовлено ──────────────────────
  // Корекції накладних (зменшення клієнта, перенесення, списання, пайок) перерозподіляють
  // уже спечене і НЕ впливають на потребу. Тому база — «Замовлено», а не «В накладних».
  const baked  = task.baked_qty ?? 0
  // «Замовлено» (потреба) = Σ max(замовлено, в_накладних_без_перерозподілу)
  const demand = clientRows.reduce((s, r) => s + Math.max(r.order_qty, r.invoice_adj), 0)
  // shopRemovedDone — фактично знято на «Недопечено» (приходить з parent: сума переміщень)
  const rawDiff       = baked - demand              // + перепечено, − недопечено
  const surplus       = Math.max(0,  rawDiff)
  const shortageTotal = Math.max(0, -rawDiff)
  const shortage      = Math.max(0, shortageTotal - shopRemovedDone)  // ще зняти з магазину

  const surplusAlloc     = surplusLines.reduce((s, l) => s + l.qty, 0)
  const surplusRemaining = surplus - surplusAlloc
  const overAllocation   = surplusAlloc > surplus
  const hasConflict      = rawDiff <= 0 && surplusAlloc > 0
  const effectiveDiff    = rawDiff + shopRemovedDone - surplusAlloc

  const showSurplusSection  = surplusAlloc > 0 || surplus > 0
  // Деталізацію по клієнтах показуємо при недопеченому або якщо вже знято з магазину
  // (не зникає після вирівнювання). Перепечене вирішується через розподіл надлишку вище.
  const showShortageSection = !hasConflict && (shortageTotal > 0 || shopRemovedDone > 0)
  const surplusRowsEditable  = overAllocation || hasConflict

  // ── Стиль панелі ──────────────────────────────────────────────────────────
  const isPerfect  = effectiveDiff === 0 && !hasConflict
  const panelClass = isPerfect
    ? styles.surplusPanel
    : hasConflict || effectiveDiff < 0
    ? styles.shortagePanel
    : styles.surplusPanelPartial
  const headerClass = isPerfect
    ? styles.surplusPanelHeader
    : hasConflict || effectiveDiff < 0
    ? styles.shortagePanelHeader
    : styles.surplusPanelHeaderPartial

  // ── Отримувачі надлишку: магазин / пайок / списання ───────────────────────
  const shopClients     = clients.filter(c => c.is_active && (c.client_kind === 'shop' || c.is_own_shop === 1))
  const rationClients   = clients.filter(c => c.is_active && c.client_kind === 'ration')
  const writeoffClients = clients.filter(c => c.is_active && c.client_kind === 'writeoff')
  const firstId = (shopClients[0] ?? rationClients[0] ?? writeoffClients[0])?.id
  const effectiveAddClientId = addClientId !== '' ? addClientId : (firstId ?? '')

  const clientName = (id: number) => {
    const c = clients.find(x => x.id === id)
    return c ? (c.short_name ?? c.full_name) : `#${id}`
  }
  const renderClientOption = (c: Client) => (
    <option key={c.id} value={c.id}>
      {KIND_ICON[c.client_kind] ? `${KIND_ICON[c.client_kind]} ` : ''}{c.short_name ?? c.full_name}
    </option>
  )

  // ── Розподіл надлишку: магазин → рядок накладної (set-surplus); пайок/списання → Order ──
  const isShopTarget = (clientId: number) => {
    const c = clients.find(x => x.id === clientId)
    return !!c && (c.client_kind === 'shop' || c.is_own_shop === 1)
  }

  const handleAddSurplus = async () => {
    const qtyNum = Number(addQty)
    const targetId = Number(effectiveAddClientId)   // 'route'/'' → NaN, відсіюється нижче
    if (!qtyNum || qtyNum <= 0 || !targetId || Number.isNaN(targetId)) return
    if (qtyNum > surplusRemaining) return
    setAddSaving(true)
    try {
      if (isShopTarget(targetId)) {
        // абсолютна к-сть = наявний надлишок магазину для виробу + додане
        const existing = surplusLines
          .filter(l => l.kind === 'invoice' && l.client_id === targetId)
          .reduce((s, l) => s + l.qty, 0)
        await api.post('/invoices/set-surplus', {
          shop_client_id: targetId, product_id: task.product_id,
          qty: existing + qtyNum, date: workDate, notes: addNotes.trim() || null,
        })
      } else {
        await api.post('/orders/', {
          client_id: targetId, product_id: task.product_id, qty: qtyNum,
          order_date: workDate, origin_id: 0, notes: addNotes.trim() || null,
        })
      }
      setAddQty('')
      setAddNotes('')
      await onReload()
    } finally {
      setAddSaving(false)
    }
  }

  const handleDeleteSurplus = async (line: SurplusLine) => {
    if (line.kind === 'invoice') {
      await api.post('/invoices/set-surplus', {
        shop_client_id: line.client_id, product_id: line.product_id,
        qty: 0, date: workDate,
      })
    } else {
      await api.delete(`/orders/${line.order_id}`)
    }
    await onReload()
  }

  const handleSaveSurplusEdit = async (line: SurplusLine) => {
    const raw = editQty[line.key]
    if (raw === undefined) return
    const newQty = Number(raw)
    setEditQty(prev => { const n = { ...prev }; delete n[line.key]; return n })
    if (newQty < 0 || newQty === line.qty) return
    if (line.kind === 'invoice') {
      await api.post('/invoices/set-surplus', {
        shop_client_id: line.client_id, product_id: line.product_id,
        qty: newQty, date: workDate,
      })
    } else {
      if (newQty <= 0) { await api.delete(`/orders/${line.order_id}`) }
      else { await api.put(`/orders/${line.order_id}`, { qty: newQty }) }
    }
    await onReload()
  }

  // ── Зняти недопечене з магазину = переміщення на «Недопечено» ──────────────
  const shopRows = clientRows.filter(r => r.is_shop && r.invoice_qty > 0 && r.invoice_id != null && r.line_id != null)
  const totalShopInv = shopRows.reduce((s, r) => s + r.invoice_qty, 0)
  const remainingAfterShop = Math.max(0, shortage - totalShopInv)

  const handleReduceShop = async (row: ClientRow) => {
    if (!underbakedClientId) { toast.error('Системний клієнт «Недопечено» не знайдений'); return }
    if (row.invoice_id == null || row.line_id == null) return
    const raw = reduceQty[row.line_id]
    const want = raw !== undefined ? Number(raw) : Math.min(shortage, row.invoice_qty)
    const qty = Math.min(Math.max(0, want), row.invoice_qty)
    if (qty <= 0) return
    setReducing(true)
    try {
      await api.post(`/invoices/${row.invoice_id}/transfer`, {
        product_id: task.product_id, qty, to_client_id: underbakedClientId,
      })
      setReduceQty(prev => { const n = { ...prev }; delete n[row.line_id!]; return n })
      await onReload()
    } finally {
      setReducing(false)
    }
  }

  const sumOrder   = clientRows.reduce((s, r) => s + Math.max(r.order_qty, r.invoice_adj), 0)
  const sumInvoice = clientRows.reduce((s, r) => s + r.invoice_qty, 0)

  return (
    <div className={panelClass}>

      {/* ── Заголовок ──────────────────────────────────────────────────── */}
      <div className={headerClass}>
        <span className={styles.surplusPanelName}>{productName}</span>
        <span className={styles.headerDiff}>
          {rawDiff > 0 ? `+${rawDiff}` : rawDiff < 0 ? `${rawDiff}` : '='}
        </span>
        <span className={styles.headerSep}>·</span>
        {hasConflict ? (
          <span className={styles.headerWarn}>⚠ Конфлікт</span>
        ) : showSurplusSection ? (
          overAllocation
            ? <span className={styles.headerWarn}>⚠ Перерозподіл: +{surplusAlloc - surplus}</span>
            : surplusRemaining === 0 && surplusAlloc > 0
            ? <span className={styles.headerOk}>{surplusAlloc}/{surplus || surplusAlloc} ✓ Повністю розподілено</span>
            : surplusRemaining > 0
            ? <span className={styles.headerMuted}>Розподілено: {surplusAlloc}/{surplus}</span>
            : null
        ) : shortage > 0 ? (
          <span className={styles.headerMuted}>Недопечено: {shortage}</span>
        ) : (
          <span className={styles.headerOk}>✓ Вирівняно</span>
        )}
      </div>

      {/* ── Попередження про конфлікт ───────────────────────────────────── */}
      {hasConflict && (
        <div className={styles.overWarning}>
          ⚠ Конфлікт: є <strong>{surplusAlloc}</strong> шт розподілених надлишків при поточній нестачі.
          Спочатку видаліть або скоротіть рядки розподілу нижче.
        </div>
      )}

      {/* ── Секція розподілу надлишків ──────────────────────────────────── */}
      {showSurplusSection && (
        <>
          {surplusLines.length > 0 && (
            <>
              {overAllocation && !hasConflict && (
                <div className={styles.overWarning}>
                  ⚠ Розподілено на <strong>{surplusAlloc - surplus}</strong> більше ніж надлишок.
                  Відредагуйте або видаліть зайві рядки.
                </div>
              )}
              <table className={styles.linesTable}>
                <thead>
                  <tr>
                    <th>Кому</th>
                    <th>Кількість</th>
                    <th>Нотатка</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {surplusLines.map(line => (
                    <tr key={line.key}>
                      <td>{clientName(line.client_id)}</td>
                      <td className={styles.lineQty}>
                        {surplusRowsEditable ? (
                          <input
                            type="number" min={1} step={1}
                            value={editQty[line.key] ?? String(line.qty)}
                            className={styles.addQtyInput}
                            onChange={e => setEditQty(prev => ({ ...prev, [line.key]: e.target.value }))}
                            onBlur={() => handleSaveSurplusEdit(line)}
                          />
                        ) : line.qty}
                      </td>
                      <td className={styles.lineNotes}>{line.notes ?? ''}</td>
                      <td>
                        <button
                          className={styles.btnDelete}
                          onClick={() => handleDeleteSurplus(line)}
                          title="Видалити рядок"
                        >🗑</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {/* Форма додавання — є нерозподілений надлишок і немає конфлікту */}
          {surplusRemaining > 0 && !hasConflict && (
            <div className={styles.addLineForm}>
              <select
                value={effectiveAddClientId}
                onChange={e => setAddClientId(Number(e.target.value))}
                className={styles.recipientSelect}
              >
                {shopClients.map(renderClientOption)}
                {rationClients.map(renderClientOption)}
                {writeoffClients.map(renderClientOption)}
                {routeReserve && <option value="route">🚚 Маршрут (резерв)</option>}
              </select>
              <input
                type="number" min={1} max={surplusRemaining} step={1}
                value={addQty}
                onChange={e => setAddQty(e.target.value)}
                placeholder="к-сть"
                className={styles.addQtyInput}
              />
              <input
                type="text"
                value={addNotes}
                onChange={e => setAddNotes(e.target.value)}
                placeholder="нотатка..."
                className={styles.addNotesInput}
              />
              <button
                className={styles.btnAdd}
                onClick={handleAddSurplus}
                disabled={addSaving || !addQty || !effectiveAddClientId}
              >
                + Додати
              </button>
            </div>
          )}
        </>
      )}

      {/* ── Недопечене: деталізація по клієнтах, зняття з магазину ───────── */}
      {showShortageSection && (
        <>
          <div className={styles.sectionDivider}>
            {shortage > 0 ? `Недопечено ${shortage} — зняти з магазину` : 'Деталізація по клієнтах'}
          </div>
          <table className={styles.linesTable}>
            <thead>
              <tr>
                <th>Клієнт</th>
                <th>Заказ</th>
                <th>В накладних</th>
                <th>Відхилення</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {clientRows.map(r => {
                // «Заказ» = max(замовлено, в_накладних_без_перерозподілу): обмінні/додаткові
                // вироби рахуються як замовлені, а перенесене між клієнтами/магазином — ні.
                // Відхилення рядка = Заказ − фактично в накладній (показує куди пішов перерозподіл).
                const rowDemand = Math.max(r.order_qty, r.invoice_adj)
                const dev = rowDemand - r.invoice_qty
                const editable = r.is_shop && r.invoice_qty > 0 && r.invoice_id != null && r.line_id != null && shortage > 0
                return (
                  <tr key={r.client_id}>
                    <td>{r.is_shop ? '🏪 ' : ''}{r.name}</td>
                    <td className={styles.lineQty}>{rowDemand}</td>
                    <td className={styles.lineQty}>{r.invoice_qty}</td>
                    <td className={styles.lineQty}>{dev !== 0 ? dev : '—'}</td>
                    <td>
                      {editable && (
                        <div className={styles.inlineEditCell}>
                          <input
                            type="number" min={1} max={r.invoice_qty} step={1}
                            value={reduceQty[r.line_id!] ?? String(Math.min(shortage, r.invoice_qty))}
                            className={styles.addQtyInput}
                            onChange={e => setReduceQty(prev => ({ ...prev, [r.line_id!]: e.target.value }))}
                          />
                          <button className={styles.btnApply} onClick={() => handleReduceShop(r)} disabled={reducing}>
                            Зняти
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className={styles.footerRow}>
                <td><strong>Сума</strong></td>
                <td className={styles.lineQty}><strong>{sumOrder}</strong></td>
                <td className={styles.lineQty}><strong>{sumInvoice}</strong></td>
                <td className={styles.lineQty}><strong>{sumOrder - sumInvoice !== 0 ? sumOrder - sumInvoice : '—'}</strong></td>
                <td />
              </tr>
            </tfoot>
          </table>
          {remainingAfterShop > 0 && (
            <div className={styles.overWarning}>
              ⚠ Бракує ще <strong>{remainingAfterShop}</strong> після зняття з магазину. Імовірно по
              накладній відправлено більше ніж спечено — перевірте і зменшіть накладні клієнтів у
              Маршрутах:
              <div style={{ marginTop: '0.3rem' }}>
                {clientRows.filter(r => !r.is_shop && r.invoice_qty > 0).map(r => (
                  <span key={r.client_id} style={{ display: 'inline-block', marginRight: '0.7rem' }}>
                    {r.name}: <strong>{r.invoice_qty}</strong>
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
})

// ─── Головна сторінка ─────────────────────────────────────────────────────────

export default function BakingPage() {
  const { workDate } = useWorkDate()
  const confirmDialog = useConfirm()
  const toast = useToast()

  const [tasks,        setTasks]        = useState<BakingTask[]>([])
  const [products,     setProducts]     = useState<Product[]>([])
  const [categories,   setCategories]   = useState<Category[]>([])
  const [clients,      setClients]      = useState<Client[]>([])
  const [surplusOrders,    setSurplusOrders]    = useState<Order[]>([])   // origin_id=0
  const [parentOrders,     setParentOrders]     = useState<Order[]>([])   // origin_id NULL (для «Заказ» по клієнтах)
  const [allInvoices,      setAllInvoices]      = useState<Invoice[]>([]) // клієнти+магазини (для «В накладних»)
  const [transfers,        setTransfers]        = useState<TransferByDate[]>([]) // переміщення дати (для нейтралізації перерозподілів)
  const [loading,          setLoading]          = useState(true)
  const [generating,   setGenerating]   = useState(false)
  const [showRec,      setShowRec]      = useState(false)
  const [showEmpty,    setShowEmpty]    = useState(false)   // показати вироби без замовлень
  const [printNotice,  setPrintNotice]  = useState<string | null>(null)
  const [routeReserve, setRouteReserve] = useState(false)
  const [closingShops, setClosingShops] = useState(false)

  // Всі мапи і сети ключовані за product_id (не task.id) — підтримує "віртуальні" рядки
  // null = значення не надано (порожнє поле), number = явно введене (в т.ч. 0)
  const bakedTimers  = useRef<Record<number, ReturnType<typeof setTimeout>>>({})
  const [bakedMap,       setBakedMap]       = useState<Record<number, number | null>>({})
  const [loadedBakedQty, setLoadedBakedQty] = useState<Record<number, number | null>>({})
  const [enteredIds,     setEnteredIds]     = useState<Set<number>>(new Set())

  // ─── Завантаження ─────────────────────────────────────────────────────────

  const load = async (date: string) => {
    setLoading(true)
    const [t, p, cats, c, ord, inv, trf, sett] = await Promise.all([
      api.get<BakingTask[]>(`/baking/tasks?task_date=${date}`),
      api.get<Product[]>('/products/?active_only=false'),
      api.get<Category[]>('/categories?active_only=false'),
      api.get<Client[]>('/clients/?active_only=false'),
      api.get<Order[]>(`/orders/?order_date=${date}`),               // усі замовлення дати
      api.get<Invoice[]>(`/invoices/?invoice_date=${date}`),
      api.get<TransferByDate[]>(`/invoices/transfers-by-date?date=${date}`),
      api.get<Record<string, { value: string }>>('/settings/'),
    ])
    setTransfers(trf)
    setRouteReserve(sett['baking_route_reserve']?.value === '1')
    setTasks(t)
    setProducts(p)
    setCategories(cats)
    setClients(c)
    setSurplusOrders(ord.filter(o => o.origin_id === 0))
    // «Заказ» по клієнтах = origin_id NULL, не pending-бот (узгоджено з aggregate_for_baking)
    setParentOrders(ord.filter(o => o.origin_id == null && !(o.source === 'bot' && o.bot_status === 'pending')))
    // Накладні клієнтів і магазинів — для «В накладних» / деталізації / зняття з магазину
    const custShopIds = new Set(
      c.filter(cl => cl.client_kind === 'customer' || cl.client_kind === 'shop' || cl.is_own_shop === 1).map(cl => cl.id)
    )
    setAllInvoices(inv.filter(i => custShopIds.has(i.client_id) && i.status !== 'cancelled' && i.corrective_for_id === null))
    // null = не введено (baked_qty IS NULL у БД), 0/число = явно введено
    const map: Record<number, number | null> = {}
    t.forEach((tk) => { map[tk.product_id] = tk.baked_qty ?? null })
    setBakedMap(map)
    setLoadedBakedQty(map)
    setLoading(false)
  }

  useEffect(() => { load(workDate) }, [workDate])

  // ─── Перевірка непідтверджених bot-замовлень ──────────────────────────────

  const checkPendingAndConfirm = async (): Promise<boolean> => {
    try {
      const pending = await api.get<{ id: number }[]>(`/bot/pending-orders?order_date=${workDate}`)
      if (pending.length > 0) {
        return await confirmDialog({
          title: 'Непідтверджені замовлення бота',
          message: `Є ${pending.length} непідтверджених замовлень через бота.\nВони будуть проігноровані при формуванні/друку.\n\nПродовжити?`,
          confirmText: 'Продовжити',
        })
      }
    } catch {}
    return true
  }

  // ─── Генерація ────────────────────────────────────────────────────────────

  const handleGenerate = async () => {
    if (!(await checkPendingAndConfirm())) return
    setGenerating(true)
    await api.post(`/baking/tasks/generate?task_date=${workDate}`, {})
    await load(workDate)
    setGenerating(false)
  }

  // ─── Закрити накладну магазину (надлишки → POS) ───────────────────────────
  const handleCloseShops = async () => {
    const ok = await confirmDialog({
      title: 'Закрити накладну магазину',
      message: 'Сформувати накладні власних магазинів з розподілених надлишків і перевести їх у «Прийнято»?\n\nПісля цього товар стане доступним у касі (POS) і у звірці магазину.',
      confirmText: 'Сформувати і прийняти',
    })
    if (!ok) return
    setClosingShops(true)
    try {
      const res = await api.post<{ closed: number }>(`/invoices/close-shops?date=${workDate}`, {})
      toast.success(res.closed > 0 ? `Закрито накладних магазину: ${res.closed}` : 'Немає накладних магазину для закриття')
    } catch {
      toast.error('Не вдалось закрити накладні магазину. Спробуйте ще раз.')
    } finally {
      setClosingShops(false)
      await load(workDate)
    }
  }

  // ─── Зміна "Спечено" з дебаунсом ─────────────────────────────────────────

  const handleBakedBlur = (task: BakingTask) => {
    // null = поле очищено/пусте → прибираємо з enteredIds
    // number (в т.ч. 0) = явно введено → додаємо до enteredIds
    const baked = bakedMap[task.product_id]
    setEnteredIds(prev => {
      const next = new Set(prev)
      if (baked != null) { next.add(task.product_id) }
      else               { next.delete(task.product_id) }
      return next
    })
  }

  const handleBakedKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const all = Array.from(document.querySelectorAll<HTMLInputElement>('[data-baked-input]'))
    const idx = all.indexOf(e.currentTarget)
    if (idx >= 0 && idx < all.length - 1) {
      all[idx + 1].focus()
      all[idx + 1].select()
    }
  }

  const handleBakedChange = (task: BakingTask, rawValue: string) => {
    // Порожній рядок → null (не введено), інакше → число (в т.ч. 0)
    const value: number | null = rawValue === '' ? null : Math.max(0, Number(rawValue))
    setBakedMap((prev) => ({ ...prev, [task.product_id]: value }))
    if (bakedTimers.current[task.product_id]) clearTimeout(bakedTimers.current[task.product_id])
    bakedTimers.current[task.product_id] = setTimeout(async () => {
      const numValue = value ?? 0
      let realId = task.id
      if (task.id === 0) {
        if (numValue === 0) return  // не створюємо задачу для пустого/нульового віртуального рядка
        // Віртуальний рядок: спочатку створюємо задачу
        const created = await api.post<BakingTask>(
          `/baking/tasks/ensure?task_date=${task.task_date}&product_id=${task.product_id}`, {}
        )
        setTasks((prev) => [...prev, created])
        realId = created.id
      }
      const updated = await api.put<BakingTask>(`/baking/tasks/${realId}`, { baked_qty: numValue })
      setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))
    }, 600)
  }

  // ─── Surplus callbacks ────────────────────────────────────────────────────

  // Розподілені надлишки виробу: рядки накладних магазину (line_kind='surplus') + Order origin_id=0
  // (пайок/списання). Спільна форма для панелі.
  const linesFor = (productId: number): SurplusLine[] => {
    const out: SurplusLine[] = []
    for (const inv of allInvoices) {
      for (const ln of inv.lines) {
        if (ln.product_id === productId && ln.line_kind === 'surplus') {
          out.push({
            key: `inv-${ln.id}`, client_id: inv.client_id, product_id: productId,
            qty: ln.qty, notes: null, kind: 'invoice', invoice_id: inv.id, line_id: ln.id,
          })
        }
      }
    }
    for (const o of surplusOrders) {
      if (o.product_id === productId) {
        out.push({
          key: `ord-${o.id}`, client_id: o.client_id, product_id: productId,
          qty: o.qty, notes: o.notes, kind: 'order', order_id: o.id,
        })
      }
    }
    return out
  }

  const reloadAll = () => load(workDate)

  // ─── Деталізація недопеченого: «Заказ» / «В накладних» по клієнтах ──────────
  const underbakedClientId = clients.find(c => c.client_kind === 'underbaked')?.id ?? null

  // product → client → Σ замовлено (origin_id NULL)
  const ordersByPC = useMemo(() => {
    const m: Record<number, Record<number, number>> = {}
    for (const o of parentOrders) {
      const slot = (m[o.product_id] ??= {})
      slot[o.client_id] = (slot[o.client_id] ?? 0) + o.qty
    }
    return m
  }, [parentOrders])

  // product → client → { qty (звичайні рядки, БЕЗ надлишку), invoice_id, line_id (звичайного рядка) }
  // Рядки line_kind='surplus' у попит НЕ входять — це розподілений надлишок (показується окремо).
  const invByPC = useMemo(() => {
    const m: Record<number, Record<number, { qty: number; invoice_id: number | null; line_id: number | null }>> = {}
    for (const inv of allInvoices) {
      for (const ln of inv.lines) {
        if (ln.line_kind === 'surplus') continue   // надлишок — не попит
        const slot = (m[ln.product_id] ??= {})
        const ex = slot[inv.client_id] ?? (slot[inv.client_id] = { qty: 0, invoice_id: inv.id, line_id: ln.id })
        ex.qty += ln.qty
        ex.invoice_id = inv.id
        ex.line_id = ln.id
      }
    }
    return m
  }, [allInvoices])

  // Нейтралізація перерозподілів: переміщення МІЖ обліковими клієнтами (customer/shop) —
  // це перерозподіл уже спеченого (товар «слідує» за початковим замовленням джерела), а не
  // нова потреба на випічку. Будуємо product → client → (Σ переміщено_З − Σ переміщено_В),
  // щоб відновити накладну «до перерозподілу»: invoice_adj = invoice_qty + цей коефіцієнт.
  // Переміщення на системних клієнтів (underbaked/writeoff/ration) НЕ нейтралізуємо — їх
  // обробляє механізм «зняти недопечене».
  const COUNTED_KINDS = new Set(['customer', 'shop'])
  const redistribByPC = useMemo(() => {
    const m: Record<number, Record<number, number>> = {}
    for (const t of transfers) {
      if (!t.source_kind || !t.target_kind) continue
      if (!COUNTED_KINDS.has(t.source_kind) || !COUNTED_KINDS.has(t.target_kind)) continue
      const slot = (m[t.product_id] ??= {})
      if (t.source_client_id != null) slot[t.source_client_id] = (slot[t.source_client_id] ?? 0) + t.qty  // переміщено З → +
      if (t.target_client_id != null) slot[t.target_client_id] = (slot[t.target_client_id] ?? 0) - t.qty  // переміщено В → −
    }
    return m
  }, [transfers])

  // Розподілений надлишок по виробу (для бейджа «↗ розподілено» / гейтингу): рядки
  // line_kind='surplus' накладних магазину + Order origin_id=0 (пайок/списання).
  const surplusAllocByProduct = useMemo(() => {
    const m: Record<number, number> = {}
    for (const o of surplusOrders) m[o.product_id] = (m[o.product_id] ?? 0) + o.qty
    for (const inv of allInvoices)
      for (const ln of inv.lines)
        if (ln.line_kind === 'surplus') m[ln.product_id] = (m[ln.product_id] ?? 0) + ln.qty
    return m
  }, [surplusOrders, allInvoices])
  const surplusAllocFor = (pid: number) => surplusAllocByProduct[pid] ?? 0

  // «Зняте недопечене» по виробу = ФАКТИЧНА сума переміщень на системного клієнта «Недопечено»
  // (target_kind='underbaked'). Рахуємо з переміщень, а НЕ як max(0, замовлено−в_накладних):
  // інакше для товару, що потрапив у магазин переказом (магазин його не замовляв, o=0), зняття
  // не зменшувало б недостачу.
  const removedUnderbakedByProduct = useMemo(() => {
    const m: Record<number, number> = {}
    for (const t of transfers) {
      if (t.target_kind === 'underbaked') m[t.product_id] = (m[t.product_id] ?? 0) + t.qty
    }
    return m
  }, [transfers])

  // Розрахунок по виробу: Замовлено / зняте з магазину / накладні + рядки клієнтів.
  // Правило: «Заказ» клієнта = max(замовлено, в_накладних_без_перерозподілу) — обмінні/додаткові
  // вироби, що є у накладній але не в замовленнях, рахуються як замовлені (їх пекли), а
  // перенесене між клієнтами/магазином не подвоюється. Корекції накладних (зменшення клієнта,
  // перенесення, списання, пайок) перерозподіляють уже спечене і НЕ впливають на «Замовлено»
  // чи «Відхилення» (Відхилення = Спечено − Замовлено, вирівнюється через магазин).
  // shopRemoved = фактично знято на «Недопечено» (з переміщень).
  interface ProductCalc {
    demand: number       // Замовлено = Σ max(o, i_adj)
    shopRemoved: number  // зняте з магазину (≥0)
    invoiceAgg: number   // Σ в_накладних факт (для деталізації)
    rows: ClientRow[]
  }
  const calcByProduct = useMemo(() => {
    const pids = new Set<number>([
      ...Object.keys(ordersByPC).map(Number),
      ...Object.keys(invByPC).map(Number),
    ])
    const m = new Map<number, ProductCalc>()
    for (const pid of pids) {
      const oc = ordersByPC[pid] ?? {}
      const ic = invByPC[pid] ?? {}
      const rc = redistribByPC[pid] ?? {}
      const ids = new Set<number>([...Object.keys(oc).map(Number), ...Object.keys(ic).map(Number)])
      let demand = 0, invoiceAgg = 0
      const rows: ClientRow[] = []
      for (const id of ids) {
        const c = clients.find(x => x.id === id)
        if (!c) continue
        const is_shop = c.client_kind === 'shop' || c.is_own_shop === 1
        const inv = ic[id]
        const o = oc[id] ?? 0
        const i = inv?.qty ?? 0   // звичайні рядки накладної (надлишок виключено в invByPC)
        // Накладна без перерозподілів (перенесене між обліковими клієнтами не множить попит)
        const iAdj = Math.max(0, i + (rc[id] ?? 0))
        demand     += Math.max(o, iAdj)
        invoiceAgg += i
        rows.push({
          client_id: id, name: c.short_name ?? c.full_name, is_shop,
          order_qty: o, invoice_qty: i, invoice_adj: iAdj,
          invoice_id: inv?.invoice_id ?? null, line_id: inv?.line_id ?? null,
        })
      }
      rows.sort((a, b) => (a.is_shop ? 1 : 0) - (b.is_shop ? 1 : 0) || a.name.localeCompare(b.name, 'uk'))
      // Зняте недопечене = фактичні переміщення на «Недопечено» (працює і для переказаного в магазин товару)
      m.set(pid, { demand, shopRemoved: removedUnderbakedByProduct[pid] ?? 0, invoiceAgg, rows })
    }
    return m
  }, [ordersByPC, invByPC, redistribByPC, removedUnderbakedByProduct, clients])

  const EMPTY_CALC: ProductCalc = { demand: 0, shopRemoved: 0, invoiceAgg: 0, rows: [] }
  const calcFor = (pid: number): ProductCalc => calcByProduct.get(pid) ?? EMPTY_CALC
  const demandFor = (pid: number): number => calcFor(pid).demand

  // ─── Допоміжні ────────────────────────────────────────────────────────────

  const productName = (id: number) => {
    const p = products.find((p) => p.id === id)
    return p?.short_name ?? p?.name ?? `#${id}`
  }

  if (loading) return <p style={{ padding: '1rem' }}>Завантаження...</p>

  // ── Фільтр: завдання з реальною розбіжністю ─────────────────────────────
  // baked > ordered → надлишок (розподіл на магазин/пайок/списання)
  // baked < ordered → недопечене (коригується в Маршрутах або знімається з магазину)
  // surplusOrders    → є записи розподілу надлишку (потрібен перегляд)

  // Продукти без замовлень де оператор вже ввів "Спечено", але БД-задача ще не збережена
  // (дебаунс 600мс — до завершення вони не потрапляють у tasks).
  const pendingVirtual: BakingTask[] = Object.entries(bakedMap)
    .filter(([pidStr, baked]) => {
      const pid = Number(pidStr)
      if (baked == null || baked <= 0) return false
      if (!enteredIds.has(pid)) return false
      return !tasks.some(t => t.product_id === pid)
    })
    .map(([pidStr]) => ({
      id: 0, task_date: workDate, product_id: Number(pidStr),
      ordered_qty: 0, recommended_qty: 0, baked_qty: 0,
    } as BakingTask))

  const withDiscrepancy = [...tasks, ...pendingVirtual].filter(t => {
    // Показуємо тільки після того як оператор ввів "Спечено" (нульове поле — не рахується)
    const bakedEntered = loadedBakedQty[t.product_id] != null || enteredIds.has(t.product_id)
    if (!bakedEntered) return false

    const baked = bakedMap[t.product_id] ?? 0
    const calc  = calcFor(t.product_id)
    if (baked !== calc.demand) return true           // перепечено / недопечено (vs Замовлено)
    if (surplusAllocFor(t.product_id) > 0) return true
    if (calc.shopRemoved > 0) return true            // зняте з магазину (вирівняне недопечене)
    return false
  }).sort((a, b) => {
    // Пріоритет: конфлікт > недопечене > надлишок
    const score = (t: BakingTask) => {
      const baked = bakedMap[t.product_id] ?? t.baked_qty ?? 0
      const need  = demandFor(t.product_id)
      const alloc = surplusAllocFor(t.product_id)
      if (baked <= need && alloc > 0) return 0  // конфлікт
      if (baked < need) return 1                // недопечене
      return 2                                   // надлишок
    }
    return score(a) - score(b)
  })

  const bakedCategories = [...categories]
    .filter((c) => c.is_baked)
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'uk'))

  const taskByProductId = new Map(tasks.map(t => [t.product_id, t]))

  const makeVirtualTask = (productId: number): BakingTask => ({
    id: 0, task_date: workDate, product_id: productId,
    ordered_qty: 0, recommended_qty: 0, baked_qty: 0,
  })

  // Рядок видимий якщо: showEmpty, або є замовлення, або введено Спечено
  const isRowVisible = (t: BakingTask) =>
    showEmpty ||
    t.ordered_qty > 0 ||
    (bakedMap[t.product_id] ?? 0) > 0 ||
    enteredIds.has(t.product_id)

  const groups = bakedCategories
    .map((cat) => {
      const catProducts = products
        .filter(p => p.category_id === cat.id && p.is_active)
        .sort((a, b) => (a.short_name ?? a.name).localeCompare(b.short_name ?? b.name, 'uk'))
      const fullList    = catProducts.map(p => taskByProductId.get(p.id) ?? makeVirtualTask(p.id))
      const visibleList = fullList.filter(isRowVisible)
      return { label: cat.name, fullList, visibleList }
    })
    .filter(g => g.visibleList.length > 0)

  const hasBakedProducts = bakedCategories.some(cat =>
    products.some(p => p.category_id === cat.id && p.is_active)
  )

  // ── Чи можна «Закрити накладну магазину» ──────────────────────────────────
  // Дозволено коли по всіх завданнях введено «Спечено» і немає нерозподілених
  // надлишків / конфліктів (недопечене сюди не входить — воно вирішується в Маршрутах).
  const allBakedEntered = tasks.length > 0 && tasks.every(t => t.baked_qty != null)
  const unresolvedSurplus = withDiscrepancy.filter(t => {
    const baked     = bakedMap[t.product_id] ?? 0
    const rawDiff   = baked - demandFor(t.product_id)
    const surplus   = Math.max(0, rawDiff)
    const allocated = surplusAllocFor(t.product_id)
    const conflict  = rawDiff <= 0 && allocated > 0
    return conflict || (surplus > 0 && allocated < surplus)
  }).length
  const canCloseShops = allBakedEntered && unresolvedSurplus === 0
  const closeShopsHint = !allBakedEntered
    ? 'Спочатку введіть «Спечено» по всіх виробах'
    : unresolvedSurplus > 0
    ? 'Спочатку розподіліть усі надлишки'
    : 'Сформувати накладні магазину і перевести у «Прийнято»'

  return (
    <div className={styles.page}>

      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      <div className={styles.toolbar}>
        <h2 className={styles.title}>Випічка — {workDate}</h2>
        <button
          className={styles.btnGenerate}
          onClick={handleGenerate}
          disabled={generating}
        >
          {generating ? 'Формую...' : '⟳ Сформувати із замовлень'}
        </button>
        {hasBakedProducts && (
          <button
            className={styles.btnToggleRec}
            onClick={() => setShowEmpty(v => !v)}
            title="Показати або приховати вироби без замовлень"
          >
            {showEmpty ? '▲ Сховати пусті' : '▼ Показати всі вироби'}
          </button>
        )}
        {tasks.length > 0 && (
          <>
            <button
              className={styles.btnToggleRec}
              onClick={() => setShowRec((v) => !v)}
              title="Показати / приховати рекомендовану кількість"
            >
              {showRec ? '▲ Сховати рекомендовано' : '▼ Показати рекомендовано'}
            </button>
            <button
              className={styles.btnPrint}
              onClick={async () => {
                const unresolved = withDiscrepancy.filter(t => {
                  const baked      = bakedMap[t.product_id] ?? 0
                  const rawDiff    = baked - demandFor(t.product_id)
                  const surplus    = Math.max(0,  rawDiff)
                  const allocated  = surplusAllocFor(t.product_id)
                  const hasConflict = rawDiff <= 0 && allocated > 0
                  // Недопечене тут не блокує друк — коригується в Маршрутах/магазині
                  return hasConflict || (surplus > 0 && allocated < surplus)
                })
                if (unresolved.length > 0) {
                  const ok = await confirmDialog({
                    title: 'Невирівняні розбіжності',
                    message: `Є ${unresolved.length} виробів з невирівняними розбіжностями:\n\n` +
                      unresolved.map(t => {
                        const p      = products.find(p => p.id === t.product_id)
                        const baked  = bakedMap[t.product_id] ?? 0
                        const diff   = baked - t.ordered_qty
                        return `• ${p?.name ?? `#${t.product_id}`}: ${diff > 0 ? '+' : ''}${diff}`
                      }).join('\n') + '\n\nВсе одно роздрукувати звіт?',
                    confirmText: 'Друкувати',
                  })
                  if (!ok) return
                }
                const url = `/api/v1/print/baking-report?task_date=${workDate}`
                const res = await fetch(url, { headers: { Authorization: `Bearer ${localStorage.getItem('bakery_token')}` } })
                if (!res.ok) {
                  const data = await res.json().catch(() => ({}))
                  setPrintNotice(data.detail ?? 'Немає даних для друку')
                  setTimeout(() => setPrintNotice(null), 4000)
                } else {
                  window.open(url, '_blank')
                }
              }}
            >
              🖨 Звіт випічки
            </button>
            <button
              className={styles.btnGenerate}
              style={{ marginLeft: 'auto' }}
              onClick={handleCloseShops}
              disabled={!canCloseShops || closingShops}
              title={closeShopsHint}
            >
              {closingShops ? 'Закриваю...' : '🏪 Закрити накладну магазину'}
            </button>
          </>
        )}
      </div>

      {printNotice && (
        <div className={styles.printNotice}>⚠️ {printNotice}</div>
      )}

      {groups.length === 0 ? (
        <div className={styles.empty}>
          {showEmpty
            ? 'Активних виробів не знайдено.'
            : 'Завдань немає. Натисніть «Сформувати із замовлень» або «Показати всі вироби».'}
        </div>
      ) : (
        <>
          <div className={styles.twoCol}>

          {/* ── Ліва колонка: Завдання пекарям ───────────────────────── */}
          <div className={styles.mainCol}>
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Завдання пекарям</h3>

            {groups.map(({ label, visibleList, fullList }) => (
              <div key={label} className={styles.typeBlock}>
                <div className={styles.typeLabel}>
                  {label}
                  {!showEmpty && fullList.length > visibleList.length && (
                    <span className={styles.hiddenCount}> +{fullList.length - visibleList.length} прихованих</span>
                  )}
                </div>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th className={styles.thName}>Виріб</th>
                        <th className={styles.thNum}>Замовлено</th>
                        {showRec && <th className={styles.thNum}>Рекомендовано</th>}
                        <th className={styles.thNum}>Спечено</th>
                        <th className={styles.thDiff}>Відхилення</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleList.map((task) => {
                        // Введено = є в БД (loadedBakedQty != null) АБО внесено в цій сесії
                        // Не беремо bakedMap — він оновлюється під час набору (до blur) і спричинив би ранній тригер
                        const bakedIsEntered = loadedBakedQty[task.product_id] != null
                          || enteredIds.has(task.product_id)
                        const baked = bakedMap[task.product_id] ?? 0
                        const calc   = calcFor(task.product_id)
                        const demand = calc.demand            // Замовлено = Σ max(замовлено, в_накладних_adj)
                        const shopRemoved = calc.shopRemoved  // зняте з магазину (≥0)
                        const surplusAlloc  = surplusAllocFor(task.product_id)
                        const isEmpty = demand === 0 && !bakedIsEntered
                        const rawDev  = baked - demand                              // Спечено − Замовлено
                        const effectiveDiff = rawDev + shopRemoved - surplusAlloc   // після зняття/розподілу
                        const hasShopCorr    = shopRemoved > 0
                        const hasSurplusCorr = surplusAlloc > 0
                        const hasCorrection  = hasShopCorr || hasSurplusCorr
                        const isOverAlloc    = surplusAlloc > Math.max(0, rawDev)
                        const isOverRemoved  = shopRemoved  > Math.max(0, -rawDev)

                        const effectiveClass =
                          !bakedIsEntered ? '' :
                          effectiveDiff === 0 ? styles.diffEffectiveOk :
                          isOverAlloc || isOverRemoved ? styles.diffEffectiveWarn :
                          effectiveDiff > 0 ? styles.diffEffectiveSurplus :
                          styles.diffEffectiveShortage

                        const effectiveLabel =
                          !bakedIsEntered ? '' :
                          effectiveDiff === 0 ? '✓' :
                          effectiveDiff > 0 ? `+${effectiveDiff}` : `${effectiveDiff}`

                        const badgeLabel =
                          hasShopCorr ? `✂ ${shopRemoved} знято` :
                          hasSurplusCorr ? `↗ ${surplusAlloc} розподілено` : ''

                        return (
                          <tr
                            key={task.id || -task.product_id}
                            className={`${styles.row} ${isEmpty ? styles.emptyRow : ''}`}
                          >
                            <td className={styles.tdName}>{productName(task.product_id)}</td>
                            <td className={styles.tdNum}>{demand}</td>
                            {showRec && (
                              <td className={`${styles.tdNum} ${styles.recommended}`}>
                                {task.recommended_qty}
                              </td>
                            )}
                            <td className={styles.tdNum}>
                              <input
                                type="number"
                                min={0}
                                step={1}
                                value={bakedMap[task.product_id] ?? ''}
                                placeholder="—"
                                className={styles.bakedInput}
                                data-baked-input="true"
                                onFocus={(e) => e.target.select()}
                                onChange={(e) => handleBakedChange(task, e.target.value)}
                                onBlur={() => handleBakedBlur(task)}
                                onKeyDown={handleBakedKeyDown}
                              />
                            </td>
                            <td className={styles.tdDiff}>
                              {bakedIsEntered && (
                                hasCorrection ? (
                                  <div className={styles.diffCell}>
                                    <span className={`${styles.diffEffective} ${effectiveClass}`}>
                                      {effectiveLabel}
                                    </span>
                                    <span className={styles.diffRaw}>
                                      {rawDev > 0 ? `+${rawDev}` : rawDev < 0 ? `${rawDev}` : '='}
                                    </span>
                                    <span className={styles.diffBadge}>{badgeLabel}</span>
                                  </div>
                                ) : (
                                  <span className={
                                    rawDev > 0 ? styles.surplusCell :
                                    rawDev < 0 ? styles.shortageCell : styles.exactCell
                                  }>
                                    {rawDev > 0 ? `+${rawDev}` : rawDev < 0 ? `${rawDev}` : '✓'}
                                  </span>
                                )
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot>
                      <tr className={styles.footerRow}>
                        <td className={styles.tdName}><strong>Разом</strong></td>
                        <td className={styles.tdNum}>
                          <strong>{visibleList.reduce((s, t) => s + calcFor(t.product_id).demand, 0)}</strong>
                        </td>
                        {showRec && (
                          <td className={styles.tdNum}>
                            <strong>{visibleList.reduce((s, t) => s + t.recommended_qty, 0)}</strong>
                          </td>
                        )}
                        <td className={styles.tdNum}>
                          <strong>
                            {visibleList.reduce((s, t) => s + (bakedMap[t.product_id] ?? 0), 0)}
                          </strong>
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            ))}
          </section>
          </div>{/* /mainCol */}

          {/* ── Права колонка: Розбіжності ────────────────────────────── */}
          <div className={styles.sideCol}>

            {withDiscrepancy.length === 0 && (
              <div className={styles.sideEmpty}>
                <span>Надлишків і нестачі немає</span>
              </div>
            )}

            {withDiscrepancy.length > 0 && (
              <section className={styles.section}>
                <h3 className={styles.sectionTitle}>
                  Розбіжності{' '}
                  <HelpTip width={300}>
                    <strong>Надлишок</strong> — спечено більше ніж замовлено.<br />
                    Потрібно розподілити: до магазину, маршруту або списати.<br /><br />
                    <strong>Нестача</strong> — спечено менше ніж замовлено.<br />
                    Зменшіть кількість у замовленнях або домовтесь з клієнтами.<br /><br />
                    Для незамовленого виробу: натисніть «Показати всі» і введіть кількість у полі «Спечено».
                  </HelpTip>
                </h3>
                <p className={styles.hint}>
                  Вироби де спечено ≠ замовлено або є нерозподілені записи.
                </p>
                {withDiscrepancy.map((task) => (
                  <DiscrepancyPanel
                    key={task.product_id}
                    task={{ ...task, baked_qty: bakedMap[task.product_id] ?? 0 }}
                    productName={productName(task.product_id)}
                    clients={clients}
                    surplusLines={linesFor(task.product_id)}
                    clientRows={calcFor(task.product_id).rows}
                    shopRemovedDone={calcFor(task.product_id).shopRemoved}
                    underbakedClientId={underbakedClientId}
                    workDate={workDate}
                    routeReserve={routeReserve}
                    onReload={reloadAll}
                  />
                ))}
              </section>
            )}

          </div>{/* /sideCol */}

          </div>{/* /twoCol */}
        </>
      )}
    </div>
  )
}
