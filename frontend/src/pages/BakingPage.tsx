import { useEffect, useRef, useState } from 'react'
import { useWorkDate } from '../context/DateContext'
import { api } from '../api/client'
import type {
  BakingTask, Category, Client, Order, Product, ShortageClientInfo,
} from '../types'
import styles from './BakingPage.module.css'

// ─── Панель розподілу надлишків (один продукт) ────────────────────────────────

const KIND_ICON: Record<string, string> = {
  shop:     '🏪',
  ration:   '🍞',
  writeoff: '🗑',
  customer: '',
}

interface SurplusPanelProps {
  task: BakingTask
  productName: string
  clients: Client[]
  lines: Order[]          // orders з origin_id=0 для цього продукту
  workDate: string
  routeReserve: boolean
  onLineAdded:   (order: Order) => void
  onLineDeleted: (id: number)   => void
}

function SurplusPanel({
  task, productName, clients, lines, workDate, routeReserve, onLineAdded, onLineDeleted,
}: SurplusPanelProps) {
  const surplus   = task.baked_qty - task.ordered_qty
  const allocated = lines.reduce((s, l) => s + l.qty, 0)
  const remaining = surplus - allocated
  const isFullyAllocated = remaining === 0

  // Впорядковані клієнти для dropdown: shop → ration → writeoff → (route) → customer
  const shopClients     = clients.filter(c => c.is_active && c.client_kind === 'shop')
  const rationClients   = clients.filter(c => c.is_active && c.client_kind === 'ration')
  const writeoffClients = clients.filter(c => c.is_active && c.client_kind === 'writeoff')
  const customerClients = clients.filter(c => c.is_active && c.client_kind === 'customer')

  const firstId = (shopClients[0] ?? rationClients[0] ?? writeoffClients[0] ?? customerClients[0])?.id
  const [selectedClientId, setSelectedClientId] = useState<number | ''>(firstId ?? '')
  const [qty,    setQty]    = useState<string>('')
  const [notes,  setNotes]  = useState<string>('')
  const [saving, setSaving] = useState(false)

  const clientName = (id: number) => {
    const c = clients.find(c => c.id === id)
    return c ? (c.short_name ?? c.full_name) : `#${id}`
  }

  const handleAdd = async () => {
    const qtyNum = Number(qty)
    if (!qtyNum || qtyNum <= 0 || !selectedClientId) return
    if (qtyNum > remaining) return
    setSaving(true)
    const order = await api.post<Order>('/orders/', {
      client_id:  selectedClientId,
      product_id: task.product_id,
      qty:        qtyNum,
      order_date: workDate,
      origin_id:  0,
      notes:      notes.trim() || null,
    })
    onLineAdded(order)
    setQty('')
    setNotes('')
    setSaving(false)
  }

  const handleDelete = async (id: number) => {
    await api.delete(`/orders/${id}`)
    onLineDeleted(id)
  }

  const renderClientOption = (c: Client) => (
    <option key={c.id} value={c.id}>
      {KIND_ICON[c.client_kind] ? `${KIND_ICON[c.client_kind]} ` : ''}{c.short_name ?? c.full_name}
    </option>
  )

  return (
    <div className={isFullyAllocated ? styles.surplusPanel : styles.surplusPanelPartial}>
      {/* Заголовок */}
      <div className={isFullyAllocated ? styles.surplusPanelHeader : styles.surplusPanelHeaderPartial}>
        <span className={styles.surplusPanelName}>{productName}</span>
        <span className={styles.surplusTag}>
          Замовлено: {task.ordered_qty} &nbsp;·&nbsp; Спечено: {task.baked_qty}
          &nbsp;·&nbsp; Надлишок: <strong>+{surplus}</strong>
        </span>
      </div>

      {/* Існуючі рядки */}
      {lines.length > 0 && (
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
            {lines.map((line) => (
              <tr key={line.id}>
                <td>{clientName(line.client_id)}</td>
                <td className={styles.lineQty}>{line.qty}</td>
                <td className={styles.lineNotes}>{line.notes ?? ''}</td>
                <td>
                  <button
                    className={styles.btnDelete}
                    onClick={() => handleDelete(line.id)}
                    title="Видалити рядок"
                  >🗑</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Форма додавання — тільки якщо є нерозподілений залишок */}
      {!isFullyAllocated && (
        <div className={styles.addLineForm}>
          <select
            value={selectedClientId}
            onChange={(e) => setSelectedClientId(Number(e.target.value))}
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
            type="number"
            min={1}
            max={remaining}
            step={1}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            placeholder="к-сть"
            className={styles.addQtyInput}
          />
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="нотатка..."
            className={styles.addNotesInput}
          />
          <button
            className={styles.btnAdd}
            onClick={handleAdd}
            disabled={saving || !qty || !selectedClientId}
          >
            + Додати
          </button>
        </div>
      )}

      {/* Підсумок */}
      <div className={styles.surplusSummary}>
        <span>Розподілено: <strong>{allocated}</strong> / {surplus}</span>
        <span className={isFullyAllocated ? styles.ok : styles.unallocated}>
          {isFullyAllocated
            ? '✓ Повністю розподілено'
            : `⚠ Не розподілений надлишок: ${remaining}`}
        </span>
      </div>
    </div>
  )
}

// ─── Панель нестачі (один продукт) ───────────────────────────────────────────

interface ShortagePanelProps {
  task: BakingTask
  productName: string
}

function ShortagePanel({ task, productName }: ShortagePanelProps) {
  const shortage = task.ordered_qty - task.baked_qty
  const [clients, setClients]     = useState<ShortageClientInfo[]>([])
  const [reductions, setReductions] = useState<Record<number, number>>({})
  const [loading, setLoading]     = useState(true)
  const [applied, setApplied]     = useState(false)
  const [applying, setApplying]   = useState(false)

  useEffect(() => {
    api.get<ShortageClientInfo[]>(
      `/baking/shortage-clients?task_date=${task.task_date}&product_id=${task.product_id}`
    ).then((data) => {
      setClients(data)
      setLoading(false)
    })
  }, [task.task_date, task.product_id])

  const totalReduction = Object.values(reductions).reduce((s, v) => s + v, 0)

  const handleApply = async () => {
    setApplying(true)
    for (const [orderId, reduceBy] of Object.entries(reductions)) {
      if (!reduceBy) continue
      const c = clients.find((c) => c.order_id === Number(orderId))
      if (!c) continue
      const newQty = Math.max(0, c.ordered_qty - reduceBy)
      if (newQty === 0) {
        await api.delete(`/orders/${orderId}`)
      } else {
        await api.put(`/orders/${orderId}`, { qty: newQty })
      }
    }
    setApplied(true)
    setApplying(false)
  }

  if (loading) return <div className={styles.shortagePanel}>Завантаження...</div>

  return (
    <div className={styles.shortagePanel}>
      <div className={styles.shortagePanelHeader}>
        <span className={styles.surplusPanelName}>{productName}</span>
        <span className={styles.shortageTag}>
          Замовлено: {task.ordered_qty} &nbsp;·&nbsp; Спечено: {task.baked_qty}
          &nbsp;·&nbsp; Нестача: <strong>-{shortage}</strong>
        </span>
      </div>

      <table className={styles.linesTable}>
        <thead>
          <tr>
            <th>Клієнт</th>
            <th>Маршрут</th>
            <th>Замовлено</th>
            <th>Зменшити на</th>
          </tr>
        </thead>
        <tbody>
          {clients.map((c) => (
            <tr key={c.order_id}>
              <td>{c.client_name}</td>
              <td className={styles.lineNotes}>{c.route_name}</td>
              <td className={styles.lineQty}>{c.ordered_qty}</td>
              <td>
                <input
                  type="number"
                  min={0}
                  max={c.ordered_qty}
                  step={1}
                  value={reductions[c.order_id] ?? ''}
                  placeholder="0"
                  className={styles.addQtyInput}
                  onChange={(e) =>
                    setReductions((prev) => ({
                      ...prev,
                      [c.order_id]: Math.min(Number(e.target.value), c.ordered_qty),
                    }))
                  }
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className={styles.surplusSummary}>
        <span>
          Погоджено зменшити:{' '}
          <strong className={totalReduction >= shortage ? styles.ok : ''}>
            {totalReduction}
          </strong>{' '}
          / {shortage}
        </span>
        {applied ? (
          <span className={styles.ok}>✓ Замовлення оновлені</span>
        ) : (
          <button
            className={styles.btnApply}
            onClick={handleApply}
            disabled={applying || totalReduction === 0}
          >
            {applying ? 'Застосовую...' : 'Застосувати'}
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Головна сторінка ─────────────────────────────────────────────────────────

export default function BakingPage() {
  const { workDate } = useWorkDate()

  const [tasks,        setTasks]        = useState<BakingTask[]>([])
  const [products,     setProducts]     = useState<Product[]>([])
  const [categories,   setCategories]   = useState<Category[]>([])
  const [clients,      setClients]      = useState<Client[]>([])
  const [surplusOrders, setSurplusOrders] = useState<Order[]>([])
  const [loading,      setLoading]      = useState(true)
  const [generating,   setGenerating]   = useState(false)
  const [showRec,      setShowRec]      = useState(false)  // показувати "Рекомендовано"
  const [printNotice,  setPrintNotice]  = useState<string | null>(null)
  const [routeReserve, setRouteReserve] = useState(false)

  const bakedTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({})
  const [bakedMap,  setBakedMap]  = useState<Record<number, number>>({})
  // Множина task.id де оператор явно ввів значення (навіть 0)
  const [enteredIds, setEnteredIds] = useState<Set<number>>(new Set())

  // ─── Завантаження ─────────────────────────────────────────────────────────

  const load = async (date: string) => {
    setLoading(true)
    const [t, p, cats, c, so, sett] = await Promise.all([
      api.get<BakingTask[]>(`/baking/tasks?task_date=${date}`),
      api.get<Product[]>('/products/'),
      api.get<Category[]>('/categories?active_only=false'),
      api.get<Client[]>('/clients/'),
      api.get<Order[]>(`/orders/?order_date=${date}&origin_id=0`),
      api.get<Record<string, { value: string }>>('/settings/'),
    ])
    setRouteReserve(sett['baking_route_reserve']?.value === '1')
    setTasks(t)
    setProducts(p)
    setCategories(cats)
    setClients(c)
    setSurplusOrders(so)
    const map: Record<number, number> = {}
    t.forEach((tk) => { map[tk.id] = tk.baked_qty })
    setBakedMap(map)
    setLoading(false)
  }

  useEffect(() => { load(workDate) }, [workDate])

  // ─── Перевірка непідтверджених bot-замовлень ──────────────────────────────

  const checkPendingAndConfirm = async (): Promise<boolean> => {
    try {
      const pending = await api.get<{ id: number }[]>(`/bot/pending-orders?order_date=${workDate}`)
      if (pending.length > 0) {
        return window.confirm(
          `⚠️ Є ${pending.length} непідтверджених замовлень через бота.\n\n` +
          `Вони будуть проігноровані при формуванні/друку.\n\n` +
          `Продовжити?`
        )
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

  const handleBakedChange = (task: BakingTask, value: number) => {
    setBakedMap((prev) => ({ ...prev, [task.id]: value }))
    setEnteredIds((prev) => new Set(prev).add(task.id))
    if (bakedTimers.current[task.id]) clearTimeout(bakedTimers.current[task.id])
    bakedTimers.current[task.id] = setTimeout(async () => {
      const updated = await api.put<BakingTask>(`/baking/tasks/${task.id}`, { baked_qty: value })
      setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))
    }, 600)
  }

  // ─── Розподіл надлишків ───────────────────────────────────────────────────

  const linesFor = (productId: number) =>
    surplusOrders.filter((o) => o.product_id === productId)

  const handleLineAdded = (order: Order) =>
    setSurplusOrders((prev) => [...prev, order])

  const handleLineDeleted = (id: number) =>
    setSurplusOrders((prev) => prev.filter((o) => o.id !== id))

  // ─── Допоміжні ────────────────────────────────────────────────────────────

  const productName = (id: number) => {
    const p = products.find((p) => p.id === id)
    return p?.short_name ?? p?.name ?? `#${id}`
  }

  const productCategoryId = (productId: number) => products.find((p) => p.id === productId)?.category_id

  if (loading) return <p style={{ padding: '1rem' }}>Завантаження...</p>

  const withSurplus  = tasks.filter((t) => (bakedMap[t.id] ?? t.baked_qty) > t.ordered_qty)
  // Нестача: оператор явно ввів значення (enteredIds) І спечено < замовлено
  const withShortage = tasks.filter((t) => {
    if (!enteredIds.has(t.id)) return false
    return (bakedMap[t.id] ?? t.baked_qty) < t.ordered_qty
  })

  const bakedCategories = [...categories]
    .filter((c) => c.is_baked)
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'uk'))

  const groups = bakedCategories
    .map((cat) => ({
      label:      cat.name,
      category_id: cat.id,
      list:       tasks.filter((t) => productCategoryId(t.product_id) === cat.id),
    }))
    .filter(({ list }) => list.length > 0)

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
                if (!(await checkPendingAndConfirm())) return
                const url = `/api/v1/print/baking?task_date=${workDate}`
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
              🖨 Завдання пекарям
            </button>
          </>
        )}
      </div>

      {printNotice && (
        <div className={styles.printNotice}>⚠️ {printNotice}</div>
      )}

      {tasks.length === 0 ? (
        <div className={styles.empty}>
          Завдань немає. Натисніть «Сформувати із замовлень».
        </div>
      ) : (
        <>
          <div className={styles.twoCol}>

          {/* ── Ліва колонка: Завдання пекарям ───────────────────────── */}
          <div className={styles.mainCol}>
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Завдання пекарям</h3>

            {groups.map(({ label, list }) => (
              <div key={label} className={styles.typeBlock}>
                <div className={styles.typeLabel}>{label}</div>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th className={styles.thName}>Виріб</th>
                        <th className={styles.thNum}>Замовлено</th>
                        {showRec && <th className={styles.thNum}>Рекомендовано</th>}
                        <th className={styles.thNum}>Спечено</th>
                        <th className={styles.thNum}>Відхилення</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((task) => {
                        const baked = bakedMap[task.id] ?? task.baked_qty
                        const diff  = baked - task.ordered_qty   // відхилення від замовленого
                        return (
                          <tr key={task.id} className={styles.row}>
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
                                value={baked || ''}
                                placeholder="—"
                                className={styles.bakedInput}
                                onFocus={(e) => e.target.select()}
                                onChange={(e) => handleBakedChange(task, Number(e.target.value))}
                              />
                            </td>
                            <td className={`${styles.tdNum} ${
                              baked === 0 ? '' :
                              diff > 0 ? styles.surplusCell :
                              diff < 0 ? styles.shortageCell : styles.exactCell
                            }`}>
                              {baked > 0
                                ? diff > 0 ? `+${diff}` : diff < 0 ? `${diff}` : '✓'
                                : ''}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot>
                      <tr className={styles.footerRow}>
                        <td className={styles.tdName}><strong>Разом</strong></td>
                        <td className={styles.tdNum}>
                          <strong>{list.reduce((s, t) => s + t.ordered_qty, 0)}</strong>
                        </td>
                        {showRec && (
                          <td className={styles.tdNum}>
                            <strong>{list.reduce((s, t) => s + t.recommended_qty, 0)}</strong>
                          </td>
                        )}
                        <td className={styles.tdNum}>
                          <strong>
                            {list.reduce((s, t) => s + (bakedMap[t.id] ?? t.baked_qty), 0)}
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

          {/* ── Права колонка: Надлишки + Нестача ────────────────────── */}
          <div className={styles.sideCol}>

            {withSurplus.length === 0 && withShortage.length === 0 && (
              <div className={styles.sideEmpty}>
                <span>Надлишків і нестачі немає</span>
              </div>
            )}

            {/* Секція 2: Розподіл надлишків */}
            {withSurplus.length > 0 && (
              <section className={styles.section}>
                <h3 className={styles.sectionTitle}>Розподіл надлишків</h3>
                <p className={styles.hint}>
                  Вкажіть кому передати надлишки. Нерозподілений залишок нікуди не переноситься автоматично.
                </p>
                {withSurplus.map((task) => (
                  <SurplusPanel
                    key={task.product_id}
                    task={{ ...task, baked_qty: bakedMap[task.id] ?? task.baked_qty }}
                    productName={productName(task.product_id)}
                    clients={clients}
                    lines={linesFor(task.product_id)}
                    workDate={workDate}
                    routeReserve={routeReserve}
                    onLineAdded={handleLineAdded}
                    onLineDeleted={handleLineDeleted}
                  />
                ))}
              </section>
            )}

            {/* Секція 3: Обробка нестачі */}
            {withShortage.length > 0 && (
              <section className={styles.section}>
                <h3 className={styles.sectionTitle}>Нестача — узгодження</h3>
                <p className={styles.hint}>
                  Спечено менше ніж замовлено. Вкажіть на скільки зменшити замовлення.
                </p>
                {withShortage.map((task) => (
                  <ShortagePanel
                    key={task.product_id}
                    task={{ ...task, baked_qty: bakedMap[task.id] ?? task.baked_qty }}
                    productName={productName(task.product_id)}
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
