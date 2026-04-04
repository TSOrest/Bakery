const BASE = '/api/v1/import'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EntityPreview {
  count: number
  sample: Record<string, string | null>[]
  warnings: string[]
}

export interface AccdbPreview {
  temp_file_token: string
  access_tables: string[]
  routes: EntityPreview
  clients: EntityPreview
  products: EntityPreview
  prices: EntityPreview
  overrides: EntityPreview
  orders: EntityPreview
  finances: EntityPreview
  stock: EntityPreview
}

export interface ProductCategoryMapping {
  access_product_id: number
  new_category_id: number
}

export interface ClientKindMapping {
  access_client_id: number
  client_kind: 'customer' | 'shop' | 'writeoff' | 'ration'
}

export interface ImportMapping {
  temp_file_token: string
  db_password: string
  transition_date: string         // YYYY-MM-DD
  finance_months: number
  order_days: number
  product_categories: ProductCategoryMapping[]
  client_kinds: ClientKindMapping[]
  default_client_kind: string
}

export interface EntityReport {
  found: number
  imported: number
  skipped: number
  warnings: string[]
  errors: string[]
}

export interface BalanceMismatch {
  client_name: string
  access_balance: number
  computed_balance: number
  diff: number
}

export interface ValidationReport {
  balance_mismatches: BalanceMismatch[]
  zero_price_products: string[]
  order_count_ok: boolean
  overall_ok: boolean
}

export interface ImportReport {
  success: boolean
  started_at: string
  finished_at: string
  transition_date: string
  entities: Record<string, EntityReport>
  validation: ValidationReport
}

export interface ImportStatus {
  running: boolean
  step: string
  progress: number
  error: string | null
}

// ─── API calls ────────────────────────────────────────────────────────────────

export interface UploadConfig {
  transition_date: string
  finance_months: number
  order_days: number
}

export async function uploadAccdb(file: File, password = ''): Promise<AccdbPreview> {
  const form = new FormData()
  form.append('file', file)
  if (password) form.append('password', password)
  const res = await fetch(`${BASE}/upload`, { method: 'POST', body: form })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? 'Помилка завантаження файлу')
  }
  return res.json()
}

export async function runImport(mapping: ImportMapping): Promise<{ status: string }> {
  const res = await fetch(`${BASE}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(mapping),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? 'Помилка запуску імпорту')
  }
  return res.json()
}

export async function getImportStatus(): Promise<ImportStatus> {
  const res = await fetch(`${BASE}/status`)
  if (!res.ok) throw new Error('Помилка отримання статусу')
  return res.json()
}

export async function getImportResult(): Promise<ImportReport | null> {
  const res = await fetch(`${BASE}/result`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error('Помилка отримання результату')
  return res.json()
}
