import { useEffect, useRef, useState } from 'react'
import { useWorkDate } from '../context/DateContext'
import { api } from '../api/client'
import type {
  BakingTask, Client, Product,
  SurplusAllocationLine, ShortageClientInfo,
} from '../types'
import styles from './BakingPage.module.css'

// ─── Допоміжні функції ────────────────────────────────────────────────────────

function recipientLabel(line: SurplusAllocationLine, clients: Client[]): string {
  switch (line.recipient_type) {
    case 'ration':   return 'Пайок'
    case 'writeoff': return 'Списати'
    case 'route':    return 'Маршрут'
    case 'client': {
      const c = clients.find((c) => c.id === line.client_id)
      return c ? (c.short_name ?? c.full_name) : `Клієнт #${line.client_id}`
    }
  }
}

// ─── Панель розподілу надлишків (один продукт) ────────────────────────────────

interface SurplusPanelProps {
  task: BakingTask
  productName: string
  clients: Client[]
  lines: SurplusAllocationLine[]
  workDate: string
  onLineAdded: (line: SurplusAllocationLine) => void
  onLineDeleted: (id: number) => void
}

function SurplusPanel({
  task, productName, clients, lines, workDate, onLineAdded, onLineDeleted,
}: SurplusPanelProps) {
  const surplus = task.baked_qty - task.ordered_qty
  const allocated = lines.reduce((s, l) => s + l.qty, 0)
  const toShop = surplus - allocated  // решта йде до магазину за замовчуванням

  const [recipient, setRecipient] = useState<string>('ration')
  const [qty, setQty]             = useState<string>('')
  const [notes, setNotes]         = useState<string>('')
  const [saving, setSaving]       = useState(false)

  const handleAdd = async () => {
    const qtyNum = Number(qty)
    if (!qtyNum || qtyNum <= 0) return
    setSaving(true)
    const isClient = recipient.startsWith('client_')
    const clientId = isClient ? Number(recipient.replace('client_', '')) : null
    const type = isClient ? 'client' : (recipient as SurplusAllocationLine['recipient_type'])
    const line = await api.post<SurplusAllocationLine>('/baking/surplus-lines', {
      alloc_date: workDate,
      product_id: task.product_id,
      recipient_type: type,
      client_id: clientId,
      qty: qtyNum,
      notes: notes.trim() || null,
    })
    onLineAdded(line)
    setQty('')
    setNotes('')
    setSaving(false)
  }

  const handleDelete = async (id: number) => {
    await api.delete(`/baking/surplus-lines/${id}`)
    onLineDeleted(id)
  }

  return (
    <div className={styles.surplusPanel}>
      {/* Заголовок */}
      <div className={styles.surplusPanelHeader}>
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
                <td>{recipientLabel(line, clients)}</td>
                <td className={styles.lineQty}>{line.qty}</td>
                <td className={styles.lineNotes}>{line.notes ?? ''}</td>
                <td>
                  <button
                    className={styles.btnDelete}
                    onClick={() => handleDelete(line.id)}
                    title="Видалити рядок"
                  >
                    🗑
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Форма додавання */}
      <div className={styles.addLineForm}>
        <select
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
          className={styles.recipientSelect}
        >
          <option value="ration">Пайок</option>
          <option value="writeoff">Списати</option>
          <option value="route">Маршрут (резерв)</option>
          <optgroup label="Клієнт">
            {clients.filter((c) => c.is_active).map((c) => (
              <option key={c.id} value={`client_${c.id}`}>
                {c.short_name ?? c.full_name}
              </option>
            ))}
          </optgroup>
        </select>
        <input
          type="number"
          min={1}
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
          disabled={saving || !qty}
        >
          + Додати
        </button>
      </div>

      {/* Підсумок */}
      <div className={styles.surplusSummary}>
        <span>Розподілено: <strong>{allocated}</strong> / {surplus}</span>
        <span className={toShop === 0 ? styles.ok : styles.toShopHint}>
          {toShop === 0
            ? '✓ Повністю розподілено'
            : `До магазину (залишок): ${toShop}`}
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
  const [clients,      setClients]      = useState<Client[]>([])
  const [surplusLines, setSurplusLines] = useState<SurplusAllocationLine[]>([])
  const [loading,      setLoading]      = useState(true)
  const [generating,   setGenerating]   = useState(false)
  const [showRec,      setShowRec]      = useState(false)  // показувати "Рекомендовано"
  const [printNotice,  setPrintNotice]  = useState<string | null>(null)

  const bakedTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({})
  const [bakedMap,  setBakedMap]  = useState<Record<number, number>>({})
  // Множина task.id де оператор явно ввів значення (навіть 0)
  const [enteredIds, setEnteredIds] = useState<Set<number>>(new Set())

  // ─── Завантаження ─────────────────────────────────────────────────────────

  const load = async (date: string) => {
    setLoading(true)
    const [t, p, c, sl] = await Promise.all([
      api.get<BakingTask[]>(`/baking/tasks?task_date=${date}`),
      api.get<Product[]>('/products/'),
      api.get<Client[]>('/clients/'),
      api.get<SurplusAllocationLine[]>(`/baking/surplus-lines?alloc_date=${date}`),
    ])
    setTasks(t)
    setProducts(p)
    setClients(c)
    setSurplusLines(sl)
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
    surplusLines.filter((l) => l.product_id === productId)

  const handleLineAdded = (line: SurplusAllocationLine) =>
    setSurplusLines((prev) => [...prev, line])

  const handleLineDeleted = (id: number) =>
    setSurplusLines((prev) => prev.filter((l) => l.id !== id))

  // ─── Допоміжні ────────────────────────────────────────────────────────────

  const productName = (id: number) => {
    const p = products.find((p) => p.id === id)
    return p?.short_name ?? p?.name ?? `#${id}`
  }

  const productType = (id: number) => products.find((p) => p.id === id)?.type

  if (loading) return <p style={{ padding: '1rem' }}>Завантаження...</p>

  const withSurplus  = tasks.filter((t) => (bakedMap[t.id] ?? t.baked_qty) > t.ordered_qty)
  // Нестача: оператор явно ввів значення (enteredIds) І спечено < замовлено
  const withShortage = tasks.filter((t) => {
    if (!enteredIds.has(t.id)) return false
    return (bakedMap[t.id] ?? t.baked_qty) < t.ordered_qty
  })

  const groups = [
    { label: 'Хліб',  list: tasks.filter((t) => productType(t.product_id) === 'bread') },
    { label: 'Булки', list: tasks.filter((t) => productType(t.product_id) === 'bun')   },
    { label: 'Інше',  list: tasks.filter((t) => productType(t.product_id) === 'other') },
  ].filter(({ list }) => list.length > 0)

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
          {/* ── Секція 1: Завдання пекарям ─────────────────────────────── */}
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

          {/* ── Секція 2: Розподіл надлишків ────────────────────────────── */}
          {withSurplus.length > 0 && (
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Розподіл надлишків</h3>
              <p className={styles.hint}>
                Вкажіть кому передати надлишки. Все нерозподілене автоматично йде до магазину.
              </p>
              {withSurplus.map((task) => (
                <SurplusPanel
                  key={task.product_id}
                  task={{ ...task, baked_qty: bakedMap[task.id] ?? task.baked_qty }}
                  productName={productName(task.product_id)}
                  clients={clients}
                  lines={linesFor(task.product_id)}
                  workDate={workDate}
                  onLineAdded={handleLineAdded}
                  onLineDeleted={handleLineDeleted}
                />
              ))}
            </section>
          )}

          {/* ── Секція 3: Обробка нестачі ────────────────────────────────── */}
          {withShortage.length > 0 && (
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Нестача — узгодження з клієнтами</h3>
              <p className={styles.hint}>
                Спечено менше ніж замовлено. Вкажіть на скільки зменшити замовлення кожного клієнта.
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
        </>
      )}
    </div>
  )
}
