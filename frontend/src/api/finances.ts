import type { Finance, ClientBalance, FinanceSummary, InternalKpi } from '../types'
import { api } from './client'

const BASE = '/finances'

export async function fetchFinances(params?: {
  client_id?: number
  date_from?: string
  date_to?: string
  finance_type?: string
  article_id?: number
}): Promise<Finance[]> {
  const q = new URLSearchParams()
  if (params?.client_id)    q.set('client_id',    String(params.client_id))
  if (params?.date_from)    q.set('date_from',    params.date_from)
  if (params?.date_to)      q.set('date_to',      params.date_to)
  if (params?.finance_type) q.set('finance_type', params.finance_type)
  if (params?.article_id)   q.set('article_id',   String(params.article_id))
  return api.get<Finance[]>(`${BASE}/?${q}`)
}

export async function fetchBalances(date?: string): Promise<ClientBalance[]> {
  return api.get<ClientBalance[]>(`${BASE}/balances${date ? `?date=${date}` : ''}`)
}

export async function fetchSummary(date?: string): Promise<FinanceSummary> {
  return api.get<FinanceSummary>(`${BASE}/summary${date ? `?date=${date}` : ''}`)
}

export async function fetchInternalKpi(date: string): Promise<InternalKpi> {
  return api.get<InternalKpi>(`${BASE}/internal-kpi?date=${date}`)
}

export async function fetchClientHistory(
  clientId: number,
  params?: { date_from?: string; date_to?: string },
): Promise<Finance[]> {
  const q = new URLSearchParams()
  if (params?.date_from) q.set('date_from', params.date_from)
  if (params?.date_to)   q.set('date_to',   params.date_to)
  return api.get<Finance[]>(`${BASE}/client/${clientId}?${q}`)
}

export async function createFinance(data: {
  finance_date: string
  client_id?: number | null
  finance_type: string
  article_id?: number | null
  amount: number
  sign: number
  notes?: string
  created_by?: string
}): Promise<Finance> {
  return api.post<Finance>(`${BASE}/`, data)
}

export async function updateFinance(
  id: number,
  data: { amount: number; notes?: string | null },
): Promise<Finance> {
  return api.patch<Finance>(`${BASE}/${id}`, data)
}

export async function deleteFinance(id: number): Promise<void> {
  return api.delete(`${BASE}/${id}`)
}
