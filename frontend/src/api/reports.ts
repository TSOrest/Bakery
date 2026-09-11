import { api } from './client'

export interface ProductBalanceClientRow {
  client_id: number
  client_name: string
  client_kind: string
  ordered_qty: number
  invoiced_qty: number
  invoiced_sum: number
  other_qty: number           // списання+пайок+інше, об'єднано (див. tags)
  other_sum: number
  tags: string[]               // 'exchange'/'stale'/'surplus'/'writeoff'/'ration'/'other'
}

export interface ProductBalanceProduct {
  product_id: number
  name: string
  short_name: string | null
  // report-parity (ідентично Секції 1 денного звіту)
  ordered_qty: number
  baked_qty: number
  baked_entered: boolean
  exchange_qty: number
  shop_qty: number
  // розширення дашборду
  invoiced_qty: number
  invoiced_sum: number
  writeoff_qty: number
  writeoff_sum: number
  ration_qty: number
  ration_sum: number
  other_qty: number
  other_sum: number
  diff_qty: number | null
  clients: ProductBalanceClientRow[]
}

export interface ProductBalanceCategory {
  category_id: number
  category_name: string
  ordered_qty: number
  baked_qty: number
  baked_entered: boolean
  exchange_qty: number
  shop_qty: number
  invoiced_qty: number
  invoiced_sum: number
  writeoff_qty: number
  writeoff_sum: number
  ration_qty: number
  ration_sum: number
  other_qty: number
  other_sum: number
  diff_qty: number | null
  products: ProductBalanceProduct[]
}

export interface ProductBalancesOut {
  date: string
  categories: ProductBalanceCategory[]
}

export function fetchProductBalances(date: string): Promise<ProductBalancesOut> {
  return api.get<ProductBalancesOut>(`/reports/product-balances?date=${date}`)
}
