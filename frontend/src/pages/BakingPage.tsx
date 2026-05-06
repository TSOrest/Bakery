import { useEffect, useRef, useState } from 'react'
import { useWorkDate } from '../context/DateContext'
import { api } from '../api/client'
import HelpTip from '../components/HelpTip'
import { useConfirm } from '../components/ConfirmDialog'
import type {
  BakingTask, Category, Client, Order, Product, ShortageClientInfo,
} from '../types'
import styles from './BakingPage.module.css'

const KIND_ICON: Record<string, string> = {
  shop:     '🏪',
  ration:   '🍞',
  writeoff: '🗑',
  customer: '',
}

// ─── Єдина панель розбіжності (надлишок / нестача / конфлікт) ─────────────────

interface DiscrepancyPanelProps {
  task:         BakingTask
  productName:  string
  clients:      Client[]
  surplusLines: Order[]     // origin_id=0 для цього продукту (зі стану батька)
  workDate:     string
  routeReserve: boolean
  onSurplusLineAdded:   (o: Order)   => void
  onSurplusLineDeleted: (id: number) => void
  onSurplusLineUpdated: (o: Order)   => void
  onShortageChanged:    () => void   // перезавантажити underbakedOrders у батьку
}

function DiscrepancyPanel({
  task, productName, clients, surplusLines, workDate, routeReserve,
  onSurplusLineAdded, onSurplusLineDeleted, onSurplusLineUpdated, onShortageChanged,
}: DiscrepancyPanelProps) {

  const [clientRows,     setClientRows]     = useState<ShortageClientInfo[]>([])
  const [childOrders,    setChildOrders]    = useState<Order[]>([])
  const [reductions,     setReductions]     = useState<Record<number, number>>({})
  const [editReductions, setEditReductions] = useState<Record<number, string>>({})
  const [editQty,        setEditQty]        = useState<Record<number, string>>({})
  const [loading,        setLoading]        = useState(true)
  const [applying,       setApplying]       = useState(false)
  const [addClientId,    setAddClientId]    = useState<number | ''>('')
  const [addQty,         setAddQty]         = useState('')
  const [addNotes,       setAddNotes]       = useState('')
  const [addSaving,      setAddSaving]      = useState(false)

  const underbakedClient = clients.find(c => c.client_kind === 'underbaked')

  const loadRows = async () => {
    setLoading(true)
    const data = await api.get<ShortageClientInfo[]>(
      `/baking/shortage-clients?task_date=${task.task_date}&product_id=${task.product_id}`
    )
    setClientRows(data)
    if (underbakedClient) {
      const parentIds = new Set(data.map(c => c.order_id))
      const all = await api.get<Order[]>(
        `/orders/?order_date=${task.task_date}&client_id=${underbakedClient.id}`
      )
      setChildOrders(all.filter(o => o.parent_order_id && parentIds.has(o.parent_order_id)))
    }
    setLoading(false)
  }

  useEffect(() => { loadRows() }, [task.task_date, task.product_id])

  // ── Обчислення стану ──────────────────────────────────────────────────────
  const rawDiff  = (task.baked_qty ?? 0) - task.ordered_qty  // + надлишок, - нестача
  const surplus  = Math.max(0,  rawDiff)
  const shortage = Math.max(0, -rawDiff)

  const surplusAlloc       = surplusLines.reduce((s, l) => s + l.qty, 0)
  const totalExistingReduc = clientRows.reduce((s, c) => s + c.existing_reduction, 0)
  const totalNewReduc      = Object.values(reductions).reduce((s, v) => s + v, 0)

  const surplusRemaining = surplus - surplusAlloc
  const overAllocation   = surplusAlloc > surplus        // розподілено більше ніж є
  const overReduction    = Math.max(0, totalExistingReduc - shortage)
  const hasConflict      = rawDiff <= 0 && surplusAlloc > 0  // нестача/рівність але є записи розподілу
  const effectiveDiff    = rawDiff - surplusAlloc + totalExistingReduc

  const showSurplusSection  = surplusAlloc > 0 || rawDiff > 0
  const showShortageSection = shortage > 0 || totalExistingReduc > 0

  // Коли показувати edit/delete
  const surplusRowsEditable  = overAllocation || hasConflict
  const shortageRowsEditable = overReduction > 0

  // ── Стиль панелі ──────────────────────────────────────────────────────────
  const isPerfect  = effectiveDiff === 0 && !hasConflict && totalNewReduc === 0
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

  // ── Клієнти для select (додавання надлишку) ───────────────────────────────
  const shopClients     = clients.filter(c => c.is_active && c.client_kind === 'shop')
  const rationClients   = clients.filter(c => c.is_active && c.client_kind === 'ration')
  const writeoffClients = clients.filter(c => c.is_active && c.client_kind === 'writeoff')
  const customerClients = clients.filter(c => c.is_active && c.client_kind === 'customer')
  const firstId = (shopClients[0] ?? rationClients[0] ?? writeoffClients[0] ?? customerClients[0])?.id
  const effectiveAddClientId = addClientId !== '' ? addClientId : (firstId ?? '')

  const clientName = (id: number) => {
    const c = clients.find(c => c.id === id)
    return c ? (c.short_name ?? c.full_name) : `#${id}`
  }

  const renderClientOption = (c: Client) => (
    <option key={c.id} value={c.id}>
      {KIND_ICON[c.client_kind] ? `${KIND_ICON[c.client_kind]} ` : ''}{c.short_name ?? c.full_name}
    </option>
  )

  // ── Surplus actions ───────────────────────────────────────────────────────
  const handleAddSurplus = async () => {
    const qtyNum = Number(addQty)
    if (!qtyNum || qtyNum <= 0 || !effectiveAddClientId) return
    if (qtyNum > surplusRemaining) return
    setAddSaving(true)
    const order = await api.post<Order>('/orders/', {
      client_id:  effectiveAddClientId,
      product_id: task.product_id,
      qty:        qtyNum,
      order_date: workDate,
      origin_id:  0,
      notes:      addNotes.trim() || null,
    })
    onSurplusLineAdded(order)
    setAddQty('')
    setAddNotes('')
    setAddSaving(false)
  }

  const handleDeleteSurplus = async (id: number) => {
    await api.delete(`/orders/${id}`)
    onSurplusLineDeleted(id)
  }

  const handleSaveSurplusEdit = async (line: Order) => {
    const raw = editQty[line.id]
    if (raw === undefined) return
    const newQty = Number(raw)
    setEditQty(prev => { const n = { ...prev }; delete n[line.id]; return n })
    if (!newQty || newQty <= 0 || newQty === line.qty) return
    const updated = await api.put<Order>(`/orders/${line.id}`, { qty: newQty })
    onSurplusLineUpdated(updated)
  }

  // ── Shortage actions ──────────────────────────────────────────────────────
  const handleApplyReductions = async () => {
    if (!underbakedClient) {
      alert('Системний клієнт "Недопечено" не знайдений.')
      return
    }
    setApplying(true)
    for (const [orderId, reduceBy] of Object.entries(reductions)) {
      if (!reduceBy) continue
      await api.post('/orders/', {
        client_id:       underbakedClient.id,
        product_id:      task.product_id,
        qty:             reduceBy,
        order_date:      task.task_date,
        parent_order_id: Number(orderId),
      })
    }
    setReductions({})
    await loadRows()
    onShortageChanged()
    setApplying(false)
  }

  const handleSaveEditReduction = async (c: ShortageClientInfo) => {
    const raw = editReductions[c.order_id]
    if (raw === undefined) return
    setEditReductions(prev => { const n = { ...prev }; delete n[c.order_id]; return n })
    const newQty = Number(raw)
    const toDelete = childOrders.filter(o => o.parent_order_id === c.order_id)
    await Promise.all(toDelete.map(o => api.delete(`/orders/${o.id}`)))
    if (newQty > 0 && underbakedClient) {
      await api.post('/orders/', {
        client_id:       underbakedClient.id,
        product_id:      task.product_id,
        qty:             newQty,
        order_date:      task.task_date,
        parent_order_id: c.order_id,
      })
    }
    await loadRows()
    onShortageChanged()
  }

  const handleDeleteReduction = async (c: ShortageClientInfo) => {
    const toDelete = childOrders.filter(o => o.parent_order_id === c.order_id)
    await Promise.all(toDelete.map(o => api.delete(`/orders/${o.id}`)))
    await loadRows()
    onShortageChanged()
  }

  if (loading) return <div className={panelClass} style={{ padding: '0.75rem 1rem', fontSize: '0.85rem', color: '#888' }}>Завантаження...</div>

  return (
    <div className={panelClass}>

      {/* ── Заголовок ──────────────────────────────────────────────────── */}
      <div className={headerClass}>
        <span className={styles.surplusPanelName}>{productName}</span>
        <span className={styles.headerDiff}>
          {rawDiff > 0 ? `+${rawDiff}` : rawDiff < 0 ? `${rawDiff}` : '='}
        </span>
        <span className={styles.headerSep}>·</span>
        {showShortageSection ? (
          hasConflict
            ? <span className={styles.headerWarn}>⚠ Конфлікт</span>
            : totalExistingReduc >= shortage && totalNewReduc === 0
            ? <span className={styles.headerOk}>{totalExistingReduc}/{shortage} ✓ Нестачу узгоджено</span>
            : <span className={styles.headerMuted}>Погоджено: {totalExistingReduc + totalNewReduc}/{shortage}</span>
        ) : showSurplusSection ? (
          overAllocation
            ? <span className={styles.headerWarn}>⚠ Перерозподіл: +{surplusAlloc - surplus}</span>
            : surplusRemaining === 0 && surplusAlloc > 0
            ? <span className={styles.headerOk}>{surplusAlloc}/{surplus || surplusAlloc} ✓ Повністю розподілено</span>
            : surplusRemaining > 0
            ? <span className={styles.headerMuted}>Розподілено: {surplusAlloc}/{surplus}</span>
            : null
        ) : null}
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
          {showShortageSection && (
            <div className={styles.sectionDivider}>Розподіл надлишків</div>
          )}

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
                    <tr key={line.id}>
                      <td>{clientName(line.client_id)}</td>
                      <td className={styles.lineQty}>
                        {surplusRowsEditable ? (
                          <input
                            type="number" min={1} step={1}
                            value={editQty[line.id] ?? String(line.qty)}
                            className={styles.addQtyInput}
                            onChange={e => setEditQty(prev => ({ ...prev, [line.id]: e.target.value }))}
                            onBlur={() => handleSaveSurplusEdit(line)}
                          />
                        ) : line.qty}
                      </td>
                      <td className={styles.lineNotes}>{line.notes ?? ''}</td>
                      <td>
                        <button
                          className={styles.btnDelete}
                          onClick={() => handleDeleteSurplus(line.id)}
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
                {customerClients.length > 0 && (
                  <optgroup label="Клієнти">
                    {customerClients.map(renderClientOption)}
                  </optgroup>
                )}
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

          {/* Попередження перерозподілу — статус вже у заголовку */}
          {overAllocation && (
            <div className={styles.surplusSummary}>
              <span className={styles.unallocated}>⚠ Розподілено на <strong>{surplusAlloc - surplus}</strong> більше ніж надлишок. Відредагуйте або видаліть зайві рядки.</span>
            </div>
          )}
        </>
      )}

      {/* ── Секція узгодження нестачі ───────────────────────────────────── */}
      {showShortageSection && (
        <>
          {showSurplusSection && (
            <div className={styles.sectionDivider}>Узгодження нестачі</div>
          )}

          {overReduction > 0 && (
            <div className={styles.overWarning}>
              ⚠ Спечено більше ніж очікувалось. Знято на <strong>{overReduction}</strong> більше
              ніж поточна нестача. Відредагуйте або видаліть зайве нижче.
            </div>
          )}

          <table className={`${styles.linesTable} ${hasConflict ? styles.dimmed : ''}`}>
            <thead>
              <tr>
                <th>Клієнт</th>
                <th>Маршрут</th>
                <th>Тип</th>
                <th>Ціна</th>
                <th>Замовлено</th>
                <th>Вже знято</th>
                {!hasConflict && <th>Зняти ще</th>}
              </tr>
            </thead>
            <tbody>
              {clientRows.map(c => {
                const maxReduce = c.ordered_qty - c.existing_reduction
                const showEditDel = shortageRowsEditable && c.existing_reduction > 0
                const isExchange  = c.exchange_type === 'pre_order'
                const isCustom    = !isExchange && c.price_override != null
                return (
                  <tr key={c.order_id}>
                    <td>{c.client_name}</td>
                    <td className={styles.lineNotes}>{c.route_name}</td>
                    <td className={styles.lineType}>
                      {isExchange
                        ? <span className={styles.typeExchange}>↔ обмін</span>
                        : isCustom
                        ? <span className={styles.typeCustom}>% своя</span>
                        : null}
                    </td>
                    <td className={styles.linePrice}>
                      {isExchange ? '0.00' : (c.effective_price ?? 0).toFixed(2)}
                    </td>
                    <td className={styles.lineQty}>{c.ordered_qty}</td>
                    <td className={styles.lineQty}>
                      {showEditDel ? (
                        <div className={styles.inlineEditCell}>
                          <input
                            type="number" min={0} max={c.ordered_qty} step={1}
                            value={editReductions[c.order_id] ?? String(c.existing_reduction)}
                            className={styles.addQtyInput}
                            onChange={e => setEditReductions(prev => ({ ...prev, [c.order_id]: e.target.value }))}
                            onBlur={() => handleSaveEditReduction(c)}
                          />
                          <button
                            className={styles.btnDelete}
                            onClick={() => handleDeleteReduction(c)}
                            title="Скасувати зняття"
                          >🗑</button>
                        </div>
                      ) : c.existing_reduction > 0 ? (
                        <span className={styles.shortageReduced}>-{c.existing_reduction}</span>
                      ) : '—'}
                    </td>
                    {!hasConflict && (
                      <td>
                        <input
                          type="number" min={0} max={maxReduce} step={1}
                          value={reductions[c.order_id] ?? ''}
                          placeholder="0"
                          className={styles.addQtyInput}
                          disabled={maxReduce <= 0}
                          onChange={e => setReductions(prev => ({
                            ...prev,
                            [c.order_id]: Math.min(Number(e.target.value), maxReduce),
                          }))}
                        />
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>

          {/* Статус узгодження нестачі — кнопка або попередження; підсумок у заголовку */}
          {(overReduction > 0 || hasConflict || !(totalExistingReduc >= shortage && totalNewReduc === 0)) && (
            <div className={styles.surplusSummary}>
              {overReduction > 0 ? (
                <span className={styles.unallocated}>⚠ Зайве зняття: +{overReduction}</span>
              ) : hasConflict ? (
                <span className={styles.unallocated}>⚠ Спочатку вирішіть конфлікт вище</span>
              ) : (
                <button
                  className={styles.btnApply}
                  onClick={handleApplyReductions}
                  disabled={applying || totalNewReduc === 0}
                >
                  {applying ? 'Застосовую...' : 'Застосувати'}
                </button>
              )}
            </div>
          )}
        </>
      )}

      {/* ── Нетто відхилення (тільки коли обидві секції) ───────────────── */}
      {showSurplusSection && showShortageSection && (
        <div className={styles.netSummary}>
          Нетто відхилення:{' '}
          <strong className={
            effectiveDiff === 0 ? styles.ok :
            effectiveDiff > 0  ? styles.surplusCell :
            styles.shortageCell
          }>
            {effectiveDiff > 0 ? `+${effectiveDiff}` : effectiveDiff === 0 ? '✓ 0' : `${effectiveDiff}`}
          </strong>
        </div>
      )}
    </div>
  )
}

// ─── Головна сторінка ─────────────────────────────────────────────────────────

export default function BakingPage() {
  const { workDate } = useWorkDate()
  const confirmDialog = useConfirm()

  const [tasks,        setTasks]        = useState<BakingTask[]>([])
  const [products,     setProducts]     = useState<Product[]>([])
  const [categories,   setCategories]   = useState<Category[]>([])
  const [clients,      setClients]      = useState<Client[]>([])
  const [surplusOrders,    setSurplusOrders]    = useState<Order[]>([])
  const [underbakedOrders, setUnderbakedOrders] = useState<Order[]>([])
  const [loading,          setLoading]          = useState(true)
  const [generating,   setGenerating]   = useState(false)
  const [showRec,      setShowRec]      = useState(false)
  const [showEmpty,    setShowEmpty]    = useState(false)   // показати вироби без замовлень
  const [printNotice,  setPrintNotice]  = useState<string | null>(null)
  const [routeReserve, setRouteReserve] = useState(false)

  // Всі мапи і сети ключовані за product_id (не task.id) — підтримує "віртуальні" рядки
  // null = значення не надано (порожнє поле), number = явно введене (в т.ч. 0)
  const bakedTimers  = useRef<Record<number, ReturnType<typeof setTimeout>>>({})
  const [bakedMap,       setBakedMap]       = useState<Record<number, number | null>>({})
  const [loadedBakedQty, setLoadedBakedQty] = useState<Record<number, number | null>>({})
  const [enteredIds,     setEnteredIds]     = useState<Set<number>>(new Set())

  // ─── Завантаження ─────────────────────────────────────────────────────────

  const load = async (date: string) => {
    setLoading(true)
    const [t, p, cats, c, so, sett] = await Promise.all([
      api.get<BakingTask[]>(`/baking/tasks?task_date=${date}`),
      api.get<Product[]>('/products/?active_only=false'),
      api.get<Category[]>('/categories?active_only=false'),
      api.get<Client[]>('/clients/?active_only=false'),
      api.get<Order[]>(`/orders/?order_date=${date}&origin_id=0`),
      api.get<Record<string, { value: string }>>('/settings/'),
    ])
    setRouteReserve(sett['baking_route_reserve']?.value === '1')
    setTasks(t)
    setProducts(p)
    setCategories(cats)
    setClients(c)
    setSurplusOrders(so)
    const underbakedClient = c.find(cl => cl.client_kind === 'underbaked')
    if (underbakedClient) {
      api.get<Order[]>(`/orders/?order_date=${date}&client_id=${underbakedClient.id}`)
        .then(setUnderbakedOrders).catch(() => setUnderbakedOrders([]))
    }
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

  const linesFor = (productId: number) =>
    surplusOrders.filter((o) => o.product_id === productId)

  const handleSurplusLineAdded   = (order: Order) => setSurplusOrders(prev => [...prev, order])
  const handleSurplusLineDeleted = (id: number)   => setSurplusOrders(prev => prev.filter(o => o.id !== id))
  const handleSurplusLineUpdated = (order: Order) => setSurplusOrders(prev => prev.map(o => o.id === order.id ? order : o))

  const handleShortageChanged = async () => {
    const underbakedClient = clients.find(c => c.client_kind === 'underbaked')
    if (underbakedClient) {
      const updated = await api.get<Order[]>(`/orders/?order_date=${workDate}&client_id=${underbakedClient.id}`)
      setUnderbakedOrders(updated)
    }
  }

  // ─── Допоміжні ────────────────────────────────────────────────────────────

  const productName = (id: number) => {
    const p = products.find((p) => p.id === id)
    return p?.short_name ?? p?.name ?? `#${id}`
  }

  if (loading) return <p style={{ padding: '1rem' }}>Завантаження...</p>

  // ── Фільтр: завдання з реальною розбіжністю ─────────────────────────────
  // baked > ordered → надлишок (потрібен розподіл)
  // baked < ordered → нестача (включно з 0) — записи зняття показуються всередині
  // surplusOrders    → є записи розподілу надлишку (потрібен перегляд)
  // underbakedOrders → НЕ показуємо окремого блоку коли baked=ordered:
  //   якщо спечено рівно замовленому — записи зняття застарілі й не впливають на доставку;
  //   вони з'являться в блоці нестачі якщо оператор знову зменшить Спечено

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
    if (baked > t.ordered_qty) return true
    if (baked < t.ordered_qty) return true
    if (surplusOrders.some(o => o.product_id === t.product_id)) return true
    return false
  }).sort((a, b) => {
    // Пріоритет: конфлікт > нестача > надлишок
    const score = (t: BakingTask) => {
      const baked = bakedMap[t.product_id] ?? t.baked_qty ?? 0
      const alloc = surplusOrders.filter(o => o.product_id === t.product_id).reduce((s, o) => s + o.qty, 0)
      if (baked <= t.ordered_qty && alloc > 0) return 0  // конфлікт
      if (baked < t.ordered_qty) return 1                // нестача
      return 2                                            // надлишок
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
                  const rawDiff    = baked - t.ordered_qty
                  const surplus    = Math.max(0,  rawDiff)
                  const shortage   = Math.max(0, -rawDiff)
                  const allocated  = surplusOrders.filter(o => o.product_id === t.product_id).reduce((s, o) => s + o.qty, 0)
                  const reduced    = underbakedOrders.filter(o => o.product_id === t.product_id).reduce((s, o) => s + o.qty, 0)
                  const hasConflict = rawDiff <= 0 && allocated > 0
                  return hasConflict || (surplus > 0 && allocated < surplus) || (shortage > 0 && reduced < shortage)
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
                        const isEmpty = task.ordered_qty === 0 && !bakedIsEntered
                        const diff  = baked - task.ordered_qty
                        const surplusAlloc  = surplusOrders.filter(o => o.product_id === task.product_id).reduce((s, o) => s + o.qty, 0)
                        const shortageReduc = underbakedOrders.filter(o => o.product_id === task.product_id).reduce((s, o) => s + o.qty, 0)
                        // Бейдж актуальний лише коли відповідає напрямку відхилення:
                        // розподіл надлишку — тільки при diff>0, зняття — тільки при diff<0
                        const hasSurplusCorr  = surplusAlloc > 0 && diff > 0
                        const hasShortageCorr = shortageReduc > 0 && diff < 0
                        const hasCorrection   = hasSurplusCorr || hasShortageCorr
                        const correction    = (hasShortageCorr ? shortageReduc : 0) - (hasSurplusCorr ? surplusAlloc : 0)
                        const effectiveDiff = diff + correction
                        const isOverAlloc   = diff > 0 && surplusAlloc > diff
                        const isOverReduc   = diff < 0 && shortageReduc > Math.abs(diff)

                        const effectiveClass =
                          !bakedIsEntered ? '' :
                          diff === 0 ? styles.diffEffectiveOk :
                          isOverAlloc || isOverReduc ? styles.diffEffectiveWarn :
                          effectiveDiff > 0 ? styles.diffEffectiveSurplus :
                          effectiveDiff < 0 ? styles.diffEffectiveShortage :
                          styles.diffEffectiveOk

                        // При diff=0 завжди "✓" — стале записи не змінюють реального відхилення в колонці
                        const effectiveLabel =
                          !bakedIsEntered ? '' :
                          diff === 0 ? '✓' :
                          effectiveDiff > 0 ? `+${effectiveDiff}` :
                          effectiveDiff < 0 ? `${effectiveDiff}` : '✓'

                        const badgeLabel =
                          hasSurplusCorr && hasShortageCorr
                            ? `↗${surplusAlloc} ✂${shortageReduc}`
                            : hasSurplusCorr ? `↗ ${surplusAlloc} розподілено`
                            : hasShortageCorr ? `✂ ${shortageReduc} знято`
                            : ''

                        return (
                          <tr
                            key={task.id || -task.product_id}
                            className={`${styles.row} ${isEmpty ? styles.emptyRow : ''}`}
                          >
                            <td className={styles.tdName}>{productName(task.product_id)}</td>
                            <td className={styles.tdNum}>{task.ordered_qty}</td>
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
                                      {diff > 0 ? `+${diff}` : diff < 0 ? `${diff}` : '='}
                                    </span>
                                    <span className={styles.diffBadge}>{badgeLabel}</span>
                                  </div>
                                ) : (
                                  <span className={
                                    diff > 0 ? styles.surplusCell :
                                    diff < 0 ? styles.shortageCell : styles.exactCell
                                  }>
                                    {diff > 0 ? `+${diff}` : diff < 0 ? `${diff}` : '✓'}
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
                          <strong>{visibleList.reduce((s, t) => s + t.ordered_qty, 0)}</strong>
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
                    workDate={workDate}
                    routeReserve={routeReserve}
                    onSurplusLineAdded={handleSurplusLineAdded}
                    onSurplusLineDeleted={handleSurplusLineDeleted}
                    onSurplusLineUpdated={handleSurplusLineUpdated}
                    onShortageChanged={handleShortageChanged}
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
