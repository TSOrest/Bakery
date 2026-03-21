import { useEffect, useState, useRef, type FormEvent } from 'react'
import { startDeviceFlow, pollDeviceFlow, getGitHubStatus, githubLogout, type GitHubStatus } from '../api/auth_github'
import { api } from '../api/client'
import type { Client, Product, Route, Unit, Category, Price, ClientPriceOverride, Ingredient, ProductIngredient, MarginRow } from '../types'
import Modal from '../components/Modal'
import formStyles from '../components/Form.module.css'
import UsersTab from './UsersTab'
import { useAuth } from '../context/AuthContext'
import {
  fetchIngredients, createIngredient, updateIngredient, deleteIngredient,
  fetchProductIngredients, addProductIngredient, removeProductIngredient,
  fetchMarginReport, recalculateAllCosts,
} from '../api/ingredients'

// Тип вкладки довідника
type Tab = 'products' | 'clients' | 'routes' | 'prices' | 'ingredients' | 'margin' | 'units' | 'categories' | 'users' | 'settings' | 'permissions'

interface TabGroup {
  label: string
  permKey: string
  tabs: { key: Tab; label: string }[]
}

// Ключ null = розділ системи, доступний лише admin-ролі
export const ADMIN_TAB_GROUPS: TabGroup[] = [
  {
    label: 'Виробництво',
    permKey: 'admin_goods',
    tabs: [
      { key: 'products',   label: 'Вироби' },
      { key: 'categories', label: 'Категорії' },
      { key: 'units',      label: 'Одиниці виміру' },
    ],
  },
  {
    label: 'Клієнти',
    permKey: 'admin_clients',
    tabs: [
      { key: 'clients', label: 'Клієнти' },
      { key: 'routes',  label: 'Маршрути' },
    ],
  },
  {
    label: 'Ціни та собівартість',
    permKey: 'admin_prices',
    tabs: [
      { key: 'prices',      label: 'Ціни' },
      { key: 'ingredients', label: 'Інгредієнти' },
      { key: 'margin',      label: 'Маржа' },
    ],
  },
  {
    label: 'Система',
    permKey: 'admin_system',
    tabs: [
      { key: 'users',       label: 'Користувачі' },
      { key: 'permissions', label: 'Права ролей' },
      { key: 'settings',    label: 'Налаштування' },
    ],
  },
]

// ─── Головний компонент ──────────────────────────────────────────────────────

