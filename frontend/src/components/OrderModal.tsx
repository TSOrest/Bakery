import { Fragment, useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import type { Category, Client, Order, Product } from '../types'
import styles from './OrderModal.module.css'
import PriceTypeBadge, { type PriceSource } from './PriceTypeBadge'

type EffectivePriceInfo = { price: number; source: PriceSource }

type CellKey = `${number}-${number}`
type SavingMap = Record<CellKey, 'saving' | 'saved' | 'error'>

interface Props {
  client: Client
  workDate: string
  products: Product[]
  categories: Category[]
  orders: Order[]
  saving: SavingMap
  locked?: boolean
  onQtyChange: (clientId: number, productId: number, qty: number) => void
  onOrdersChange: () => void
  onClose: () => void
}

const fmt = (n: number) => n.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function OrderModal({
  client, workDate, products, categories, orders, saving, locked,
  onQtyChange, onOrdersChange, onClose,
}: Props) {
  const [filter,  setFilter]  = useState<'all' | number>('all')
  const [sortBy,  setSortBy]  = useState<'alpha' | 'freq'>('alpha')
  const [freqs,   setFreqs]   = useState<Record<number, number>>({})
  const [prices,  setPrices]  = useState<Record<number, EffectivePriceInfo>>({})

  // ── Дата замовлення (може відрізнятись від workDate) ──────────────────────
  const [orderForDate, setOrderForDate] = useState(workDate)
  // Власні замовлення для orderForDate != workDate
  const [ownOrders,    setOwnOrders]    = useState<Order[] | null>(null)
  const ownOrdersRef = useRef<Order[] | null>(null)
  useEffect(() => { ownOrdersRef.current = ownOrders }, [ownOrders])

  // Inline обмін: productId → значення поля вводу
  const [exchangeInputs, setExchangeInputs] = useState<Record<number, string>>({})
  const ownTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({})

  // effectiveOrders — те що показує модалка
  const effectiveOrders = orderForDate !== workDate && ownOrders !== null ? ownOrders : orders

  const yesterday = (() => { const d = new Date(workDate); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10) })()
  const [repeatDate,    setRepeatDate]    = useState(yesterday)
  const [repeatOrders,  setRepeatOrders]  = useState<Order[]>([])
  const [repeatChecked, setRepeatChecked] = useState<Set<number>>(new Set())
  const [repeatLoading, setRepeatLoading] = useState(false)

  // Форма додавання discount-рядка (обмін тепер інлайн)
  const [addLine, setAddLine] = useState<{
    productId: number
    qty: string
    price: string
  } | null>(null)
  const [addingSaving, setAddingSaving] = useState(false)

  const inputRefs = useRef<Record<number, HTMLInputElement | null>>({})

  // Закриття по Escape + блокування скролу сторінки
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  // Завантажуємо ефективні ціни при зміні orderForDate
  useEffect(() => {
    api.get<Record<number, EffectivePriceInfo | number>>(`/prices/effective?client_id=${client.id}&date=${orderForDate}`)
      .then(raw => {
        const normalized: Record<number, EffectivePriceInfo> = {}
        for (const [k, v] of Object.entries(raw)) {
          normalized[Number(k)] = typeof v === 'number'
            ? { price: v, source: 'base' }
            : v as EffectivePriceInfo
        }
        setPrices(normalized)
      }).catch(() => {})
  }, [client.id, orderForDate])

  // Коли orderForDate змінюється на non-workDate — завантажуємо власні замовлення
  const fetchOwnOrders = () => {
    api.get<Order[]>(`/orders/?order_date=${orderForDate}&client_id=${client.id}`)
      .then(data => setOwnOrders(data.filter(o => o.qty > 0)))
      .catch(() => setOwnOrders([]))
  }
  useEffect(() => {
    if (orderForDate === workDate) { setOwnOrders(null); return }
    fetchOwnOrders()
    setExchangeInputs({})
  }, [orderForDate, workDate, client.id])

  // Частота замовлень (для сортування)
  useEffect(() => {
    if (sortBy !== 'freq' || Object.keys(freqs).length > 0) return
    const from = new Date(); from.setDate(from.getDate() - 90)
    api.get<Record<number, number>>(
      `/orders/averages?client_id=${client.id}&date_from=${from.toISOString().split('T')[0]}`
    ).then(setFreqs).catch(() => {})
  }, [sortBy, client.id, freqs])

  // Замовлення для панелі "Повтор"
  useEffect(() => {
    if (!repeatDate) return
    setRepeatLoading(true)
    setRepeatChecked(new Set())
    api.get<Order[]>(`/orders/?order_date=${repeatDate}&client_id=${client.id}`)
      .then(data => {
        const main = data.filter(o => o.parent_order_id == null && o.exchange_type === 'none' && o.qty > 0)
        setRepeatOrders(main)
        setRepeatChecked(new Set(main.map(o => o.product_id)))
      })
      .catch(() => setRepeatOrders([]))
      .finally(() => setRepeatLoading(false))
  }, [repeatDate, client.id])

  // ─── Допоміжні ────────────────────────────────────────────────────────────

  const getQty = (productId: number): number =>
    effectiveOrders.find(o =>
      o.client_id === client.id &&
      o.product_id === productId &&
      o.parent_order_id == null &&
      o.origin_id == null &&
      o.exchange_type === 'none' &&
      o.price_override == null
    )?.qty ?? 0

  const getExtraLines = (productId: number): Order[] =>
    effectiveOrders.filter(o =>
      o.client_id === client.id &&
      o.product_id === productId &&
      o.parent_order_id == null &&
      o.origin_id == null &&
      (o.exchange_type !== 'none' || o.price_override != null)
    )

  const bakedCategoryIds = new Set(categories.filter(c => c.is_baked).map(c => c.id))
  const activeProducts = products.filter(p => p.is_active && bakedCategoryIds.has(p.category_id!))
  const filtered = filter === 'all' ? activeProducts : activeProducts.filter(p => p.category_id === filter)
  const displayed = [...filtered].sort((a, b) => {
    if (sortBy === 'freq') {
      const diff = (freqs[b.id] ?? 0) - (freqs[a.id] ?? 0)
      if (diff !== 0) return diff
    }
    return a.name.localeCompare(b.name, 'uk')
  })

  // Підсумки
  const clientOrders = effectiveOrders.filter(o =>
    o.client_id === client.id &&
    o.parent_order_id == null &&
    o.origin_id == null &&
    o.qty > 0
  )
  const uniqueCount = new Set(clientOrders.map(o => o.product_id)).size
  const totalQty    = clientOrders.reduce((s, o) => s + o.qty, 0)
  const totalSum    = clientOrders.reduce((s, o) => {
    const price = o.price_override != null ? o.price_override : (prices[o.product_id]?.price ?? 0)
    return s + o.qty * price
  }, 0)

  // ─── Enter-навігація ───────────────────────────────────────────────────────

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, productId: number) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const idx = displayed.findIndex(p => p.id === productId)
    if (idx >= 0 && idx < displayed.length - 1) {
      inputRefs.current[displayed[idx + 1].id]?.focus()
    }
  }

  // ─── Qty для non-workDate замовлень (з debounce) ─────────────────────────

  const handleOwnQtyChange = (productId: number, qty: number) => {
    // Оптимістичне оновлення ownOrders
    setOwnOrders(prev => {
      const isMain = (o: Order) =>
        o.product_id === productId && o.parent_order_id == null &&
        o.exchange_type === 'none' && o.price_override == null
      const exists = (prev ?? []).find(isMain)
      if (exists) {
        if (qty <= 0) return (prev ?? []).filter(o => !isMain(o))
        return (prev ?? []).map(o => isMain(o) ? { ...o, qty } : o)
      }
      if (qty <= 0) return prev ?? []
      return [...(prev ?? []), {
        id: -1, client_id: client.id, product_id: productId, qty,
        order_date: orderForDate, source: 'phone' as const, exchange_type: 'none' as const,
        exchange_qty: 0, exchange_price: null, exchange_notes: null, price_override: null,
        notes: null, created_at: null, parent_order_id: null, delivered_qty: null,
        origin_id: null, bot_status: null, bot_rejection_reason: null, bot_original_qty: null,
      } as Order]
    })

    if (ownTimers.current[productId]) clearTimeout(ownTimers.current[productId])
    ownTimers.current[productId] = setTimeout(async () => {
      const curOrders = ownOrdersRef.current ?? []
      const isMain = (o: Order) =>
        o.product_id === productId && o.parent_order_id == null &&
        o.exchange_type === 'none' && o.price_override == null
      const existing = curOrders.find(isMain)
      try {
        if (existing && existing.id !== -1) {
          if (qty <= 0) {
            await api.delete(`/orders/${existing.id}`)
          } else {
            const upd = await api.put<Order>(`/orders/${existing.id}`, { qty })
            setOwnOrders(p => (p ?? []).map(o => o.id === existing.id ? upd : o))
          }
        } else if (qty > 0) {
          const created = await api.post<Order>('/orders/', {
            client_id: client.id, product_id: productId, qty, order_date: orderForDate,
          })
          setOwnOrders(p => (p ?? []).map(o => isMain(o) && o.id === -1 ? created : o))
        }
      } catch {}
    }, 600)
  }

  // ─── Inline обмін ─────────────────────────────────────────────────────────

  const handleInlineExchange = async (productId: number, qtyStr: string) => {
    const qty = Number(qtyStr)
    if (!qty || qty <= 0) return
    try {
      await api.post('/orders/', {
        client_id: client.id,
        product_id: productId,
        qty,
        order_date: orderForDate,
        exchange_type: 'pre_order',
        price_override: 0,
      })
      setExchangeInputs(p => ({ ...p, [productId]: '' }))
      if (orderForDate !== workDate) { fetchOwnOrders() } else { onOrdersChange() }
    } catch {}
  }

  // ─── Повтор замовлення ────────────────────────────────────────────────────

  const handleAddRepeat = async () => {
    const items = repeatOrders.filter(o => repeatChecked.has(o.product_id))
    if (orderForDate === workDate) {
      for (const o of items) onQtyChange(client.id, o.product_id, o.qty)
    } else {
      for (const o of items) {
        await api.post('/orders/', {
          client_id: client.id, product_id: o.product_id, qty: o.qty, order_date: orderForDate,
        }).catch(() => {})
      }
      fetchOwnOrders()
    }
  }

  // ─── Discount-рядок (+ кнопка) ───────────────────────────────────────────

  const handleAddDiscountLine = async () => {
    if (!addLine) return
    const qty = Number(addLine.qty)
    if (!qty || qty <= 0) return
    setAddingSaving(true)
    try {
      const price = addLine.price !== '' ? Number(addLine.price) : null
      await api.post('/orders/', {
        client_id: client.id,
        product_id: addLine.productId,
        qty,
        order_date: orderForDate,
        price_override: price,
      })
      setAddLine(null)
      if (orderForDate !== workDate) { fetchOwnOrders() } else { onOrdersChange() }
    } finally {
      setAddingSaving(false)
    }
  }

  const handleDeleteExtraLine = async (orderId: number) => {
    await api.delete(`/orders/${orderId}`)
    if (orderForDate !== workDate) { fetchOwnOrders() } else { onOrdersChange() }
  }

  // ─── Рендер ───────────────────────────────────────────────────────────────

  const hasDiscount = (client.discount_pct ?? 0) > 0
  const isNonWorkDate = orderForDate !== workDate

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
          {/* На дату */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginRight: 8 }}>
            <span style={{ fontSize: '0.8rem', color: '#64748b', whiteSpace: 'nowrap' }}>На дату:</span>
            <input
              type="date"
              value={orderForDate}
              disabled={locked}
              style={{
                fontSize: '0.85rem', padding: '2px 6px', border: '1px solid #cbd5e1',
                borderRadius: 5, background: isNonWorkDate ? '#fef3c7' : undefined,
                fontWeight: isNonWorkDate ? 700 : undefined, color: isNonWorkDate ? '#92400e' : undefined,
              }}
              onChange={e => { setOrderForDate(e.target.value); setAddLine(null) }}
            />
          </div>
          <button className={styles.closeBtn} onClick={onClose} title="Закрити (Esc)">×</button>
        </div>

        {/* Фільтр + сортування */}
        <div className={styles.filterBar}>
          <div className={styles.filterGroup}>
            <button
              className={`${styles.filterBtn} ${filter === 'all' ? styles.active : ''}`}
              onClick={() => setFilter('all')}
            >Всі</button>
            {[...categories]
              .filter(c => c.is_active && c.is_baked)
              .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'uk'))
              .map(c => (
                <button
                  key={c.id}
                  className={`${styles.filterBtn} ${filter === c.id ? styles.active : ''}`}
                  onClick={() => setFilter(c.id)}
                >{c.name}</button>
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

        {/* Locked notice */}
        {locked && (
          <div style={{ background: '#fff3cd', border: '1px solid #ffc107', borderRadius: 4, padding: '0.4rem 0.8rem', fontSize: '0.85rem', color: '#856404', flexShrink: 0 }}>
            🔒 Накладна сформована — замовлення заблоковані для редагування
          </div>
        )}

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
                  <th className={styles.thAct}></th>
                  <th className={styles.thQtyH}>Кількість</th>
                  <th className={styles.thSum}>Сума</th>
                </tr>
              </thead>
              <tbody>
                {displayed.map(product => {
                  const key: CellKey = `${client.id}-${product.id}`
                  // saving state only relevant for workDate orders (managed by parent)
                  const state      = orderForDate === workDate ? saving[key] : undefined
                  const qty        = getQty(product.id)
                  const freq       = freqs[product.id]
                  const priceInfo  = prices[product.id]
                  const price      = priceInfo?.price
                  const extraLines = getExtraLines(product.id)
                  const showAdd    = addLine?.productId === product.id
                  const hasExchange = extraLines.some(l => l.exchange_type === 'pre_order')

                  return (
                    <Fragment key={product.id}>
                      {/* ── Основний рядок ─────────────────────────────── */}
                      <tr className={qty > 0 ? styles.hasQty : ''}>
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
                          {price != null && price > 0
                            ? <>{fmt(price)}<PriceTypeBadge source={priceInfo!.source} /></>
                            : '—'}
                        </td>
                        <td className={styles.tdAct}>
                          {!locked && !showAdd && (
                            <button
                              className={styles.btnAddLine}
                              title="Додати рядок зі знижкою / своєю ціною"
                              onClick={() => setAddLine({ productId: product.id, qty: '', price: '' })}
                            >%</button>
                          )}
                        </td>
                        <td className={styles.tdInput}>
                          <input
                            ref={el => { inputRefs.current[product.id] = el }}
                            type="number"
                            min={0}
                            step={1}
                            value={qty || ''}
                            placeholder="—"
                            disabled={locked}
                            className={
                              styles.qtyInput +
                              (state === 'saving' ? ' ' + styles.saving : '') +
                              (state === 'saved'  ? ' ' + styles.saved  : '') +
                              (state === 'error'  ? ' ' + styles.error  : '')
                            }
                            onFocus={e => e.target.select()}
                            onChange={e => {
                              if (locked) return
                              const v = Number(e.target.value)
                              if (orderForDate === workDate) {
                                onQtyChange(client.id, product.id, v)
                              } else {
                                handleOwnQtyChange(product.id, v)
                              }
                            }}
                            onKeyDown={e => handleKeyDown(e, product.id)}
                          />
                        </td>
                        <td className={styles.tdSum}>
                          {price != null && qty > 0 ? fmt(qty * price) : '—'}
                        </td>
                      </tr>

                      {/* ── Inline Обмін (якщо є qty і ще немає рядка обміну) ── */}
                      {qty > 0 && !hasExchange && !locked && (
                        <tr style={{ background: '#f0fdf4' }}>
                          <td colSpan={2} style={{ paddingLeft: 20, fontSize: '0.78rem', color: '#16a34a', fontWeight: 600 }}>
                            ↔ Обмін
                          </td>
                          <td />
                          <td />
                          <td className={styles.tdInput}>
                            <input
                              type="number"
                              min={0}
                              step={1}
                              value={exchangeInputs[product.id] ?? ''}
                              placeholder="0"
                              className={styles.qtyInput}
                              style={{ background: '#dcfce7' }}
                              onChange={e => setExchangeInputs(p => ({ ...p, [product.id]: e.target.value }))}
                              onBlur={() => {
                                const v = exchangeInputs[product.id]
                                if (v && Number(v) > 0) handleInlineExchange(product.id, v)
                              }}
                              onKeyDown={e => {
                                if (e.key === 'Enter') {
                                  const v = exchangeInputs[product.id]
                                  if (v && Number(v) > 0) handleInlineExchange(product.id, v)
                                  e.preventDefault()
                                }
                              }}
                            />
                          </td>
                          <td style={{ fontSize: '0.75rem', color: '#6b7280', paddingLeft: 4 }}>безкошт.</td>
                        </tr>
                      )}

                      {/* ── Існуючі extra рядки ─────────────────────────── */}
                      {extraLines.map(line => (
                        <tr key={line.id} className={styles.extraLineRow}>
                          <td className={styles.extraLineLabel} colSpan={2}>
                            {line.exchange_type === 'pre_order' ? '↔ Обмін' : '% Знижка'}
                          </td>
                          <td className={styles.tdPrice}>
                            {line.price_override != null ? fmt(line.price_override) : '0.00'}
                          </td>
                          <td className={styles.tdAct}>
                            {!locked && (
                              <button
                                className={styles.btnDeleteLine}
                                title="Видалити рядок"
                                onClick={() => handleDeleteExtraLine(line.id)}
                              >🗑</button>
                            )}
                          </td>
                          <td className={styles.tdInput} style={{ textAlign: 'center', color: '#333' }}>
                            {line.qty}
                          </td>
                          <td className={styles.tdSum}>
                            {line.price_override != null && line.price_override > 0
                              ? fmt(line.qty * line.price_override)
                              : '—'}
                          </td>
                        </tr>
                      ))}

                      {/* ── Форма discount-рядка (%) ─────────────────────── */}
                      {showAdd && (
                        <tr className={styles.addLineFormRow}>
                          <td colSpan={2} className={styles.addLineCell}>
                            <span style={{ fontSize: '0.82rem', color: '#475569' }}>% Знижка — своя ціна</span>
                          </td>
                          <td className={styles.addLineCell}>
                            <input
                              type="number" min={0} step={0.01}
                              value={addLine!.price}
                              placeholder="Ціна"
                              className={styles.addLinePriceInput}
                              onChange={e => setAddLine(p => p ? { ...p, price: e.target.value } : null)}
                            />
                          </td>
                          <td className={styles.tdAct}>
                            <button
                              className={styles.btnSaveLine}
                              disabled={addingSaving || !addLine!.qty}
                              onClick={handleAddDiscountLine}
                              title="Зберегти"
                            >✓</button>
                            <button
                              className={styles.btnCancelLine}
                              onClick={() => setAddLine(null)}
                              title="Скасувати"
                            >✕</button>
                          </td>
                          <td className={styles.addLineCell}>
                            <input
                              type="number" min={1} step={1}
                              value={addLine!.qty}
                              placeholder="К-сть"
                              className={styles.addLineQtyInput}
                              autoFocus
                              onKeyDown={e => { if (e.key === 'Enter') handleAddDiscountLine() }}
                              onChange={e => setAddLine(p => p ? { ...p, qty: e.target.value } : null)}
                            />
                          </td>
                          <td />
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Панель повтору */}
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
                  disabled={repeatChecked.size === 0 || locked}
                >
                  Додати відмічені
                </button>
              </>
            )}
          </div>
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
            <button className={styles.btnDone} onClick={onClose}>
              Завершити
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}
