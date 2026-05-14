import { useEffect, useRef, useState, type FormEvent } from 'react'
import { api } from '../../api/client'
import Modal from '../../components/Modal'
import formStyles from '../../components/Form.module.css'
import { useToast } from '../../components/Toast'
import PriceGantt, { type GanttRow, type GanttPriceSegment } from '../../components/PriceGantt'
import type { Category, Client, ClientPriceOverride, Price, Product } from '../../types'
import { addBtnStyle, tableStyle } from './shared'

interface BulkPreviewItem {
  product_id:     number
  product_name:   string
  old_price:      number
  new_price:      number
  valid_from:     string
  has_collision:  boolean
  collision_date: string | null
}

const round2 = (v: number) => Math.round(v * 100) / 100

/** Чекбокс що підтримує indeterminate (три стани) */
function IndeterminateCheckbox({ checked, indeterminate, onChange }: {
  checked: boolean; indeterminate: boolean; onChange: (v: boolean) => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { if (ref.current) ref.current.indeterminate = indeterminate }, [indeterminate])
  return <input type="checkbox" ref={ref} checked={checked}
    onChange={e => onChange(e.target.checked)} />
}

/** Рядок у переробленому BulkChangeModal */
interface BulkRow extends BulkPreviewItem {
  checked:       boolean
  locked:        boolean
  manual_price:  string
  category_id:   number | null
  category_name: string
}

