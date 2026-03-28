import { api } from './client'
import type { Ingredient, ProductIngredient, MarginRow } from '../types'

export const fetchIngredients = () =>
  api.get<Ingredient[]>('/ingredients/')

export const createIngredient = (data: { name: string; unit_id?: number | null; price_per_unit: number }) =>
  api.post<Ingredient>('/ingredients/', data)

export const updateIngredient = (id: number, data: Partial<{ name: string; unit_id: number | null; price_per_unit: number }>) =>
  api.put<Ingredient>(`/ingredients/${id}`, data)

export const deleteIngredient = (id: number) =>
  api.delete(`/ingredients/${id}`)

export const fetchProductIngredients = (productId: number) =>
  api.get<ProductIngredient[]>(`/products/${productId}/ingredients`)

export const addProductIngredient = (productId: number, data: { ingredient_id: number; qty_per_unit: number }) =>
  api.post<ProductIngredient>(`/products/${productId}/ingredients`, data)

export const updateProductIngredient = (productId: number, piId: number, qty: number) =>
  api.put<ProductIngredient>(`/products/${productId}/ingredients/${piId}?qty_per_unit=${qty}`, null)

export const removeProductIngredient = (productId: number, piId: number) =>
  api.delete(`/products/${productId}/ingredients/${piId}`)

export const fetchMarginReport = (date?: string) =>
  api.get<{ rows: MarginRow[] }>(`/margin-report${date ? `?date=${date}` : ''}`)

export const recalculateAllCosts = () =>
  api.post<{ recalculated: number }>('/ingredients/recalculate-all', null)
