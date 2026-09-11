/**
 * Баланси Виробів — інтерактивна звірка руху продукції за день.
 * Замовлено/Спечено/Обмін/Магазин — 1:1 з "Денним звітом пекарні" (той самий
 * бекенд-розрахунок), плюс розгортання категорія → виріб → клієнти з
 * деталізацією по накладних і списанню/пайку/іншому.
 */

import { useEffect, useMemo, useState } from 'react'
import { useWorkDate } from '../context/DateContext'
import { fetchProductBalances } from '../api/reports'
import type { ProductBalancesOut, ProductBalanceCategory, ProductBalanceProduct, ProductBalanceClientRow } from '../api/reports'
import { fmt } from '../utils/format'
import HelpTip from '../components/HelpTip'
import styles from './ProductBalancesTab.module.css'

function qty(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}
function qtyOrDash(n: number): string {
  return n ? qty(n) : '—'
}

function otherQty(row: { writeoff_qty: number; ration_qty: number; other_qty: number }): number {
  return row.writeoff_qty + row.ration_qty + row.other_qty
}
function otherSum(row: { writeoff_sum: number; ration_sum: number; other_sum: number }): number {
  return row.writeoff_sum + row.ration_sum + row.other_sum
}

function diffClass(diff: number | null): string {
  if (diff == null || diff === 0) return styles.diffOk
  return diff > 0 ? styles.diffSurplus : styles.diffShortage
}
function diffLabel(diff: number | null): string {
  if (diff == null) return '—'
  if (diff === 0) return '✓'
  return diff > 0 ? `+${qty(diff)}` : qty(diff)
}

const TAG_ICON: Record<string, { icon: string; label: string }> = {
  exchange: { icon: '↔', label: 'Обмін' },
  stale:    { icon: '☾', label: 'Черствий' },
  surplus:  { icon: '⚖', label: 'Надлишок' },
  writeoff: { icon: '🗑', label: 'Списання' },
  ration:   { icon: '🍞', label: 'Пайок' },
  other:    { icon: '🏪', label: 'Інше' },
}

