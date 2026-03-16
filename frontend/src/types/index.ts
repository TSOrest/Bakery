// ============================================================
// Базові типи — відповідають Pydantic-схемам бекенду
// ============================================================

export interface Unit {
  id: number
  name: string
}

export interface Category {
  id: number
  name: string
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

export interface Price {
  id: number
  product_id: number
  category_id: number | null
  price: number
  valid_from: string
  valid_to: string | null
  is_active: number
}
