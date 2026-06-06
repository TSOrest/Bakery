import { api } from './client'

const BASE = '/import'
// Для multipart/form-data upload api.* не підходить (він серіалізує JSON).
// Тому залишаємо raw fetch але вручну додаємо Authorization header.
const TOKEN_KEY = 'bakery_token'
function authHeaders(): Record<string, string> {
  const token = localStorage.getItem(TOKEN_KEY)
  return token ? { Authorization: `Bearer ${token}` } : {}
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ColumnMap {
  access_col:   string
  target_field: string
  description:  string
}

export interface TableDetail {
  access_table: string | null
  target_table: string
  count:        number
  column_map:   ColumnMap[]
  sample:       Record<string, string | null>[]
  warnings:     string[]
}

export interface PriceCategory {
  access_id:    string
  name:         string
  price_count:  number
  client_count: number
}

export interface AccdbPreview {
  temp_file_token:       string
  access_tables:         string[]
  product_types:         string[]       // unique values of 'Тип' from _Вироби
  price_categories:      PriceCategory[]
  base_price_category:   string         // auto-detected base category id
  routes:    TableDetail
  clients:   TableDetail
  products:  TableDetail
  prices:    TableDetail
  orders:    TableDetail
  finances:  TableDetail
  all_routes:               RoutePreview[]
  all_clients_preview:      ClientPreview[]
  suggested_route_skips:    string[]    // route names to auto-skip
  suggested_non_customers:  SuggestedNonCustomer[]
}

export interface SuggestedNonCustomer {
  access_id:          number
  name:               string
  suggested_kind:     string
  suggested_merge_id: number | null
}

export interface RoutePreview {
  access_id: number
  name:      string
}

export interface ClientPreview {
  access_id: number
  name:      string
}

// ─── Mapping types ────────────────────────────────────────────────────────────

export interface RouteMapping {
  access_id:     number
  import_it:     boolean    // false = skip this route
  name_override: string
  sort_order:    number
}

export interface CategoryMapping {
  access_type:   string    // value of 'Тип' in Access ('Хліб', 'Булка', …)
  category_name: string
  is_baked:      number    // 1 = baked, 0 = shop only
  sort_order:    number
  reserve_pct:   number
}

export interface ClientMapping {
  access_id:   number
  client_kind: 'customer' | 'shop' | 'writeoff' | 'ration'
  merge_with:  number | null  // if set → use existing SQLite client_id
  skip:        boolean        // if true → don't create, exclude from all mappings
}

export interface ImportMapping {
  temp_file_token:      string
  db_password:          string
  transition_date:      string          // YYYY-MM-DD
  finance_months:       number
  order_days:           number
  route_mappings:       RouteMapping[]
  category_mappings:    CategoryMapping[]
  client_mappings:      ClientMapping[]
  default_client_kind:  string
  base_price_category:  string          // Access КодКатегорії for base prices
  invoice_draft_from:   string | null   // YYYY-MM-DD; накладні з цієї дати = draft
}

// ─── Context types ────────────────────────────────────────────────────────────

export interface ExistingClient {
  id:          number
  full_name:   string
  short_name:  string | null
  client_kind: string
}

export interface ExistingRoute {
  id:         number
  name:       string
  sort_order: number
}

export interface ExistingCategory {
  id:         number
  name:       string
  is_baked:   number
  sort_order: number
}

export interface ImportContext {
  existing_clients:    ExistingClient[]
  existing_routes:     ExistingRoute[]
  existing_categories: ExistingCategory[]
}

// ─── Report types ─────────────────────────────────────────────────────────────

export interface EntityReport {
  found:        number
  imported:     number
  skipped:      number
  skip_reasons: Record<string, number>
  warnings:     string[]
  errors:       string[]
  notes:        string
}

export interface BalanceMismatch {
  client_id:        number
  client_name:      string
  access_balance:   number
  computed_balance: number
  diff:             number
}

export interface ImportPriceRange {
  price:      number
  valid_from: string
  valid_to:   string | null
}

export interface ClientPriceGroup {
  client_id:   number
  client_name: string
  ranges:      ImportPriceRange[]
}

export interface ZeroPriceProduct {
  id:            number
  name:          string
  client_groups: ClientPriceGroup[]
}

export interface ValidationReport {
  balance_mismatches:  BalanceMismatch[]
  zero_price_products: ZeroPriceProduct[]
  order_count_ok:      boolean
  overall_ok:          boolean
}

export interface ImportReport {
  success:         boolean
  started_at:      string
  finished_at:     string
  transition_date: string
  entities:        Record<string, EntityReport>
  validation:      ValidationReport
}

export interface ImportStatus {
  running:  boolean
  step:     string
  progress: number
  error:    string | null
}

// ─── API calls ────────────────────────────────────────────────────────────────

export async function uploadAccdb(file: File, password = ''): Promise<AccdbPreview> {
  const form = new FormData()
  form.append('file', file)
  if (password) form.append('password', password)
  const res = await fetch(`/api/v1${BASE}/upload`, {
    method: 'POST',
    body: form,
    headers: authHeaders(),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? 'Помилка завантаження файлу')
  }
  return res.json()
}

export async function getImportContext(): Promise<ImportContext> {
  return api.get<ImportContext>(`${BASE}/context`)
}

export async function runImport(mapping: ImportMapping): Promise<{ status: string }> {
  try {
    return await api.post<{ status: string }>(`${BASE}/run`, mapping)
  } catch (e) {
    // У api.* exception формат: "STATUS STATUSTEXT: BODY". Пробуємо витягти detail.
    const msg = e instanceof Error ? e.message : String(e)
    const match = msg.match(/:\s*(\{.*\})/)
    if (match) {
      try {
        const body = JSON.parse(match[1])
        const detail = body.detail
        const niceMsg = Array.isArray(detail)
          ? detail.map((d: { msg?: string }) => d.msg ?? JSON.stringify(d)).join('; ')
          : (detail ?? 'Помилка запуску імпорту')
        throw new Error(niceMsg)
      } catch { /* fallthrough */ }
    }
    throw e
  }
}

export async function getImportStatus(): Promise<ImportStatus> {
  return api.get<ImportStatus>(`${BASE}/status`)
}

export async function getImportResult(): Promise<ImportReport | null> {
  try {
    return await api.get<ImportReport>(`${BASE}/result`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.startsWith('404')) return null
    throw e
  }
}