export default function ProductBalancesTab() {
  const { workDate } = useWorkDate()
  const [date, setDate] = useState(workDate)
  const [data, setData] = useState<ProductBalancesOut | null>(null)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [onlyDiff, setOnlyDiff] = useState(false)
  const [openCats, setOpenCats] = useState<Set<number>>(new Set())
  const [openProducts, setOpenProducts] = useState<Set<number>>(new Set())

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    // За замовчуванням усі групи згорнуті — оператор розгортає вручну.
    setOpenCats(new Set())
    setOpenProducts(new Set())
    fetchProductBalances(date)
      .then(d => { if (!cancelled) setData(d) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [date])

  const expandDiffs = () => {
    if (!data) return
    const cats = new Set<number>()
    const prods = new Set<number>()
    for (const cat of data.categories) {
      let catHasDiff = cat.diff_qty != null && cat.diff_qty !== 0
      for (const p of cat.products) {
        if (p.diff_qty != null && p.diff_qty !== 0) {
          prods.add(p.product_id)
          catHasDiff = true
        }
      }
      if (catHasDiff) cats.add(cat.category_id)
    }
    setOpenCats(cats)
    setOpenProducts(prods)
  }

  const toggleCat = (id: number) => setOpenCats(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })
  const toggleProduct = (id: number) => setOpenProducts(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  const filteredCategories = useMemo((): ProductBalanceCategory[] => {
    if (!data) return []
    const q = search.trim().toLowerCase()
    return data.categories
      .map(cat => {
        let products = cat.products
        if (q) products = products.filter(p => p.name.toLowerCase().includes(q))
        if (onlyDiff) products = products.filter(p => p.diff_qty != null && p.diff_qty !== 0)
        return { ...cat, products }
      })
      .filter(cat => cat.products.length > 0)
  }, [data, search, onlyDiff])

  const totals = useMemo(() => {
    return filteredCategories.reduce((acc, cat) => ({
      ordered_qty:  acc.ordered_qty  + cat.ordered_qty,
      baked_qty:    acc.baked_qty    + cat.baked_qty,
      exchange_qty: acc.exchange_qty + cat.exchange_qty,
      shop_qty:     acc.shop_qty     + cat.shop_qty,
      invoiced_qty: acc.invoiced_qty + cat.invoiced_qty,
      invoiced_sum: acc.invoiced_sum + cat.invoiced_sum,
      other_qty:    acc.other_qty    + otherQty(cat),
      other_sum:    acc.other_sum    + otherSum(cat),
    }), { ordered_qty: 0, baked_qty: 0, exchange_qty: 0, shop_qty: 0, invoiced_qty: 0, invoiced_sum: 0, other_qty: 0, other_sum: 0 })
  }, [filteredCategories])

  return (
    <div className={styles.wrap}>
      <div className={styles.filters}>
        <label>
          Дата
          <input type="date" value={date} onChange={e => setDate(e.target.value)} />
        </label>
        <input
          className={styles.searchInput}
          placeholder="Пошук виробу…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <label className={styles.checkboxLabel}>
          <input type="checkbox" checked={onlyDiff} onChange={e => setOnlyDiff(e.target.checked)} />
          Тільки розбіжності
        </label>
        <button type="button" className={styles.expandDiffsBtn} onClick={expandDiffs} disabled={!data}>
          Розгорнути розбіжності
        </button>
        {loading && <span className={styles.loading}>Завантаження…</span>}
      </div>

      <div className={styles.formulaHint}>
        <span className={styles.formulaLabel}>Як перевірити:</span>{' '}
        Спечено <span className={styles.formulaOp}>−</span> Списання/пайок/інше{' '}
        <span className={styles.formulaOp}>=</span> В накладних{' '}
        <span className={styles.formulaMuted}>(якщо Розбіжність = 0)</span>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.thName}>Виріб</th>
              <th className={styles.thNum}>
                Замовлено{' '}
                <HelpTip width={280}>
                  Кількість, яку клієнти замовили на цю дату (вкладка Замовлення).
                  Не включає власні магазини пекарні та системні записи
                  (списання/пайок) — лише реальні клієнтські замовлення.
                </HelpTip>
              </th>
              <th className={styles.thNum}>
                Спечено{' '}
                <HelpTip width={280}>
                  Фактично випечена кількість (вкладка Випічка).
                  <br /><br />
                  Якщо завдання випічки ще не внесено — тимчасово показано
                  значення «Замовлено» як заповнювач (позначка{' '}
                  <span className={styles.estimatedMark}>≈</span>), щоб колонка
                  не була порожньою. Це НЕ реальний факт випічки, і Розбіжність
                  для такого рядка не рахується.
                </HelpTip>
              </th>
              <th className={styles.thNum}>
                Обмін{' '}
                <HelpTip width={260}>
                  Кількість, передана клієнтам безкоштовно в рамках обміну
                  черствого товару на свіжий.
                </HelpTip>
              </th>
              <th className={styles.thNum}>
                Магазин{' '}
                <HelpTip width={280}>
                  Кількість, що пішла у власний магазин пекарні: замовлення
                  магазину плюс надлишок випічки, долитий прямо в його накладну.
                </HelpTip>
              </th>
              <th className={styles.thNum}>
                Списання/пайок/інше{' '}
                <HelpTip width={300}>
                  Товар, що вибув НЕ як продаж клієнту: <strong>списання</strong>{' '}
                  (втрата, брак), <strong>пайок</strong> персоналу, або{' '}
                  <strong>інше</strong> (реалізація чи передача поза стандартною
                  накладною — переважно на рівні магазину).
                  <br /><br />
                  Сума — за собівартістю виробу (крім реалізації, де врахована
                  фактична ціна продажу).
                </HelpTip>
              </th>
              <th className={styles.thNum}>
                В накладних{' '}
                <HelpTip width={280}>
                  Загальна кількість і сума, задокументована в накладних за цю
                  дату — усі типи рядків (звичайний продаж, обмін, черствий
                  товар, надлишок у магазин), по всіх клієнтах разом.
                </HelpTip>
              </th>
              <th className={styles.thNum}>
                Розбіжність{' '}
                <HelpTip width={300}>
                  <strong>Розбіжність = Спечено − (В накладних + Списання + Пайок + Інше)</strong>
                  <br /><br />
                  Показує різницю між тим, скільки виробу фактично спечено, і тим,
                  скільки задокументовано як таке, що пішло з пекарні (накладні,
                  списання, пайок). Додатна — частина випічки ще не задокументована
                  (лишок, помилка). Від'ємна — задокументовано більше ніж спечено
                  (типова причина: дубльований запис).
                  <br /><br />
                  Не рахується, поки для виробу не введено фактичне "Спечено" у
                  вкладці Випічка (позначка «≈» = показано Замовлено як заповнювач).
                </HelpTip>
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredCategories.map(cat => (
              <CategoryBlock
                key={cat.category_id}
                cat={cat}
                open={openCats.has(cat.category_id)}
                onToggle={() => toggleCat(cat.category_id)}
                openProducts={openProducts}
                onToggleProduct={toggleProduct}
              />
            ))}
            {!loading && filteredCategories.length === 0 && (
              <tr><td colSpan={8} className={styles.empty}>Немає даних за обраними фільтрами</td></tr>
            )}
          </tbody>
          {data && filteredCategories.length > 0 && (
            <tfoot>
              <tr className={styles.totalsRow}>
                <td>Разом</td>
                <td className={styles.tdNum}>{qty(totals.ordered_qty)}</td>
                <td className={styles.tdNum}>{qty(totals.baked_qty)}</td>
                <td className={styles.tdNum}>{qtyOrDash(totals.exchange_qty)}</td>
                <td className={styles.tdNum}>{qtyOrDash(totals.shop_qty)}</td>
                <td className={styles.tdNum}>
                  {qty(totals.other_qty)} <span className={styles.sumHint}>· {fmt(totals.other_sum)}</span>
                </td>
                <td className={styles.tdNum}>
                  {qty(totals.invoiced_qty)} <span className={styles.sumHint}>· {fmt(totals.invoiced_sum)}</span>
                </td>
                <td className={styles.tdNum}>—</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}

// ── Рядок категорії + розгорнуті вироби ─────────────────────────────────────

function CategoryBlock({ cat, open, onToggle, openProducts, onToggleProduct }: {
  cat: ProductBalanceCategory
  open: boolean
  onToggle: () => void
  openProducts: Set<number>
  onToggleProduct: (id: number) => void
}) {
  return (
    <>
      <tr className={styles.catRow} onClick={onToggle}>
        <td className={styles.tdName}>
          <span className={styles.expandIcon}>{open ? '▾' : '▸'}</span>
          <strong>{cat.category_name}</strong>
          <span className={styles.countHint}>({cat.products.length})</span>
        </td>
        <td className={styles.tdNum}>{qtyOrDash(cat.ordered_qty)}</td>
        <td className={styles.tdNum}>
          {qtyOrDash(cat.baked_qty)}
          {!cat.baked_entered && <span className={styles.estimatedMark} title="Не всі завдання випічки введено">≈</span>}
        </td>
        <td className={styles.tdNum}>{qtyOrDash(cat.exchange_qty)}</td>
        <td className={styles.tdNum}>{qtyOrDash(cat.shop_qty)}</td>
        <td className={styles.tdNum}>
          {qty(otherQty(cat))} <span className={styles.sumHint}>· {fmt(otherSum(cat))}</span>
        </td>
        <td className={styles.tdNum}>
          {qty(cat.invoiced_qty)} <span className={styles.sumHint}>· {fmt(cat.invoiced_sum)}</span>
        </td>
        <td className={`${styles.tdNum} ${diffClass(cat.diff_qty)}`}>{diffLabel(cat.diff_qty)}</td>
      </tr>
      {open && cat.products.map(p => (
        <ProductRow
          key={p.product_id}
          p={p}
          open={openProducts.has(p.product_id)}
          onToggle={() => onToggleProduct(p.product_id)}
        />
      ))}
    </>
  )
}

function ProductRow({ p, open, onToggle }: {
  p: ProductBalanceProduct
  open: boolean
  onToggle: () => void
}) {
  const hasClients = p.clients.length > 0
  return (
    <>
      <tr
        className={`${styles.productRow} ${hasClients ? styles.clickable : ''}`}
        onClick={hasClients ? onToggle : undefined}
      >
        <td className={styles.tdNameIndent}>
          {hasClients && <span className={styles.expandIcon}>{open ? '▾' : '▸'}</span>}
          {p.short_name ?? p.name}
        </td>
        <td className={styles.tdNum}>{qtyOrDash(p.ordered_qty)}</td>
        <td className={styles.tdNum}>
          {qtyOrDash(p.baked_qty)}
          {!p.baked_entered && <span className={styles.estimatedMark} title="Випічку не введено — показано Замовлено">≈</span>}
        </td>
        <td className={styles.tdNum}>{qtyOrDash(p.exchange_qty)}</td>
        <td className={styles.tdNum}>{qtyOrDash(p.shop_qty)}</td>
        <td className={styles.tdNum}>
          {otherQty(p) ? <>{qty(otherQty(p))} <span className={styles.sumHint}>· {fmt(otherSum(p))}</span></> : '—'}
        </td>
        <td className={styles.tdNum}>
          {p.invoiced_qty ? <>{qty(p.invoiced_qty)} <span className={styles.sumHint}>· {fmt(p.invoiced_sum)}</span></> : '—'}
        </td>
        <td className={`${styles.tdNum} ${diffClass(p.diff_qty)}`}>{diffLabel(p.diff_qty)}</td>
      </tr>
      {open && p.clients.map((c, i) => (
        <ClientRow key={i} c={c} />
      ))}
    </>
  )
}

function ClientRow({ c }: { c: ProductBalanceClientRow }) {
  const isSystem = c.client_kind === 'system'
  return (
    <tr className={`${styles.clientRow} ${isSystem ? styles.systemClientRow : ''}`}>
      <td className={styles.tdClientName}>
        {c.tags.map(t => TAG_ICON[t] && (
          <span key={t} className={styles.clientTagIcon} title={TAG_ICON[t].label}>{TAG_ICON[t].icon}</span>
        ))}
        {c.client_name}
      </td>
      <td className={styles.tdNum}>{qtyOrDash(c.ordered_qty)}</td>
      <td className={styles.tdNum}>—</td>
      <td className={styles.tdNum}>—</td>
      <td className={styles.tdNum}>—</td>
      <td className={styles.tdNum}>
        {c.other_qty ? <>{qty(c.other_qty)} <span className={styles.sumHint}>· {fmt(c.other_sum)}</span></> : '—'}
      </td>
      <td className={styles.tdNum}>
        {c.invoiced_qty ? <>{qty(c.invoiced_qty)} <span className={styles.sumHint}>· {fmt(c.invoiced_sum)}</span></> : '—'}
      </td>
      <td className={styles.tdNum}>—</td>
    </tr>
  )
}
