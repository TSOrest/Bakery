import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import type { ClientBalance, Finance, FinanceSummary, InternalKpi, FinanceArticle } from '../types'
import {
  fetchBalances, fetchSummary, fetchClientHistory,
  createFinance, deleteFinance, fetchFinances, fetchInternalKpi,
} from '../api/finances'
import { fetchFinanceArticles } from '../api/financeArticles'
import { useWorkDate } from '../context/DateContext'
import styles from './FinancesPage.module.css'

// ── Константи ─────────────────────────────────────────────────────────────────

type TabId = 'balances' | 'journal'



const TYPE_COLORS: Record<string, string> = {
  invoice:         '#e74c3c',
  payment:         '#27ae60',
  writeoff:        '#8e44ad',
  deposit:         '#2980b9',
  route_cash:      '#16a085',
  exchange_credit: '#d35400',
  shop_revenue:    '#0097a7',
}

function fmt(n: number) {
  return n.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// ── Міні-графік оборотів ──────────────────────────────────────────────────────

function TurnoverChart({ history }: { history: Finance[] }) {
  const byMonth: Record<string, { income: number; expense: number }> = {}
  for (const e of history) {
    const month = e.finance_date.slice(0, 7)
    if (!byMonth[month]) byMonth[month] = { income: 0, expense: 0 }
    if (e.sign === 1) byMonth[month].income  += e.amount
    else              byMonth[month].expense += e.amount
  }
  const months = Object.keys(byMonth).sort().slice(-6)
  if (months.length === 0) return null
  const maxVal = Math.max(...months.flatMap(m => [byMonth[m].income, byMonth[m].expense]), 1)

  const W = 320, H = 58, BOTTOM = 14, BAR_H = H - BOTTOM
  const colW = W / months.length
  const bw   = Math.max(4, Math.floor(colW / 2) - 2)

  return (
    <div style={{ padding: '6px 14px 10px', borderBottom: '1px solid #eee' }}>
      <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 3, fontWeight: 500 }}>
        Оборот по місяцях
        <span style={{ marginLeft: 10, color: '#27ae60' }}>■ оплата</span>
        <span style={{ marginLeft: 6,  color: '#e74c3c' }}>■ накладна</span>
      </div>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        {months.map((month, i) => {
          const { income, expense } = byMonth[month]
          const cx = i * colW + colW / 2
          const incH = Math.round((income  / maxVal) * BAR_H)
          const expH = Math.round((expense / maxVal) * BAR_H)
          return (
            <g key={month}>
              {income  > 0 && <rect x={cx - bw - 1} y={BAR_H - incH} width={bw} height={incH} fill="#27ae60" rx={2} opacity={0.85} />}
              {expense > 0 && <rect x={cx + 1}       y={BAR_H - expH} width={bw} height={expH} fill="#e74c3c" rx={2} opacity={0.75} />}
              <text x={cx} y={H - 2} textAnchor="middle" fontSize={9} fill="#9ca3af">
                {month.slice(5)}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// ── Форма нової операції ──────────────────────────────────────────────────────

interface PaymentFormProps {
  clientId?:   number
  clientName?: string
  defaultDate: string
  balances?:   ClientBalance[]   // для вибору клієнта якщо clientId не переданий
  onSave: (data: Parameters<typeof createFinance>[0]) => Promise<void>
  onClose: () => void
}

function PaymentForm({ clientId, clientName, defaultDate, balances, onSave, onClose }: PaymentFormProps) {
  const [date,        setDate]        = useState(defaultDate)
  const [articleId,   setArticleId]   = useState<number | null>(null)
  const [selClientId, setSelClientId] = useState<number | null>(clientId ?? null)
  const [amount,      setAmount]      = useState('')
  const [notes,       setNotes]       = useState('')
  const [saving,      setSaving]      = useState(false)
  const [error,       setError]       = useState('')
  const [articles,    setArticles]    = useState<FinanceArticle[]>([])

  // Якщо clientId переданий — одразу ставимо "Оплата" і не показуємо вибір статті
  const isClientMode = !!clientId

  useEffect(() => {
    fetchFinanceArticles().then(list => {
      setArticles(list)
      if (isClientMode) {
        // Для клієнтської форми — шукаємо "Оплата" (income, needs_client=1)
        const payment = list.find(a => a.needs_client && a.direction === 'income' && a.name === 'Оплата')
        if (payment) setArticleId(payment.id)
      } else {
        // Загальна форма — перша загальна стаття (needs_client=0)
        const first = list.find(a => !a.needs_client)
        if (first) setArticleId(first.id)
        else if (list.length > 0) setArticleId(list[0].id)
      }
    })
  }, [isClientMode])

  const chosen = articles.find(a => a.id === articleId)
  const needsClient = chosen ? chosen.needs_client === 1 : false

  // Фільтруємо статті для загальної форми: без "Накладна" (автоматична)
  const generalArticles = articles.filter(a => a.name !== 'Накладна')
  const clientArticles  = generalArticles.filter(a => a.needs_client === 1)
  const cashArticles    = generalArticles.filter(a => a.needs_client === 0)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const num = parseFloat(amount.replace(',', '.'))
    if (!num || num <= 0) { setError('Введіть суму > 0'); return }
    if (!chosen) { setError('Оберіть статтю операції'); return }
    if (needsClient && !selClientId) { setError('Оберіть клієнта'); return }
    setSaving(true)
    setError('')
    try {
      await onSave({
        finance_date: date,
        client_id:    needsClient || isClientMode ? (selClientId ?? null) : null,
        finance_type: chosen.direction === 'income' ? 'payment' : 'invoice',
        article_id:   chosen.id,
        amount:       num,
        sign:         chosen.direction === 'income' ? 1 : -1,
        notes:        notes || undefined,
      })
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Помилка')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h3>{isClientMode ? `Оплата — ${clientName}` : 'Нова операція'}</h3>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit} className={styles.form}>
          <label>Дата
            <input type="date" value={date} onChange={e => setDate(e.target.value)} required />
          </label>

          {/* Загальна форма: спочатку вибір статті */}
          {!isClientMode && (
            <label>Стаття операції
              <select value={articleId ?? ''} onChange={e => setArticleId(Number(e.target.value))}>
                {clientArticles.length > 0 && (
                  <optgroup label="Клієнтські операції">
                    {clientArticles.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </optgroup>
                )}
                {cashArticles.length > 0 && (
                  <optgroup label="Касові операції">
                    {cashArticles.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </optgroup>
                )}
              </select>
            </label>
          )}

          {/* Вибір клієнта: для загальної форми тільки якщо стаття клієнтська */}
          {!isClientMode && needsClient && balances && (
            <label>Клієнт
              <select value={selClientId ?? ''} onChange={e => setSelClientId(e.target.value ? Number(e.target.value) : null)} required>
                <option value="">— оберіть клієнта —</option>
                {balances.map(b => (
                  <option key={b.client_id} value={b.client_id}>
                    {b.short_name ?? b.client_name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {chosen && !isClientMode && (
            <p style={{ margin: '-4px 0 6px', fontSize: '0.8rem', color: chosen.direction === 'income' ? '#27ae60' : '#e74c3c' }}>
              {chosen.direction === 'income' ? '+ надходження' : '− витрата'}
            </p>
          )}

          <label>Сума (грн)
            <input
              type="number" min="0.01" step="0.01" autoFocus
              value={amount} onChange={e => setAmount(e.target.value)}
              placeholder="0.00" required
            />
          </label>
          <label>Примітка
            <input
              type="text" value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Необов'язково"
            />
          </label>
          {error && <p className={styles.error}>{error}</p>}
          <div className={styles.formActions}>
            <button type="button" className={styles.btnSecondary} onClick={onClose}>
              Скасувати
            </button>
            <button type="submit" className={styles.btnPrimary} disabled={saving || !chosen}>
              {saving ? 'Зберігаємо…' : 'Зберегти'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Панель деталей клієнта ────────────────────────────────────────────────────

interface ClientPanelProps {
  balance:        ClientBalance
  workDate:       string
  onChanged:      () => void
  onClose:        () => void
}

function ClientPanel({ balance, workDate, onChanged, onClose }: ClientPanelProps) {
  const [history,  setHistory]  = useState<Finance[]>([])
  const [loading,  setLoading]  = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [deleting, setDeleting] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try { setHistory(await fetchClientHistory(balance.client_id)) }
    finally { setLoading(false) }
  }, [balance.client_id])

  useEffect(() => { load() }, [load])

  async function handleSave(data: Parameters<typeof createFinance>[0]) {
    await createFinance(data)
    await load()
    onChanged()
  }

  async function handleDelete(id: number) {
    if (!confirm('Видалити запис?')) return
    setDeleting(id)
    try {
      await deleteFinance(id)
      await load()
      onChanged()
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Помилка')
    } finally {
      setDeleting(null)
    }
  }

  const recentHistory = useMemo(() => {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 30)
    const cutoffISO = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`
    return history.filter(e => e.finance_date >= cutoffISO)
  }, [history])

  const isDebt   = balance.balance < 0
  const isCredit = balance.balance > 0

  return (
    <div className={styles.clientPanel}>
      <div className={styles.clientPanelHeader}>
        <div>
          <h3>{balance.short_name ?? balance.client_name}</h3>
          {balance.route_name && (
            <span className={styles.routeTag}>{balance.route_name}</span>
          )}
        </div>
        <div className={styles.clientPanelActions}>
          <button className={styles.btnPrimary} onClick={() => setShowForm(true)}>
            + Оплата
          </button>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>
      </div>

      <div className={styles.balanceBig}>
        <span className={isDebt ? styles.debtColor : isCredit ? styles.creditColor : styles.neutralColor}>
          {isDebt ? '−' : isCredit ? '+' : ''}{fmt(Math.abs(balance.balance))} грн
        </span>
        <span className={styles.balanceLabel}>
          {isDebt ? 'борг' : isCredit ? 'переплата' : 'без боргів'}
        </span>
      </div>

      {!loading && history.length > 0 && <TurnoverChart history={history} />}

      <div className={styles.historyList}>
        {loading && <p className={styles.hint}>Завантаження…</p>}
        {!loading && history.length === 0 && (
          <p className={styles.hint}>Операцій ще немає</p>
        )}
        {recentHistory.map(e => (
          <div key={e.id} className={styles.historyRow}>
            <div className={styles.historyRowTop}>
              <span
                className={styles.typeTag}
                style={{ background: TYPE_COLORS[e.finance_type] ?? '#888' }}
              >
                {e.type_label ?? e.finance_type}
              </span>
              <span />
              <span className={`${styles.historyRowAmount} ${e.sign === 1 ? styles.creditColor : styles.debtColor}`}>
                {e.sign === 1 ? '+' : '−'}{fmt(e.amount)} грн
              </span>
              {e.finance_type !== 'invoice' ? (
                <button
                  className={styles.delBtn}
                  title="Видалити"
                  disabled={deleting === e.id}
                  onClick={() => handleDelete(e.id)}
                >
                  ×
                </button>
              ) : <span />}
            </div>
            <div className={styles.historyRowMeta}>
              <span className={styles.historyDate}>{e.finance_date}</span>
              {e.notes && <span className={styles.historyNotes}>{e.notes}</span>}
            </div>
          </div>
        ))}
      </div>

      {showForm && (
        <PaymentForm
          clientId={balance.client_id}
          clientName={balance.short_name ?? balance.client_name}
          defaultDate={workDate}
          onSave={handleSave}
          onClose={() => setShowForm(false)}
        />
      )}
    </div>
  )
}

// ── Головна сторінка ──────────────────────────────────────────────────────────

export default function FinancesPage() {
  const { workDate } = useWorkDate()
  const today = workDate ?? new Date().toISOString().slice(0, 10)

  const [tab,           setTab]           = useState<TabId>('balances')
  const [balances,      setBalances]      = useState<ClientBalance[]>([])
  const [summary,       setSummary]       = useState<FinanceSummary | null>(null)
  const [internalKpi,   setInternalKpi]   = useState<InternalKpi | null>(null)
  const [journal,       setJournal]       = useState<Finance[]>([])
  const [selected,      setSelected]      = useState<ClientBalance | null>(null)
  const selectedRef = useRef(selected)
  useEffect(() => { selectedRef.current = selected }, [selected])
  const [showForm,      setShowForm]      = useState(false)
  const [showInternal,  setShowInternal]  = useState(false)

  // Фільтри
  const [search,      setSearch]      = useState('')
  const [filterRoute, setFilterRoute] = useState('')
  const [filterFrom,  setFilterFrom]  = useState(today)
  const [filterTo,    setFilterTo]    = useState(today)
  const [filterType,  setFilterType]  = useState('')

  const [articles,   setArticles]   = useState<FinanceArticle[]>([])
  const [loadingBal, setLoadingBal] = useState(false)
  const [loadingJrn, setLoadingJrn] = useState(false)

  const loadBalances = useCallback(async () => {
    setLoadingBal(true)
    try {
      const [b, s, kpi] = await Promise.all([fetchBalances(today), fetchSummary(today), fetchInternalKpi(today)])
      setBalances(b)
      setSummary(s)
      setInternalKpi(kpi)
      if (selectedRef.current) {
        const updated = b.find(x => x.client_id === selectedRef.current!.client_id)
        if (updated) setSelected(updated)
      }
    } finally {
      setLoadingBal(false)
    }
  }, [today]) // eslint-disable-line

  const loadJournal = useCallback(async () => {
    setLoadingJrn(true)
    try {
      const isArticle = filterType.startsWith('article:')
      setJournal(await fetchFinances({
        date_from:    filterFrom || undefined,
        date_to:      filterTo   || undefined,
        finance_type: (!isArticle && filterType) ? filterType : undefined,
        article_id:   isArticle ? parseInt(filterType.slice(8)) : undefined,
      }))
    } finally {
      setLoadingJrn(false)
    }
  }, [filterFrom, filterTo, filterType])

  useEffect(() => { loadBalances() }, [loadBalances]) // eslint-disable-line
  useEffect(() => { if (tab === 'journal') loadJournal() }, [tab, loadJournal])
  useEffect(() => { fetchFinanceArticles().then(setArticles) }, [])

  // Фільтровані баланси
  const filteredBalances = balances.filter(b => {
    const q = search.toLowerCase()
    const matchName  = b.client_name.toLowerCase().includes(q) ||
                       (b.short_name ?? '').toLowerCase().includes(q)
    const matchRoute = !filterRoute || String(b.route_id) === filterRoute
    return matchName && matchRoute
  })

  const regularBalances  = filteredBalances.filter(b => b.client_kind === 'customer')
  const internalBalances = filteredBalances.filter(b => b.client_kind !== 'customer')

  const routes = [...new Map(
    balances.filter(b => b.route_id && b.client_kind === 'customer').map(b => [b.route_id, b.route_name])
  ).entries()]

  // Групування балансів по маршрутах (лише для вкладки «Баланси»)
  type RouteGroup = { key: string; name: string; clients: ClientBalance[]; total: number }
  const groupedByRoute = useMemo<RouteGroup[]>(() => {
    const map = new Map<string, RouteGroup>()
    for (const b of regularBalances) {
      const key  = String(b.route_id ?? 0)
      const name = b.route_name ?? 'Без маршруту'
      if (!map.has(key)) map.set(key, { key, name, clients: [], total: 0 })
      const g = map.get(key)!
      g.clients.push(b)
      g.total = Math.round((g.total + b.balance) * 100) / 100
    }
    return Array.from(map.values()).sort((a, b) =>
      a.name === 'Без маршруту' ? 1 : b.name === 'Без маршруту' ? -1 : a.name.localeCompare(b.name, 'uk')
    )
  }, [regularBalances])

  async function handleSaveGlobal(data: Parameters<typeof createFinance>[0]) {
    await createFinance(data)
    await loadBalances()
    if (tab === 'journal') await loadJournal()
  }

  async function handleJournalDelete(id: number) {
    if (!confirm('Видалити запис?')) return
    try {
      await deleteFinance(id)
      await loadJournal()
      await loadBalances()
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Помилка')
    }
  }

  return (
    <div className={styles.page}>
      {/* Шапка */}
      <div className={styles.header}>
        <h2>
          Фінанси
          {today !== new Date().toISOString().slice(0, 10) && (
            <span className={styles.asOfNote}>
              {' '}(Станом на {today.split('-').reverse().join('.')})
            </span>
          )}
        </h2>
        <button className={styles.btnPrimary} onClick={() => setShowForm(true)}>
          + Операція
        </button>
      </div>

      {/* Зведення + KPI внутрішніх клієнтів — один рядок */}
      {summary && (
        <div className={styles.summaryBar}>
          <div className={styles.summaryCard}>
            <span className={styles.summaryLabel}>Загальний борг</span>
            <span className={`${styles.summaryValue} ${styles.debtColor}`}>
              {fmt(summary.total_debt)} грн
            </span>
            <span className={styles.summaryHint}>{summary.clients_in_debt} клієнтів</span>
          </div>
          <div className={styles.summaryCard}>
            <span className={styles.summaryLabel}>Переплати</span>
            <span className={`${styles.summaryValue} ${styles.creditColor}`}>
              {fmt(summary.total_credit)} грн
            </span>
            <span className={styles.summaryHint}>{summary.clients_with_credit} клієнтів</span>
          </div>
          <div className={styles.summaryCard}>
            <span className={styles.summaryLabel}>Чистий баланс</span>
            <span className={`${styles.summaryValue} ${summary.net_balance >= 0 ? styles.creditColor : styles.debtColor}`}>
              {summary.net_balance >= 0 ? '+' : ''}{fmt(summary.net_balance)} грн
            </span>
          </div>
          {internalKpi && (<>
            <div className={styles.summaryCard}>
              <span className={styles.summaryLabel}>Магазин</span>
              <span className={styles.summaryValue}>
                {fmt(internalKpi.shop.stock_value)} грн
              </span>
              <span className={styles.summaryHint}>
                Прихід{' '}
                <span className={styles.debtColor}>{fmt(internalKpi.shop.received_value)} грн</span>
                {' | '}Виручка{' '}
                <span className={styles.creditColor}>{fmt(internalKpi.shop.revenue)} грн</span>
              </span>
            </div>
            <div className={styles.summaryCard}>
              <span className={styles.summaryLabel}>Пайок</span>
              <span className={`${styles.summaryValue} ${styles.debtColor}`}>
                {internalKpi.ration.amount > 0 ? '−' : ''}{fmt(internalKpi.ration.amount)} грн
              </span>
              <span className={styles.summaryHint}>Втрати за дату</span>
            </div>
            <div className={styles.summaryCard}>
              <span className={styles.summaryLabel}>Списання</span>
              <span className={`${styles.summaryValue} ${styles.debtColor}`}>
                {internalKpi.writeoff.amount > 0 ? '−' : ''}{fmt(internalKpi.writeoff.amount)} грн
              </span>
              <span className={styles.summaryHint}>Втрати за дату</span>
            </div>
          </>)}
        </div>
      )}

      {/* Вкладки */}
      <div className={styles.tabs}>
        <button
          className={tab === 'balances' ? styles.tabActive : styles.tab}
          onClick={() => setTab('balances')}
        >
          Баланси клієнтів
        </button>
        <button
          className={tab === 'journal' ? styles.tabActive : styles.tab}
          onClick={() => setTab('journal')}
        >
          Журнал операцій
        </button>
      </div>

      {/* ── Баланси ── */}
      {tab === 'balances' && (
        <div className={styles.balancesTab}>
          <div className={styles.filters}>
            <input
              className={styles.searchInput}
              placeholder="Пошук клієнта…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <select value={filterRoute} onChange={e => setFilterRoute(e.target.value)}>
              <option value="">Всі маршрути</option>
              {routes.map(([id, name]) => (
                <option key={id} value={String(id)}>{name}</option>
              ))}
            </select>
          </div>

          {loadingBal && <p className={styles.hint}>Завантаження…</p>}

          <div className={styles.balancesLayout}>
            <div className={styles.balancesTableWrap}>
              <table className={styles.balancesTable}>
                <thead>
                  <tr>
                    <th>Клієнт</th>
                    <th>Маршрут</th>
                    <th>Остання оплата</th>
                    <th>Остання накладна</th>
                    <th className={styles.right}>Баланс, грн</th>
                  </tr>
                </thead>
                <tbody>
                  {groupedByRoute.map(group => (
                    <React.Fragment key={group.key}>
                      <tr className={styles.routeGroupHeader}>
                        <td colSpan={4}>{group.name}</td>
                        <td className={`${styles.right} ${group.total < 0 ? styles.debtColor : group.total > 0 ? styles.creditColor : ''}`}>
                          {group.total < 0 ? '−' : group.total > 0 ? '+' : ''}{fmt(Math.abs(group.total))}
                        </td>
                      </tr>
                      {group.clients.map(b => {
                        const isDebt   = b.balance < 0
                        const isCredit = b.balance > 0
                        const isActive = selected?.client_id === b.client_id
                        return (
                          <tr
                            key={b.client_id}
                            className={`${styles.balanceRow}${isActive ? ` ${styles.activeRow}` : ''}`}
                            onClick={() => setSelected(isActive ? null : b)}
                          >
                            <td className={styles.clientName}>{b.short_name ?? b.client_name}</td>
                            <td>{b.route_name ?? '—'}</td>
                            <td>{b.last_payment_date ?? '—'}</td>
                            <td>{b.last_invoice_date ?? '—'}</td>
                            <td className={`${styles.right} ${isDebt ? styles.debtColor : isCredit ? styles.creditColor : ''}`}>
                              {isDebt ? '−' : isCredit ? '+' : ''}{fmt(Math.abs(b.balance))}
                            </td>
                          </tr>
                        )
                      })}
                    </React.Fragment>
                  ))}
                  {regularBalances.length === 0 && !loadingBal && (
                    <tr><td colSpan={5} className={styles.hint}>Клієнтів не знайдено</td></tr>
                  )}

                  {/* ── Внутрішні клієнти (пайок, списання, магазин) ── */}
                  {internalBalances.length > 0 && (
                    <>
                      <tr
                        className={styles.internalSectionRow}
                        onClick={() => setShowInternal(v => !v)}
                      >
                        <td colSpan={5}>
                          {showInternal ? '▾' : '▸'} Внутрішні ({internalBalances.length})
                          <span className={styles.internalHint}> — пайок, списання, власний магазин</span>
                        </td>
                      </tr>
                      {showInternal && internalBalances.map(b => {
                        const isDebt   = b.balance < 0
                        const isCredit = b.balance > 0
                        const isActive = selected?.client_id === b.client_id
                        const kindLabel: Record<string, string> = { shop: 'магазин', writeoff: 'списання', ration: 'пайок' }
                        return (
                          <tr
                            key={b.client_id}
                            className={`${styles.balanceRow} ${styles.internalRow}${isActive ? ` ${styles.activeRow}` : ''}`}
                            onClick={() => setSelected(isActive ? null : b)}
                          >
                            <td className={styles.clientName}>
                              {b.short_name ?? b.client_name}
                              <span className={styles.kindTag}>{kindLabel[b.client_kind] ?? b.client_kind}</span>
                            </td>
                            <td>{b.route_name ?? '—'}</td>
                            <td>{b.last_payment_date ?? '—'}</td>
                            <td>{b.last_invoice_date ?? '—'}</td>
                            <td className={`${styles.right} ${isDebt ? styles.debtColor : isCredit ? styles.creditColor : ''}`}>
                              {isDebt ? '−' : isCredit ? '+' : ''}{fmt(Math.abs(b.balance))}
                            </td>
                          </tr>
                        )
                      })}
                    </>
                  )}
                </tbody>
              </table>
            </div>

            {selected && (
              <ClientPanel
                key={selected.client_id}
                balance={selected}
                workDate={today}
                onChanged={loadBalances}
                onClose={() => setSelected(null)}
              />
            )}
          </div>
        </div>
      )}

      {/* ── Журнал операцій ── */}
      {tab === 'journal' && (
        <div className={styles.journalTab}>
          <div className={styles.filters}>
            <label>Від
              <input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} />
            </label>
            <label>До
              <input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)} />
            </label>
            <select value={filterType} onChange={e => setFilterType(e.target.value)}>
              <option value="">Всі типи</option>
              {articles.map(a => (
                <option key={a.id} value={`article:${a.id}`}>{a.name}</option>
              ))}
            </select>
          </div>

          {loadingJrn && <p className={styles.hint}>Завантаження…</p>}

          <table className={styles.journalTable}>
            <thead>
              <tr>
                <th>Дата</th>
                <th>Тип</th>
                <th>Клієнт</th>
                <th>Примітка</th>
                <th className={styles.right}>Сума, грн</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {journal.map(e => (
                <tr key={e.id}>
                  <td>{e.finance_date}</td>
                  <td>
                    <span
                      className={styles.typeTag}
                      style={{ background: TYPE_COLORS[e.finance_type] ?? '#888' }}
                    >
                      {e.type_label ?? e.finance_type}
                    </span>
                  </td>
                  <td>{e.client_name ?? '—'}</td>
                  <td className={styles.notesCell}>{e.notes ?? ''}</td>
                  <td className={`${styles.right} ${e.sign === 1 ? styles.creditColor : styles.debtColor}`}>
                    {e.sign === 1 ? '+' : '−'}{fmt(e.amount)}
                  </td>
                  <td>
                    {e.finance_type !== 'invoice' && (
                      <button
                        className={styles.delBtn}
                        title="Видалити"
                        onClick={() => handleJournalDelete(e.id)}
                      >
                        ×
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {journal.length === 0 && !loadingJrn && (
                <tr>
                  <td colSpan={6} className={styles.hint}>Операцій немає</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <PaymentForm
          defaultDate={today}
          balances={balances}
          onSave={handleSaveGlobal}
          onClose={() => setShowForm(false)}
        />
      )}
    </div>
  )
}