export default function AdminPage() {
  const { user, permissions, reloadPermissions } = useAuth()
  const role    = user?.role ?? 'operator'
  const isAdmin = role === 'admin'
  const userPerms: string[] = isAdmin ? [] : (permissions[role] ?? [])

  // Які групи доступні цій ролі?
  const visibleGroups = ADMIN_TAB_GROUPS.filter(g =>
    isAdmin || userPerms.includes(g.permKey as string)
  )

  const allVisibleTabKeys = visibleGroups.flatMap(g => g.tabs.map(t => t.key))
  const defaultTab = allVisibleTabKeys[0] ?? 'products'
  const [tab, setTab] = useState<Tab>(defaultTab)

  // Якщо поточна вкладка недоступна — переключити на першу доступну
  const activeTab: Tab = allVisibleTabKeys.includes(tab) ? tab : defaultTab

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

  return (
    <div style={{ padding: '1.5rem' }}>
      <h2 style={{ marginTop: 0, marginBottom: '1.25rem' }}>Довідники</h2>

      {/* Згруповані вкладки */}
      <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1.5rem', flexWrap: 'wrap', alignItems: 'flex-end', borderBottom: '1px solid #e0e0e0', paddingBottom: '0.75rem' }}>
        {visibleGroups.map(group => (
          <div key={group.label}>
            <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.35rem' }}>
              {group.label}
            </div>
            <div style={{ display: 'flex', gap: '0.3rem' }}>
              {group.tabs.map(t => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  style={{
                    padding: '0.35rem 0.85rem',
                    borderRadius: '4px',
                    border: '1px solid',
                    borderColor: activeTab === t.key ? '#1a3a5c' : '#d0d7de',
                    background: activeTab === t.key ? '#1a3a5c' : '#fff',
                    color: activeTab === t.key ? '#fff' : '#444',
                    cursor: 'pointer',
                    fontWeight: activeTab === t.key ? 600 : 400,
                    fontSize: '0.875rem',
                    transition: 'background 0.12s, border-color 0.12s',
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {activeTab === 'products' && (
        <ProductsTab
          products={products}
          units={units}
          categories={categories}
          onReload={reloadProducts}
        />
      )}
      {activeTab === 'clients' && (
        <ClientsTab routes={routes} />
      )}
      {activeTab === 'routes' && (
        <RoutesTab routes={routes} onReload={reloadRoutes} />
      )}
      {activeTab === 'prices' && (
        <PricesTab products={products} clients={clients} />
      )}
      {activeTab === 'units' && (
        <SimpleListTab
          title="Одиниці виміру"
          items={units}
          addLabel="+ Додати одиницю"
          placeholder="напр. буханка, шт, кг"
          onAdd={(name) => api.post('/units', null, `name=${encodeURIComponent(name)}`).then(reloadUnits)}
          onUpdate={(id, patch) => api.put(`/units/${id}`, patch).then(reloadUnits)}
        />
      )}
      {activeTab === 'categories' && (
        <CategoriesTab
          categories={categories}
          onReload={reloadCategories}
        />
      )}
      {activeTab === 'ingredients' && <IngredientsTab units={units} products={products} />}
      {activeTab === 'margin'      && <MarginTab products={products} />}
      {activeTab === 'users'       && <UsersTab />}
      {activeTab === 'settings'    && <SettingsTab />}
      {activeTab === 'permissions' && <RolePermissionsTab onSaved={reloadPermissions} />}
    </div>
  )
}

// ─── Вироби ─────────────────────────────────────────────────────────────────

interface ProductFormState {
  name: string
  short_name: string
  weight: string
  unit_id: string
  category_id: string
}

const emptyProduct = (): ProductFormState => ({
  name: '', short_name: '', weight: '', unit_id: '', category_id: '',
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
            <Th>Назва</Th><Th>Скорочена</Th><Th>Категорія</Th>
            <Th>Вага, кг</Th><Th>Активний</Th><Th>Дії</Th>
          </tr>
        </thead>
        <tbody>
          {products.map((p) => (
            <tr key={p.id} style={{ opacity: p.is_active ? 1 : 0.45 }}>
              <Td>{p.name}</Td>
              <Td>{p.short_name ?? '—'}</Td>
              <Td>{categories.find((c) => c.id === p.category_id)?.name ?? '—'}</Td>
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
  client_kind: string; bot_phones: string
}

const emptyClient = (): ClientFormState => ({
  full_name: '', short_name: '', address: '', phone: '',
  director: '', accountant: '', route_id: '', discount_pct: '0',
  client_kind: 'customer', bot_phones: '',
})

interface BotUser {
  id: number; chat_id: string; phone: string | null
  first_name: string | null; authorized_at: string | null; is_active: number
}

const CLIENT_KIND_LABELS: Record<string, string> = {
  customer: 'Клієнт',
  shop:     'Власний магазин',
  writeoff: 'Списання',
  ration:   'Пайок',
}

function ClientsTab({ routes }: { routes: Route[] }) {
  const [clients, setClients]   = useState<Client[]>([])
  const [modal, setModal]       = useState(false)
  const [editing, setEditing]   = useState<Client | null>(null)
  const [form, setForm]         = useState<ClientFormState>(emptyClient())
  const [saving, setSaving]     = useState(false)
  const [botUsers, setBotUsers] = useState<BotUser[]>([])

  const load = () => api.get<Client[]>('/clients/?active_only=false').then(setClients)
  useEffect(() => { load() }, [])

  const openNew  = () => { setEditing(null); setForm(emptyClient()); setBotUsers([]); setModal(true) }
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
      client_kind:  c.client_kind ?? 'customer',
      bot_phones:  c.bot_phones ?? '',
    })
    api.get<BotUser[]>(`/bot/clients/${c.id}/bot-users`).then(setBotUsers).catch(() => setBotUsers([]))
    setModal(true)
  }
  const closeModal = () => { setModal(false); setBotUsers([]) }

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
      client_kind: form.client_kind,
      is_own_shop: form.client_kind === 'shop' ? 1 : 0,
      bot_phones:  form.bot_phones.trim() || null,
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
            <Th>Назва</Th><Th>Скорочена</Th><Th>Тип</Th><Th>Маршрут</Th>
            <Th>Знижка %</Th><Th>Телефон</Th><Th>Активний</Th><Th>Дії</Th>
          </tr>
        </thead>
        <tbody>
          {clients.map((c) => (
            <tr key={c.id} style={{ opacity: c.is_active ? 1 : 0.45 }}>
              <Td>{c.full_name}</Td>
              <Td>{c.short_name ?? '—'}</Td>
              <Td>{CLIENT_KIND_LABELS[c.client_kind] ?? c.client_kind}</Td>
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
              <label>Тип клієнта</label>
              <select value={form.client_kind} onChange={(e) => setForm({ ...form, client_kind: e.target.value })}>
                <option value="customer">Клієнт</option>
                <option value="shop">Власний магазин</option>
                <option value="writeoff">Списання</option>
                <option value="ration">Пайок</option>
              </select>
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
            <div className={formStyles.field}>
              <label>Телефони для авторизації в боті</label>
              <input value={form.bot_phones}
                onChange={(e) => setForm({ ...form, bot_phones: e.target.value })}
                placeholder="+380501234567, +380671234567" />
              <span className={formStyles.hint}>Через кому. Клієнт надсилає свій контакт — бот звіряє з цим списком.</span>
            </div>
            {editing && botUsers.length > 0 && (
              <div className={formStyles.field}>
                <label>Авторизовані користувачі бота</label>
                <table style={{ width: '100%', fontSize: '0.83rem', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#f0f4f8' }}>
                      <th style={{ padding: '0.22rem 0.5rem', textAlign: 'left' }}>Ім'я</th>
                      <th style={{ padding: '0.22rem 0.5rem', textAlign: 'left' }}>Телефон</th>
                      <th style={{ padding: '0.22rem 0.5rem', textAlign: 'left' }}>Авторизовано</th>
                      <th style={{ padding: '0.22rem 0.3rem' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {botUsers.map((u) => (
                      <tr key={u.id} style={{ opacity: u.is_active ? 1 : 0.5, borderBottom: '1px solid #eee' }}>
                        <td style={{ padding: '0.2rem 0.5rem' }}>{u.first_name ?? '—'}</td>
                        <td style={{ padding: '0.2rem 0.5rem' }}>{u.phone ?? '—'}</td>
                        <td style={{ padding: '0.2rem 0.5rem', color: '#7090b0' }}>{u.authorized_at?.slice(0, 16) ?? '—'}</td>
                        <td style={{ padding: '0.2rem 0.3rem' }}>
                          <button
                            type="button"
                            title="Відкликати авторизацію"
                            onClick={async () => {
                              if (!confirm(`Відкликати авторизацію ${u.first_name ?? u.chat_id}?`)) return
                              await api.delete(`/bot/clients/${editing.id}/bot-users/${u.id}`)
                              setBotUsers((prev) => prev.filter((x) => x.id !== u.id))
                            }}
                            style={{ background: '#fde', border: '1px solid #e88', borderRadius: 3, cursor: 'pointer', padding: '0.1rem 0.4rem', color: '#900', fontSize: '0.8rem' }}
                          >✕</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
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

// ─── Категорії (відділи) ─────────────────────────────────────────────────────

interface CategoryFormState { name: string; is_baked: boolean; reserve_pct: string; sort_order: string }
const emptyCategoryForm = (): CategoryFormState => ({ name: '', is_baked: true, reserve_pct: '5', sort_order: '0' })

function CategoriesTab({ categories, onReload }: { categories: Category[]; onReload: () => void }) {
  const [modal,   setModal]   = useState(false)
  const [editing, setEditing] = useState<Category | null>(null)
  const [form,    setForm]    = useState<CategoryFormState>(emptyCategoryForm())
  const [saving,  setSaving]  = useState(false)
  const [newName, setNewName] = useState('')
  const [error,   setError]   = useState<string | null>(null)

  const openEdit = (c: Category) => {
    setEditing(c)
    setError(null)
    setForm({ name: c.name, is_baked: !!c.is_baked, reserve_pct: String(c.reserve_pct), sort_order: String(c.sort_order) })
    setModal(true)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editing) return
    setSaving(true)
    setError(null)
    try {
      await api.put(`/categories/${editing.id}`, {
        name:        form.name,
        is_baked:    form.is_baked ? 1 : 0,
        reserve_pct: Number(form.reserve_pct),
        sort_order:  Number(form.sort_order),
      })
      onReload()
      setModal(false)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const detail = msg.match(/"detail":"([^"]+)"/)?.[1] ?? msg
      setError(detail)
    } finally { setSaving(false) }
  }

  const handleAdd = async () => {
    const name = newName.trim()
    if (!name) return
    setSaving(true)
    setError(null)
    try {
      await api.post('/categories', null, `name=${encodeURIComponent(name)}`)
      setNewName('')
      onReload()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const detail = msg.match(/"detail":"([^"]+)"/)?.[1] ?? msg
      setError(detail)
    } finally { setSaving(false) }
  }

  const handleToggle = async (c: Category) => {
    if (!confirm(`${c.is_active ? 'Приховати' : 'Відновити'} категорію "${c.name}"?`)) return
    await api.put(`/categories/${c.id}`, { is_active: c.is_active ? 0 : 1 })
    onReload()
  }

  const sorted = [...categories].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'uk'))

  return (
    <section>
      <strong>Категорії (відділи) — {categories.filter((c) => c.is_active).length} активних</strong>
      <div style={{ display: 'flex', gap: '0.5rem', margin: '0.75rem 0', flexWrap: 'wrap' }}>
        <input value={newName} onChange={(e) => { setNewName(e.target.value); setError(null) }}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          placeholder="напр. Хліб, Булки, Магазин"
          style={{ padding: '0.4rem 0.6rem', border: '1px solid #ccc', borderRadius: '4px', fontSize: '0.9rem', flex: 1, maxWidth: '260px' }} />
        <button onClick={handleAdd} disabled={saving || !newName.trim()} style={addBtnStyle}>+ Додати категорію</button>
        {error && !modal && <span style={{ color: '#c00', fontSize: '0.85rem', alignSelf: 'center' }}>⚠ {error}</span>}
      </div>
      <table style={tableStyle}>
        <thead>
          <tr style={{ background: '#e8eef5' }}>
            <Th>Порядок</Th><Th>Назва</Th><Th>Відділ випічки</Th><Th>Резерв, %</Th><Th>Активна</Th><Th>Дії</Th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((c) => (
            <tr key={c.id} style={{ opacity: c.is_active ? 1 : 0.45 }}>
              <Td>{c.sort_order}</Td>
              <Td>{c.name}</Td>
              <Td>{c.is_baked ? '✓ Випікається' : '—'}</Td>
              <Td>{c.is_baked ? `${c.reserve_pct}%` : '—'}</Td>
              <Td>{c.is_active ? '✓' : '✗'}</Td>
              <Td>
                <button onClick={() => openEdit(c)} style={editBtnStyle}>Редагувати</button>
                <button onClick={() => handleToggle(c)} style={c.is_active ? delBtnStyle : { ...editBtnStyle, color: '#080' }}>
                  {c.is_active ? 'Приховати' : 'Відновити'}
                </button>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>

      {modal && editing && (
        <Modal title={`Редагувати категорію: ${editing.name}`} onClose={() => setModal(false)}>
          <form onSubmit={handleSave} className={formStyles.form}>
            <div className={formStyles.field}>
              <label>Назва *</label>
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className={formStyles.field}>
              <label>
                <input type="checkbox" checked={form.is_baked} onChange={(e) => setForm({ ...form, is_baked: e.target.checked })} />
                {' '}Відділ випічки (товари цієї категорії випікаються)
              </label>
            </div>
            {form.is_baked && (
              <div className={formStyles.field}>
                <label>Резерв, %</label>
                <input type="number" min="0" max="100" step="0.1" value={form.reserve_pct}
                  onChange={(e) => setForm({ ...form, reserve_pct: e.target.value })} />
                <span className={formStyles.hint}>Додаток до замовленої кількості при формуванні завдання на випічку</span>
              </div>
            )}
            <div className={formStyles.field}>
              <label>Порядок сортування</label>
              <input type="number" step="1" value={form.sort_order}
                onChange={(e) => setForm({ ...form, sort_order: e.target.value })} />
            </div>
            {error && <div style={{ color: '#c00', fontSize: '0.85rem', marginBottom: '0.5rem' }}>⚠ {error}</div>}
            <div className={formStyles.actions}>
              <button type="button" onClick={() => setModal(false)} className={formStyles.btnSecondary}>Скасувати</button>
              <button type="submit" disabled={saving} className={formStyles.btnPrimary}>{saving ? 'Збереження...' : 'Зберегти'}</button>
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
  order_lock_time:   'Час блокування замовлень',
}

function SettingsTab() {
  const [settings, setSettings] = useState<SettingsMap>({})
  const [form,     setForm]     = useState<Record<string, string>>({})
  const [saving,   setSaving]   = useState(false)
  const [saved,    setSaved]    = useState(false)

  // Telegram
  const [tgToken,   setTgToken]   = useState('')
  const [tgPhones,  setTgPhones]  = useState('')   // через кому
  const [tgRunning, setTgRunning] = useState(false)
  const [tgChats,   setTgChats]   = useState<{ chat_id: string; phone: string }[]>([])
  const [tgSaving,  setTgSaving]  = useState(false)
  const [tgMsg,     setTgMsg]     = useState('')
  const [showToken, setShowToken] = useState(false)

  const load = () =>
    api.get<SettingsMap>('/settings/').then((data) => {
      setSettings(data)
      const vals: Record<string, string> = {}
      Object.entries(SETTINGS_LABELS).forEach(([k]) => {
        vals[k] = data[k]?.value ?? ''
      })
      setForm(vals)
      setTgToken(data['telegram_bot_token']?.value ?? '')
      setTgPhones(data['telegram_allowed_phones']?.value ?? '')
    })

  const loadTgStatus = () =>
    api.get<{ running: boolean }>('/settings/telegram/status').then(d => setTgRunning(d.running))

  const loadTgChats = () =>
    api.get<{ chats: { chat_id: string; phone: string }[] }>('/settings/telegram/authorized')
      .then(d => setTgChats(d.chats))

  useEffect(() => {
    load()
    loadTgStatus()
    loadTgChats()
    const id = setInterval(loadTgStatus, 10000)
    return () => clearInterval(id)
  }, []) // eslint-disable-line

  const handleSave = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true); setSaved(false)
    try {
      await Promise.all(
        Object.entries(form).map(([key, value]) =>
          api.put(`/settings/${key}`, { value, description: settings[key]?.description ?? '' })
        )
      )
      setSaved(true)
      await load()
    } finally { setSaving(false) }
  }

  const saveTgSettings = async () => {
    setTgSaving(true); setTgMsg('')
    try {
      await api.put('/settings/telegram_bot_token',    { value: tgToken })
      await api.put('/settings/telegram_allowed_phones', { value: tgPhones })
      // Перезапускаємо бота з новим токеном
      const res = await api.post<{ running: boolean; has_token: boolean }>(
        '/settings/telegram/restart', null
      )
      setTgRunning(res.running)
      setTgMsg(res.running ? '✓ Бот запущено' : res.has_token ? '⚠ Не вдалось запустити — перевірте токен' : 'Токен не задано — бот не запущено')
    } catch (err) {
      setTgMsg(String(err))
    } finally { setTgSaving(false) }
  }

  const stopBot = async () => {
    await api.post('/settings/telegram/stop', null)
    setTgRunning(false); setTgMsg('Бот зупинено')
  }

  const revokeChat = async (chatId: string) => {
    await api.delete(`/settings/telegram/authorized/${chatId}`)
    await loadTgChats()
  }

  const fieldStyle: React.CSSProperties = {
    display: 'flex', flexDirection: 'column', gap: '0.25rem', marginBottom: '0.85rem',
  }
  const labelStyle: React.CSSProperties = { fontSize: '0.85rem', fontWeight: 500, color: '#444' }
  const inputStyle: React.CSSProperties = {
    padding: '0.4rem 0.6rem', border: '1px solid #ccc', borderRadius: '4px',
    fontSize: '0.9rem', maxWidth: '420px',
  }

  const sectionHead: React.CSSProperties = {
    fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: '0.08em', color: '#7a8899', margin: '1.5rem 0 0.75rem',
  }

  return (
    <section>
      {/* ── Параметри пекарні ── */}
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

      {/* ── Telegram-бот ── */}
      <p style={sectionHead}>Telegram-бот</p>

      <div style={{ maxWidth: 520, background: '#f8fafc', border: '1px solid #dde3ea', borderRadius: 8, padding: '1rem 1.25rem' }}>

        {/* Статус */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <span style={{
            width: 10, height: 10, borderRadius: '50%',
            background: tgRunning ? '#27ae60' : '#e74c3c', display: 'inline-block',
          }} />
          <span style={{ fontWeight: 600 }}>{tgRunning ? 'Бот запущено' : 'Бот зупинено'}</span>
          {tgRunning && (
            <button onClick={stopBot} style={{ ...delBtnStyle, marginLeft: 'auto' }}>Зупинити</button>
          )}
        </div>

        {/* Токен */}
        <div style={fieldStyle}>
          <label style={labelStyle}>Bot Token (від @BotFather)</label>
          <div style={{ display: 'flex', gap: 6, maxWidth: 420 }}>
            <input
              type={showToken ? 'text' : 'password'}
              style={{ ...inputStyle, flex: 1, maxWidth: 'none' }}
              value={tgToken}
              onChange={e => setTgToken(e.target.value)}
              placeholder="1234567890:AAF..."
            />
            <button type="button" onClick={() => setShowToken(v => !v)}
              style={{ ...editBtnStyle, whiteSpace: 'nowrap' }}>
              {showToken ? 'Сховати' : 'Показати'}
            </button>
          </div>
        </div>

        {/* Дозволені телефони */}
        <div style={fieldStyle}>
          <label style={labelStyle}>Дозволені номери телефонів</label>
          <textarea
            style={{ ...inputStyle, maxWidth: 'none', width: '100%', height: 70, resize: 'vertical', fontFamily: 'monospace', fontSize: '0.85rem' }}
            value={tgPhones}
            onChange={e => setTgPhones(e.target.value)}
            placeholder="+380501234567, +380671234567"
          />
          <span style={{ fontSize: 12, color: '#888' }}>Через кому. Формат: +380XXXXXXXXX</span>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={saveTgSettings} disabled={tgSaving} style={addBtnStyle}>
            {tgSaving ? 'Збереження...' : 'Зберегти і перезапустити'}
          </button>
          {tgMsg && (
            <span style={{ fontSize: 13, color: tgMsg.startsWith('✓') ? '#27ae60' : '#e74c3c' }}>
              {tgMsg}
            </span>
          )}
        </div>

        {/* Авторизовані користувачі */}
        {tgChats.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ ...sectionHead, margin: '0 0 8px' }}>Авторизовані користувачі</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#e8eef5' }}>
                  <th style={{ padding: '5px 8px', textAlign: 'left' }}>Chat ID</th>
                  <th style={{ padding: '5px 8px', textAlign: 'left' }}>Телефон</th>
                  <th style={{ width: 60 }}></th>
                </tr>
              </thead>
              <tbody>
                {tgChats.map(c => (
                  <tr key={c.chat_id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <td style={{ padding: '5px 8px', fontFamily: 'monospace' }}>{c.chat_id}</td>
                    <td style={{ padding: '5px 8px' }}>{c.phone}</td>
                    <td style={{ padding: '5px 8px', textAlign: 'center' }}>
                      <button onClick={() => revokeChat(c.chat_id)} style={delBtnStyle}
                        title="Відкликати доступ">✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Інструкція */}
        <details style={{ marginTop: 14, fontSize: 13, color: '#555' }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Як налаштувати бота</summary>
          <ol style={{ marginTop: 8, paddingLeft: 18, lineHeight: 1.7 }}>
            <li>Напишіть <code>@BotFather</code> в Telegram → <code>/newbot</code></li>
            <li>Введіть назву та username бота (напр. <code>MyBakeryBot</code>)</li>
            <li>Скопіюйте токен у поле вище</li>
            <li>Додайте свій номер телефону в список дозволених</li>
            <li>Натисніть "Зберегти і перезапустити"</li>
            <li>Знайдіть бота в Telegram → <code>/start</code> → поділіться номером</li>
          </ol>
        </details>
      </div>

      {/* ── Шаблони повідомлень бота ── */}
      <BotTemplatesSection
        settings={settings}
        onReload={load}
        inputStyle={inputStyle}
        fieldStyle={fieldStyle}
        labelStyle={labelStyle}
        addBtnStyle={addBtnStyle}
        sectionHead={sectionHead}
      />

      {/* ── Система звернень ── */}
      <IssuesSettingsSection
        settings={settings}
        inputStyle={inputStyle}
        fieldStyle={fieldStyle}
        labelStyle={labelStyle}
        addBtnStyle={addBtnStyle}
        sectionHead={sectionHead}
      />
    </section>
  )
}

// ─── Шаблони повідомлень Telegram-бота ────────────────────────────────────────

const BOT_TEMPLATES: { key: string; label: string; hint: string }[] = [
  { key: 'bot_tpl_reminder',  label: 'Нагадування про замовлення',       hint: 'Змінні: {date}' },
  { key: 'bot_tpl_deadline',  label: 'Стоп-прийом замовлень',           hint: 'Змінні: {date}' },
  { key: 'bot_tpl_confirmed', label: 'Підтверджено оператором',          hint: 'Змінні: {product}, {qty}, {date}, {sum}' },
  { key: 'bot_tpl_rejected',  label: 'Відхилено оператором',             hint: 'Змінні: {product}, {qty}, {date}, {reason}' },
  { key: 'bot_tpl_modified',  label: 'Підтверджено зі змінами',          hint: 'Змінні: {product}, {qty}, {new_qty}, {date}, {sum}, {reason}' },
]

function BotTemplatesSection({ settings, onReload, inputStyle, fieldStyle, labelStyle, addBtnStyle, sectionHead }: {
  settings: SettingsMap
  onReload: () => void
  inputStyle: React.CSSProperties
  fieldStyle: React.CSSProperties
  labelStyle: React.CSSProperties
  addBtnStyle: React.CSSProperties
  sectionHead: React.CSSProperties
}) {
  const [form, setForm] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    const vals: Record<string, string> = {}
    BOT_TEMPLATES.forEach(({ key }) => { vals[key] = settings[key]?.value ?? '' })
    setForm(vals)
  }, [settings])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true); setSaved(false)
    try {
      await Promise.all(
        BOT_TEMPLATES.map(({ key }) =>
          api.put(`/settings/${key}`, { value: form[key] ?? '', description: settings[key]?.description ?? '' })
        )
      )
      setSaved(true)
      onReload()
    } finally { setSaving(false) }
  }

  return (
    <>
      <p style={sectionHead}>Шаблони повідомлень бота</p>
      <form onSubmit={handleSave} style={{ maxWidth: 640 }}>
        {BOT_TEMPLATES.map(({ key, label, hint }) => (
          <div key={key} style={fieldStyle}>
            <label style={labelStyle}>{label}</label>
            <textarea
              style={{ ...inputStyle, maxWidth: 'none', width: '100%', height: 64, resize: 'vertical', fontFamily: 'monospace', fontSize: '0.83rem' }}
              value={form[key] ?? ''}
              onChange={e => setForm({ ...form, [key]: e.target.value })}
            />
            <span style={{ fontSize: 11, color: '#888' }}>{hint}</span>
          </div>
        ))}
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginTop: '0.25rem' }}>
          <button type="submit" disabled={saving} style={addBtnStyle}>
            {saving ? 'Збереження...' : 'Зберегти шаблони'}
          </button>
          {saved && <span style={{ color: '#2e7d32', fontSize: '0.9rem' }}>✓ Збережено</span>}
        </div>
      </form>
    </>
  )
}

// ─── Блок налаштувань системи звернень (GitHub OAuth) ─────────────────────────

type FlowState = 'idle' | 'waiting' | 'authorized'

function IssuesSettingsSection({ settings, inputStyle, fieldStyle, labelStyle, addBtnStyle, sectionHead }: {
  settings:    SettingsMap
  inputStyle:  React.CSSProperties
  fieldStyle:  React.CSSProperties
  labelStyle:  React.CSSProperties
  addBtnStyle: React.CSSProperties
  sectionHead: React.CSSProperties
}) {
  const [repo,      setRepo]      = useState(settings['github_repo']?.value ?? 'TSOrest/Bakery')
  const [repoMsg,   setRepoMsg]   = useState('')
  const [ghStatus,  setGhStatus]  = useState<GitHubStatus | null>(null)
  const [flowState, setFlowState] = useState<FlowState>('idle')
  const [userCode,  setUserCode]  = useState('')
  const [verifyUri, setVerifyUri] = useState('')
  const [flowMsg,   setFlowMsg]   = useState('')
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stoppedRef = useRef(false)

  useEffect(() => {
    setRepo(settings['github_repo']?.value ?? 'TSOrest/Bakery')
  }, [settings])

  useEffect(() => {
    getGitHubStatus().then(s => {
      setGhStatus(s)
      if (s.authorized) setFlowState('authorized')
    }).catch(() => {})
  }, [])

  // Зупиняємо polling при розмонтуванні
  useEffect(() => () => {
    stoppedRef.current = true
    if (pollRef.current) clearTimeout(pollRef.current)
  }, [])

  // Рекурсивний polling — надійніший за setInterval
  const schedulePoll = (deviceCode: string, interval: number) => {
    if (stoppedRef.current) return
    pollRef.current = setTimeout(async () => {
      if (stoppedRef.current) return
      try {
        const res = await pollDeviceFlow(deviceCode)
        if (res.status === 'authorized') {
          setGhStatus({ authorized: true, login: res.login, name: res.name, avatar_url: res.avatar_url })
          setFlowState('authorized')
          setFlowMsg('✓ Авторизовано')
        } else if (res.status === 'pending') {
          schedulePoll(deviceCode, interval)  // наступний крок
        } else {
          setFlowState('idle')
          setFlowMsg(res.status === 'access_denied' ? 'Доступ відхилено' : 'Час очікування вичерпано')
        }
      } catch (e: unknown) {
        setFlowState('idle')
        setFlowMsg(e instanceof Error ? e.message : 'Помилка polling')
      }
    }, interval * 1000)
  }

  const startFlow = async () => {
    stoppedRef.current = false
    if (pollRef.current) clearTimeout(pollRef.current)
    setFlowMsg(''); setFlowState('idle')
    try {
      const data = await startDeviceFlow()
      setUserCode(data.user_code)
      setVerifyUri(data.verification_uri)
      setFlowState('waiting')
      window.open(data.verification_uri, '_blank', 'noopener')
      schedulePoll(data.device_code, data.interval)
    } catch (e: unknown) {
      setFlowMsg(e instanceof Error ? e.message : 'Помилка запуску авторизації')
    }
  }

  const logout = async () => {
    await githubLogout()
    setGhStatus({ authorized: false })
    setFlowState('idle')
    setFlowMsg('')
  }

  const saveRepo = async () => {
    setRepoMsg('')
    try {
      await api.put('/settings/github_repo', { value: repo, description: 'GitHub репозиторій (owner/repo)' })
      setRepoMsg('✓ Збережено')
    } catch { setRepoMsg('Помилка') }
  }

  return (
    <>
      <p style={sectionHead}>Система звернень (💬)</p>
      <div style={{ maxWidth: 520, background: '#f8fafc', border: '1px solid #dde3ea', borderRadius: 8, padding: '1rem 1.25rem' }}>

        {/* Статус авторизації */}
        {flowState === 'authorized' && ghStatus?.authorized ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            {ghStatus.avatar_url && (
              <img src={ghStatus.avatar_url} alt={ghStatus.login} style={{ width: 36, height: 36, borderRadius: '50%', border: '1px solid #d0d7de' }} />
            )}
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{ghStatus.name || ghStatus.login}</div>
              <div style={{ fontSize: 12, color: '#6e7781' }}>@{ghStatus.login}</div>
            </div>
            <span style={{ marginLeft: 'auto', fontSize: 12, color: '#27ae60', fontWeight: 600 }}>✓ Авторизовано</span>
            <button onClick={logout} style={{ ...addBtnStyle, background: '#6c757d', fontSize: 12 }}>
              Вийти
            </button>
          </div>
        ) : flowState === 'waiting' ? (
          <div style={{ marginBottom: 14, padding: '12px 14px', background: '#fff8e1', border: '1px solid #ffe082', borderRadius: 6 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Авторизація GitHub</div>
            <div style={{ fontSize: 13, marginBottom: 10 }}>
              Відкрийте <strong>{verifyUri}</strong> і введіть код:
            </div>
            <div style={{
              fontSize: 28, fontFamily: 'monospace', fontWeight: 700, letterSpacing: '0.2em',
              textAlign: 'center', padding: '10px 0', color: '#1a3a5c',
            }}>
              {userCode}
            </div>
            <div style={{ fontSize: 12, color: '#888', textAlign: 'center', marginTop: 6 }}>
              Очікуємо підтвердження...
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button
                onClick={() => window.open(verifyUri, '_blank', 'noopener')}
                style={{ ...addBtnStyle, flex: 1, textAlign: 'center' }}
              >
                Відкрити github.com/login/device ↗
              </button>
              <button
                onClick={startFlow}
                style={{ ...addBtnStyle, background: '#6c757d', whiteSpace: 'nowrap' }}
                title="Отримати новий код і почати спочатку"
              >
                Почати знову
              </button>
            </div>
          </div>
        ) : (
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#e74c3c', display: 'inline-block' }} />
              <span style={{ fontWeight: 600 }}>Не авторизовано</span>
            </div>
            <div style={{ fontSize: 12, color: '#888', marginTop: 4, marginBottom: 10 }}>
              Авторизуйте GitHub-акаунт пекарні — від його імені будуть надсилатись звернення та завантажуватись оновлення.
            </div>
            <button onClick={startFlow} style={addBtnStyle}>
              Авторизуватись через GitHub
            </button>
          </div>
        )}

        {flowMsg && (
          <div style={{ fontSize: 13, color: flowMsg.startsWith('✓') ? '#27ae60' : '#e74c3c', marginBottom: 10 }}>
            {flowMsg}
          </div>
        )}

        {/* Репозиторій */}
        <div style={fieldStyle}>
          <label style={labelStyle}>Репозиторій</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              style={{ ...inputStyle, flex: 1, maxWidth: 'none' }}
              value={repo}
              onChange={e => setRepo(e.target.value)}
              placeholder="owner/repo"
            />
            <button onClick={saveRepo} style={{ ...addBtnStyle, whiteSpace: 'nowrap' }}>
              Зберегти
            </button>
          </div>
          {repoMsg && <span style={{ fontSize: 12, color: repoMsg.startsWith('✓') ? '#27ae60' : '#e74c3c' }}>{repoMsg}</span>}
          <span style={{ fontSize: 12, color: '#888' }}>Формат: owner/repo (напр. TSOrest/Bakery)</span>
        </div>
      </div>
    </>
  )
}

// ─── Права ролей ──────────────────────────────────────────────────────────────

// Основні вкладки (не Довідники)
const MAIN_PAGE_PERMS = [
  { key: 'orders',   label: 'Замовлення' },
  { key: 'baking',   label: 'Випічка' },
  { key: 'routes',   label: 'Маршрути' },
  { key: 'shop',     label: 'Магазин' },
  { key: 'finances', label: 'Фінанси' },
]

// Підрозділи Довідників (всі конфігуруються)
const ADMIN_SUB_PERMS = ADMIN_TAB_GROUPS
  .map(g => ({ key: g.permKey as string, label: g.label }))

const ALL_ROLES = ['operator', 'accountant', 'admin', 'owner'] as const
const ROLE_LABELS_MAP: Record<string, string> = {
  operator:   'Оператор',
  accountant: 'Бухгалтер',
  admin:      'Адміністратор',
  owner:      'Власник',
}

function RolePermissionsTab({ onSaved }: { onSaved: () => Promise<void> }) {
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
    padding: '0.5rem 0.75rem', textAlign: 'center', fontWeight: 600,
    fontSize: '0.8rem', background: '#e8eef5', whiteSpace: 'nowrap',
  }
  const thGroupStyle: React.CSSProperties = {
    padding: '0.3rem 0.75rem', textAlign: 'center', fontWeight: 700,
    fontSize: '0.68rem', background: '#dde6f0', color: '#555',
    textTransform: 'uppercase', letterSpacing: '0.05em',
  }
  const tdStyle: React.CSSProperties = {
    padding: '0.45rem 0.75rem', textAlign: 'center',
    borderBottom: '1px solid #f0f0f0',
  }
  const tdSepStyle: React.CSSProperties = {
    ...tdStyle, borderLeft: '2px solid #c8d6e5', background: '#f7f9fc',
  }

  return (
    <section>
      <h3 style={{ marginTop: 0, marginBottom: '0.5rem' }}>Доступ ролей до розділів</h3>
      <p style={{ fontSize: '0.82rem', color: '#666', marginBottom: '1rem' }}>
        Оператори та бухгалтери бачать лише дозволені розділи. Адміністратор завжди має повний доступ.
      </p>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ ...tableStyle, width: 'auto' }}>
          <thead>
            {/* Рядок групових заголовків */}
            <tr>
              <th style={{ ...thGroupStyle, textAlign: 'left', background: '#e8eef5' }} rowSpan={2}>Роль</th>
              <th style={{ ...thGroupStyle }} colSpan={MAIN_PAGE_PERMS.length}>Основні розділи</th>
              <th style={{ ...thGroupStyle, borderLeft: '2px solid #c8d6e5' }} colSpan={ADMIN_SUB_PERMS.length}>Довідники</th>
            </tr>
            {/* Рядок конкретних колонок */}
            <tr>
              {MAIN_PAGE_PERMS.map(t => (
                <th key={t.key} style={thStyle}>{t.label}</th>
              ))}
              {ADMIN_SUB_PERMS.map((t, i) => (
                <th key={t.key} style={{ ...thStyle, ...(i === 0 ? { borderLeft: '2px solid #c8d6e5' } : {}) }}>
                  {t.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ALL_ROLES.map((role) => {
              const isAdmin = role === 'admin'
              return (
                <tr key={role} style={isAdmin ? { background: '#f0f4f8' } : undefined}>
                  <td style={{ ...tdStyle, textAlign: 'left', fontWeight: 500, whiteSpace: 'nowrap' }}>
                    {ROLE_LABELS_MAP[role]}
                    {isAdmin && <span style={{ fontSize: 10, color: '#888', marginLeft: 6 }}>(завжди всі)</span>}
                  </td>
                  {MAIN_PAGE_PERMS.map(t => (
                    <td key={t.key} style={tdStyle}>
                      {isAdmin ? (
                        <span style={{ color: '#27ae60', fontSize: 16 }}>✓</span>
                      ) : (
                        <input
                          type="checkbox"
                          checked={perms[role]?.has(t.key) ?? false}
                          onChange={() => toggle(role, t.key)}
                          style={{ cursor: 'pointer', width: '16px', height: '16px' }}
                        />
                      )}
                    </td>
                  ))}
                  {ADMIN_SUB_PERMS.map((t, i) => (
                    <td key={t.key} style={i === 0 ? tdSepStyle : tdStyle}>
                      {isAdmin ? (
                        <span style={{ color: '#27ae60', fontSize: 16 }}>✓</span>
                      ) : (
                        <input
                          type="checkbox"
                          checked={perms[role]?.has(t.key) ?? false}
                          onChange={() => toggle(role, t.key)}
                          style={{ cursor: 'pointer', width: '16px', height: '16px' }}
                        />
                      )}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
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

// ─── Інгредієнти ─────────────────────────────────────────────────────────────

function IngredientsTab({ units, products }: { units: Unit[]; products: Product[] }) {
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [editIng, setEditIng]         = useState<Ingredient | null>(null)
  const [addModal, setAddModal]       = useState(false)
  const [compProduct, setCompProduct] = useState<Product | null>(null)
  const [composition, setComposition] = useState<ProductIngredient[]>([])
  const [saving, setSaving]           = useState(false)
  const [error,  setError]            = useState('')

  const [addForm, setAddForm]   = useState({ name: '', unit_id: '', price_per_unit: '' })
  const [editForm, setEditForm] = useState({ name: '', unit_id: '', price_per_unit: '' })
  const [compForm, setCompForm] = useState({ ingredient_id: '', qty_per_unit: '' })

  const load = async () => setIngredients(await fetchIngredients())

  useEffect(() => { load() }, [])

  const openComp = async (p: Product) => {
    setCompProduct(p)
    setComposition(await fetchProductIngredients(p.id))
  }

  const submitAdd = async (e: FormEvent) => {
    e.preventDefault(); setSaving(true); setError('')
    try {
      await createIngredient({
        name: addForm.name,
        unit_id: addForm.unit_id ? Number(addForm.unit_id) : null,
        price_per_unit: Number(addForm.price_per_unit),
      })
      setAddModal(false)
      setAddForm({ name: '', unit_id: '', price_per_unit: '' })
      await load()
    } catch (err) { setError(String(err)) }
    finally { setSaving(false) }
  }

  const submitEdit = async (e: FormEvent) => {
    e.preventDefault()
    if (!editIng) return
    setSaving(true); setError('')
    try {
      await updateIngredient(editIng.id, {
        name: editForm.name,
        unit_id: editForm.unit_id ? Number(editForm.unit_id) : null,
        price_per_unit: Number(editForm.price_per_unit),
      })
      setEditIng(null)
      await load()
      if (compProduct) setComposition(await fetchProductIngredients(compProduct.id))
    } catch (err) { setError(String(err)) }
    finally { setSaving(false) }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('Видалити інгредієнт?')) return
    try { await deleteIngredient(id); await load() }
    catch (err) { alert(String(err)) }
  }

  const submitAddComp = async (e: FormEvent) => {
    e.preventDefault()
    if (!compProduct) return
    setSaving(true); setError('')
    try {
      await addProductIngredient(compProduct.id, {
        ingredient_id: Number(compForm.ingredient_id),
        qty_per_unit:  Number(compForm.qty_per_unit),
      })
      setCompForm({ ingredient_id: '', qty_per_unit: '' })
      setComposition(await fetchProductIngredients(compProduct.id))
    } catch (err) { setError(String(err)) }
    finally { setSaving(false) }
  }

  const handleRemoveComp = async (piId: number) => {
    if (!compProduct) return
    await removeProductIngredient(compProduct.id, piId)
    setComposition(await fetchProductIngredients(compProduct.id))
  }

  const uName = (id: number | null) => units.find(u => u.id === id)?.name ?? ''
  const totalCost = composition.reduce((s, r) => s + r.line_cost, 0)

  return (
    <section>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>

        {/* Ліва колонка: список інгредієнтів */}
        <div style={{ flex: '1 1 420px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
            <h3 style={{ margin: 0 }}>Інгредієнти / Сировина</h3>
            <button onClick={() => setAddModal(true)} style={addBtnStyle}>+ Додати</button>
          </div>

          <table style={tableStyle}>
            <thead>
              <tr style={{ background: '#e8eef5' }}>
                <Th>Назва</Th><Th>Од. виміру</Th><Th>Ціна / од.</Th><Th>Оновлено</Th><th style={{ width: 80 }}></th>
              </tr>
            </thead>
            <tbody>
              {ingredients.map(ing => (
                <tr key={ing.id}>
                  <Td>{ing.name}</Td>
                  <Td>{uName(ing.unit_id)}</Td>
                  <Td><strong>{ing.price_per_unit.toFixed(2)}</strong></Td>
                  <Td><span style={{ fontSize: 12, color: '#888' }}>{ing.price_updated_at?.slice(0, 10) ?? '—'}</span></Td>
                  <Td>
                    <button onClick={() => { setEditIng(ing); setEditForm({ name: ing.name, unit_id: String(ing.unit_id ?? ''), price_per_unit: String(ing.price_per_unit) }) }} style={{ ...editBtnStyle, marginRight: 4 }}>✎</button>
                    <button onClick={() => handleDelete(ing.id)} style={delBtnStyle}>✕</button>
                  </Td>
                </tr>
              ))}
              {ingredients.length === 0 && (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: '1rem', color: '#888' }}>Інгредієнти не додані</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Права колонка: склад виробу */}
        <div style={{ flex: '1 1 380px' }}>
          <div style={{ marginBottom: 10 }}>
            <h3 style={{ margin: '0 0 8px' }}>Склад виробу</h3>
            <select
              value={compProduct?.id ?? ''}
              onChange={e => {
                const p = products.find(p => p.id === Number(e.target.value))
                if (p) openComp(p); else { setCompProduct(null); setComposition([]) }
              }}
              style={{ padding: '5px 10px', border: '1px solid #ccc', borderRadius: 4, width: '100%' }}
            >
              <option value="">— оберіть виріб —</option>
              {products.filter(p => p.is_active).map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {compProduct && (
            <>
              <table style={tableStyle}>
                <thead>
                  <tr style={{ background: '#e8eef5' }}>
                    <Th>Інгредієнт</Th><Th>К-сть</Th><Th>Од.</Th><Th>Ціна</Th><Th>Сума</Th><th style={{ width: 36 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {composition.map(r => (
                    <tr key={r.id}>
                      <Td>{r.ingredient_name}</Td>
                      <Td>{r.qty_per_unit}</Td>
                      <Td>{r.unit_name}</Td>
                      <Td>{r.price_per_unit.toFixed(2)}</Td>
                      <Td><strong>{r.line_cost.toFixed(4)}</strong></Td>
                      <Td>
                        <button onClick={() => handleRemoveComp(r.id)} style={delBtnStyle}>✕</button>
                      </Td>
                    </tr>
                  ))}
                  {composition.length === 0 && (
                    <tr><td colSpan={6} style={{ textAlign: 'center', padding: '0.75rem', color: '#888' }}>Склад порожній</td></tr>
                  )}
                  {composition.length > 0 && (
                    <tr style={{ background: '#f0f4f8', fontWeight: 600 }}>
                      <td colSpan={4} style={{ padding: '6px 10px', textAlign: 'right' }}>Собівартість:</td>
                      <Td>{totalCost.toFixed(4)} грн</Td>
                      <td></td>
                    </tr>
                  )}
                </tbody>
              </table>

              <form onSubmit={submitAddComp} style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                <select required value={compForm.ingredient_id}
                  onChange={e => setCompForm({ ...compForm, ingredient_id: e.target.value })}
                  style={{ flex: 2, padding: '5px 8px', border: '1px solid #ccc', borderRadius: 4, minWidth: 140 }}>
                  <option value="">— інгредієнт —</option>
                  {ingredients
                    .filter(i => !composition.find(c => c.ingredient_id === i.id))
                    .map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
                <input required type="number" step="any" min="0.0001"
                  placeholder="К-сть" value={compForm.qty_per_unit}
                  onChange={e => setCompForm({ ...compForm, qty_per_unit: e.target.value })}
                  style={{ flex: 1, padding: '5px 8px', border: '1px solid #ccc', borderRadius: 4, minWidth: 80 }} />
                <button type="submit" disabled={saving} style={addBtnStyle}>+ Додати</button>
              </form>
              {error && <p style={{ color: '#c0392b', marginTop: 6, fontSize: 13 }}>{error}</p>}
            </>
          )}
        </div>
      </div>

      {addModal && (
        <Modal title="Новий інгредієнт" onClose={() => { setAddModal(false); setError('') }}>
          <form onSubmit={submitAdd} className={formStyles.form}>
            {error && <p style={{ color: '#c0392b', margin: '0 0 .5rem' }}>{error}</p>}
            <div className={formStyles.field}>
              <label>Назва *</label>
              <input required autoFocus value={addForm.name}
                onChange={e => setAddForm({ ...addForm, name: e.target.value })} />
            </div>
            <div className={formStyles.field}>
              <label>Одиниця виміру</label>
              <select value={addForm.unit_id} onChange={e => setAddForm({ ...addForm, unit_id: e.target.value })}>
                <option value="">— не вказано —</option>
                {units.filter(u => u.is_active).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
            <div className={formStyles.field}>
              <label>Ціна за одиницю, грн</label>
              <input type="number" step="0.0001" min="0" value={addForm.price_per_unit}
                onChange={e => setAddForm({ ...addForm, price_per_unit: e.target.value })} placeholder="0.00" />
            </div>
            <div className={formStyles.actions}>
              <button type="button" onClick={() => setAddModal(false)} className={formStyles.btnSecondary}>Скасувати</button>
              <button type="submit" disabled={saving} className={formStyles.btnPrimary}>{saving ? 'Збереження...' : 'Зберегти'}</button>
            </div>
          </form>
        </Modal>
      )}

      {editIng && (
        <Modal title={`Редагувати: ${editIng.name}`} onClose={() => { setEditIng(null); setError('') }}>
          <form onSubmit={submitEdit} className={formStyles.form}>
            {error && <p style={{ color: '#c0392b', margin: '0 0 .5rem' }}>{error}</p>}
            <div className={formStyles.field}>
              <label>Назва *</label>
              <input required autoFocus value={editForm.name}
                onChange={e => setEditForm({ ...editForm, name: e.target.value })} />
            </div>
            <div className={formStyles.field}>
              <label>Одиниця виміру</label>
              <select value={editForm.unit_id} onChange={e => setEditForm({ ...editForm, unit_id: e.target.value })}>
                <option value="">— не вказано —</option>
                {units.filter(u => u.is_active).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
            <div className={formStyles.field}>
              <label>Ціна за одиницю, грн</label>
              <input type="number" step="0.0001" min="0" value={editForm.price_per_unit}
                onChange={e => setEditForm({ ...editForm, price_per_unit: e.target.value })} />
              <span className={formStyles.hint}>Після збереження собівартість виробів перерахується автоматично</span>
            </div>
            <div className={formStyles.actions}>
              <button type="button" onClick={() => setEditIng(null)} className={formStyles.btnSecondary}>Скасувати</button>
              <button type="submit" disabled={saving} className={formStyles.btnPrimary}>{saving ? 'Збереження...' : 'Зберегти'}</button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  )
}

// ─── Маржа ───────────────────────────────────────────────────────────────────

function MarginTab({ products: _products }: { products: Product[] }) {
  const today = new Date().toISOString().slice(0, 10)
  const [date, setDate]         = useState(today)
  const [rows, setRows]         = useState<MarginRow[]>([])
  const [loading, setLoading]   = useState(false)
  const [recalcMsg, setRecalcMsg] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const data = await fetchMarginReport(date)
      setRows(data.rows)
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [date]) // eslint-disable-line

  const handleRecalc = async () => {
    const res = await recalculateAllCosts()
    setRecalcMsg(`Перераховано: ${res.recalculated} виробів`)
    await load()
    setTimeout(() => setRecalcMsg(''), 3000)
  }

  const avgMarginPct = rows.length
    ? rows.filter(r => r.price > 0).reduce((s, r) => s + r.margin_pct, 0) / (rows.filter(r => r.price > 0).length || 1)
    : 0

  return (
    <section>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>Маржинальність виробів</h3>
        <input type="date" value={date} onChange={e => setDate(e.target.value)}
          style={{ padding: '4px 8px', border: '1px solid #ccc', borderRadius: 4 }} />
        <button onClick={handleRecalc} style={{ ...editBtnStyle, background: '#1a3a5c', color: '#fff', border: 'none' }}>
          ↺ Перерахувати собівартість
        </button>
        {recalcMsg && <span style={{ color: '#2e7d32', fontSize: 13 }}>{recalcMsg}</span>}
        {loading && <span style={{ color: '#888', fontSize: 13 }}>Завантаження...</span>}
      </div>

      {rows.length > 0 && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
          {[
            { label: 'Виробів',         value: String(rows.length),                                    color: '#1a3a5c' },
            { label: 'Без собівартості', value: String(rows.filter(r => r.cost_per_unit === 0).length), color: '#e67e22' },
            { label: 'Збиткових',       value: String(rows.filter(r => r.price > 0 && r.margin_grn < 0).length), color: '#c0392b' },
            { label: 'Середня маржа',   value: `${avgMarginPct.toFixed(1)}%`, color: avgMarginPct >= 20 ? '#2e7d32' : '#e67e22' },
          ].map(c => (
            <div key={c.label} style={{
              background: '#f8fafc', border: '1px solid #dde3ea', borderRadius: 8,
              padding: '10px 18px', minWidth: 120,
            }}>
              <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 1 }}>{c.label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: c.color }}>{c.value}</div>
            </div>
          ))}
        </div>
      )}

      <table style={tableStyle}>
        <thead>
          <tr style={{ background: '#e8eef5' }}>
            <Th>Виріб</Th>
            <Th>Собівартість, грн</Th>
            <Th>Ціна продажу, грн</Th>
            <Th>Маржа, грн</Th>
            <Th>Маржа, %</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const noPrice = r.price === 0
            const noCost  = r.cost_per_unit === 0
            const loss    = r.margin_grn < 0
            return (
              <tr key={r.product_id}>
                <Td>{r.product_name}</Td>
                <Td>{noCost ? <span style={{ color: '#e67e22' }}>не задана</span> : r.cost_per_unit.toFixed(4)}</Td>
                <Td>{noPrice ? <span style={{ color: '#e67e22' }}>не задана</span> : r.price.toFixed(2)}</Td>
                <Td>
                  <strong style={{ color: loss ? '#c0392b' : noPrice || noCost ? '#aaa' : '#2e7d32' }}>
                    {noPrice || noCost ? '—' : r.margin_grn.toFixed(4)}
                  </strong>
                </Td>
                <Td>
                  <strong style={{ color: loss ? '#c0392b' : noPrice || noCost ? '#aaa' : '#2e7d32' }}>
                    {noPrice || noCost ? '—' : `${r.margin_pct.toFixed(1)}%`}
                  </strong>
                </Td>
              </tr>
            )
          })}
          {rows.length === 0 && !loading && (
            <tr><td colSpan={5} style={{ textAlign: 'center', padding: '1rem', color: '#888' }}>Дані відсутні</td></tr>
          )}
        </tbody>
      </table>
    </section>
  )
}
