import { useEffect, useState, type FormEvent } from 'react'
import { api } from '../api/client'
import type { Client, Product, Route, Unit, Category, Price, ClientPriceOverride } from '../types'
import Modal from '../components/Modal'
import formStyles from '../components/Form.module.css'
import UsersTab from './UsersTab'
import { useAuth } from '../context/AuthContext'

// Тип вкладки довідника
type Tab = 'products' | 'clients' | 'routes' | 'prices' | 'units' | 'categories' | 'users' | 'settings' | 'permissions'

// ─── Головний компонент ──────────────────────────────────────────────────────

export default function AdminPage() {
  const { reloadPermissions } = useAuth()
  const [tab, setTab] = useState<Tab>('products')

  // Спільні довідники, потрібні у кількох формах
  const [units, setUnits]           = useState<Unit[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [routes, setRoutes]         = useState<Route[]>([])
  const [products, setProducts]     = useState<Product[]>([])
  const [clients,  setClients]      = useState<Client[]>([])

  useEffect(() => {
    api.get<Unit[]>('/units?active_only=false').then(setUnits)
    api.get<Category[]>('/categories?active_only=false').then(setCategories)
    api.get<Route[]>('/routes/?active_only=false').then(setRoutes)
    api.get<Product[]>('/products/?active_only=false').then(setProducts)
    api.get<Client[]>('/clients/?active_only=false').then(setClients)
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
    { key: 'users',       label: 'Користувачі' },
    { key: 'settings',    label: 'Налаштування' },
    { key: 'permissions', label: 'Права ролей' },
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
        <PricesTab products={products} clients={clients} />
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
      {tab === 'users'       && <UsersTab />}
      {tab === 'settings'    && <SettingsTab />}
      {tab === 'permissions' && <RolePermissionsTab onSaved={reloadPermissions} />}
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

function PricesTab({ products, clients }: {
  products: Product[]
  clients: Client[]
}) {
  const today = new Date().toISOString().slice(0, 10)
  type InnerTab = 'base' | 'overrides'
  const [innerTab, setInnerTab] = useState<InnerTab>('base')

  // ── Базові ціни ──
  const [prices,    setPrices]    = useState<Price[]>([])
  const [editPrice, setEditPrice] = useState<Price | null>(null)
  const [newModal,  setNewModal]  = useState(false)
  const [bulkModal, setBulkModal] = useState(false)
  const [newForm, setNewForm]     = useState({ product_id: '', price: '', valid_from: today })
  const [editForm, setEditForm]   = useState({ price: '', effective_date: today })
  const [bulkForm, setBulkForm]   = useState({ pct: '', effective_date: today })
  const [bulkPreview, setBulkPreview] = useState<{ product_name: string; old_price: number; new_price: number }[]>([])
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  // ── Індивідуальні ──
  const [overrides,       setOverrides]       = useState<ClientPriceOverride[]>([])
  const [filterClientId,  setFilterClientId]  = useState('')
  const [overrideModal,   setOverrideModal]   = useState(false)
  const [overrideForm,    setOverrideForm]    = useState({
    client_id: '', product_id: '', price: '', valid_from: today, valid_to: '',
  })

  const loadPrices    = () => api.get<Price[]>('/prices/').then(setPrices)
  const loadOverrides = () => api.get<ClientPriceOverride[]>(
    `/prices/overrides${filterClientId ? `?client_id=${filterClientId}` : ''}`
  ).then(setOverrides)

  useEffect(() => { loadPrices() }, [])
  useEffect(() => { if (innerTab === 'overrides') loadOverrides() }, [innerTab, filterClientId]) // eslint-disable-line

  const pName = (id: number) => products.find(p => p.id === id)?.name ?? `#${id}`
  const cName = (id: number) => {
    const c = clients.find(c => c.id === id)
    return c ? (c.short_name ?? c.full_name) : `#${id}`
  }

  // Поточна ціна для кожного продукту (найновіша active)
  const currentPriceMap = new Map<number, Price>()
  for (const p of prices) {
    if (!currentPriceMap.has(p.product_id)) currentPriceMap.set(p.product_id, p)
  }
  const currentPrices = Array.from(currentPriceMap.values())
    .sort((a, b) => pName(a.product_id).localeCompare(pName(b.product_id), 'uk'))

  // Редагування — замінює ціну
  const openEdit = (p: Price) => {
    setEditPrice(p)
    setEditForm({ price: String(p.price), effective_date: today })
  }
  const submitEdit = async (e: FormEvent) => {
    e.preventDefault()
    if (!editPrice) return
    setSaving(true); setError('')
    try {
      await api.post('/prices/replace', {
        old_price_id:   editPrice.id,
        price:          Number(editForm.price),
        effective_date: editForm.effective_date,
      })
      setEditPrice(null)
      await loadPrices()
    } catch (err) {
      setError(String(err))
    } finally { setSaving(false) }
  }

  // Нова ціна (для продукту без ціни)
  const submitNew = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true); setError('')
    try {
      await api.post('/prices/', {
        product_id: Number(newForm.product_id),
        price:      Number(newForm.price),
        valid_from: newForm.valid_from,
      })
      setNewModal(false)
      await loadPrices()
    } catch (err) {
      setError(String(err))
    } finally { setSaving(false) }
  }

  // Деактивувати ціну
  const deactivate = async (id: number) => {
    if (!confirm('Деактивувати цю ціну?')) return
    try {
      await api.delete(`/prices/${id}`)
      await loadPrices()
    } catch (err) {
      alert(String(err))
    }
  }

  // Масова зміна — превью
  const loadBulkPreview = async () => {
    if (!bulkForm.pct || !bulkForm.effective_date) return
    try {
      const data = await api.get<{ items: typeof bulkPreview }>(
        `/prices/bulk-preview?pct=${bulkForm.pct}&effective_date=${bulkForm.effective_date}`
      )
      setBulkPreview(data.items)
    } catch (err) {
      setError(String(err))
    }
  }
  useEffect(() => { if (bulkModal) loadBulkPreview() }, [bulkForm.pct, bulkForm.effective_date, bulkModal]) // eslint-disable-line

  const submitBulk = async (e: FormEvent) => {
    e.preventDefault()
    if (!confirm(`Змінити всі ціни на ${bulkForm.pct}% з ${bulkForm.effective_date}?`)) return
    setSaving(true); setError('')
    try {
      await api.post('/prices/bulk-change', { pct: Number(bulkForm.pct), effective_date: bulkForm.effective_date })
      setBulkModal(false)
      await loadPrices()
    } catch (err) {
      setError(String(err))
    } finally { setSaving(false) }
  }

  // Нова індивідуальна ціна
  const submitOverride = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true); setError('')
    try {
      await api.post('/prices/overrides', {
        client_id:  Number(overrideForm.client_id),
        product_id: Number(overrideForm.product_id),
        price:      Number(overrideForm.price),
        valid_from: overrideForm.valid_from,
        valid_to:   overrideForm.valid_to || null,
      })
      setOverrideModal(false)
      await loadOverrides()
    } catch (err) {
      setError(String(err))
    } finally { setSaving(false) }
  }

  const deleteOverride = async (id: number) => {
    if (!confirm('Видалити індивідуальну ціну?')) return
    await api.delete(`/prices/overrides/${id}`)
    loadOverrides()
  }

  const tabBtn = (t: InnerTab, label: string) => (
    <button
      onClick={() => setInnerTab(t)}
      style={{
        padding: '6px 16px', border: 'none', cursor: 'pointer', fontSize: 13,
        background: innerTab === t ? '#1565c0' : '#e8eef5',
        color: innerTab === t ? '#fff' : '#333',
        borderRadius: 4, fontWeight: innerTab === t ? 600 : 400,
      }}
    >{label}</button>
  )

  // Продукти без поточної ціни
  const productsWithoutPrice = products.filter(
    p => p.is_active && !currentPriceMap.has(p.id)
  )

  return (
    <section>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {tabBtn('base', 'Базові ціни')}
        {tabBtn('overrides', 'Індивідуальні ціни клієнтів')}
      </div>

      {/* ── Базові ціни ── */}
      {innerTab === 'base' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
            <strong>Поточні ціни ({currentPrices.length} виробів)</strong>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setBulkModal(true)} style={{ ...addBtnStyle, background: '#e67e22' }}>
                % Масова зміна
              </button>
              {productsWithoutPrice.length > 0 && (
                <button onClick={() => setNewModal(true)} style={addBtnStyle}>
                  + Нова ціна
                </button>
              )}
            </div>
          </div>

          <table style={tableStyle}>
            <thead>
              <tr style={{ background: '#e8eef5' }}>
                <Th>Виріб</Th><Th>Ціна, грн</Th><Th>Діє з</Th><Th>Діє до</Th><th style={{width:120}}></th>
              </tr>
            </thead>
            <tbody>
              {currentPrices.map(p => (
                <tr key={p.id}>
                  <Td>{pName(p.product_id)}</Td>
                  <Td><strong>{p.price.toFixed(2)}</strong></Td>
                  <Td>{p.valid_from}</Td>
                  <Td>{p.valid_to ? <span style={{ color: '#e67e22' }}>{p.valid_to}</span> : '∞'}</Td>
                  <Td>
                    <button onClick={() => openEdit(p)} style={{ ...editBtnStyle, marginRight: 4 }}>
                      Редагувати
                    </button>
                    <button onClick={() => deactivate(p.id)} style={delBtnStyle}>✕</button>
                  </Td>
                </tr>
              ))}
              {currentPrices.length === 0 && (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: '1rem', color: '#888' }}>
                  Ціни не задані
                </td></tr>
              )}
            </tbody>
          </table>

          {/* Модал редагування */}
          {editPrice && (
            <Modal title={`Змінити ціну: ${pName(editPrice.product_id)}`} onClose={() => setEditPrice(null)}>
              <form onSubmit={submitEdit} className={formStyles.form}>
                <div className={formStyles.field}>
                  <label>Поточна ціна</label>
                  <input type="text" readOnly value={`${editPrice.price.toFixed(2)} грн`}
                    style={{ background: '#f0f0f0' }} />
                </div>
                <div className={formStyles.field}>
                  <label>Нова ціна, грн *</label>
                  <input required type="number" min="0.01" step="0.01" autoFocus
                    value={editForm.price}
                    onChange={e => setEditForm({ ...editForm, price: e.target.value })} />
                </div>
                <div className={formStyles.field}>
                  <label>Діє з (дата набуття чинності) *</label>
                  <input required type="date" value={editForm.effective_date}
                    onChange={e => setEditForm({ ...editForm, effective_date: e.target.value })} />
                  <span className={formStyles.hint}>
                    Стара ціна діятиме до {editForm.effective_date
                      ? new Date(new Date(editForm.effective_date).getTime() - 86400000)
                          .toISOString().slice(0, 10)
                      : '…'}
                  </span>
                </div>
                {error && <p style={{ color: '#c0392b', margin: '0 0 .5rem' }}>{error}</p>}
                <div className={formStyles.actions}>
                  <button type="button" onClick={() => { setEditPrice(null); setError('') }} className={formStyles.btnSecondary}>
                    Скасувати
                  </button>
                  <button type="submit" disabled={saving} className={formStyles.btnPrimary}>
                    {saving ? 'Збереження...' : 'Зберегти'}
                  </button>
                </div>
              </form>
            </Modal>
          )}

          {/* Модал нової ціни */}
          {newModal && (
            <Modal title="Нова ціна" onClose={() => { setNewModal(false); setError('') }}>
              <form onSubmit={submitNew} className={formStyles.form}>
                {error && <p style={{ color: '#c0392b', margin: '0 0 .5rem' }}>{error}</p>}
                <div className={formStyles.field}>
                  <label>Виріб *</label>
                  <select required value={newForm.product_id}
                    onChange={e => setNewForm({ ...newForm, product_id: e.target.value })}>
                    <option value="">— оберіть виріб —</option>
                    {productsWithoutPrice.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div className={formStyles.field}>
                  <label>Ціна, грн *</label>
                  <input required type="number" min="0.01" step="0.01"
                    value={newForm.price}
                    onChange={e => setNewForm({ ...newForm, price: e.target.value })}
                    placeholder="0.00" />
                </div>
                <div className={formStyles.field}>
                  <label>Діє з *</label>
                  <input required type="date" value={newForm.valid_from}
                    onChange={e => setNewForm({ ...newForm, valid_from: e.target.value })} />
                </div>
                <div className={formStyles.actions}>
                  <button type="button" onClick={() => setNewModal(false)} className={formStyles.btnSecondary}>
                    Скасувати
                  </button>
                  <button type="submit" disabled={saving} className={formStyles.btnPrimary}>
                    {saving ? 'Збереження...' : 'Зберегти'}
                  </button>
                </div>
              </form>
            </Modal>
          )}

          {/* Модал масової зміни */}
          {bulkModal && (
            <Modal title="Масова зміна цін" onClose={() => { setBulkModal(false); setError(''); setBulkPreview([]) }}>
              <form onSubmit={submitBulk} className={formStyles.form}>
                <div className={formStyles.field}>
                  <label>Зміна, % (+ збільшення, − зменшення) *</label>
                  <input required type="number" step="0.1" autoFocus
                    value={bulkForm.pct}
                    onChange={e => setBulkForm({ ...bulkForm, pct: e.target.value })}
                    placeholder="+5 або -10" />
                </div>
                <div className={formStyles.field}>
                  <label>Діє з *</label>
                  <input required type="date" value={bulkForm.effective_date}
                    onChange={e => setBulkForm({ ...bulkForm, effective_date: e.target.value })} />
                </div>

                {error && <p style={{ color: '#c0392b', margin: '0 0 .5rem' }}>{error}</p>}
                {bulkPreview.length > 0 && (
                  <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid #ddd', borderRadius: 4 }}>
                    <table style={{ ...tableStyle, margin: 0 }}>
                      <thead>
                        <tr style={{ background: '#f0f4f8' }}>
                          <Th>Виріб</Th>
                          <Th>Стара ціна</Th>
                          <Th>Нова ціна</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {bulkPreview.map((item, i) => (
                          <tr key={i}>
                            <Td>{item.product_name}</Td>
                            <Td>{item.old_price.toFixed(2)}</Td>
                            <Td><strong style={{ color: Number(bulkForm.pct) > 0 ? '#27ae60' : '#e74c3c' }}>
                              {item.new_price.toFixed(2)}
                            </strong></Td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className={formStyles.actions}>
                  <button type="button" onClick={() => setBulkModal(false)} className={formStyles.btnSecondary}>
                    Скасувати
                  </button>
                  <button type="submit" disabled={saving || bulkPreview.length === 0} className={formStyles.btnPrimary}>
                    {saving ? 'Збереження...' : `Застосувати (${bulkPreview.length} цін)`}
                  </button>
                </div>
              </form>
            </Modal>
          )}
        </>
      )}

      {/* ── Індивідуальні ціни ── */}
      {innerTab === 'overrides' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
            <select value={filterClientId} onChange={e => setFilterClientId(e.target.value)}
              style={{ padding: '5px 10px', border: '1px solid #ccc', borderRadius: 4, fontSize: 13 }}>
              <option value="">Всі клієнти</option>
              {clients.filter(c => c.is_active).map(c => (
                <option key={c.id} value={c.id}>{c.short_name ?? c.full_name}</option>
              ))}
            </select>
            <button onClick={() => setOverrideModal(true)} style={addBtnStyle}>
              + Додати індивідуальну ціну
            </button>
          </div>

          <table style={tableStyle}>
            <thead>
              <tr style={{ background: '#e8eef5' }}>
                <Th>Клієнт</Th><Th>Виріб</Th><Th>Ціна, грн</Th><Th>Діє з</Th><Th>Діє до</Th><th style={{width:60}}></th>
              </tr>
            </thead>
            <tbody>
              {overrides.map(o => (
                <tr key={o.id}>
                  <Td>{cName(o.client_id)}</Td>
                  <Td>{pName(o.product_id)}</Td>
                  <Td><strong>{o.price.toFixed(2)}</strong></Td>
                  <Td>{o.valid_from}</Td>
                  <Td>{o.valid_to ?? '∞'}</Td>
                  <Td>
                    <button onClick={() => deleteOverride(o.id)} style={delBtnStyle}>✕</button>
                  </Td>
                </tr>
              ))}
              {overrides.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: '1rem', color: '#888' }}>
                  Немає індивідуальних цін
                </td></tr>
              )}
            </tbody>
          </table>

          {overrideModal && (
            <Modal title="Нова індивідуальна ціна" onClose={() => { setOverrideModal(false); setError('') }}>
              <form onSubmit={submitOverride} className={formStyles.form}>
                {error && <p style={{ color: '#c0392b', margin: '0 0 .5rem' }}>{error}</p>}
                <div className={formStyles.field}>
                  <label>Клієнт *</label>
                  <select required value={overrideForm.client_id}
                    onChange={e => setOverrideForm({ ...overrideForm, client_id: e.target.value })}>
                    <option value="">— оберіть клієнта —</option>
                    {clients.filter(c => c.is_active).map(c => (
                      <option key={c.id} value={c.id}>{c.short_name ?? c.full_name}</option>
                    ))}
                  </select>
                </div>
                <div className={formStyles.field}>
                  <label>Виріб *</label>
                  <select required value={overrideForm.product_id}
                    onChange={e => setOverrideForm({ ...overrideForm, product_id: e.target.value })}>
                    <option value="">— оберіть виріб —</option>
                    {products.filter(p => p.is_active).map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div className={formStyles.field}>
                  <label>Ціна, грн *</label>
                  <input required type="number" min="0.01" step="0.01"
                    value={overrideForm.price}
                    onChange={e => setOverrideForm({ ...overrideForm, price: e.target.value })}
                    placeholder="0.00" />
                </div>
                <div className={formStyles.field}>
                  <label>Діє з *</label>
                  <input required type="date" value={overrideForm.valid_from}
                    onChange={e => setOverrideForm({ ...overrideForm, valid_from: e.target.value })} />
                </div>
                <div className={formStyles.field}>
                  <label>Діє до</label>
                  <input type="date" value={overrideForm.valid_to}
                    onChange={e => setOverrideForm({ ...overrideForm, valid_to: e.target.value })} />
                  <span className={formStyles.hint}>Порожньо — безстроково</span>
                </div>
                <div className={formStyles.actions}>
                  <button type="button" onClick={() => setOverrideModal(false)} className={formStyles.btnSecondary}>
                    Скасувати
                  </button>
                  <button type="submit" disabled={saving} className={formStyles.btnPrimary}>
                    {saving ? 'Збереження...' : 'Зберегти'}
                  </button>
                </div>
              </form>
            </Modal>
          )}
        </>
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

// ─── Налаштування ─────────────────────────────────────────────────────────────

interface SettingEntry { value: string; description: string }
type SettingsMap = Record<string, SettingEntry>

const SETTINGS_LABELS: Record<string, string> = {
  bakery_name:       'Назва пекарні',
  director:          'ПІБ директора',
  accountant_name:   'ПІБ бухгалтера',
  address:           'Адреса',
  city:              'Місто',
  phone:             'Телефон',
  edrpou:            'Код ЄДРПОУ',
  iban:              'IBAN рахунок',
  bank:              'Банк',
  bun_reserve_pct:   'Резерв булок, %',
  bread_reserve_pct: 'Резерв хліба, %',
  order_lock_time:   'Час блокування замовлень',
}

function SettingsTab() {
  const [settings, setSettings] = useState<SettingsMap>({})
  const [form,     setForm]     = useState<Record<string, string>>({})
  const [saving,   setSaving]   = useState(false)
  const [saved,    setSaved]    = useState(false)

  const load = () =>
    api.get<SettingsMap>('/settings/').then((data) => {
      setSettings(data)
      const vals: Record<string, string> = {}
      Object.entries(SETTINGS_LABELS).forEach(([k]) => {
        vals[k] = data[k]?.value ?? ''
      })
      setForm(vals)
    })

  useEffect(() => { load() }, [])

  const handleSave = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setSaved(false)
    try {
      // Зберігаємо кожне поле окремо (PUT /settings/{key})
      await Promise.all(
        Object.entries(form).map(([key, value]) =>
          api.put(`/settings/${key}`, { value, description: settings[key]?.description ?? '' })
        )
      )
      setSaved(true)
      await load()
    } finally {
      setSaving(false)
    }
  }

  const fieldStyle: React.CSSProperties = {
    display: 'flex', flexDirection: 'column', gap: '0.25rem', marginBottom: '0.85rem',
  }
  const labelStyle: React.CSSProperties = { fontSize: '0.85rem', fontWeight: 500, color: '#444' }
  const inputStyle: React.CSSProperties = {
    padding: '0.4rem 0.6rem', border: '1px solid #ccc', borderRadius: '4px',
    fontSize: '0.9rem', maxWidth: '420px',
  }

  return (
    <section>
      <h3 style={{ marginTop: 0, marginBottom: '1.25rem' }}>Параметри пекарні</h3>
      <form onSubmit={handleSave}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 2rem', maxWidth: '860px' }}>
          {Object.entries(SETTINGS_LABELS).map(([key, label]) => (
            <div key={key} style={fieldStyle}>
              <label style={labelStyle}>{label}</label>
              <input
                style={inputStyle}
                value={form[key] ?? ''}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
              />
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginTop: '0.5rem' }}>
          <button type="submit" disabled={saving} style={addBtnStyle}>
            {saving ? 'Збереження...' : 'Зберегти'}
          </button>
          {saved && <span style={{ color: '#2e7d32', fontSize: '0.9rem' }}>✓ Збережено</span>}
        </div>
      </form>
    </section>
  )
}

// ─── Права ролей ──────────────────────────────────────────────────────────────

const PERMISSION_TABS = [
  { key: 'orders',   label: 'Замовлення' },
  { key: 'baking',   label: 'Випічка' },
  { key: 'routes',   label: 'Маршрути' },
  { key: 'shop',     label: 'Магазин' },
  { key: 'finances', label: 'Фінанси' },
  { key: 'admin',    label: 'Довідники' },
]

const ALL_ROLES = ['operator', 'accountant', 'admin', 'owner'] as const
const ROLE_LABELS_MAP: Record<string, string> = {
  operator:   'Оператор',
  accountant: 'Бухгалтер',
  admin:      'Адміністратор',
  owner:      'Власник',
}

function RolePermissionsTab({ onSaved }: { onSaved: () => Promise<void> }) {
  // perms[role] = Set<tabKey>
  const [perms,  setPerms]  = useState<Record<string, Set<string>>>({})
  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(false)

  const load = () =>
    api.get<Record<string, { value: string }>>('/settings/').then((data) => {
      try {
        const raw: Record<string, string[]> = JSON.parse(data.role_permissions?.value ?? '{}')
        const map: Record<string, Set<string>> = {}
        ALL_ROLES.forEach((r) => { map[r] = new Set(raw[r] ?? []) })
        setPerms(map)
      } catch { /* ignore */ }
    })

  useEffect(() => { load() }, [])

  const toggle = (role: string, key: string) => {
    setPerms((prev) => {
      const next = { ...prev, [role]: new Set(prev[role]) }
      if (next[role].has(key)) next[role].delete(key)
      else next[role].add(key)
      return next
    })
    setSaved(false)
  }

  const handleSave = async () => {
    setSaving(true)
    setSaved(false)
    try {
      const json: Record<string, string[]> = {}
      ALL_ROLES.forEach((r) => { json[r] = Array.from(perms[r] ?? []) })
      await api.put('/settings/role_permissions', { value: JSON.stringify(json) })
      setSaved(true)
      await onSaved()
    } finally {
      setSaving(false)
    }
  }

  const thStyle: React.CSSProperties = {
    padding: '0.5rem 0.85rem', textAlign: 'center', fontWeight: 600,
    fontSize: '0.875rem', background: '#e8eef5',
  }
  const tdStyle: React.CSSProperties = {
    padding: '0.45rem 0.85rem', textAlign: 'center',
    borderBottom: '1px solid #f0f0f0',
  }

  return (
    <section>
      <h3 style={{ marginTop: 0, marginBottom: '1rem' }}>Доступ ролей до вкладок</h3>
      <table style={{ ...tableStyle, maxWidth: '640px' }}>
        <thead>
          <tr>
            <th style={{ ...thStyle, textAlign: 'left' }}>Роль</th>
            {PERMISSION_TABS.map((t) => (
              <th key={t.key} style={thStyle}>{t.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ALL_ROLES.map((role) => (
            <tr key={role}>
              <td style={{ ...tdStyle, textAlign: 'left', fontWeight: 500 }}>
                {ROLE_LABELS_MAP[role]}
              </td>
              {PERMISSION_TABS.map((t) => (
                <td key={t.key} style={tdStyle}>
                  <input
                    type="checkbox"
                    checked={perms[role]?.has(t.key) ?? false}
                    onChange={() => toggle(role, t.key)}
                    style={{ cursor: 'pointer', width: '16px', height: '16px' }}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginTop: '1rem' }}>
        <button onClick={handleSave} disabled={saving} style={addBtnStyle}>
          {saving ? 'Збереження...' : 'Зберегти права'}
        </button>
        {saved && <span style={{ color: '#2e7d32', fontSize: '0.9rem' }}>✓ Збережено</span>}
      </div>
      <p style={{ fontSize: '0.82rem', color: '#888', marginTop: '0.75rem' }}>
        Зміни набудуть чинності після наступного входу в систему.
      </p>
    </section>
  )
}
