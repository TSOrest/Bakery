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
  is_baked: number
  reserve_pct: number
  sort_order: number
}

export interface Product {
  id: number
  name: string
  short_name: string | null
  weight: number | null
  unit_id: number | null
  category_id: number | null
  cost_per_unit: number
  is_active: number
  initial_stock: number
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
  is_own_shop: number
  print_invoice: number
  receiver_name: string | null
  delivery_agent: string | null
  delivery_note_number: string | null
  delivery_note_date: string | null
  client_group: string | null
  client_kind: 'customer' | 'shop' | 'writeoff' | 'ration'
  bot_phones: string | null
}

export interface Order {
  id: number
  client_id: number
  product_id: number
  qty: number
  order_date: string
  status: 'draft' | 'confirmed' | 'closed'
  source: 'phone' | 'paper' | 'bot'
  exchange_type: 'none' | 'pre_order' | 'post_delivery'
  exchange_qty: number
  exchange_price: number | null
  exchange_notes: string | null
  price_override: number | null
  notes: string | null
  created_at: string | null
  parent_order_id: number | null
  delivered_qty: number | null
  origin_id: number | null   // null=замовлення, 0=надлишок випічки, X=orders.id джерела
  bot_status: 'pending' | 'confirmed' | 'rejected' | 'modified' | null
  bot_rejection_reason: string | null
  bot_original_qty: number | null
}

export interface BotPendingOrder {
  id: number
  client_id: number
  client_name: string
  product_id: number
  product_name: string
  qty: number
  price: number
  sum: number
  order_date: string
}

export interface BotBroadcastResult {
  sent: number
  skipped: number
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

export interface FinanceArticle {
  id: number
  name: string
  direction: 'income' | 'expense'
  is_system: number
}

export interface Finance {
  id: number
  finance_date: string
  client_id: number | null
  client_name: string | null
  finance_type: string
  type_label: string | null
  article_id: number | null
  article_name: string | null
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
  client_kind: 'customer' | 'shop' | 'writeoff' | 'ration'
}

export interface FinanceSummary {
  total_debt: number
  total_credit: number
  net_balance: number
  clients_in_debt: number
  clients_with_credit: number
}

export interface InternalKpi {
  shop:     { stock_value: number; received_value: number; revenue: number }
  ration:   { amount: number }
  writeoff: { amount: number }
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

export interface Ingredient {
  id: number
  name: string
  unit_id: number | null
  price_per_unit: number
  price_updated_at: string | null
}

export interface ProductIngredient {
  id: number
  product_id: number
  ingredient_id: number
  qty_per_unit: number
  ingredient_name: string
  unit_name: string
  price_per_unit: number
  line_cost: number
}

export interface MarginRow {
  product_id: number
  product_name: string
  cost_per_unit: number
  price: number
  margin_grn: number
  margin_pct: number
}

export interface ClientPriceOverride {
  id: number
  client_id: number
  product_id: number
  price: number
  valid_from: string
  valid_to: string | null
}
