// ============================================================
// Базові типи — відповідають Pydantic-схемам бекенду
// ============================================================

export interface Unit {
  id: number
  name: string
  is_active: number
}

export interface Category {
  id: number
  name: string
  is_active: number
}

export interface Product {
  id: number
  name: string
  short_name: string | null
  type: 'bread' | 'bun' | 'other'
  weight: number | null
  unit_id: number | null
  category_id: number | null
  cost_per_unit: number
  is_active: number
}

export interface Route {
  id: number
  name: string
  sort_order: number
  is_active: number
}

export interface Client {
  id: number
  full_name: string
  short_name: string | null
  address: string | null
  phone: string | null
  route_id: number | null
  discount_pct: number
  is_active: number
}

export interface Order {
  id: number
  client_id: number
  product_id: number
  qty: number
  order_date: string
  status: 'draft' | 'confirmed' | 'closed'
  source: 'phone' | 'paper'
  exchange_type: 'none' | 'pre_order' | 'post_delivery'
  exchange_qty: number
  exchange_price: number | null
  exchange_notes: string | null
  price_override: number | null
  notes: string | null
  created_at: string | null
}

export interface BakingTask {
  id: number
  task_date: string
  product_id: number
  ordered_qty: number
  recommended_qty: number
  baked_qty: number
}

export interface SurplusAllocation {
  id: number
  alloc_date: string
  product_id: number
  to_shop: number
  to_route: number
  ration_qty: number
  written_off: number
  notes: string | null
}

export interface SurplusAllocationLine {
  id: number
  alloc_date: string
  product_id: number
  recipient_type: 'ration' | 'writeoff' | 'route' | 'client'
  client_id: number | null
  qty: number
  notes: string | null
}

export interface ShortageClientInfo {
  order_id: number
  client_id: number
  client_name: string
  route_name: string
  ordered_qty: number
}

export interface InvoiceLine {
  id: number
  product_id: number
  qty: number
  price: number
  price_override: number | null
  is_exchange: number
  is_stale: number
  sum: number
}

export interface Invoice {
  id: number
  invoice_number: string
  invoice_date: string
  client_id: number
  route_id: number | null
  status: 'draft' | 'printed' | 'delivered' | 'cancelled'
  total_sum: number
  notes: string | null
  lines: InvoiceLine[]
}

export interface Finance {
  id: number
  finance_date: string
  client_id: number | null
  client_name: string | null
  finance_type: string
  type_label: string | null
  amount: number
  sign: number
  signed_amount: number | null
  notes: string | null
  created_at: string | null
  created_by: string | null
}

export interface ClientBalance {
  client_id: number
  client_name: string
  short_name: string | null
  route_id: number | null
  route_name: string | null
  balance: number
  last_payment_date: string | null
  last_invoice_date: string | null
}

export interface FinanceSummary {
  total_debt: number
  total_credit: number
  net_balance: number
  clients_in_debt: number
  clients_with_credit: number
}

export interface Price {
  id: number
  product_id: number
  category_id: number | null
  price: number
  valid_from: string
  valid_to: string | null
  is_active: number
}

export interface ClientPriceOverride {
  id: number
  client_id: number
  product_id: number
  price: number
  valid_from: string
  valid_to: string | null
}
