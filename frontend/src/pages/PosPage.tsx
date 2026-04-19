/**
 * POS-інтерфейс для продавця магазину.
 * Touch-оптимізовано для планшета. Маршрут /pos.
 */
import { useEffect, useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { api } from '../api/client'
import css from './PosPage.module.css'

// ─── Типи ─────────────────────────────────────────────────────────────────────

interface ShopClient {
  id: number
  name: string
  short_name?: string
}

interface PosProduct {
  product_id: number
  name: string
  short_name: string | null
  category_id: number | null
  category_name: string | null
  price: number | null
  current_balance: number
}

interface CartItem {
  product_id: number
  name: string
  price: number
  qty: number
}

interface DailyStat {
  receipts: number
  total: number
}

// ─── Допоміжні ────────────────────────────────────────────────────────────────

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

function fmt(n: number): string {
  return n.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// ─── Numpad Modal ─────────────────────────────────────────────────────────────

interface NumpadProps {
  total: number
  onConfirm: (cash: number) => void
  onCancel: () => void
}

function NumpadModal({ total, onConfirm, onCancel }: NumpadProps) {
  const [input, setInput] = useState('')

  const cash = parseFloat(input || '0') || 0
  const change = cash >= total ? cash - total : null

  function pressKey(k: string) {
    if (k === '←') {
      setInput(v => v.slice(0, -1))
    } else if (k === 'C') {
      setInput('')
    } else if (k === '00') {
      setInput(v => (v === '' ? '' : v + '00'))
    } else if (k === '.') {
      if (!input.includes('.')) setInput(v => (v || '0') + '.')
    } else {
      // Обмежуємо до 2 знаків після крапки
      if (input.includes('.') && input.split('.')[1]?.length >= 2) return
      setInput(v => v + k)
    }
  }

  const keys = ['7','8','9','←', '4','5','6','C', '1','2','3','', '0','.','00','']

  return (
    <div className={css.overlay}>
      <div className={css.payModal}>
        <div className={css.payModalTitle}>До оплати</div>
        <div className={css.payModalTotal}>{fmt(total)} грн</div>

        <input
          className={css.payInput}
          readOnly
          value={input}
          placeholder="0.00"
        />

        <div className={css.numpad}>
          {keys.map((k, i) => (
            k === '' ? <div key={i} /> :
            <button
              key={i}
              className={`${css.numKey} ${(k === '←' || k === 'C') ? css.numKeyAction : ''}`}
              onClick={() => pressKey(k)}
            >
              {k}
            </button>
          ))}
        </div>

        <div className={css.payChange}>
          {change != null ? `Решта: ${fmt(change)} грн` : ''}
        </div>

        <div className={css.payModalButtons}>
          <button className={css.cancelBtn} onClick={onCancel}>Назад</button>
          <button
            className={css.confirmBtn}
            disabled={cash < total}
            onClick={() => cash >= total && onConfirm(cash)}
          >
            ПІДТВЕРДИТИ
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function PosPage() {
  const { user, permissions, logout, loading: authLoading } = useAuth()
  const navigate = useNavigate()

  const [shops, setShops]           = useState<ShopClient[]>([])
  const [shopId, setShopId]         = useState<number | null>(null)
  const [products, setProducts]     = useState<PosProduct[]>([])
  const [cart, setCart]             = useState<CartItem[]>([])
  const [flashIds, setFlashIds]     = useState<Set<number>>(new Set())
  const [collapsed, setCollapsed]   = useState<Set<string>>(new Set())
  const [showPay, setShowPay]       = useState(false)
  const [successAmt, setSuccessAmt] = useState<number | null>(null)
  const [dailyStat, setDailyStat]   = useState<DailyStat>({ receipts: 0, total: 0 })
  const [loading, setLoading]       = useState(true)
  const flashTimers                 = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  const today = todayStr()

  // Перевірка доступу (чекаємо поки AuthContext завершить відновлення сесії)
  useEffect(() => {
    if (authLoading) return
    if (!user) { navigate('/'); return }
    // seller: маршрут захищений в AppRoutes (тільки /pos доступний), перевірка тут зайва
    // і спричиняє нескінченну петлю navigate('/') → AppRoutes redirect → /pos → repeat
    if (user.role === 'seller') return
    const perms: string[] = (permissions as Record<string, string[]>)[user.role] ?? []
    if (!perms.includes('pos') && user.role !== 'admin') {
      navigate('/')
    }
  }, [authLoading, user, permissions, navigate])

  // Відновлення вибраного магазину
  useEffect(() => {
    const saved = localStorage.getItem('pos_shop_id')
    if (saved) setShopId(Number(saved))
  }, [])

  // Стан груп з localStorage
  useEffect(() => {
    const saved = localStorage.getItem('pos_collapsed_groups')
    if (saved) {
      try { setCollapsed(new Set(JSON.parse(saved))) } catch { /* ignore */ }
    }
  }, [])

  // Завантаження магазинів
  useEffect(() => {
    api.get<{ id: number; name: string; short_name: string | null }[]>('/shop/shops')
      .then(data => {
        const list = data.map(s => ({ id: s.id, name: s.name, short_name: s.short_name ?? undefined }))
        setShops(list)
        if (list.length === 1) {
          setShopId(list[0].id)
          localStorage.setItem('pos_shop_id', String(list[0].id))
        } else if (!shopId && list.length > 1) {
          setShopId(list[0].id)
          localStorage.setItem('pos_shop_id', String(list[0].id))
        }
      })
      .catch(console.error)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Завантаження товарів при зміні магазину
  const loadProducts = useCallback(() => {
    if (!shopId) return
    api.get<PosProduct[]>(`/shop/pos/products?shop_client_id=${shopId}&date=${today}`)
      .then(data => { setProducts(data); setLoading(false) })
      .catch(e => { console.error(e); setLoading(false) })
  }, [shopId, today])

  useEffect(() => { setLoading(true); loadProducts() }, [loadProducts])

  // Щоденна статистика
  const loadDailyStat = useCallback(() => {
    if (!shopId) return
    api.get<{ session_id: string; total: number }[]>(`/shop/sales?shop_client_id=${shopId}&date=${today}`)
      .then(data => {
        setDailyStat({
          receipts: data.length,
          total: data.reduce((s, r) => s + r.total, 0),
        })
      })
      .catch(console.error)
  }, [shopId, today])

  useEffect(() => { loadDailyStat() }, [loadDailyStat])

  // ─── Cart ────────────────────────────────────────────────────────

  function addToCart(prod: PosProduct) {
    if (!prod.price) return
    setCart(prev => {
      const idx = prev.findIndex(i => i.product_id === prod.product_id)
      if (idx >= 0) {
        const updated = [...prev]
        updated[idx] = { ...updated[idx], qty: updated[idx].qty + 1 }
        return updated
      }
      return [...prev, { product_id: prod.product_id, name: prod.short_name || prod.name, price: prod.price!, qty: 1 }]
    })
    // Flash анімація
    if (flashTimers.current.has(prod.product_id)) {
      clearTimeout(flashTimers.current.get(prod.product_id)!)
    }
    setFlashIds(prev => new Set(prev).add(prod.product_id))
    flashTimers.current.set(prod.product_id, setTimeout(() => {
      setFlashIds(prev => { const s = new Set(prev); s.delete(prod.product_id); return s })
    }, 220))
  }

  function changeQty(product_id: number, delta: number) {
    setCart(prev => {
      const updated = prev.map(i =>
        i.product_id === product_id ? { ...i, qty: i.qty + delta } : i
      ).filter(i => i.qty > 0)
      return updated
    })
  }

  function removeFromCart(product_id: number) {
    setCart(prev => prev.filter(i => i.product_id !== product_id))
  }

  const cartTotal = cart.reduce((s, i) => s + i.price * i.qty, 0)

  // ─── Accordion ──────────────────────────────────────────────────

  function toggleGroup(name: string) {
    setCollapsed(prev => {
      const s = new Set(prev)
      if (s.has(name)) s.delete(name); else s.add(name)
      localStorage.setItem('pos_collapsed_groups', JSON.stringify([...s]))
      return s
    })
  }

  // ─── Checkout ───────────────────────────────────────────────────

  async function handleConfirm(_cash: number) {
    if (!shopId || cart.length === 0) return
    setShowPay(false)
    try {
      await api.post('/shop/sales', {
        shop_client_id: shopId,
        sale_date: today,
        lines: cart.map(i => ({ product_id: i.product_id, qty: i.qty, price: i.price })),
      })
      setSuccessAmt(cartTotal)
      setCart([])
      loadProducts()
      loadDailyStat()
      setTimeout(() => setSuccessAmt(null), 1500)
    } catch (e) {
      alert('Помилка збереження продажу')
      console.error(e)
    }
  }

  // ─── Групування товарів ──────────────────────────────────────────

  const groups: { name: string; products: PosProduct[] }[] = []
  const seen = new Set<string>()
  for (const p of products) {
    if (!p.price) continue
    const gName = p.category_name || 'Інше'
    if (!seen.has(gName)) { seen.add(gName); groups.push({ name: gName, products: [] }) }
    groups.find(g => g.name === gName)!.products.push(p)
  }

  const currentShop = shops.find(s => s.id === shopId)

  // ─── Render ──────────────────────────────────────────────────────

  if (!user) return null

  return (
    <div className={css.root}>
      {/* Header */}
      <header className={css.header}>
        {shops.length > 1 ? (
          <select
            className={css.shopSelect}
            value={shopId ?? ''}
            onChange={e => {
              const id = Number(e.target.value)
              setShopId(id)
              localStorage.setItem('pos_shop_id', String(id))
            }}
          >
            {shops.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        ) : (
          <span className={css.headerShop}>🏪 {currentShop?.name ?? 'Магазин'}</span>
        )}
        <span className={css.headerDate}>{new Date().toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' })}</span>
        <span className={css.headerSeller}>👤 {user.full_name || user.username}</span>
        <button className={css.headerLogout} onClick={async () => { await logout(); navigate('/') }}>
          Вийти
        </button>
      </header>

      <div className={css.body}>
        {/* Product accordion */}
        <div className={css.productsPanel}>
          {loading ? (
            <p style={{ padding: '24px', color: '#94a3b8' }}>Завантаження товарів…</p>
          ) : groups.length === 0 ? (
            <p style={{ padding: '24px', color: '#94a3b8' }}>Немає товарів з цінами для цього магазину.</p>
          ) : (
            groups.map(group => {
              const isOpen = !collapsed.has(group.name)
              return (
                <div key={group.name} className={css.group}>
                  <button className={css.groupHeader} onClick={() => toggleGroup(group.name)}>
                    <span className={`${css.groupArrow} ${isOpen ? css.groupArrowOpen : css.groupArrowClosed}`}>▼</span>
                    <span className={css.groupName}>{group.name}</span>
                    <span className={css.groupCount}>{group.products.length} поз.</span>
                  </button>
                  {isOpen && (
                    <div className={css.productGrid}>
                      {group.products.map(prod => {
                        const inCart = cart.find(i => i.product_id === prod.product_id)
                        const isFlash = flashIds.has(prod.product_id)
                        const isLow = prod.current_balance <= 2
                        return (
                          <div
                            key={prod.product_id}
                            className={[
                              css.productCard,
                              inCart ? css.productCardInCart : '',
                              isFlash ? css.productCardFlash : '',
                            ].join(' ')}
                            onClick={() => addToCart(prod)}
                          >
                            {inCart && <span className={css.cartBadge}>{inCart.qty}</span>}
                            <span className={css.productName}>{prod.short_name || prod.name}</span>
                            <span className={css.productPrice}>{fmt(prod.price!)}</span>
                            <span className={`${css.productBalance} ${isLow ? css.productBalanceLow : ''}`}>
                              залишок: {prod.current_balance} шт
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>

        {/* Cart */}
        <div className={css.cartPanel}>
          <div className={css.cartHeader}>Кошик</div>

          <div className={css.cartItems}>
            {cart.length === 0 ? (
              <div className={css.cartEmpty}>Торкніться товару щоб додати</div>
            ) : (
              cart.map(item => (
                <div key={item.product_id} className={css.cartItem}>
                  <span className={css.cartItemName}>{item.name}</span>
                  <div className={css.cartQtyControls}>
                    <button className={css.qtyBtn} onClick={() => changeQty(item.product_id, -1)}>−</button>
                    <span className={css.qtyValue}>{item.qty}</span>
                    <button className={css.qtyBtn} onClick={() => changeQty(item.product_id, +1)}>+</button>
                  </div>
                  <span className={css.cartItemAmount}>{fmt(item.price * item.qty)}</span>
                  <button className={css.removeBtn} onClick={() => removeFromCart(item.product_id)}>×</button>
                </div>
              ))
            )}
          </div>

          <div className={css.cartFooter}>
            {dailyStat.receipts > 0 && (
              <div className={css.cartDailyStat}>
                Сьогодні: {dailyStat.receipts} чек{dailyStat.receipts > 1 ? 'ів' : ''} · {fmt(dailyStat.total)} грн
              </div>
            )}
            <div className={css.cartTotal}>
              <span className={css.cartTotalLabel}>Разом:</span>
              <span className={css.cartTotalAmount}>{fmt(cartTotal)} грн</span>
            </div>
            <button
              className={css.payBtn}
              disabled={cart.length === 0}
              onClick={() => cart.length > 0 && setShowPay(true)}
            >
              ОПЛАТА
            </button>
            {cart.length > 0 && (
              <button className={css.clearBtn} onClick={() => setCart([])}>
                Очистити кошик
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Payment modal */}
      {showPay && (
        <NumpadModal
          total={cartTotal}
          onConfirm={handleConfirm}
          onCancel={() => setShowPay(false)}
        />
      )}

      {/* Success overlay */}
      {successAmt != null && (
        <div className={css.successOverlay}>
          <span className={css.successIcon}>✓</span>
          <span className={css.successAmount}>{fmt(successAmt)} грн</span>
          <span className={css.successLabel}>Продано</span>
        </div>
      )}
    </div>
  )
}
