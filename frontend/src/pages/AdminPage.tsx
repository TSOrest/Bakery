import { useEffect, useState, type FormEvent } from 'react'
import { api } from '../api/client'
import type { Client, Product, Route, Unit, Category, Price } from '../types'
import Modal from '../components/Modal'
import formStyles from '../components/Form.module.css'
import UsersTab from './UsersTab'

// Тип вкладки довідника
type Tab = 'products' | 'clients' | 'routes' | 'prices' | 'units' | 'categories' | 'users'

// ─── Головний компонент ──────────────────────────────────────────────────────

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>('products')

  // Спільні довідники, потрібні у кількох формах
  const [units, setUnits]           = useState<Unit[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [routes, setRoutes]         = useState<Route[]>([])
  const [products, setProducts]     = useState<Product[]>([])

  useEffect(() => {
    api.get<Unit[]>('/units?active_only=false').then(setUnits)
    api.get<Category[]>('/categories?active_only=false').then(setCategories)
    api.get<Route[]>('/routes/?active_only=false').then(setRoutes)
    api.get<Product[]>('/products/?active_only=false').then(setProducts)
  }, [])

  const reloadProducts   = () => api.get<Product[]>('/products/?active_only=false').then(setProducts)
  const reloadRoutes     = () => api.get<Route[]>('/routes/?active_only=false').then(setRoutes)
  const reloadUnits      = () => api.get<Unit[]>('/units?active_only=false').then(setUnits)
  const reloadCategories = () => api.get<Category[]>('/categories?active_only=false').then(setCategories)

  const TABS: { key: Tab; label: string }[] = [
    { key: 'products',   label: 'Вироби' },
    { key: 'clients',    label: 'Клієнти' },
    { key: 'routes',     label: 'Маршрути' },
    { key: 'prices',     label: 'Ціни' },
    { key: 'units',      label: 'Одиниці виміру' },
    { key: 'categories', label: 'Категорії' },
    { key: 'users',      label: 'Користувачі' },
  ]

  return (
    <div>
      <h2>Довідники</h2>

      {/* Перемикачі вкладок */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem' }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: '0.4rem 1.1rem',
              borderRadius: '4px',
              border: '1px solid #ccc',
              background: tab === t.key ? '#1a3a5c' : '#fff',
              color: tab === t.key ? '#fff' : '#333',
              cursor: 'pointer',
              fontWeight: tab === t.key ? 600 : 400,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'products' && (
        <ProductsTab
          products={products}
          units={units}
          categories={categories}
          onReload={reloadProducts}
        />
      )}
      {tab === 'clients' && (
        <ClientsTab routes={routes} />
      )}
      {tab === 'routes' && (
        <RoutesTab routes={routes} onReload={reloadRoutes} />
      )}
      {tab === 'prices' && (
        <PricesTab products={products} categories={categories} />
      )}
      {tab === 'units' && (
        <SimpleListTab
          title="Одиниці виміру"
          items={units}
          addLabel="+ Додати одиницю"
          placeholder="напр. буханка, шт, кг"
          onAdd={(name) => api.post('/units', null, `name=${encodeURIComponent(name)}`).then(reloadUnits)}
          onUpdate={(id, patch) => api.put(`/units/${id}`, patch).then(reloadUnits)}
        />
      )}
      {tab === 'categories' && (
        <SimpleListTab
          title="Категорії"
          items={categories}
          addLabel="+ Додати категорію"
          placeholder="напр. Хліб, Булки, Магазин"
          onAdd={(name) => api.post('/categories', null, `name=${encodeURIComponent(name)}`).then(reloadCategories)}
          onUpdate={(id, patch) => api.put(`/categories/${id}`, patch).then(reloadCategories)}
        />
      )}
      {tab === 'users' && <UsersTab />}
    </div>
  )
}

// ─── Вироби ─────────────────────────────────────────────────────────────────

const PRODUCT_TYPE_LABELS: Record<string, string> = {
  bread: 'Хліб',
  bun:   'Булки',
  other: 'Інше',
}

interface ProductFormState {
  name: string
  short_name: string
  type: string
  weight: string
  unit_id: string
  category_id: string
}

const emptyProduct = (): ProductFormState => ({
  name: '', short_name: '', type: 'bread', weight: '', unit_id: '', category_id: '',
})

