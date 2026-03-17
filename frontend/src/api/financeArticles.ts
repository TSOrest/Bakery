import { api } from './client'
import type { FinanceArticle } from '../types'

export const fetchFinanceArticles = (): Promise<FinanceArticle[]> =>
  api.get('/finances/articles/')

export const createFinanceArticle = (data: { name: string; direction: 'income' | 'expense' }): Promise<FinanceArticle> =>
  api.post('/finances/articles/', data)

export const updateFinanceArticle = (id: number, data: { name?: string; direction?: 'income' | 'expense' }): Promise<FinanceArticle> =>
  api.put(`/finances/articles/${id}`, data)

export const deleteFinanceArticle = (id: number): Promise<void> =>
  api.delete(`/finances/articles/${id}`)