export default function PricesTab({ products, clients, categories }: {
  products:   Product[]
  clients:    Client[]
  categories: Category[]
}) {
  const toast = useToast()
  const today    = new Date().toISOString().slice(0, 10)
  const tomorrow = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10) })()

  type InnerTab = 'base' | 'overrides'
  const [innerTab, setInnerTab] = useState<InnerTab>('base')

  // ── Базові ціни ──
  const [prices,    setPrices]    = useState<Price[]>([])
  const [editPrice, setEditPrice] = useState<Price | null>(null)
  const [newModal,  setNewModal]  = useState(false)
  const [bulkModal, setBulkModal] = useState(false)
  const [newForm, setNewForm]     = useState({ product_id: '', price: '', valid_from: today })
  const [editForm, setEditForm]   = useState({ price: '', effective_date: tomorrow })
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  // Timeframe для Gantt — за замовчуванням: -1 місяць … +1 місяць
  const defaultTimeFrom = (() => {
    const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 10)
  })()
  const defaultTimeTo = (() => {
    const d = new Date(); d.setMonth(d.getMonth() + 1); return d.toISOString().slice(0, 10)
  })()
  const [timeFrom, setTimeFrom] = useState(defaultTimeFrom)
  const [timeTo,   setTimeTo]   = useState(defaultTimeTo)
  // Авто-розширення timeTo при першому завантаженні: якщо є ціни далі за timeTo
  const pricesAutoExtended = useRef(false)
  useEffect(() => {
    if (prices.length === 0 || pricesAutoExtended.current) return
    pricesAutoExtended.current = true
    const maxDate = prices.reduce((m, p) => p.valid_from > m ? p.valid_from : m, '')
    if (!maxDate || maxDate <= today) return
    const d = new Date(maxDate); d.setDate(d.getDate() + 14)
    const smartTo = d.toISOString().slice(0, 10)
    setTimeTo(prev => smartTo > prev ? smartTo : prev)
  }, [prices]) // eslint-disable-line

  // ── Масова зміна (новий стан) ──
  const [bulkDate, setBulkDate]   = useState(tomorrow)
  const [bulkPct,  setBulkPct]    = useState('')
  const [bulkRows, setBulkRows]   = useState<BulkRow[]>([])
  const [bulkLoading, setBulkLoading] = useState(false)

  // ── Індивідуальні ──
  const [overrides,        setOverrides]        = useState<ClientPriceOverride[]>([])
  const [overrideModal,    setOverrideModal]    = useState(false)
  const [expandedClient,   setExpandedClient]   = useState<number | null>(null)
  const [ovTimeFrom,       setOvTimeFrom]       = useState(defaultTimeFrom)
  const [ovTimeTo,         setOvTimeTo]         = useState(defaultTimeTo)
  const ovAutoExtended = useRef(false)
  useEffect(() => {
    if (overrides.length === 0 || ovAutoExtended.current) return
    ovAutoExtended.current = true
    const maxDate = overrides.reduce((m, p) => p.valid_from > m ? p.valid_from : m, '')
    if (!maxDate || maxDate <= today) return
    const d = new Date(maxDate); d.setDate(d.getDate() + 14)
    const smartTo = d.toISOString().slice(0, 10)
    setOvTimeTo(prev => smartTo > prev ? smartTo : prev)
  }, [overrides]) // eslint-disable-line
  const [ovModalClient,    setOvModalClient]    = useState('')
  const [ovModalValidFrom, setOvModalValidFrom] = useState(tomorrow)
  const [ovModalValidTo,   setOvModalValidTo]   = useState('')
  type OvRow = { product_id: number; product_name: string; base_price: number | null; cur_override: ClientPriceOverride | null; new_price: string }
  const [ovModalRows,      setOvModalRows]      = useState<OvRow[]>([])

  const loadPrices    = () => api.get<Price[]>('/prices/?active_only=false').then(setPrices)
  const loadOverrides = () => api.get<ClientPriceOverride[]>('/prices/overrides').then(setOverrides)

  useEffect(() => { loadPrices() }, [])
  useEffect(() => { if (innerTab === 'overrides') loadOverrides() }, [innerTab]) // eslint-disable-line

  const pName = (id: number) => products.find(p => p.id === id)?.name ?? `#${id}`
  const cName = (id: number) => {
    const c = clients.find(c => c.id === id)
    return c ? (c.short_name ?? c.full_name) : `#${id}`
  }

  // Поточна ціна для кожного продукту (активна, найновіша)
  const currentPriceMap = new Map<number, Price>()
  for (const p of prices) {
    if (p.is_active && !currentPriceMap.has(p.product_id)) currentPriceMap.set(p.product_id, p)
  }

  // Продукти без поточної ціни
  const productsWithoutPrice = products.filter(
    p => p.is_active && !currentPriceMap.has(p.id)
  )

  /**
   * Для відображення: якщо сегмент має valid_to=null, але наступний сегмент вже починається —
   * обрізаємо відображення до (next.valid_from - 1 день). БД не змінюється.
   */
  const trimSegments = (segs: GanttPriceSegment[]): GanttPriceSegment[] => {
    const sorted = [...segs].sort((a, b) => a.valid_from.localeCompare(b.valid_from))
    return sorted.map((seg, i) => {
      if (seg.valid_to !== null) return seg
      const next = sorted[i + 1]
      if (!next) return seg
      const d = new Date(next.valid_from)
      d.setDate(d.getDate() - 1)
      return { ...seg, valid_to: d.toISOString().slice(0, 10) }
    })
  }

  // ── Gantt rows (base prices) ────────────────────────────────────────────────
  const ganttRows: GanttRow[] = (() => {
    const rowMap = new Map<number, { product_name: string; prices: GanttPriceSegment[] }>()
    for (const p of prices) {
      if (!rowMap.has(p.product_id)) {
        rowMap.set(p.product_id, { product_name: pName(p.product_id), prices: [] })
      }
      rowMap.get(p.product_id)!.prices.push({
        price_id:   p.id,
        price:      p.price,
        valid_from: p.valid_from,
        valid_to:   p.valid_to ?? null,
      })
    }
    return Array.from(rowMap.entries())
      .map(([product_id, { product_name, prices: segs }]) => ({
        product_id, product_name, prices: trimSegments(segs),
      }))
      .sort((a, b) => a.product_name.localeCompare(b.product_name, 'uk'))
  })()

  // Найдавніша дата серед усіх базових цін (нижня межа слайдера)
  const earliestPriceDate = prices.length > 0
    ? prices.reduce((m, p) => p.valid_from < m ? p.valid_from : m, prices[0].valid_from)
    : undefined

  // Найдавніша дата серед усіх індивідуальних цін
  const earliestOvDate = overrides.length > 0
    ? overrides.reduce((m, o) => o.valid_from < m ? o.valid_from : m, overrides[0].valid_from)
    : undefined

  // ── Редагування — замінює ціну ──────────────────────────────────────────────
  const openEdit = (priceId: number) => {
    const p = prices.find(x => x.id === priceId)
    if (!p) return
    setEditPrice(p)
    setEditForm({ price: String(p.price), effective_date: tomorrow })
  }
  const submitEdit = async (e: FormEvent) => {
    e.preventDefault()
    if (!editPrice) return
    setSaving(true); setError('')
    try {
      await api.post('/prices/replace', {
        old_price_id:   editPrice.id,
        price:          Number(editForm.price),
        effective_date: editForm.effective_date,
      })
      setEditPrice(null)
      await loadPrices()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg.match(/"detail":"([^"]+)"/)?.[1] ?? msg)
    } finally { setSaving(false) }
  }

  // ── Нова ціна (для продукту без ціни) ──────────────────────────────────────
  const submitNew = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true); setError('')
    try {
      await api.post('/prices/', {
        product_id: Number(newForm.product_id),
        price:      Number(newForm.price),
        valid_from: newForm.valid_from,
      })
      setNewModal(false)
      await loadPrices()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg.match(/"detail":"([^"]+)"/)?.[1] ?? msg)
    } finally { setSaving(false) }
  }

  // ── Деактивувати ціну (тільки майбутні) ────────────────────────────────────
  const deactivate = async (priceId: number) => {
    const p = prices.find(x => x.id === priceId)
    if (!p) return
    if (p.valid_from <= today) {
      toast.warning('Не можна видалити поточну або минулу ціну')
      return
    }
    if (!confirm('Видалити цю майбутню ціну?')) return
    try {
      await api.delete(`/prices/${priceId}`)
      await loadPrices()
    } catch (err) {
      toast.error(String(err))
    }
  }

  // ── Масова зміна — завантажити попередній перегляд ─────────────────────────
  const loadBulkPreview = async (pct: string, date: string) => {
    if (!pct || !date) { setBulkRows([]); return }
    setBulkLoading(true)
    try {
      const data = await api.get<{ items: BulkPreviewItem[] }>(
        `/prices/bulk-preview?pct=${pct}&effective_date=${date}`
      )
      setBulkRows(data.items.map(item => {
        const prod = products.find(p => p.id === item.product_id)
        const cat  = categories.find(c => c.id === prod?.category_id)
        return {
          ...item,
          checked:       true,
          locked:        false,
          manual_price:  item.new_price.toFixed(2),
          category_id:   prod?.category_id ?? null,
          category_name: cat?.name ?? 'Інше',
        }
      }))
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg.match(/"detail":"([^"]+)"/)?.[1] ?? msg)
    } finally { setBulkLoading(false) }
  }
  useEffect(() => { if (bulkModal) loadBulkPreview(bulkPct, bulkDate) }, [bulkPct, bulkDate, bulkModal]) // eslint-disable-line

  // Оновити нову ціну в рядку через глобальний % (для незаблокованих)
  const recalcUnlocked = (pct: string) => {
    const p = parseFloat(pct)
    if (isNaN(p)) return
    setBulkRows(prev => prev.map(r =>
      r.locked ? r : { ...r, new_price: round2(r.old_price * (1 + p / 100)), manual_price: round2(r.old_price * (1 + p / 100)).toFixed(2) }
    ))
  }

  // Підтвердити масову зміну
  const submitBulk = async () => {
    const checkedRows = bulkRows.filter(r => r.checked)
    if (checkedRows.length === 0) return
    const hasCollision = checkedRows.some(r => r.has_collision)
    if (hasCollision && !confirm('Деякі вироби мають колізію цін. Продовжити?')) return
    setSaving(true); setError('')
    try {
      // 1. Незаблоковані рядки → bulk-change
      const unlockedChecked  = checkedRows.filter(r => !r.locked)
      const lockedChecked    = checkedRows.filter(r =>  r.locked)
      const excludedIds: number[] = bulkRows
        .filter(r => !r.checked || r.locked)
        .map(r => r.product_id)

      if (unlockedChecked.length > 0) {
        await api.post('/prices/bulk-change', {
          pct:                  parseFloat(bulkPct) || 0,
          effective_date:       bulkDate,
          excluded_product_ids: excludedIds,
        })
      }

      // 2. Заблоковані рядки → replace (по одному)
      for (const row of lockedChecked) {
        const currentPrice = currentPriceMap.get(row.product_id)
        if (!currentPrice) continue
        await api.post('/prices/replace', {
          old_price_id:   currentPrice.id,
          price:          parseFloat(row.manual_price) || row.new_price,
          effective_date: bulkDate,
        })
      }

      setBulkModal(false)
      await loadPrices()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg.match(/"detail":"([^"]+)"/)?.[1] ?? msg)
    } finally { setSaving(false) }
  }

  // ── Індивідуальні ціни ──────────────────────────────────────────────────────
  const populateOvRows = (clientId: string) => {
    const cid = clientId ? Number(clientId) : null
    const activeOverrideMap = new Map<number, ClientPriceOverride>()
    if (cid) {
      for (const o of overrides) {
        if (o.client_id === cid && o.valid_from <= today && (o.valid_to === null || o.valid_to >= today)) {
          if (!activeOverrideMap.has(o.product_id)) activeOverrideMap.set(o.product_id, o)
        }
      }
    }
    setOvModalRows(
      products
        .filter(p => p.is_active)
        .sort((a, b) => a.name.localeCompare(b.name, 'uk'))
        .map(p => ({
          product_id:   p.id,
          product_name: p.name,
          base_price:   currentPriceMap.get(p.id)?.price ?? null,
          cur_override: cid ? (activeOverrideMap.get(p.id) ?? null) : null,
          new_price:    '',
        }))
    )
  }

  const openOverrideModal = (presetClientId = '') => {
    setOvModalClient(presetClientId)
    setOvModalValidFrom(tomorrow)
    setOvModalValidTo('')
    setError('')
    populateOvRows(presetClientId)
    setOverrideModal(true)
  }

  const submitBulkOverride = async (e: FormEvent) => {
    e.preventDefault()
    const toCreate = ovModalRows.filter(r => r.new_price !== '' && parseFloat(r.new_price) > 0)
    if (toCreate.length === 0) return
    setSaving(true); setError('')
    try {
      for (const row of toCreate) {
        await api.post('/prices/overrides', {
          client_id:  Number(ovModalClient),
          product_id: row.product_id,
          price:      parseFloat(row.new_price),
          valid_from: ovModalValidFrom,
          valid_to:   ovModalValidTo || null,
        })
      }
      setOverrideModal(false)
      await loadOverrides()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg.match(/"detail":"([^"]+)"/)?.[1] ?? msg)
    } finally { setSaving(false) }
  }

  const deleteOverride = async (id: number) => {
    const o = overrides.find(x => x.id === id)
    if (!o) return
    if (o.valid_from <= today) {
      toast.warning('Не можна видалити поточну або минулу індивідуальну ціну')
      return
    }
    if (!confirm('Видалити індивідуальну ціну?')) return
    await api.delete(`/prices/overrides/${id}`)
    loadOverrides()
  }

  // ── Редагування одного запису індивідуальної ціни ──
  const [ovEditId,   setOvEditId]   = useState<number | null>(null)
  const [ovEditForm, setOvEditForm] = useState({ price: '', valid_to: '' })

  const openOvEdit = (priceId: number) => {
    const o = overrides.find(x => x.id === priceId)
    if (!o) return
    setOvEditForm({ price: String(o.price), valid_to: o.valid_to ?? '' })
    setOvEditId(priceId)
  }

  const submitOvEdit = async () => {
    const o = overrides.find(x => x.id === ovEditId)
    if (!o) return
    const newPrice = parseFloat(ovEditForm.price)
    if (isNaN(newPrice) || newPrice <= 0) { toast.warning('Введіть коректну ціну'); return }
    setSaving(true)
    try {
      await api.delete(`/prices/overrides/${o.id}`)
      await api.post('/prices/overrides', {
        client_id:  o.client_id,
        product_id: o.product_id,
        price:      newPrice,
        valid_from: o.valid_from,
        valid_to:   ovEditForm.valid_to || null,
      })
      setOvEditId(null)
      loadOverrides()
    } finally { setSaving(false) }
  }

  const tabBtn = (t: InnerTab, label: string) => (
    <button
      onClick={() => setInnerTab(t)}
      style={{
        padding: '6px 16px', border: 'none', cursor: 'pointer', fontSize: 13,
        background: innerTab === t ? '#1565c0' : '#e8eef5',
        color: innerTab === t ? '#fff' : '#333',
        borderRadius: 4, fontWeight: innerTab === t ? 600 : 400,
      }}
    >{label}</button>
  )

  /**
   * Швидкий вибір тимфрейму: рухає ТІЛЬКИ ліву межу (timeFrom).
   * Права межа (timeTo) залишається фіксованою = today+1m або дата майбутньої ціни+1m.
   */
  const quickRange = (backMonths: number, setFrom: (v: string) => void) => {
    const d = new Date(today)
    d.setMonth(d.getMonth() - backMonths)
    setFrom(d.toISOString().slice(0, 10))
  }

  // Кількість місяців між двома ISO датами
  const monthsBetween = (a: string, b: string) => {
    const da = new Date(a), db = new Date(b)
    return (db.getFullYear() - da.getFullYear()) * 12 + db.getMonth() - da.getMonth()
  }

  const QUICK_PRESETS = [
    { label: '2 міс',  back: 1  },
    { label: '4 міс',  back: 3  },
    { label: '6 міс',  back: 5  },
    { label: '1 рік',  back: 11 },
    { label: '2 роки', back: 23 },
  ]

  /**
   * Панель вибору часового діапазону.
   * earliestDate — найдавніша дата в даних (нижня межа слайдера).
   */
  const timeframeBar = (
    from: string, setFrom: (v: string) => void,
    to:   string, setTo:   (v: string) => void,
    earliestDate?: string,
  ) => {
    const earliest = earliestDate ?? from
    // Скільки місяців від найдавнішої дати до сьогодні (макс. діапазон слайдера)
    const maxSlider = Math.max(2, monthsBetween(earliest, today))
    // Поточне значення слайдера = скільки місяців від earliest до from
    const sliderVal = Math.min(maxSlider, Math.max(0, monthsBetween(earliest, from)))

    return (
      <div style={{ marginBottom: 12 }}>
        {/* Рядок з датами + кнопки */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
          <span style={{ fontSize: 13, color: '#64748b' }}>Період:</span>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)}
            style={{ fontSize: 13, padding: '3px 8px', border: '1px solid #cbd5e1', borderRadius: 6 }} />
          <span style={{ color: '#94a3b8' }}>—</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)}
            style={{ fontSize: 13, padding: '3px 8px', border: '1px solid #cbd5e1', borderRadius: 6 }} />
          {QUICK_PRESETS.map(({ label, back }) => (
            <button key={label} onClick={() => quickRange(back, setFrom)}
              style={{ fontSize: 12, padding: '3px 10px', border: '1px solid #cbd5e1', borderRadius: 6,
                background: '#f8fafc', cursor: 'pointer' }}>
              {label}
            </button>
          ))}
        </div>
        {/* Слайдер глибини історії — заповнення показує ВИДИМИЙ діапазон (від value до max) */}
        {earliestDate && maxSlider > 1 && (
          <>
            <style>{`
              .pgRevRange { -webkit-appearance: none; appearance: none; height: 6px; border-radius: 4px; outline: none; padding: 0; margin: 0; }
              .pgRevRange::-webkit-slider-runnable-track { height: 6px; border-radius: 4px; background: transparent; }
              .pgRevRange::-moz-range-track { height: 6px; border-radius: 4px; background: transparent; }
              .pgRevRange::-webkit-slider-thumb { -webkit-appearance: none; width: 16px; height: 16px; border-radius: 50%; background: #2563eb; cursor: pointer; border: 2px solid #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.25); margin-top: -5px; }
              .pgRevRange::-moz-range-thumb { width: 14px; height: 14px; border-radius: 50%; background: #2563eb; cursor: pointer; border: 2px solid #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.25); }
            `}</style>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, color: '#94a3b8', minWidth: 52, textAlign: 'right' }}>
                {earliest.slice(0, 7)}
              </span>
              <input
                type="range"
                min={0}
                max={maxSlider}
                value={sliderVal}
                onChange={e => {
                  const v = Number(e.target.value)
                  const d = new Date(earliest)
                  d.setMonth(d.getMonth() + v)
                  setFrom(d.toISOString().slice(0, 10))
                }}
                className="pgRevRange"
                style={{
                  flex: 1,
                  cursor: 'pointer',
                  background: (() => {
                    const pct = maxSlider > 0 ? (sliderVal / maxSlider) * 100 : 0
                    return `linear-gradient(to right, #e5e7eb 0%, #e5e7eb ${pct}%, #2563eb ${pct}%, #2563eb 100%)`
                  })(),
                }}
              />
              <span style={{ fontSize: 11, color: '#94a3b8', minWidth: 52 }}>
                {today.slice(0, 7)}
              </span>
              <span style={{ fontSize: 11, color: '#2563eb', minWidth: 56, fontWeight: 500 }}>
                ↤ {from.slice(0, 7)}
              </span>
            </div>
          </>
        )}
      </div>
    )
  }

  return (
    <section>
      <div style={{ position: 'sticky', top: 0, zIndex: 10, background: 'white', paddingBottom: 4 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {tabBtn('base', 'Базові ціни')}
          {tabBtn('overrides', 'Індивідуальні ціни клієнтів')}
        </div>

        {/* ── Базові ціни — контролери ── */}
        {innerTab === 'base' && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, flexWrap: 'wrap', gap: 8 }}>
              <strong style={{ fontSize: 14 }}>
                Ціни ({ganttRows.length} виробів)
                {productsWithoutPrice.length > 0 && (
                  <span style={{ color: '#e67e22', fontWeight: 400, marginLeft: 8 }}>
                    ⚠ {productsWithoutPrice.length} без ціни
                  </span>
                )}
              </strong>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => { setBulkModal(true); setError('') }}
                  style={{ ...addBtnStyle, background: '#e67e22' }}>
                  % Масова зміна
                </button>
                <button onClick={() => { setNewModal(true); setError('') }} style={addBtnStyle}>
                  + Нова ціна
                </button>
              </div>
            </div>

            {timeframeBar(timeFrom, setTimeFrom, timeTo, setTimeTo, earliestPriceDate)}
          </>
        )}

        {/* ── Індивідуальні ціни — контролери ── */}
        {innerTab === 'overrides' && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
            <button onClick={() => openOverrideModal()} style={addBtnStyle}>
              + Встановити індивідуальні ціни
            </button>
          </div>
        )}
      </div>

      {/* ── Базові ціни — список ── */}
      {innerTab === 'base' && (
        <>
          <PriceGantt
            rows={ganttRows}
            timeFrom={timeFrom}
            timeTo={timeTo}
            today={today}
            onEdit={openEdit}
            onDelete={deactivate}
          />

          {/* Модал редагування */}
          {editPrice && (
            <Modal title={`Змінити ціну: ${pName(editPrice.product_id)}`} onClose={() => { setEditPrice(null); setError('') }}>
              <form onSubmit={submitEdit} className={formStyles.form}>
                <div className={formStyles.field}>
                  <label>Поточна ціна</label>
                  <input type="text" readOnly value={`${editPrice.price.toFixed(2)} грн`}
                    style={{ background: '#f0f0f0' }} />
                </div>
                <div className={formStyles.field}>
                  <label>Нова ціна, грн *</label>
                  <input required type="number" min="0.01" step="0.01" autoFocus
                    value={editForm.price}
                    onChange={e => setEditForm({ ...editForm, price: e.target.value })} />
                </div>
                <div className={formStyles.field}>
                  <label>Діє з (дата набуття чинності) *</label>
                  <input required type="date" min={tomorrow} value={editForm.effective_date}
                    onChange={e => setEditForm({ ...editForm, effective_date: e.target.value })} />
                  <span className={formStyles.hint}>
                    Мінімум завтра. Стара ціна діятиме до {editForm.effective_date
                      ? new Date(new Date(editForm.effective_date).getTime() - 86400000)
                          .toISOString().slice(0, 10)
                      : '…'}
                  </span>
                </div>
                {error && <p style={{ color: '#c0392b', margin: '0 0 .5rem' }}>{error}</p>}
                <div className={formStyles.actions}>
                  <button type="button" onClick={() => { setEditPrice(null); setError('') }} className={formStyles.btnSecondary}>
                    Скасувати
                  </button>
                  <button type="submit" disabled={saving} className={formStyles.btnPrimary}>
                    {saving ? 'Збереження...' : 'Зберегти'}
                  </button>
                </div>
              </form>
            </Modal>
          )}

          {/* Модал нової ціни */}
          {newModal && (
            <Modal title="Нова ціна" onClose={() => { setNewModal(false); setError('') }}>
              <form onSubmit={submitNew} className={formStyles.form}>
                {error && <p style={{ color: '#c0392b', margin: '0 0 .5rem' }}>{error}</p>}
                <div className={formStyles.field}>
                  <label>Виріб *</label>
                  <select required value={newForm.product_id}
                    onChange={e => setNewForm({ ...newForm, product_id: e.target.value })}>
                    <option value="">— оберіть виріб —</option>
                    {products.filter(p => p.is_active).map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                {(() => {
                  if (!newForm.product_id) return null
                  const currentPrice = prices
                    .filter(p => p.product_id === Number(newForm.product_id) && p.valid_from <= today && p.is_active)
                    .sort((a, b) => b.valid_from.localeCompare(a.valid_from))[0]
                  if (!currentPrice) return (
                    <p style={{ margin: '-4px 0 8px', fontSize: 13, color: '#64748b' }}>
                      Поточна ціна: <em>не встановлена</em>
                    </p>
                  )
                  const newVal = parseFloat(newForm.price)
                  const pct = !isNaN(newVal) && newVal > 0 && currentPrice.price > 0
                    ? ((newVal - currentPrice.price) / currentPrice.price * 100)
                    : null
                  return (
                    <p style={{ margin: '-4px 0 8px', fontSize: 13, color: '#64748b' }}>
                      Поточна ціна: <strong style={{ color: '#1e293b' }}>{currentPrice.price.toFixed(2)} ₴</strong>
                      {pct !== null && (
                        <span style={{
                          marginLeft: 10, fontWeight: 600,
                          color: pct > 0 ? '#16a34a' : pct < 0 ? '#dc2626' : '#64748b',
                        }}>
                          {pct > 0 ? '+' : ''}{pct.toFixed(1)}%
                        </span>
                      )}
                    </p>
                  )
                })()}
                <div className={formStyles.field}>
                  <label>Ціна, грн *</label>
                  <input required type="number" min="0.01" step="0.01"
                    value={newForm.price}
                    onChange={e => setNewForm({ ...newForm, price: e.target.value })}
                    placeholder="0.00" />
                </div>
                <div className={formStyles.field}>
                  <label>Діє з *</label>
                  <input required type="date" value={newForm.valid_from}
                    onChange={e => setNewForm({ ...newForm, valid_from: e.target.value })} />
                </div>
                <div className={formStyles.actions}>
                  <button type="button" onClick={() => { setNewModal(false); setError('') }} className={formStyles.btnSecondary}>
                    Скасувати
                  </button>
                  <button type="submit" disabled={saving} className={formStyles.btnPrimary}>
                    {saving ? 'Збереження...' : 'Зберегти'}
                  </button>
                </div>
              </form>
            </Modal>
          )}

          {/* ── Модал масової зміни (перероблений) ── */}
          {bulkModal && (() => {
            // Групуємо рядки за категорією
            const groupOrder: string[] = []
            const groupMap = new Map<string, BulkRow[]>()
            for (const row of bulkRows) {
              if (!groupMap.has(row.category_name)) {
                groupOrder.push(row.category_name)
                groupMap.set(row.category_name, [])
              }
              groupMap.get(row.category_name)!.push(row)
            }

            const checkedRows  = bulkRows.filter(r => r.checked)
            const allChecked   = bulkRows.length > 0 && bulkRows.every(r => r.checked)
            const anyChecked   = bulkRows.some(r => r.checked)

            // Аналітика
            const avgPct = checkedRows.length > 0
              ? checkedRows.reduce((acc, r) => {
                  const p = r.old_price > 0 ? (parseFloat(r.manual_price) - r.old_price) / r.old_price * 100 : 0
                  return acc + p
                }, 0) / checkedRows.length
              : 0
            const newPrices = checkedRows.map(r => parseFloat(r.manual_price)).filter(v => !isNaN(v))
            const minNew = newPrices.length ? Math.min(...newPrices) : 0
            const maxNew = newPrices.length ? Math.max(...newPrices) : 0
            const totalDelta = checkedRows.reduce((acc, r) =>
              acc + ((parseFloat(r.manual_price) || 0) - r.old_price), 0)

            const thStyle: React.CSSProperties = {
              padding: '0.35rem 0.6rem', textAlign: 'left', fontSize: 13,
              background: '#f8fafc', fontWeight: 600, color: '#475569',
              position: 'sticky', top: 0, zIndex: 1,
              borderBottom: '2px solid #e2e8f0',
            }
            const td = { padding: '0.3rem 0.55rem', borderBottom: '1px solid #f0f0f0', fontSize: 13 }

            return (
              <Modal title="Масова зміна цін" wide onClose={() => { setBulkModal(false); setError(''); setBulkRows([]) }}>
                {/* ── Рядок параметрів ── */}
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
                  <div>
                    <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 3 }}>Дата набуття чинності</label>
                    <input type="date" min={tomorrow} value={bulkDate}
                      onChange={e => setBulkDate(e.target.value)}
                      style={{ padding: '5px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 14 }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 3 }}>Зміна, %</label>
                    <input type="number" step="0.1" value={bulkPct} placeholder="+5 або -10"
                      onChange={e => { setBulkPct(e.target.value); recalcUnlocked(e.target.value) }}
                      style={{ padding: '5px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 14, width: 110 }} />
                  </div>
                  {bulkLoading && <div style={{ fontSize: 13, color: '#94a3b8', alignSelf: 'center' }}>Завантаження...</div>}
                </div>

                {/* ── Аналітика ── */}
                {checkedRows.length > 0 && (
                  <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', background: '#f0f9ff',
                    border: '1px solid #bae6fd', borderRadius: 8, padding: '8px 14px',
                    marginBottom: 10, fontSize: 13 }}>
                    <span style={{ color: '#0369a1' }}>
                      <strong>{checkedRows.length}</strong> із {bulkRows.length} виробів
                    </span>
                    <span style={{ color: avgPct >= 0 ? '#16a34a' : '#dc2626' }}>
                      Середня зміна: <strong>{(avgPct >= 0 ? '+' : '') + avgPct.toFixed(1)}%</strong>
                    </span>
                    <span style={{ color: '#475569' }}>
                      Нові ціни: <strong>{minNew.toFixed(2)} – {maxNew.toFixed(2)} ₴</strong>
                    </span>
                    <span style={{ color: totalDelta >= 0 ? '#16a34a' : '#dc2626' }}>
                      Сума змін: <strong>{(totalDelta >= 0 ? '+' : '') + totalDelta.toFixed(2)} ₴</strong>
                    </span>
                  </div>
                )}

                {/* Колізійне попередження */}
                {bulkRows.some(r => r.checked && r.has_collision) && (
                  <div style={{ background: '#fffbeb', border: '1px solid #fbbf24', borderRadius: 8,
                    padding: '8px 12px', fontSize: 13, color: '#92400e', marginBottom: 10 }}>
                    ⚠ {bulkRows.filter(r => r.checked && r.has_collision).length} виробів мають колізію — вже є ціна з цієї або пізнішої дати
                  </div>
                )}

                {error && <p style={{ color: '#c0392b', margin: '0 0 .5rem', fontSize: 13 }}>{error}</p>}

                {/* ── Таблиця (фіксований заголовок, прокрутка тільки body) ── */}
                <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
                  <table style={{ ...tableStyle, margin: 0, tableLayout: 'fixed', width: '100%' }}>
                    <colgroup>
                      <col style={{ width: 32 }} />
                      <col style={{ width: '28%' }} />
                      <col style={{ width: 82 }} />
                      <col style={{ width: 82 }} />
                      <col style={{ width: 118 }} />
                      <col style={{ width: 68 }} />
                    </colgroup>
                    <thead>
                      <tr>
                        {/* "Всі" checkbox */}
                        <th style={{ ...thStyle, width: 32 }}>
                          <IndeterminateCheckbox
                            checked={allChecked}
                            indeterminate={anyChecked && !allChecked}
                            onChange={v => setBulkRows(prev => prev.map(r => ({ ...r, checked: v })))}
                          />
                        </th>
                        <th style={thStyle}>Виріб</th>
                        <th style={thStyle}>Діє з</th>
                        <th style={thStyle}>Стара ціна</th>
                        <th style={thStyle}>Нова ціна</th>
                        <th style={thStyle}>% зміна</th>
                      </tr>
                    </thead>
                  </table>

                  {/* Прокручуваний tbody */}
                  <div style={{ maxHeight: 360, overflowY: 'auto' }}>
                    <table style={{ ...tableStyle, margin: 0, tableLayout: 'fixed', width: '100%' }}>
                      <colgroup>
                        <col style={{ width: 32 }} />
                        <col style={{ width: '28%' }} />
                        <col style={{ width: 82 }} />
                        <col style={{ width: 82 }} />
                        <col style={{ width: 118 }} />
                        <col style={{ width: 68 }} />
                      </colgroup>
                      <tbody>
                        {bulkRows.length === 0 && !bulkLoading && (
                          <tr><td colSpan={6} style={{ textAlign: 'center', padding: '1.5rem', color: '#94a3b8', fontSize: 13 }}>
                            Введіть % і дату щоб побачити попередній перегляд
                          </td></tr>
                        )}
                        {groupOrder.map(groupName => {
                          const rows = groupMap.get(groupName)!
                          const allG = rows.every(r => r.checked)
                          const anyG = rows.some(r => r.checked)
                          return (
                            <>
                              {/* Рядок-заголовок групи */}
                              <tr key={`g-${groupName}`} style={{ background: '#f1f5f9' }}>
                                <td style={{ ...td, padding: '0.25rem 0.5rem' }}>
                                  <IndeterminateCheckbox
                                    checked={allG}
                                    indeterminate={anyG && !allG}
                                    onChange={v => setBulkRows(prev => prev.map(r =>
                                      r.category_name === groupName ? { ...r, checked: v } : r))}
                                  />
                                </td>
                                <td colSpan={5} style={{ ...td, fontWeight: 700, color: '#334155',
                                  fontSize: 12, letterSpacing: '0.04em', textTransform: 'uppercase',
                                  padding: '0.25rem 0.6rem' }}>
                                  {groupName}
                                  <span style={{ fontWeight: 400, color: '#94a3b8', marginLeft: 6 }}>
                                    ({rows.filter(r => r.checked).length}/{rows.length})
                                  </span>
                                </td>
                              </tr>
                              {/* Рядки виробів групи */}
                              {rows.map(row => {
                                const idx = bulkRows.findIndex(r => r.product_id === row.product_id)
                                const pct = row.old_price > 0
                                  ? ((parseFloat(row.manual_price) || row.new_price) - row.old_price) / row.old_price * 100
                                  : 0
                                const pctStr = (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%'
                                const pctColor = pct > 0 ? '#16a34a' : pct < 0 ? '#dc2626' : '#64748b'
                                return (
                                  <tr key={row.product_id}
                                    style={{ background: row.has_collision && row.checked ? '#fffbeb' : undefined,
                                      opacity: row.checked ? 1 : 0.45 }}>
                                    <td style={td}>
                                      <input type="checkbox" checked={row.checked}
                                        onChange={e => setBulkRows(prev => prev.map((r, j) =>
                                          j === idx ? { ...r, checked: e.target.checked } : r))} />
                                    </td>
                                    <td style={{ ...td, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                      {row.product_name}
                                      {row.has_collision && (
                                        <span style={{ color: '#f59e0b', marginLeft: 5 }}
                                          title={`Конфліктна ціна: ${row.collision_date}`}>⚠</span>
                                      )}
                                    </td>
                                    <td style={{ ...td, fontSize: 11, color: '#94a3b8' }}>{row.valid_from}</td>
                                    <td style={td}>{row.old_price.toFixed(2)}</td>
                                    <td style={td}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                                        <input type="number" step="0.01" min="0.01"
                                          value={row.manual_price}
                                          onChange={e => setBulkRows(prev => prev.map((r, j) =>
                                            j === idx ? { ...r, manual_price: e.target.value, locked: true } : r))}
                                          style={{ width: 70, padding: '2px 5px', border: '1px solid #cbd5e1',
                                            borderRadius: 4, fontSize: 13,
                                            background: row.locked ? '#eff6ff' : undefined }} />
                                        {row.locked && (
                                          <button type="button" title="Зняти блокування"
                                            onClick={() => {
                                              const newP = round2(row.old_price * (1 + (parseFloat(bulkPct) || 0) / 100))
                                              setBulkRows(prev => prev.map((r, j) =>
                                                j === idx ? { ...r, locked: false, manual_price: newP.toFixed(2), new_price: newP } : r))
                                            }}
                                            style={{ background: 'none', border: 'none', cursor: 'pointer',
                                              fontSize: 14, color: '#3b82f6', padding: 0, lineHeight: 1 }}>
                                            🔒
                                          </button>
                                        )}
                                      </div>
                                    </td>
                                    <td style={{ ...td, color: pctColor, fontWeight: 600 }}>{pctStr}</td>
                                  </tr>
                                )
                              })}
                            </>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
                  <button type="button" onClick={() => { setBulkModal(false); setBulkRows([]); setError('') }}
                    className={formStyles.btnSecondary}>
                    Скасувати
                  </button>
                  <button type="button"
                    disabled={saving || checkedRows.length === 0}
                    onClick={submitBulk}
                    className={formStyles.btnPrimary}>
                    {saving ? 'Збереження...' : `Підтвердити зміни (${checkedRows.length})`}
                  </button>
                </div>
              </Modal>
            )
          })()}
        </>
      )}

      {/* ── Індивідуальні ціни ── */}
      {innerTab === 'overrides' && (() => {
        // Group overrides by client
        const clientMap = new Map<number, ClientPriceOverride[]>()
        for (const o of overrides) {
          if (!clientMap.has(o.client_id)) clientMap.set(o.client_id, [])
          clientMap.get(o.client_id)!.push(o)
        }
        const sortedClients = Array.from(clientMap.entries())
          .sort(([a], [b]) => cName(a).localeCompare(cName(b), 'uk'))

        return (
          <>

            {sortedClients.length === 0 && (
              <p style={{ color: '#94a3b8', padding: 24, textAlign: 'center' }}>Немає індивідуальних цін</p>
            )}

            {sortedClients.map(([clientId, cOverrides]) => {
              const isExpanded = expandedClient === clientId
              const activeOvs = cOverrides.filter(
                o => o.valid_from <= today && (o.valid_to === null || o.valid_to >= today)
              )
              const activeSum = activeOvs.reduce((s, o) => s + o.price, 0)
              const toggleExpand = () => setExpandedClient(isExpanded ? null : clientId)

              // Будуємо GanttRow[] з індивідуальних цін клієнта
              const productMap = new Map<number, GanttPriceSegment[]>()
              for (const o of cOverrides) {
                if (!productMap.has(o.product_id)) productMap.set(o.product_id, [])
                productMap.get(o.product_id)!.push({
                  price_id: o.id, price: o.price,
                  valid_from: o.valid_from, valid_to: o.valid_to ?? null,
                })
              }
              const ovGanttRows = Array.from(productMap.entries())
                .sort(([a], [b]) => pName(a).localeCompare(pName(b), 'uk'))
                .map(([pid, segs]) => ({
                  product_id: pid,
                  product_name: pName(pid),
                  prices: [...segs].sort((a, b) => a.valid_from.localeCompare(b.valid_from)),
                }))

              return (
                <div key={clientId} style={{ marginBottom: 6, border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
                  <div onClick={toggleExpand} style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px',
                    background: '#f8fafc', cursor: 'pointer', userSelect: 'none',
                    borderBottom: isExpanded ? '1px solid #e2e8f0' : 'none',
                  }}>
                    <span style={{ fontSize: 12, color: '#64748b', width: 12 }}>{isExpanded ? '▼' : '▶'}</span>
                    <strong style={{ flex: 1, fontSize: 14, color: '#1e293b' }}>{cName(clientId)}</strong>
                    <span style={{ fontSize: 12, color: '#64748b' }}>
                      {cOverrides.length} {cOverrides.length === 1 ? 'запис' : cOverrides.length < 5 ? 'записи' : 'записів'}
                    </span>
                    {activeOvs.length > 0 && (
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#16a34a', background: '#f0fdf4', padding: '2px 8px', borderRadius: 4 }}>
                        активних: {activeOvs.length} · {activeSum.toFixed(2)} ₴
                      </span>
                    )}
                    <button
                      onClick={e => { e.stopPropagation(); openOverrideModal(String(clientId)) }}
                      style={{ fontSize: 12, padding: '3px 10px', border: '1px solid #3b82f6', borderRadius: 6, background: 'white', color: '#2563eb', cursor: 'pointer' }}
                    >+ Ціни</button>
                  </div>
                  {isExpanded && (
                    <div style={{ padding: '8px 0 4px' }}>
                      {timeframeBar(ovTimeFrom, setOvTimeFrom, ovTimeTo, setOvTimeTo, earliestOvDate)}
                      <PriceGantt
                        rows={ovGanttRows}
                        timeFrom={ovTimeFrom}
                        timeTo={ovTimeTo}
                        today={today}
                        onEdit={(id) => openOvEdit(id)}
                        onDelete={(id) => deleteOverride(id)}
                      />
                    </div>
                  )}
                </div>
              )
            })}

            {ovEditId !== null && (() => {
              const o = overrides.find(x => x.id === ovEditId)!
              // min для valid_to: max(valid_from + 1 день, завтра)
              const minValidTo = o.valid_from >= tomorrow
                ? (() => { const d = new Date(o.valid_from); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10) })()
                : tomorrow
              return (
                <Modal title={`Редагувати ціну — ${pName(o.product_id)}`} onClose={() => setOvEditId(null)}>
                  <div className={formStyles.form}>
                    <div className={formStyles.field}>
                      <label>Ціна, ₴ *</label>
                      <input type="number" min="0.01" step="0.01" required
                        value={ovEditForm.price}
                        onChange={e => setOvEditForm(f => ({ ...f, price: e.target.value }))} />
                    </div>
                    <div className={formStyles.field}>
                      <label>Діє з</label>
                      <input type="text" disabled value={o.valid_from}
                        style={{ background: '#f8fafc', color: '#64748b' }} />
                    </div>
                    <div className={formStyles.field}>
                      <label>Діє до <span style={{ fontWeight: 400, color: '#94a3b8' }}>(порожньо = безстроково)</span></label>
                      <input type="date" min={minValidTo}
                        value={ovEditForm.valid_to}
                        onChange={e => setOvEditForm(f => ({ ...f, valid_to: e.target.value }))} />
                    </div>
                    <div className={formStyles.actions}>
                      <button type="button" onClick={() => setOvEditId(null)} className={formStyles.btnSecondary}>Скасувати</button>
                      <button type="button" disabled={saving} onClick={submitOvEdit} className={formStyles.btnPrimary}>
                        {saving ? 'Збереження...' : 'Зберегти'}
                      </button>
                    </div>
                  </div>
                </Modal>
              )
            })()}

            {overrideModal && (
              <Modal title="Індивідуальні ціни клієнта" wide onClose={() => { setOverrideModal(false); setError('') }}>
                <form onSubmit={submitBulkOverride} className={formStyles.form}>
                  {error && <p style={{ color: '#c0392b', margin: '0 0 .5rem' }}>{error}</p>}
                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 12, alignItems: 'flex-end' }}>
                    <div className={formStyles.field} style={{ flex: '1 1 200px', minWidth: 180, margin: 0 }}>
                      <label>Клієнт *</label>
                      <select required value={ovModalClient}
                        onChange={e => { setOvModalClient(e.target.value); populateOvRows(e.target.value) }}>
                        <option value="">— оберіть клієнта —</option>
                        {clients.filter(c => c.is_active).map(c => (
                          <option key={c.id} value={c.id}>{c.short_name ?? c.full_name}</option>
                        ))}
                      </select>
                    </div>
                    <div className={formStyles.field} style={{ flex: '0 0 140px', margin: 0 }}>
                      <label>Діє з *</label>
                      <input required type="date" min={tomorrow} value={ovModalValidFrom}
                        onChange={e => {
                          setOvModalValidFrom(e.target.value)
                          if (ovModalValidTo && ovModalValidTo < e.target.value) setOvModalValidTo(e.target.value)
                        }} />
                    </div>
                    <div className={formStyles.field} style={{ flex: '0 0 160px', margin: 0 }}>
                      <label>Діє до <span style={{ fontWeight: 400, color: '#94a3b8' }}>(необов'язково)</span></label>
                      <input type="date" min={ovModalValidFrom || tomorrow} value={ovModalValidTo}
                        onChange={e => setOvModalValidTo(e.target.value)} />
                    </div>
                  </div>

                  {ovModalClient && (
                    <>
                      <div style={{ maxHeight: 420, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 6 }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                          <thead>
                            <tr>
                              {['Виріб', 'Базова ціна', 'Поточна інд. ціна', 'Нова ціна, ₴', '% від бази'].map(h => (
                                <th key={h} style={{
                                  padding: '0.35rem 0.6rem', textAlign: 'left', fontSize: 13,
                                  background: '#f8fafc', fontWeight: 600, color: '#475569',
                                  position: 'sticky', top: 0, zIndex: 1, borderBottom: '2px solid #e2e8f0',
                                }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {ovModalRows.map((row, idx) => {
                              const newVal = parseFloat(row.new_price)
                              const pct = !isNaN(newVal) && newVal > 0 && row.base_price
                                ? ((newVal - row.base_price) / row.base_price * 100) : null
                              return (
                                <tr key={row.product_id} style={{ background: idx % 2 === 0 ? '#fff' : '#fafafa' }}>
                                  <td style={{ padding: '0.3rem 0.55rem', borderBottom: '1px solid #f0f0f0' }}>{row.product_name}</td>
                                  <td style={{ padding: '0.3rem 0.55rem', borderBottom: '1px solid #f0f0f0', color: '#64748b' }}>
                                    {row.base_price !== null ? `${row.base_price.toFixed(2)} ₴` : '—'}
                                  </td>
                                  <td style={{ padding: '0.3rem 0.55rem', borderBottom: '1px solid #f0f0f0', fontWeight: row.cur_override ? 600 : 400, color: row.cur_override ? '#1e293b' : '#94a3b8' }}>
                                    {row.cur_override ? `${row.cur_override.price.toFixed(2)} ₴` : '—'}
                                  </td>
                                  <td style={{ padding: '0.3rem 0.55rem', borderBottom: '1px solid #f0f0f0' }}>
                                    <input type="number" min="0.01" step="0.01" placeholder="не змінювати"
                                      value={row.new_price}
                                      onChange={e => setOvModalRows(prev => prev.map((r, i) =>
                                        i === idx ? { ...r, new_price: e.target.value } : r
                                      ))}
                                      style={{ width: '100%', padding: '3px 6px', border: '1px solid #cbd5e1', borderRadius: 4, fontSize: 13 }}
                                    />
                                  </td>
                                  <td style={{ padding: '0.3rem 0.55rem', borderBottom: '1px solid #f0f0f0', fontWeight: 600,
                                    color: pct === null ? '#94a3b8' : pct > 0 ? '#16a34a' : pct < 0 ? '#dc2626' : '#64748b',
                                  }}>
                                    {pct !== null ? `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%` : '—'}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                      <p style={{ fontSize: 12, color: '#94a3b8', margin: '6px 0 0' }}>
                        Заповніть ціни лише для потрібних виробів. Порожні рядки пропускаються.
                      </p>
                    </>
                  )}

                  <div className={formStyles.actions}>
                    <button type="button" onClick={() => { setOverrideModal(false); setError('') }} className={formStyles.btnSecondary}>
                      Скасувати
                    </button>
                    <button type="submit" disabled={saving || !ovModalClient || ovModalRows.every(r => !r.new_price || parseFloat(r.new_price) <= 0)} className={formStyles.btnPrimary}>
                      {saving ? 'Збереження...' : `Зберегти (${ovModalRows.filter(r => r.new_price !== '' && parseFloat(r.new_price) > 0).length})`}
                    </button>
                  </div>
                </form>
              </Modal>
            )}
          </>
        )
      })()}
    </section>
  )
}