function ProductsTab({
  products, units, categories, onReload,
}: {
  products: Product[]
  units: Unit[]
  categories: Category[]
  onReload: () => void
}) {
  const [modal, setModal]   = useState(false)
  const [editing, setEditing] = useState<Product | null>(null)
  const [form, setForm]     = useState<ProductFormState>(emptyProduct())
  const [saving, setSaving] = useState(false)

  const openNew  = () => { setEditing(null); setForm(emptyProduct()); setModal(true) }
  const openEdit = (p: Product) => {
    setEditing(p)
    setForm({
      name:        p.name,
      short_name:  p.short_name ?? '',
      type:        p.type,
      weight:      p.weight?.toString() ?? '',
      unit_id:     p.unit_id?.toString() ?? '',
      category_id: p.category_id?.toString() ?? '',
    })
    setModal(true)
  }
  const closeModal = () => setModal(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    const body = {
      name:        form.name,
      short_name:  form.short_name || null,
      type:        form.type,
      weight:      form.weight ? Number(form.weight) : null,
      unit_id:     form.unit_id ? Number(form.unit_id) : null,
      category_id: form.category_id ? Number(form.category_id) : null,
    }
    try {
      if (editing) {
        await api.put(`/products/${editing.id}`, body)
      } else {
        await api.post('/products/', body)
      }
      onReload()
      closeModal()
    } finally {
      setSaving(false)
    }
  }

  const handleDeactivate = async (p: Product) => {
    if (!confirm(`Деактивувати виріб "${p.name}"?`)) return
    await api.delete(`/products/${p.id}`)
    onReload()
  }

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
        <strong>Вироби ({products.length})</strong>
        <button onClick={openNew} style={addBtnStyle}>+ Додати виріб</button>
      </div>

      <table style={tableStyle}>
        <thead>
          <tr style={{ background: '#e8eef5' }}>
            <Th>Назва</Th><Th>Скорочена</Th><Th>Тип</Th>
            <Th>Вага, кг</Th><Th>Активний</Th><Th>Дії</Th>
          </tr>
        </thead>
        <tbody>
          {products.map((p) => (
            <tr key={p.id} style={{ opacity: p.is_active ? 1 : 0.45 }}>
              <Td>{p.name}</Td>
              <Td>{p.short_name ?? '—'}</Td>
              <Td>{PRODUCT_TYPE_LABELS[p.type] ?? p.type}</Td>
              <Td>{p.weight ?? '—'}</Td>
              <Td>{p.is_active ? '✓' : '✗'}</Td>
              <Td>
                <button onClick={() => openEdit(p)} style={editBtnStyle}>Редагувати</button>
                {p.is_active === 1 ? (
                  <button onClick={() => handleDeactivate(p)} style={delBtnStyle}>Деактивувати</button>
                ) : (
                  <button onClick={async () => { await api.put(`/products/${p.id}`, { is_active: 1 }); onReload() }} style={{ ...editBtnStyle, color: '#080' }}>Відновити</button>
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </table>

      {modal && (
        <Modal title={editing ? 'Редагувати виріб' : 'Новий виріб'} onClose={closeModal}>
          <form onSubmit={handleSubmit} className={formStyles.form}>
            <div className={formStyles.field}>
              <label>Назва *</label>
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className={formStyles.field}>
              <label>Скорочена назва</label>
              <input value={form.short_name} onChange={(e) => setForm({ ...form, short_name: e.target.value })} />
              <span className={formStyles.hint}>Відображається в таблиці замовлень</span>
            </div>
            <div className={formStyles.field}>
              <label>Тип *</label>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                <option value="bread">Хліб</option>
                <option value="bun">Булки</option>
                <option value="other">Інше</option>
              </select>
            </div>
            <div className={formStyles.field}>
              <label>Вага (кг)</label>
              <input type="number" step="0.001" min="0" value={form.weight}
                onChange={(e) => setForm({ ...form, weight: e.target.value })} />
            </div>
            <div className={formStyles.field}>
              <label>Одиниця виміру</label>
              <select value={form.unit_id} onChange={(e) => setForm({ ...form, unit_id: e.target.value })}>
                <option value="">— не вказано —</option>
                {units.filter((u) => u.is_active).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
            <div className={formStyles.field}>
              <label>Категорія</label>
              <select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
                <option value="">— не вказано —</option>
                {categories.filter((c) => c.is_active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className={formStyles.actions}>
              <button type="button" onClick={closeModal} className={formStyles.btnSecondary}>Скасувати</button>
              <button type="submit" disabled={saving} className={formStyles.btnPrimary}>
                {saving ? 'Збереження...' : 'Зберегти'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  )
}

// ─── Клієнти ─────────────────────────────────────────────────────────────────

interface ClientFormState {
  full_name: string; short_name: string; address: string
  phone: string; director: string; accountant: string
  route_id: string; discount_pct: string
}

const emptyClient = (): ClientFormState => ({
  full_name: '', short_name: '', address: '', phone: '',
  director: '', accountant: '', route_id: '', discount_pct: '0',
})

function ClientsTab({ routes }: { routes: Route[] }) {
  const [clients, setClients]   = useState<Client[]>([])
  const [modal, setModal]       = useState(false)
  const [editing, setEditing]   = useState<Client | null>(null)
  const [form, setForm]         = useState<ClientFormState>(emptyClient())
  const [saving, setSaving]     = useState(false)

  const load = () => api.get<Client[]>('/clients/?active_only=false').then(setClients)
  useEffect(() => { load() }, [])

  const openNew  = () => { setEditing(null); setForm(emptyClient()); setModal(true) }
  const openEdit = (c: Client) => {
    setEditing(c)
    setForm({
      full_name:   c.full_name,
      short_name:  c.short_name ?? '',
      address:     c.address ?? '',
      phone:       c.phone ?? '',
      director:    '',
      accountant:  '',
      route_id:    c.route_id?.toString() ?? '',
      discount_pct: c.discount_pct.toString(),
    })
    setModal(true)
  }
  const closeModal = () => setModal(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    const body = {
      full_name:   form.full_name,
      short_name:  form.short_name || null,
      address:     form.address || null,
      phone:       form.phone || null,
      director:    form.director || null,
      accountant:  form.accountant || null,
      route_id:    form.route_id ? Number(form.route_id) : null,
      discount_pct: Number(form.discount_pct),
    }
    try {
      if (editing) {
        await api.put(`/clients/${editing.id}`, body)
      } else {
        await api.post('/clients/', body)
      }
      load(); closeModal()
    } finally { setSaving(false) }
  }

  const handleDeactivate = async (c: Client) => {
    if (!confirm(`Деактивувати клієнта "${c.full_name}"?`)) return
    await api.delete(`/clients/${c.id}`)
    load()
  }

  const routeName = (id: number | null) => routes.find((r) => r.id === id)?.name ?? '—'

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
        <strong>Клієнти ({clients.length})</strong>
        <button onClick={openNew} style={addBtnStyle}>+ Додати клієнта</button>
      </div>

      <table style={tableStyle}>
        <thead>
          <tr style={{ background: '#e8eef5' }}>
            <Th>Назва</Th><Th>Скорочена</Th><Th>Маршрут</Th>
            <Th>Знижка %</Th><Th>Телефон</Th><Th>Активний</Th><Th>Дії</Th>
          </tr>
        </thead>
        <tbody>
          {clients.map((c) => (
            <tr key={c.id} style={{ opacity: c.is_active ? 1 : 0.45 }}>
              <Td>{c.full_name}</Td>
              <Td>{c.short_name ?? '—'}</Td>
              <Td>{routeName(c.route_id)}</Td>
              <Td>{c.discount_pct}</Td>
              <Td>{c.phone ?? '—'}</Td>
              <Td>{c.is_active ? '✓' : '✗'}</Td>
              <Td>
                <button onClick={() => openEdit(c)} style={editBtnStyle}>Редагувати</button>
                {c.is_active === 1 ? (
                  <button onClick={() => handleDeactivate(c)} style={delBtnStyle}>Деактивувати</button>
                ) : (
                  <button onClick={async () => { await api.put(`/clients/${c.id}`, { is_active: 1 }); load() }} style={{ ...editBtnStyle, color: '#080' }}>Відновити</button>
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </table>

      {modal && (
        <Modal title={editing ? 'Редагувати клієнта' : 'Новий клієнт'} onClose={closeModal}>
          <form onSubmit={handleSubmit} className={formStyles.form}>
            <div className={formStyles.field}>
              <label>Повна назва *</label>
              <input required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
            </div>
            <div className={formStyles.field}>
              <label>Скорочена назва</label>
              <input value={form.short_name} onChange={(e) => setForm({ ...form, short_name: e.target.value })} />
              <span className={formStyles.hint}>Відображається в таблиці замовлень</span>
            </div>
            <div className={formStyles.field}>
              <label>Маршрут</label>
              <select value={form.route_id} onChange={(e) => setForm({ ...form, route_id: e.target.value })}>
                <option value="">— не призначено —</option>
                {routes.filter((r) => r.is_active).map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>
            <div className={formStyles.field}>
              <label>Знижка %</label>
              <input type="number" min="0" max="100" step="0.1" value={form.discount_pct}
                onChange={(e) => setForm({ ...form, discount_pct: e.target.value })} />
            </div>
            <div className={formStyles.field}>
              <label>Адреса</label>
              <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </div>
            <div className={formStyles.field}>
              <label>Телефон</label>
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
            <div className={formStyles.field}>
              <label>Директор</label>
              <input value={form.director} onChange={(e) => setForm({ ...form, director: e.target.value })} />
            </div>
            <div className={formStyles.field}>
              <label>Бухгалтер</label>
              <input value={form.accountant} onChange={(e) => setForm({ ...form, accountant: e.target.value })} />
            </div>
            <div className={formStyles.actions}>
              <button type="button" onClick={closeModal} className={formStyles.btnSecondary}>Скасувати</button>
              <button type="submit" disabled={saving} className={formStyles.btnPrimary}>
                {saving ? 'Збереження...' : 'Зберегти'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  )
}

// ─── Маршрути ────────────────────────────────────────────────────────────────

interface RouteFormState { name: string; sort_order: string }

function RoutesTab({ routes, onReload }: { routes: Route[]; onReload: () => void }) {
  const [modal, setModal]     = useState(false)
  const [editing, setEditing] = useState<Route | null>(null)
  const [form, setForm]       = useState<RouteFormState>({ name: '', sort_order: '0' })
  const [saving, setSaving]   = useState(false)

  const openNew  = () => { setEditing(null); setForm({ name: '', sort_order: '0' }); setModal(true) }
  const openEdit = (r: Route) => {
    setEditing(r)
    setForm({ name: r.name, sort_order: r.sort_order.toString() })
    setModal(true)
  }
  const closeModal = () => setModal(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    const body = { name: form.name, sort_order: Number(form.sort_order) }
    try {
      if (editing) {
        await api.put(`/routes/${editing.id}`, body)
      } else {
        await api.post('/routes/', body)
      }
      onReload(); closeModal()
    } finally { setSaving(false) }
  }

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
        <strong>Маршрути ({routes.length})</strong>
        <button onClick={openNew} style={addBtnStyle}>+ Додати маршрут</button>
      </div>

      <table style={tableStyle}>
        <thead>
          <tr style={{ background: '#e8eef5' }}>
            <Th>Назва</Th><Th>Порядок</Th><Th>Активний</Th><Th>Дії</Th>
          </tr>
        </thead>
        <tbody>
          {routes.map((r) => (
            <tr key={r.id}>
              <Td>{r.name}</Td>
              <Td>{r.sort_order}</Td>
              <Td>{r.is_active ? '✓' : '✗'}</Td>
              <Td>
                <button onClick={() => openEdit(r)} style={editBtnStyle}>Редагувати</button>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>

      {modal && (
        <Modal title={editing ? 'Редагувати маршрут' : 'Новий маршрут'} onClose={closeModal}>
          <form onSubmit={handleSubmit} className={formStyles.form}>
            <div className={formStyles.field}>
              <label>Назва маршруту *</label>
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="напр. Центр, Північ, Ринок" />
            </div>
            <div className={formStyles.field}>
              <label>Порядок сортування</label>
              <input type="number" min="0" value={form.sort_order}
                onChange={(e) => setForm({ ...form, sort_order: e.target.value })} />
              <span className={formStyles.hint}>Маршрути з меншим числом відображаються першими</span>
            </div>
            <div className={formStyles.actions}>
              <button type="button" onClick={closeModal} className={formStyles.btnSecondary}>Скасувати</button>
              <button type="submit" disabled={saving} className={formStyles.btnPrimary}>
                {saving ? 'Збереження...' : 'Зберегти'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  )
}

// ─── Ціни ────────────────────────────────────────────────────────────────────

interface PriceFormState {
  product_id: string; category_id: string
  price: string; valid_from: string; valid_to: string
}

function PricesTab({ products, categories }: { products: Product[]; categories: Category[] }) {
  const [prices, setPrices]   = useState<Price[]>([])
  const [modal, setModal]     = useState(false)
  const [form, setForm]       = useState<PriceFormState>({
    product_id: '', category_id: '', price: '', valid_from: '', valid_to: '',
  })
  const [saving, setSaving]   = useState(false)

  const today = new Date().toISOString().slice(0, 10)

  const load = () => api.get<Price[]>('/prices/').then(setPrices)
  useEffect(() => { load() }, [])

  const openNew = () => {
    setForm({ product_id: '', category_id: '', price: '', valid_from: today, valid_to: '' })
    setModal(true)
  }
  const closeModal = () => setModal(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    const body = {
      product_id:  Number(form.product_id),
      category_id: form.category_id ? Number(form.category_id) : null,
      price:       Number(form.price),
      valid_from:  form.valid_from,
      valid_to:    form.valid_to || null,
    }
    try {
      await api.post('/prices/', body)
      load(); closeModal()
    } finally { setSaving(false) }
  }

  const productName = (id: number) => products.find((p) => p.id === id)?.name ?? `#${id}`
  const categoryName = (id: number | null) =>
    id ? (categories.find((c) => c.id === id)?.name ?? `#${id}`) : 'Усі категорії'

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
        <strong>Ціни ({prices.length})</strong>
        <button onClick={openNew} style={addBtnStyle}>+ Додати ціну</button>
      </div>

      <table style={tableStyle}>
        <thead>
          <tr style={{ background: '#e8eef5' }}>
            <Th>Виріб</Th><Th>Категорія</Th><Th>Ціна, грн</Th>
            <Th>Діє з</Th><Th>Діє до</Th>
          </tr>
        </thead>
        <tbody>
          {prices.map((p) => (
            <tr key={p.id}>
              <Td>{productName(p.product_id)}</Td>
              <Td>{categoryName(p.category_id)}</Td>
              <Td><strong>{p.price.toFixed(2)}</strong></Td>
              <Td>{p.valid_from}</Td>
              <Td>{p.valid_to ?? '∞'}</Td>
            </tr>
          ))}
          {prices.length === 0 && (
            <tr><td colSpan={5} style={{ textAlign: 'center', padding: '1rem', color: '#888' }}>
              Ціни не задані
            </td></tr>
          )}
        </tbody>
      </table>

      {modal && (
        <Modal title="Нова ціна" onClose={closeModal}>
          <form onSubmit={handleSubmit} className={formStyles.form}>
            <div className={formStyles.field}>
              <label>Виріб *</label>
              <select required value={form.product_id}
                onChange={(e) => setForm({ ...form, product_id: e.target.value })}>
                <option value="">— оберіть виріб —</option>
                {products.filter((p) => p.is_active).map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className={formStyles.field}>
              <label>Категорія клієнта</label>
              <select value={form.category_id}
                onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
                <option value="">Для всіх категорій</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <span className={formStyles.hint}>Залиште порожнім якщо ціна єдина для всіх</span>
            </div>
            <div className={formStyles.field}>
              <label>Ціна, грн *</label>
              <input required type="number" min="0" step="0.01" value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
                placeholder="0.00" />
            </div>
            <div className={formStyles.field}>
              <label>Діє з *</label>
              <input required type="date" value={form.valid_from}
                onChange={(e) => setForm({ ...form, valid_from: e.target.value })} />
            </div>
            <div className={formStyles.field}>
              <label>Діє до</label>
              <input type="date" value={form.valid_to}
                onChange={(e) => setForm({ ...form, valid_to: e.target.value })} />
              <span className={formStyles.hint}>Залиште порожнім — ціна безстрокова</span>
            </div>
            <div className={formStyles.actions}>
              <button type="button" onClick={closeModal} className={formStyles.btnSecondary}>Скасувати</button>
              <button type="submit" disabled={saving} className={formStyles.btnPrimary}>
                {saving ? 'Збереження...' : 'Зберегти'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  )
}

// ─── Універсальна вкладка для простих довідників (одиниці, категорії) ────────

interface SimpleItem { id: number; name: string; is_active: number }

function SimpleListTab({
  title, items, addLabel, placeholder, onAdd, onUpdate,
}: {
  title: string
  items: SimpleItem[]
  addLabel: string
  placeholder: string
  onAdd: (name: string) => Promise<unknown>
  onUpdate: (id: number, patch: { name?: string; is_active?: number }) => Promise<unknown>
}) {
  const [newName, setNewName]       = useState('')
  const [saving,  setSaving]        = useState(false)
  const [editItem, setEditItem]     = useState<SimpleItem | null>(null)
  const [editName, setEditName]     = useState('')

  const handleAdd = async () => {
    const name = newName.trim()
    if (!name) return
    setSaving(true)
    try { await onAdd(name); setNewName('') }
    finally { setSaving(false) }
  }

  const openEdit = (item: SimpleItem) => { setEditItem(item); setEditName(item.name) }

  const handleRename = async () => {
    if (!editItem) return
    const name = editName.trim()
    if (!name || name === editItem.name) { setEditItem(null); return }
    await onUpdate(editItem.id, { name })
    setEditItem(null)
  }

  const handleToggleActive = async (item: SimpleItem) => {
    const label = item.is_active ? 'приховати' : 'відновити'
    if (!confirm(`${label} "${item.name}"?`)) return
    await onUpdate(item.id, { is_active: item.is_active ? 0 : 1 })
  }

  const active   = items.filter((i) => i.is_active)
  const inactive = items.filter((i) => !i.is_active)

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
        <strong>{title} ({active.length} активних{inactive.length > 0 ? `, ${inactive.length} прихованих` : ''})</strong>
      </div>

      {/* Форма додавання */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          placeholder={placeholder}
          style={{ padding: '0.4rem 0.6rem', border: '1px solid #ccc', borderRadius: '4px', fontSize: '0.9rem', flex: 1, maxWidth: '260px' }}
        />
        <button onClick={handleAdd} disabled={saving || !newName.trim()} style={addBtnStyle}>
          {addLabel}
        </button>
      </div>

      <table style={tableStyle}>
        <thead>
          <tr style={{ background: '#e8eef5' }}>
            <Th>ID</Th><Th>Назва</Th><Th>Дії</Th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} style={{ opacity: item.is_active ? 1 : 0.5 }}>
              <Td>{item.id}</Td>
              <Td>
                {editItem?.id === item.id ? (
                  <span style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                    <input
                      autoFocus
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') setEditItem(null) }}
                      style={{ padding: '0.2rem 0.4rem', border: '1px solid #bcd', borderRadius: '3px', fontSize: '0.9rem' }}
                    />
                    <button onClick={handleRename} style={editBtnStyle}>Зберегти</button>
                    <button onClick={() => setEditItem(null)} style={{ ...editBtnStyle, color: '#888' }}>✕</button>
                  </span>
                ) : (
                  item.name
                )}
              </Td>
              <Td>
                {editItem?.id !== item.id && (
                  <button onClick={() => openEdit(item)} style={editBtnStyle}>Перейменувати</button>
                )}
                <button
                  onClick={() => handleToggleActive(item)}
                  style={item.is_active ? delBtnStyle : { ...editBtnStyle, color: '#080' }}
                >
                  {item.is_active ? 'Приховати' : 'Відновити'}
                </button>
              </Td>
            </tr>
          ))}
          {items.length === 0 && (
            <tr><td colSpan={3} style={{ textAlign: 'center', padding: '1rem', color: '#888' }}>
              Список порожній
            </td></tr>
          )}
        </tbody>
      </table>
    </section>
  )
}

// ─── Допоміжні компоненти таблиці ────────────────────────────────────────────

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  background: '#fff',
  borderRadius: '6px',
  overflow: 'hidden',
  boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
}

const Th = ({ children }: { children: React.ReactNode }) => (
  <th style={{ padding: '0.45rem 0.8rem', textAlign: 'left', fontWeight: 600, fontSize: '0.875rem' }}>
    {children}
  </th>
)
const Td = ({ children }: { children: React.ReactNode }) => (
  <td style={{ padding: '0.4rem 0.8rem', borderBottom: '1px solid #f0f0f0', fontSize: '0.9rem' }}>
    {children}
  </td>
)

// ─── Стилі кнопок ────────────────────────────────────────────────────────────

const addBtnStyle: React.CSSProperties = {
  padding: '0.4rem 1rem',
  background: '#1a3a5c',
  color: '#fff',
  border: 'none',
  borderRadius: '4px',
  cursor: 'pointer',
  fontSize: '0.9rem',
}

const editBtnStyle: React.CSSProperties = {
  padding: '0.2rem 0.6rem',
  marginRight: '0.4rem',
  background: '#e8eef5',
  border: '1px solid #bcd',
  borderRadius: '3px',
  cursor: 'pointer',
  fontSize: '0.8rem',
}

const delBtnStyle: React.CSSProperties = {
  padding: '0.2rem 0.6rem',
  background: '#fff0f0',
  border: '1px solid #f5b8b8',
  borderRadius: '3px',
  cursor: 'pointer',
  fontSize: '0.8rem',
  color: '#c00',
}
