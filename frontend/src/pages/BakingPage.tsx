import { useEffect, useRef, useState } from 'react'
import { useWorkDate } from '../context/DateContext'
import { api } from '../api/client'
import type { BakingTask, Product, SurplusAllocation } from '../types'
import styles from './BakingPage.module.css'

// ─── Розподіл надлишків по одному продукту ───────────────────────────────────

interface SurplusRowProps {
  task: BakingTask
  productName: string
  allocation: SurplusAllocation | undefined
  onSave: (productId: number, data: Partial<SurplusAllocation>) => void
}

function SurplusRow({ task, productName, allocation, onSave }: SurplusRowProps) {
  const surplus = task.baked_qty - task.ordered_qty
  const [toShop,    setToShop]    = useState(allocation?.to_shop    ?? 0)
  const [toRoute,   setToRoute]   = useState(allocation?.to_route   ?? 0)
  const [ration,    setRation]    = useState(allocation?.ration_qty ?? 0)
  const [writtenOff, setWrittenOff] = useState(allocation?.written_off ?? 0)
  const [notes,     setNotes]     = useState(allocation?.notes ?? '')
  const timer = useRef<ReturnType<typeof setTimeout>>()

  // Синхронізуємо якщо allocation змінився (після завантаження)
  useEffect(() => {
    setToShop(allocation?.to_shop ?? 0)
    setToRoute(allocation?.to_route ?? 0)
    setRation(allocation?.ration_qty ?? 0)
    setWrittenOff(allocation?.written_off ?? 0)
    setNotes(allocation?.notes ?? '')
  }, [allocation])

  const allocated = toShop + toRoute + ration + writtenOff
  const remaining = surplus - allocated
  const isBalanced = Math.abs(remaining) < 0.001

  const schedSave = (patch: Partial<{ toShop: number; toRoute: number; ration: number; writtenOff: number; notes: string }>) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      onSave(task.product_id, {
        to_shop:     patch.toShop     ?? toShop,
        to_route:    patch.toRoute    ?? toRoute,
        ration_qty:  patch.ration     ?? ration,
        written_off: patch.writtenOff ?? writtenOff,
        notes:       (patch.notes ?? notes) || undefined,
      })
    }, 600)
  }

  return (
    <tr className={styles.surplusRow}>
      <td className={styles.tdName}>{productName}</td>
      <td className={styles.tdNum}>{task.ordered_qty}</td>
      <td className={styles.tdNum}>{task.baked_qty}</td>
      <td className={`${styles.tdNum} ${styles.surplus}`}>+{surplus}</td>

      {/* Поля розподілу */}
      {([
        ['до магазину', toShop,     setToShop,     'toShop'],
        ['до маршруту', toRoute,    setToRoute,    'toRoute'],
        ['пайок',       ration,     setRation,     'ration'],
        ['списати',     writtenOff, setWrittenOff, 'writtenOff'],
      ] as const).map(([, val, setter, key]) => (
        <td key={key} className={styles.tdNum}>
          <input
            type="number"
            min={0}
            step={1}
            value={val || ''}
            placeholder="0"
            className={styles.allocInput}
            onFocus={(e) => e.target.select()}
            onChange={(e) => {
              const v = Number(e.target.value)
              setter(v)
              schedSave({ [key]: v })
            }}
          />
        </td>
      ))}

      <td className={`${styles.tdNum} ${isBalanced ? styles.ok : styles.warn}`}>
        {remaining > 0 ? `+${remaining}` : remaining}
      </td>
      <td className={styles.tdNotes}>
        <input
          type="text"
          value={notes}
          placeholder="нотатка..."
          className={styles.notesInput}
          onChange={(e) => {
            setNotes(e.target.value)
            schedSave({ notes: e.target.value })
          }}
        />
      </td>
    </tr>
  )
}

// ─── Головна сторінка ─────────────────────────────────────────────────────────

