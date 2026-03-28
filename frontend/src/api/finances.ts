import type { Finance, ClientBalance, FinanceSummary, InternalKpi } from '../types'

const BASE = '/api/v1/finances'

export async function fetchFinances(params?: {
  client_id?: number
  date_from?: string
  date_to?: string
  finance_type?: string
}): Promise<Finance[]> {
  const q = new URLSearchParams()
  if (params?.client_id)    q.set('client_id',    String(params.client_id))
  if (params?.date_from)    q.set('date_from',    params.date_from)
  if (params?.date_to)      q.set('date_to',      params.date_to)
  if (params?.finance_type) q.set('finance_type', params.finance_type)
  const res = await fetch(`${BASE}/?${q}`)
  if (!res.ok) throw new Error('Помилка завантаження операцій')
  return res.json()
}

export async function fetchBalances(date?: string): Promise<ClientBalance[]> {
  const q = date ? `?date=${date}` : ''
  const res = await fetch(`${BASE}/balances${q}`)
  if (!res.ok) throw new Error('Помилка завантаження балансів')
  return res.json()
}

export async function fetchSummary(date?: string): Promise<FinanceSummary> {
  const q = date ? `?date=${date}` : ''
  const res = await fetch(`${BASE}/summary${q}`)
  if (!res.ok) throw new Error('Помилка завантаження зведення')
  return res.json()
}

export async function fetchInternalKpi(date: string): Promise<InternalKpi> {
  const res = await fetch(`${BASE}/internal-kpi?date=${date}`)
  if (!res.ok) throw new Error('Помилка завантаження KPI')
  return res.json()
}

export async function fetchClientHistory(
  clientId: number,
  params?: { date_from?: string; date_to?: string },
): Promise<Finance[]> {
  const q = new URLSearchParams()
  if (params?.date_from) q.set('date_from', params.date_from)
  if (params?.date_to)   q.set('date_to',   params.date_to)
  const res = await fetch(`${BASE}/client/${clientId}?${q}`)
  if (!res.ok) throw new Error('Помилка завантаження історії')
  return res.json()
}

export async function createFinance(data: {
  finance_date: string
  client_id?: number | null
  finance_type: string
  amount: number
  sign: number
  notes?: string
  created_by?: string
}): Promise<Finance> {
  const res = await fetch(`${BASE}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Помилка збереження')
  }
  return res.json()
}

export async function deleteFinance(id: number): Promise<void> {
  const res = await fetch(`${BASE}/${id}`, { method: 'DELETE' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Помилка видалення')
  }
}
