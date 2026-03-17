import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import type { Client, Order, Product } from '../types'
import styles from './OrderModal.module.css'

type CellKey = `${number}-${number}`
type SavingMap = Record<CellKey, 'saving' | 'saved' | 'error'>

interface Props {
  client: Client
  workDate: string
  products: Product[]
  orders: Order[]
  saving: SavingMap
  onQtyChange: (clientId: number, productId: number, qty: number) => void
  onClose: () => void
}

const fmt = (n: number) => n.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function OrderModal({ client, workDate, products, orders, saving, onQtyChange, onClose }: Props) {
  const [filter,  setFilter]  = useState<'all' | 'bread' | 'bun'>('all')
  const [sortBy,  setSortBy]  = useState<'alpha' | 'freq'>('alpha')
  const [freqs,   setFreqs]   = useState<Record<number, number>>({})
  const [prices,  setPrices]  = useState<Record<number, number>>({})

  const [showRepeat,    setShowRepeat]    = useState(false)
  const [repeatDate,    setRepeatDate]    = useState('')
  const [repeatOrders,  setRepeatOrders]  = useState<Order[]>([])
  const [repeatChecked, setRepeatChecked] = useState<Set<number>>(new Set())
  const [repeatLoading, setRepeatLoading] = useState(false)

  const inputRefs = useRef<Record<number, HTMLInputElement | null>>({})

  // Закриття по Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Завантажуємо ефективні ціни при відкритті
  useEffect(() => {
    api.get<Record<number, number>>(`/prices/effective?client_id=${client.id}&date=${workDate}`)
      .then(setPrices)
      .catch(() => {})
  }, [client.id, workDate])

  // Завантажуємо частоту клієнта при перемиканні на сортування за частотою
  useEffect(() => {
    if (sortBy !== 'freq' || Object.keys(freqs).length > 0) return
    const from = new Date(); from.setDate(from.getDate() - 90)
    api.get<Record<number, number>>(
      `/orders/averages?client_id=${client.id}&date_from=${from.toISOString().split('T')[0]}`
    ).then(setFreqs).catch(() => {})
  }, [sortBy, client.id, freqs])

  // Завантажуємо замовлення для дати повтору
  useEffect(() => {
    if (!repeatDate) return
    setRepeatLoading(true)
    setRepeatChecked(new Set())
    api.get<Order[]>(`/orders/?order_date=${repeatDate}&client_id=${client.id}`)
      .then(data => {
        const main = data.filter(o => o.parent_order_id == null && o.qty > 0)
        setRepeatOrders(main)
        setRepeatChecked(new Set(main.map(o => o.product_id)))
      })
      .catch(() => setRepeatOrders([]))
      .finally(() => setRepeatLoading(false))
  }, [repeatDate, client.id])

  // ─── Допоміжні ────────────────────────────────────────────────────────────

  const getQty = (productId: number): number =>
    orders.find(o => o.client_id === client.id && o.product_id === productId && o.parent_order_id == null)?.qty ?? 0

  const activeProducts = products.filter(p => p.is_active)
  const filtered = filter === 'all' ? activeProducts : activeProducts.filter(p => p.type === filter)
  const displayed = [...filtered].sort((a, b) => {
    if (sortBy === 'freq') {
      const diff = (freqs[b.id] ?? 0) - (freqs[a.id] ?? 0)
      if (diff !== 0) return diff
    }
    return a.name.localeCompare(b.name, 'uk')
  })

  // Підсумки
  const clientOrders = orders.filter(o => o.client_id === client.id && o.parent_order_id == null && o.qty > 0)
  const uniqueCount = new Set(clientOrders.map(o => o.product_id)).size
  const totalQty    = clientOrders.reduce((s, o) => s + o.qty, 0)
  const totalSum    = clientOrders.reduce((s, o) => s + o.qty * (prices[o.product_id] ?? 0), 0)

  // ─── Enter-навігація ───────────────────────────────────────────────────────

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, productId: number) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const idx = displayed.findIndex(p => p.id === productId)
    if (idx >= 0 && idx < displayed.length - 1) {
      inputRefs.current[displayed[idx + 1].id]?.focus()
    }
  }

  // ─── Додавання з повтору ──────────────────────────────────────────────────

  const handleAddRepeat = () => {
    for (const o of repeatOrders) {
      if (repeatChecked.has(o.product_id)) onQtyChange(client.id, o.product_id, o.qty)
    }
    setShowRepeat(false)
  }

  // ─── Рендер ───────────────────────────────────────────────────────────────

  const hasDiscount = (client.discount_pct ?? 0) > 0

  return (
    <div className={styles.overlay} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={styles.modal}>

        {/* Заголовок */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <strong>{client.full_name}</strong>
            {client.short_name && <span className={styles.clientShort}>({client.short_name})</span>}
            {client.address   && <span className={styles.clientAddr}>{client.address}</span>}
            {client.phone     && <span className={styles.clientPhone}>{client.phone}</span>}
            {hasDiscount && (
              <span className={styles.discountBadge} title={`Знижка ${client.discount_pct}%`}>
                -{client.discount_pct}%
              </span>
            )}
          </div>
          <button className={styles.closeBtn} onClick={onClose} title="Закрити (Esc)">×</button>
        </div>

        {/* Фільтр + сортування */}
        <div className={styles.filterBar}>
          <div className={styles.filterGroup}>
            {(['all', 'bread', 'bun'] as const).map(f => (
              <button
                key={f}
                className={`${styles.filterBtn} ${filter === f ? styles.active : ''}`}
                onClick={() => setFilter(f)}
              >
                {f === 'all' ? 'Всі' : f === 'bread' ? 'Хліб' : 'Булки'}
              </button>
            ))}
          </div>
          <div className={styles.sortGroup}>
            <button
              className={`${styles.sortBtn} ${sortBy === 'alpha' ? styles.active : ''}`}
              onClick={() => setSortBy('alpha')}
              title="За алфавітом"
            >А–Я</button>
            <button
              className={`${styles.sortBtn} ${sortBy === 'freq' ? styles.active : ''}`}
              onClick={() => setSortBy('freq')}
              title="За частотою замовлень за 90 днів"
            >Частота</button>
          </div>
        </div>

        {/* Тіло */}
        <div className={styles.body}>

          {/* Список виробів */}
          <div className={styles.productCol}>
            <table className={styles.productTable}>
              <thead>
                <tr>
                  <th className={styles.thName}>Виріб</th>
                  <th className={styles.thWeight}>Вага</th>
                  <th className={styles.thPrice}>Ціна</th>
                  <th className={styles.thQtyH}>Кількість</th>
                </tr>
              </thead>
              <tbody>
                {displayed.map(product => {
                  const key: CellKey = `${client.id}-${product.id}`
                  const state = saving[key]
                  const qty   = getQty(product.id)
                  const freq  = freqs[product.id]
                  const price = prices[product.id]
                  return (
                    <tr key={product.id} className={qty > 0 ? styles.hasQty : ''}>
                      <td className={styles.tdName}>
                        <span className={styles.prodName}>{product.name}</span>
                        {sortBy === 'freq' && freq
                          ? <span className={styles.freqHint}>~{freq}</span>
                          : null}
                      </td>
                      <td className={styles.tdWeight}>
                        {product.weight ? <span>{product.weight}</span> : null}
                      </td>
                      <td className={styles.tdPrice}>
                        {price != null && price > 0 ? fmt(price) : '—'}
                      </td>
                      <td className={styles.tdInput}>
                        <input
                          ref={el => { inputRefs.current[product.id] = el }}
                          type="number"
                          min={0}
                          step={1}
                          value={qty || ''}
                          placeholder="—"
                          className={
                            styles.qtyInput +
                            (state === 'saving' ? ' ' + styles.saving : '') +
                            (state === 'saved'  ? ' ' + styles.saved  : '') +
                            (state === 'error'  ? ' ' + styles.error  : '')
                          }
                          onFocus={e => e.target.select()}
                          onChange={e => onQtyChange(client.id, product.id, Number(e.target.value))}
                          onKeyDown={e => handleKeyDown(e, product.id)}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Панель повтору */}
          {showRepeat && (
            <div className={styles.repeatCol}>
              <div className={styles.repeatTitle}>Повтор замовлення</div>
              <input
                type="date"
                value={repeatDate}
                max={workDate}
                onChange={e => setRepeatDate(e.target.value)}
                className={styles.repeatDateInput}
              />
              {repeatLoading && <div className={styles.repeatHint}>Завантаження...</div>}
              {!repeatLoading && repeatDate && repeatOrders.length === 0 && (
                <div className={styles.repeatHint}>Замовлень не знайдено</div>
              )}
              {repeatOrders.length > 0 && (
                <>
                  <label className={styles.repeatSelectAll}>
                    <input
                      type="checkbox"
                      checked={repeatChecked.size === repeatOrders.length}
                      onChange={e =>
                        setRepeatChecked(
                          e.target.checked ? new Set(repeatOrders.map(o => o.product_id)) : new Set()
                        )
                      }
                    />
                    {' '}Всі
                  </label>
                  <div className={styles.repeatList}>
                    {repeatOrders.map(o => {
                      const p = products.find(pr => pr.id === o.product_id)
                      return (
                        <label key={o.product_id} className={styles.repeatRow}>
                          <input
                            type="checkbox"
                            checked={repeatChecked.has(o.product_id)}
                            onChange={e => setRepeatChecked(prev => {
                              const n = new Set(prev)
                              e.target.checked ? n.add(o.product_id) : n.delete(o.product_id)
                              return n
                            })}
                          />
                          <span className={styles.repeatName}>{p?.name ?? `#${o.product_id}`}</span>
                          <span className={styles.repeatQty}>{o.qty}</span>
                        </label>
                      )
                    })}
                  </div>
                  <button
                    className={styles.btnAddRepeat}
                    onClick={handleAddRepeat}
                    disabled={repeatChecked.size === 0}
                  >
                    Додати відмічені
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* Підвал */}
        <div className={styles.footer}>
          <div className={styles.totals}>
            <span>Видів: <strong>{uniqueCount}</strong></span>
            <span>Виробів: <strong>{totalQty}</strong></span>
            {totalSum > 0 && (
              <span className={styles.totalSum}>Сума: <strong>{fmt(totalSum)} ₴</strong></span>
            )}
          </div>
          <div className={styles.footerActions}>
            <button
              className={`${styles.btnRepeat} ${showRepeat ? styles.btnRepeatOn : ''}`}
              onClick={() => setShowRepeat(v => !v)}
            >
              Повтор
            </button>
            <button className={styles.btnDone} onClick={onClose}>
              Завершити
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}