export default function BakingPage() {
  const { workDate } = useWorkDate()

  const [tasks,       setTasks]       = useState<BakingTask[]>([])
  const [products,    setProducts]    = useState<Product[]>([])
  const [allocations, setAllocations] = useState<SurplusAllocation[]>([])
  const [loading,     setLoading]     = useState(true)
  const [generating,  setGenerating]  = useState(false)

  // Дебаунс-таймери для поля "спечено"
  const bakedTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({})
  const [bakedMap, setBakedMap] = useState<Record<number, number>>({})

  // ─── Завантаження ───────────────────────────────────────────────────────────

  const load = async (date: string) => {
    setLoading(true)
    const [t, p, a] = await Promise.all([
      api.get<BakingTask[]>(`/baking/tasks?task_date=${date}`),
      api.get<Product[]>('/products/'),
      api.get<SurplusAllocation[]>(`/baking/surplus?alloc_date=${date}`),
    ])
    setTasks(t)
    setProducts(p)
    setAllocations(a)
    // Ініціалізуємо локальний стан поля "спечено"
    const map: Record<number, number> = {}
    t.forEach((tk) => { map[tk.id] = tk.baked_qty })
    setBakedMap(map)
    setLoading(false)
  }

  useEffect(() => { load(workDate) }, [workDate])

  // ─── Генерація завдань ──────────────────────────────────────────────────────

  const handleGenerate = async () => {
    setGenerating(true)
    await api.post(`/baking/tasks/generate?task_date=${workDate}`, {})
    await load(workDate)
    setGenerating(false)
  }

  // ─── Зміна "спечено" з дебаунсом ────────────────────────────────────────────

  const handleBakedChange = (task: BakingTask, value: number) => {
    setBakedMap((prev) => ({ ...prev, [task.id]: value }))
    if (bakedTimers.current[task.id]) clearTimeout(bakedTimers.current[task.id])
    bakedTimers.current[task.id] = setTimeout(async () => {
      const updated = await api.put<BakingTask>(`/baking/tasks/${task.id}`, { baked_qty: value })
      setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))
    }, 600)
  }

  // ─── Збереження розподілу надлишків ─────────────────────────────────────────

  const handleSurplusSave = async (productId: number, data: Partial<SurplusAllocation>) => {
    const saved = await api.post<SurplusAllocation>('/baking/surplus', {
      alloc_date: workDate,
      product_id: productId,
      to_shop:     data.to_shop     ?? 0,
      to_route:    data.to_route    ?? 0,
      ration_qty:  data.ration_qty  ?? 0,
      written_off: data.written_off ?? 0,
      notes:       data.notes       ?? null,
    })
    setAllocations((prev) => {
      const exists = prev.find((a) => a.product_id === productId)
      return exists
        ? prev.map((a) => (a.product_id === productId ? saved : a))
        : [...prev, saved]
    })
  }

  // ─── Допоміжні ──────────────────────────────────────────────────────────────

  const productName = (id: number) => {
    const p = products.find((p) => p.id === id)
    return p?.short_name ?? p?.name ?? `#${id}`
  }

  const productType = (id: number) => products.find((p) => p.id === id)?.type

  const hasSurplus = tasks.some((t) => t.baked_qty > t.ordered_qty)

  if (loading) return <p style={{ padding: '1rem' }}>Завантаження...</p>

  // Розбиваємо завдання по типах
  const breadTasks = tasks.filter((t) => productType(t.product_id) === 'bread')
  const bunTasks   = tasks.filter((t) => productType(t.product_id) === 'bun')
  const otherTasks = tasks.filter((t) => productType(t.product_id) === 'other')

  return (
    <div className={styles.page}>

      {/* ── Заголовок ──────────────────────────────────────────────────────── */}
      <div className={styles.toolbar}>
        <h2 className={styles.title}>Випічка — {workDate}</h2>
        <button
          className={styles.btnGenerate}
          onClick={handleGenerate}
          disabled={generating}
        >
          {generating ? 'Формую...' : '⟳ Сформувати із замовлень'}
        </button>
      </div>

      {tasks.length === 0 ? (
        <div className={styles.empty}>
          Завдань немає. Натисніть «Сформувати із замовлень» щоб розрахувати на основі замовлень.
        </div>
      ) : (
        <>
          {/* ── Секція 1: Завдання пекарям ─────────────────────────────────── */}
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Завдання пекарям</h3>

            {[
              { label: 'Хліб', list: breadTasks },
              { label: 'Булки', list: bunTasks },
              { label: 'Інше', list: otherTasks },
            ]
              .filter(({ list }) => list.length > 0)
              .map(({ label, list }) => (
                <div key={label} className={styles.typeBlock}>
                  <div className={styles.typeLabel}>{label}</div>
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th className={styles.thName}>Виріб</th>
                          <th className={styles.thNum}>Замовлено</th>
                          <th className={styles.thNum}>Рекомендовано</th>
                          <th className={styles.thNum}>Спечено</th>
                          <th className={styles.thNum}>Відхилення</th>
                        </tr>
                      </thead>
                      <tbody>
                        {list.map((task) => {
                          const baked = bakedMap[task.id] ?? task.baked_qty
                          const diff  = baked - task.recommended_qty
                          return (
                            <tr key={task.id} className={styles.row}>
                              <td className={styles.tdName}>{productName(task.product_id)}</td>
                              <td className={styles.tdNum}>{task.ordered_qty}</td>
                              <td className={`${styles.tdNum} ${styles.recommended}`}>
                                {task.recommended_qty}
                              </td>
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
                              <td className={`${styles.tdNum} ${diff > 0 ? styles.surplusCell : diff < 0 ? styles.shortageCell : ''}`}>
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
                          <td className={styles.tdNum}>
                            <strong>{list.reduce((s, t) => s + t.recommended_qty, 0)}</strong>
                          </td>
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

          {/* ── Секція 2: Розподіл надлишків ───────────────────────────────── */}
          {hasSurplus && (
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Розподіл надлишків</h3>
              <p className={styles.hint}>
                Розподіліть різницю між спеченим і замовленим: до магазину, до маршруту, пайок чи списати.
              </p>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th className={styles.thName}>Виріб</th>
                      <th className={styles.thNum}>Замовлено</th>
                      <th className={styles.thNum}>Спечено</th>
                      <th className={styles.thNum}>Надлишок</th>
                      <th className={styles.thNum}>До магазину</th>
                      <th className={styles.thNum}>До маршруту</th>
                      <th className={styles.thNum}>Пайок</th>
                      <th className={styles.thNum}>Списати</th>
                      <th className={styles.thNum}>Залишок</th>
                      <th className={styles.thNotes}>Нотатка</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tasks
                      .filter((t) => t.baked_qty > t.ordered_qty)
                      .map((task) => (
                        <SurplusRow
                          key={task.product_id}
                          task={task}
                          productName={productName(task.product_id)}
                          allocation={allocations.find((a) => a.product_id === task.product_id)}
                          onSave={handleSurplusSave}
                        />
                      ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
