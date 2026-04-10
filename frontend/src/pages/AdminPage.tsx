import { useEffect, useState, useRef, type FormEvent } from 'react'
import { startDeviceFlow, pollDeviceFlow, getGitHubStatus, githubLogout, type GitHubStatus } from '../api/auth_github'
import { api } from '../api/client'
import type { Client, Product, Route, Unit, Category, Price, ClientPriceOverride, Ingredient, ProductIngredient, MarginRow } from '../types'
import Modal from '../components/Modal'
import PriceGantt, { type GanttRow, type GanttPriceSegment } from '../components/PriceGantt'
import formStyles from '../components/Form.module.css'
import UsersTab from './UsersTab'
import ImportPage from './ImportPage'
import { useAuth } from '../context/AuthContext'
import {
  fetchIngredients, createIngredient, updateIngredient, deleteIngredient,
  fetchProductIngredients, addProductIngredient, removeProductIngredient,
  fetchMarginReport, recalculateAllCosts,
} from '../api/ingredients'
import {
  fetchFinanceArticles, createFinanceArticle, updateFinanceArticle, deleteFinanceArticle,
} from '../api/financeArticles'
import type { FinanceArticle } from '../types'

// Тип вкладки
type Tab =
  | 'products' | 'categories' | 'units'
  | 'clients'  | 'routes'
  | 'prices'   | 'ingredients' | 'margin'
  | 'settings_bakery' | 'settings_bot' | 'settings_bot_tpl' | 'settings_issues'
  | 'users' | 'permissions'
  | 'system_clients'
  | 'finance_articles'
  | 'backup'

interface TabGroup {
  label: string
  permKey: string
  tabs: { key: Tab; label: string }[]
}

const ADMIN_TAB_GROUPS: TabGroup[] = [
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
    label: 'Організація',
    permKey: 'admin_org',
    tabs: [
      { key: 'settings_bakery',  label: 'Параметри пекарні' },
      { key: 'system_clients',    label: 'Системні клієнти' },
      { key: 'finance_articles',  label: 'Фінансові статті' },
      { key: 'settings_bot',      label: 'Telegram Бот' },
      { key: 'settings_bot_tpl', label: 'Шаблони повідомлень' },
      { key: 'settings_issues',  label: 'Система звернень' },
    ],
  },
  {
    label: 'Система',
    permKey: 'admin_system',
    tabs: [
      { key: 'users',       label: 'Користувачі' },
      { key: 'permissions', label: 'Права ролей' },
      { key: 'backup',      label: 'Бекапи та імпорт' },
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
    <div style={{ padding: '1.5rem', display: 'flex', gap: 0, height: '100%', overflow: 'hidden', boxSizing: 'border-box' }}>

      {/* ── Вертикальний сайдбар ────────────────────────────────────────────── */}
      <nav style={{
        width: 210, flexShrink: 0,
        borderRight: '1px solid #e2e8f0',
        paddingRight: '0.75rem',
        marginRight: '1.75rem',
        paddingTop: '0.25rem',
        overflowY: 'auto',
        height: '100%',
      }}>
        {visibleGroups.map(group => (
          <div key={group.label} style={{ marginBottom: '1.1rem' }}>
            <div style={{
              fontSize: '0.62rem', fontWeight: 800, textTransform: 'uppercase',
              letterSpacing: '0.09em', color: '#b0bec5',
              padding: '0 0.5rem', marginBottom: '0.25rem',
              userSelect: 'none',
            }}>
              {group.label}
            </div>
            {group.tabs.map(t => {
              const isActive = activeTab === t.key
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    padding: '0.38rem 0.65rem',
                    borderRadius: '6px',
                    border: 'none',
                    background: isActive ? '#1a3a5c' : 'transparent',
                    color: isActive ? '#fff' : '#374151',
                    cursor: 'pointer',
                    fontSize: '0.875rem',
                    fontWeight: isActive ? 600 : 400,
                    marginBottom: '0.1rem',
                    transition: 'background 0.1s, color 0.1s',
                  }}
                  onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = '#f1f5f9' }}
                  onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
                >
                  {t.label}
                </button>
              )
            })}
          </div>
        ))}

        {/* ── База даних (тільки адмін) ──────────────────────────────────────── */}
        {isAdmin && (
          <div style={{ marginBottom: '1.1rem' }}>
            <div style={{
              fontSize: '0.62rem', fontWeight: 800, textTransform: 'uppercase',
              letterSpacing: '0.09em', color: '#b0bec5',
              padding: '0 0.5rem', marginBottom: '0.25rem',
              userSelect: 'none',
            }}>
              База даних
            </div>
            <button
              onClick={() => window.open('/db-editor', '_blank')}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '0.38rem 0.65rem',
                borderRadius: '6px',
                border: 'none',
                background: 'transparent',
                color: '#374151',
                cursor: 'pointer',
                fontSize: '0.875rem',
                fontWeight: 400,
                marginBottom: '0.1rem',
                transition: 'background 0.1s, color 0.1s',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#f1f5f9' }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
            >
              ⚠️ Редактор БД
            </button>
          </div>
        )}
      </nav>

      {/* ── Контент ─────────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', height: '100%' }}>
        {activeTab === 'products' && (
          <ProductsTab products={products} units={units} categories={categories} onReload={reloadProducts} />
        )}
        {activeTab === 'clients'        && <ClientsTab routes={routes} products={products} />}
        {activeTab === 'system_clients' && <SystemClientsTab routes={routes} />}
        {activeTab === 'routes'      && <RoutesTab routes={routes} onReload={reloadRoutes} />}
        {activeTab === 'prices'      && <PricesTab products={products} clients={clients} categories={categories} />}
        {activeTab === 'units'       && (
          <SimpleListTab
            title="Одиниці виміру"
            items={units}
            addLabel="+ Додати одиницю"
            placeholder="напр. буханка, шт, кг"
            onAdd={(name) => api.post('/units', null, `name=${encodeURIComponent(name)}`).then(reloadUnits)}
            onUpdate={(id, patch) => api.put(`/units/${id}`, patch).then(reloadUnits)}
          />
        )}
        {activeTab === 'categories'  && <CategoriesTab categories={categories} onReload={reloadCategories} />}
        {activeTab === 'ingredients' && <IngredientsTab units={units} products={products} />}
        {activeTab === 'margin'      && <MarginTab products={products} />}
        {activeTab === 'users'       && <UsersTab />}
        {activeTab === 'permissions' && <RolePermissionsTab onSaved={reloadPermissions} />}
        {(activeTab === 'settings_bakery'  ||
          activeTab === 'settings_bot'     ||
          activeTab === 'settings_bot_tpl' ||
          activeTab === 'settings_issues') && (
          <SettingsTab section={activeTab} />
        )}
        {activeTab === 'finance_articles' && <FinanceArticlesTab />}
        {activeTab === 'backup' && <BackupTab />}
      </div>
    </div>
  )
}

// ─── Фінансові статті ────────────────────────────────────────────────────────

function FinanceArticlesTab() {
  const [articles,  setArticles]  = useState<FinanceArticle[]>([])
  const [loading,   setLoading]   = useState(true)
  const [editId,    setEditId]    = useState<number | null>(null)
  const [editName,  setEditName]  = useState('')
  const [newName,   setNewName]   = useState('')
  const [newDir,    setNewDir]    = useState<'income' | 'expense'>('income')
  const [saving,    setSaving]    = useState(false)
  const [error,     setError]     = useState('')

  const s: React.CSSProperties = { fontSize: '0.85rem' }
  const btnS: React.CSSProperties = {
    padding: '4px 12px', border: '1px solid #d1d5db', borderRadius: 4,
    background: '#fff', cursor: 'pointer', fontSize: '0.82rem',
  }

  const load = () => {
    setLoading(true)
    fetchFinanceArticles().then(setArticles).finally(() => setLoading(false))
  }
  useEffect(load, [])

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return
    setSaving(true); setError('')
    try {
      await createFinanceArticle({ name: newName.trim(), direction: newDir })
      setNewName(''); load()
    } catch { setError('Помилка збереження') }
    finally { setSaving(false) }
  }

  async function handleSaveEdit(id: number) {
    if (!editName.trim()) return
    setSaving(true); setError('')
    try {
      await updateFinanceArticle(id, { name: editName.trim() })
      setEditId(null); load()
    } catch { setError('Помилка збереження') }
    finally { setSaving(false) }
  }

  async function handleDelete(id: number) {
    if (!confirm('Видалити статтю?')) return
    try {
      await deleteFinanceArticle(id); load()
    } catch { setError('Помилка видалення') }
  }

  const dirLabel = (d: string) => d === 'income' ? 'Надходження' : 'Витрати'
  const dirColor = (d: string) => d === 'income' ? '#27ae60' : '#e74c3c'

  return (
    <div style={{ maxWidth: 540, padding: '1.25rem' }}>
      <h3 style={{ marginTop: 0, marginBottom: '1rem' }}>Фінансові статті</h3>
      <p style={{ ...s, color: '#6b7280', marginBottom: '1rem' }}>
        Системні статті не можна видалити, лише редагувати назву.
        Власні статті — для нестандартних операцій, не пов'язаних з накладними.
      </p>

      {loading && <p style={s}>Завантаження…</p>}
      {error   && <p style={{ ...s, color: '#e74c3c' }}>{error}</p>}

      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '1.5rem' }}>
        <thead>
          <tr style={{ background: '#f9fafb', borderBottom: '2px solid #e5e7eb' }}>
            <th style={{ ...s, textAlign: 'left', padding: '6px 10px' }}>Назва</th>
            <th style={{ ...s, textAlign: 'left', padding: '6px 10px' }}>Напрям</th>
            <th style={{ ...s, padding: '6px 10px' }}></th>
          </tr>
        </thead>
        <tbody>
          {articles.map(a => (
            <tr key={a.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
              <td style={{ padding: '6px 10px' }}>
                {editId === a.id ? (
                  <input
                    autoFocus
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleSaveEdit(a.id); if (e.key === 'Escape') setEditId(null) }}
                    style={{ fontSize: '0.85rem', padding: '3px 6px', border: '1px solid #d1d5db', borderRadius: 3 }}
                  />
                ) : (
                  <span style={s}>{a.name}{a.is_system ? <span style={{ fontSize: '0.7rem', color: '#9ca3af', marginLeft: 6 }}>системна</span> : null}</span>
                )}
              </td>
              <td style={{ padding: '6px 10px' }}>
                <span style={{ ...s, color: dirColor(a.direction), fontWeight: 600 }}>
                  {dirLabel(a.direction)}
                </span>
              </td>
              <td style={{ padding: '6px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                {editId === a.id ? (
                  <>
                    <button style={{ ...btnS, background: '#2563eb', color: '#fff', border: 'none', marginRight: 4 }} disabled={saving} onClick={() => handleSaveEdit(a.id)}>Зберегти</button>
                    <button style={btnS} onClick={() => setEditId(null)}>Скасувати</button>
                  </>
                ) : (
                  <>
                    <button style={{ ...btnS, marginRight: 4 }} onClick={() => { setEditId(a.id); setEditName(a.name) }}>✎</button>
                    {!a.is_system && (
                      <button style={{ ...btnS, color: '#e74c3c', borderColor: '#fca5a5' }} onClick={() => handleDelete(a.id)}>×</button>
                    )}
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h4 style={{ ...s, marginBottom: '0.5rem' }}>Додати статтю</h4>
      <form onSubmit={handleAdd} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          value={newName} onChange={e => setNewName(e.target.value)}
          placeholder="Назва статті"
          required
          style={{ fontSize: '0.85rem', padding: '5px 8px', border: '1px solid #d1d5db', borderRadius: 4, minWidth: 180 }}
        />
        <select value={newDir} onChange={e => setNewDir(e.target.value as 'income' | 'expense')}
          style={{ fontSize: '0.85rem', padding: '5px 8px', border: '1px solid #d1d5db', borderRadius: 4 }}>
          <option value="income">Надходження</option>
          <option value="expense">Витрати</option>
        </select>
        <button type="submit" disabled={saving}
          style={{ ...btnS, background: '#2563eb', color: '#fff', border: 'none', padding: '5px 14px' }}>
          + Додати
        </button>
      </form>
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
  initial_price: string  // тільки при створенні; порожньо = не встановлювати
}

const emptyProduct = (): ProductFormState => ({
  name: '', short_name: '', weight: '', unit_id: '', category_id: '', initial_price: '',
})

function ProductsTab({
  products, units, categories, onReload,
}: {
  products: Product[]
  units: Unit[]
  categories: Category[]
  onReload: () => void
}) {
  const [modal, setModal]         = useState(false)
  const [editing, setEditing]     = useState<Product | null>(null)
  const [form, setForm]           = useState<ProductFormState>(emptyProduct())
  const [saving, setSaving]       = useState(false)
  const [showInactive, setShowInactive] = useState(false)
  const controlsRef = useRef<HTMLDivElement>(null)
  const [theadTop, setTheadTop] = useState(50)
  useEffect(() => {
    if (controlsRef.current) setTheadTop(controlsRef.current.offsetHeight)
  })

  const openNew  = () => { setEditing(null); setForm(emptyProduct()); setModal(true) }
  const openEdit = (p: Product) => {
    setEditing(p)
    setForm({
      name:          p.name,
      short_name:    p.short_name ?? '',
      weight:        p.weight?.toString() ?? '',
      unit_id:       p.unit_id?.toString() ?? '',
      category_id:   p.category_id?.toString() ?? '',
      initial_price: '',
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
        const created = await api.post<{ id: number }>('/products/', body)
        // Автоматично створюємо базову ціну якщо вказана при створенні
        const price = parseFloat(form.initial_price)
        if (created?.id && price > 0) {
          const today = new Date().toISOString().slice(0, 10)
          await api.post('/prices/', {
            product_id: created.id,
            price,
            valid_from: today,
          })
        }
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

  const activeProducts   = products.filter(p => p.is_active)
  const inactiveProducts = products.filter(p => !p.is_active)

  const renderProductRow = (p: Product) => (
    <tr key={p.id}>
      <Td>{p.name}</Td>
      <Td>{p.short_name ?? '—'}</Td>
      <Td>{categories.find((c) => c.id === p.category_id)?.name ?? '—'}</Td>
      <Td>{p.weight ?? '—'}</Td>
      <Td>
        <button onClick={() => openEdit(p)} style={editBtnStyle}>Редагувати</button>
        {p.is_active === 1 ? (
          <button onClick={() => handleDeactivate(p)} style={delBtnStyle}>Деактивувати</button>
        ) : (
          <button onClick={async () => { await api.put(`/products/${p.id}`, { is_active: 1 }); onReload() }} style={{ ...editBtnStyle, color: '#080' }}>Відновити</button>
        )}
      </Td>
    </tr>
  )

  return (
    <section>
      <div ref={controlsRef} style={{ position: 'sticky', top: 0, zIndex: 10, background: 'white', paddingBottom: 6, marginBottom: 2 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
          <strong>Вироби ({activeProducts.length})</strong>
          <button onClick={openNew} style={addBtnStyle}>+ Додати виріб</button>
        </div>
      </div>

      <table style={tableStyle}>
        <thead>
          <tr>
            <Th top={theadTop}>Назва</Th>
            <Th top={theadTop}>Скорочена</Th>
            <Th top={theadTop}>Категорія</Th>
            <Th top={theadTop}>Вага, кг</Th>
            <Th top={theadTop}>Дії</Th>
          </tr>
        </thead>
        <tbody>
          {activeProducts.map(renderProductRow)}
          {inactiveProducts.length > 0 && (
            <tr>
              <td colSpan={5} style={{ padding: '6px 10px', borderTop: '2px dashed #d1d5db' }}>
                <button
                  onClick={() => setShowInactive(v => !v)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: 13, padding: 0 }}
                >
                  {showInactive ? '▲' : '▼'} Деактивовані ({inactiveProducts.length})
                </button>
              </td>
            </tr>
          )}
          {showInactive && inactiveProducts.map(p => (
            <tr key={p.id} style={{ opacity: 0.5, background: '#f9fafb' }}>
              <Td>{p.name}</Td>
              <Td>{p.short_name ?? '—'}</Td>
              <Td>{categories.find((c) => c.id === p.category_id)?.name ?? '—'}</Td>
              <Td>{p.weight ?? '—'}</Td>
              <Td>
                <button onClick={() => openEdit(p)} style={editBtnStyle}>Редагувати</button>
                <button onClick={async () => { await api.put(`/products/${p.id}`, { is_active: 1 }); onReload() }} style={{ ...editBtnStyle, color: '#080' }}>Відновити</button>
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
            {!editing && (
              <div className={formStyles.field}>
                <label>Базова ціна, грн</label>
                <input
                  type="number" step="0.01" min="0"
                  value={form.initial_price}
                  onChange={(e) => setForm({ ...form, initial_price: e.target.value })}
                  placeholder="Наприклад: 27.50"
                />
                <span className={formStyles.hint}>Встановлюється з сьогоднішньої дати</span>
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
  customer:   'Клієнт',
  shop:       'Власний магазин',
  writeoff:   'Списання',
  ration:     'Пайок',
  underbaked: 'Недопечено',
}

function ClientsTab({ routes, products }: { routes: Route[]; products: Product[] }) {
  const today    = new Date().toISOString().slice(0, 10)
  const tomorrow = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10) })()
  const [clients, setClients]   = useState<Client[]>([])
  const [modal, setModal]       = useState(false)
  const [editing, setEditing]   = useState<Client | null>(null)
  const [form, setForm]         = useState<ClientFormState>(emptyClient())
  const [saving, setSaving]     = useState(false)
  const [botUsers, setBotUsers] = useState<BotUser[]>([])
  const [showInactive, setShowInactive] = useState(false)
  const controlsRef = useRef<HTMLDivElement>(null)
  const [theadTop, setTheadTop] = useState(50)
  useEffect(() => {
    if (controlsRef.current) setTheadTop(controlsRef.current.offsetHeight)
  })

  // Індивідуальні ціни клієнта
  const [clientOverrides,    setClientOverrides]    = useState<ClientPriceOverride[]>([])
  const [overrideAddForm,    setOverrideAddForm]    = useState({ product_id: '', price: '', valid_from: today, valid_to: '' })
  const [overrideAdding,     setOverrideAdding]     = useState(false)
  const [overrideSaving,     setOverrideSaving]     = useState(false)

  const loadClientOverrides = (clientId: number) =>
    api.get<ClientPriceOverride[]>(`/prices/overrides?client_id=${clientId}`)
      .then(setClientOverrides)
      .catch(() => setClientOverrides([]))

  const load = () => api.get<Client[]>('/clients/?active_only=false')
    .then(data => setClients(data.filter(c => c.client_kind === 'customer' || c.client_kind === 'shop')))
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
    loadClientOverrides(c.id)
    setOverrideAdding(false)
    setOverrideAddForm({ product_id: '', price: '', valid_from: tomorrow, valid_to: '' })
    setModal(true)
  }
  const closeModal = () => { setModal(false); setBotUsers([]); setClientOverrides([]) }

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
      client_kind: form.client_kind || 'customer',
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

  const activeClients   = clients.filter(c => c.is_active)
  const inactiveClients = clients.filter(c => !c.is_active)

  const renderClientRow = (c: Client, dimmed = false) => (
    <tr key={c.id} style={dimmed ? { opacity: 0.5, background: '#f9fafb' } : undefined}>
      <Td>{c.full_name}</Td>
      <Td>{c.short_name ?? '—'}</Td>
      <Td>{routeName(c.route_id)}</Td>
      <Td>{c.discount_pct}</Td>
      <Td>{c.phone ?? '—'}</Td>
      <Td>
        <button onClick={() => openEdit(c)} style={editBtnStyle}>Редагувати</button>
        {c.is_active === 1
          ? <button onClick={() => handleDeactivate(c)} style={delBtnStyle}>Деактивувати</button>
          : <button onClick={async () => { await api.put(`/clients/${c.id}`, { is_active: 1 }); load() }} style={{ ...editBtnStyle, color: '#080' }}>Відновити</button>
        }
      </Td>
    </tr>
  )

  const SECTION_HEADER_STYLE: React.CSSProperties = {
    background: '#f0f4f8', padding: '4px 10px', fontSize: 11,
    fontWeight: 600, color: '#475569', letterSpacing: '0.05em', textTransform: 'uppercase',
  }

  return (
    <section>
      <div ref={controlsRef} style={{ position: 'sticky', top: 0, zIndex: 10, background: 'white', paddingBottom: 6, marginBottom: 2 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
          <strong>Клієнти ({activeClients.length})</strong>
          <button onClick={openNew} style={addBtnStyle}>+ Додати клієнта</button>
        </div>
      </div>

      {(() => {
        const activeShops     = activeClients.filter(c => c.client_kind === 'shop')
        const activeCustomers = activeClients.filter(c => c.client_kind !== 'shop')
        return (
          <table style={tableStyle}>
            <thead>
              <tr>
                <Th top={theadTop}>Назва</Th>
                <Th top={theadTop}>Скорочена</Th>
                <Th top={theadTop}>Маршрут</Th>
                <Th top={theadTop}>Знижка %</Th>
                <Th top={theadTop}>Телефон</Th>
                <Th top={theadTop}>Дії</Th>
              </tr>
            </thead>
            <tbody>
              {activeShops.length > 0 && (
                <tr><td colSpan={6} style={SECTION_HEADER_STYLE}>Магазини ({activeShops.length})</td></tr>
              )}
              {activeShops.map(c => renderClientRow(c))}
              {activeShops.length > 0 && activeCustomers.length > 0 && (
                <tr><td colSpan={6} style={SECTION_HEADER_STYLE}>Клієнти ({activeCustomers.length})</td></tr>
              )}
              {activeCustomers.map(c => renderClientRow(c))}
              {inactiveClients.length > 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: '6px 10px', borderTop: '2px dashed #d1d5db' }}>
                    <button
                      onClick={() => setShowInactive(v => !v)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: 13, padding: 0 }}
                    >
                      {showInactive ? '▲' : '▼'} Деактивовані ({inactiveClients.length})
                    </button>
                  </td>
                </tr>
              )}
              {showInactive && inactiveClients.map(c => renderClientRow(c, true))}
            </tbody>
          </table>
        )
      })()}

      {modal && (
        <Modal title={editing ? 'Редагувати клієнта' : 'Новий клієнт'} onClose={closeModal} xwide={!!editing}>
          <form onSubmit={handleSubmit} className={formStyles.form}>
            <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>

              {/* ── Колонка 1: Основні дані ── */}
              <div style={{ flex: '0 0 200px' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Основні дані</div>
                {!editing && (
                  <div className={formStyles.field}>
                    <label>Тип *</label>
                    <select value={form.client_kind} onChange={(e) => setForm({ ...form, client_kind: e.target.value })}>
                      <option value="customer">Клієнт</option>
                      <option value="shop">Магазин</option>
                    </select>
                  </div>
                )}
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
                  <label>Адреса</label>
                  <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
                </div>
                <div className={formStyles.field}>
                  <label>Телефон</label>
                  <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                </div>
              </div>

              {/* ── Колонка 2: Реквізити та бот ── */}
              <div style={{ flex: '0 0 210px' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Реквізити</div>
                <div className={formStyles.field}>
                  <label>Директор</label>
                  <input value={form.director} onChange={(e) => setForm({ ...form, director: e.target.value })} />
                </div>
                <div className={formStyles.field}>
                  <label>Бухгалтер</label>
                  <input value={form.accountant} onChange={(e) => setForm({ ...form, accountant: e.target.value })} />
                </div>
                <div className={formStyles.field}>
                  <label>Телефони для бота</label>
                  <input value={form.bot_phones}
                    onChange={(e) => setForm({ ...form, bot_phones: e.target.value })}
                    placeholder="+380501234567, +380671234567" />
                  <span className={formStyles.hint}>Через кому. Бот звіряє при авторизації.</span>
                </div>
                {editing && botUsers.length > 0 && (
                  <div className={formStyles.field}>
                    <label>Авторизовані в боті</label>
                    <table style={{ width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ background: '#f0f4f8' }}>
                          <th style={{ padding: '0.2rem 0.4rem', textAlign: 'left' }}>Ім'я</th>
                          <th style={{ padding: '0.2rem 0.4rem', textAlign: 'left' }}>Телефон</th>
                          <th style={{ width: 28 }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {botUsers.map((u) => (
                          <tr key={u.id} style={{ opacity: u.is_active ? 1 : 0.5, borderBottom: '1px solid #eee' }}>
                            <td style={{ padding: '0.18rem 0.4rem' }}>{u.first_name ?? '—'}</td>
                            <td style={{ padding: '0.18rem 0.4rem', color: '#64748b' }}>{u.phone ?? '—'}</td>
                            <td style={{ padding: '0.18rem 0.3rem' }}>
                              <button type="button" title="Відкликати авторизацію"
                                onClick={async () => {
                                  if (!confirm(`Відкликати авторизацію ${u.first_name ?? u.chat_id}?`)) return
                                  await api.delete(`/bot/clients/${editing.id}/bot-users/${u.id}`)
                                  setBotUsers((prev) => prev.filter((x) => x.id !== u.id))
                                }}
                                style={{ background: '#fde', border: '1px solid #e88', borderRadius: 3, cursor: 'pointer', padding: '0.1rem 0.35rem', color: '#900', fontSize: '0.78rem' }}
                              >✕</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* ── Колонка 3: Ціноутворення (тільки при редагуванні) ── */}
              {editing && (
                <div style={{ flex: '0 0 440px', borderLeft: '1px solid #e2e8f0', paddingLeft: 20 }}>
                  {/* Знижка */}
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Ціноутворення</div>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginBottom: 14 }}>
                    <div className={formStyles.field} style={{ margin: 0, flex: '0 0 100px' }}>
                      <label>Знижка %</label>
                      <input type="number" min="0" max="100" step="0.1" value={form.discount_pct}
                        onChange={(e) => setForm({ ...form, discount_pct: e.target.value })} />
                    </div>
                    <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.6, padding: '5px 8px', background: '#f8fafc', borderRadius: 6, border: '1px solid #e2e8f0', flex: 1 }}>
                      Пріоритет ціни:<br />
                      <strong style={{ color: '#dc2626' }}>Р</strong> Ручна&nbsp;→&nbsp;<strong style={{ color: '#2563eb' }}>І</strong> Інд.&nbsp;→&nbsp;<strong style={{ color: '#ea580c' }}>%</strong> Знижка&nbsp;→&nbsp;<strong style={{ color: '#16a34a' }}>Б</strong> Базова
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Індивідуальні ціни</div>
                    <button type="button" onClick={() => setOverrideAdding(!overrideAdding)}
                      style={{ fontSize: 12, padding: '2px 10px', border: '1px solid #3b82f6', borderRadius: 6,
                        background: overrideAdding ? '#eff6ff' : '#fff', color: '#3b82f6', cursor: 'pointer' }}>
                      {overrideAdding ? 'Скасувати' : '+ Додати'}
                    </button>
                  </div>

                  {overrideAdding && (
                    <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8,
                      padding: '10px 12px', marginBottom: 8, display: 'grid',
                      gridTemplateColumns: '1fr auto auto auto auto', gap: 6, alignItems: 'flex-end' }}>
                      <div>
                        <div style={{ fontSize: 11, color: '#64748b', marginBottom: 2 }}>Виріб *</div>
                        <select required value={overrideAddForm.product_id}
                          onChange={e => setOverrideAddForm({ ...overrideAddForm, product_id: e.target.value })}
                          style={{ width: '100%', padding: '4px 6px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 12 }}>
                          <option value="">— оберіть —</option>
                          {products.filter(p => p.is_active).map(p => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: '#64748b', marginBottom: 2 }}>Ціна, ₴ *</div>
                        <input type="number" step="0.01" min="0.01" required
                          value={overrideAddForm.price} placeholder="0.00"
                          onChange={e => setOverrideAddForm({ ...overrideAddForm, price: e.target.value })}
                          style={{ padding: '4px 6px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 12, width: 72 }} />
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: '#64748b', marginBottom: 2 }}>Діє з *</div>
                        <input type="date" required min={tomorrow} value={overrideAddForm.valid_from}
                          onChange={e => {
                            setOverrideAddForm({ ...overrideAddForm, valid_from: e.target.value,
                              valid_to: overrideAddForm.valid_to && overrideAddForm.valid_to < e.target.value ? e.target.value : overrideAddForm.valid_to
                            })
                          }}
                          style={{ padding: '4px 6px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 12 }} />
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: '#64748b', marginBottom: 2 }}>Діє до</div>
                        <input type="date" min={overrideAddForm.valid_from || tomorrow} value={overrideAddForm.valid_to}
                          onChange={e => setOverrideAddForm({ ...overrideAddForm, valid_to: e.target.value })}
                          style={{ padding: '4px 6px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 12 }} />
                      </div>
                      <button type="button" disabled={overrideSaving || !overrideAddForm.product_id || !overrideAddForm.price}
                        onClick={async () => {
                          if (!editing) return
                          setOverrideSaving(true)
                          try {
                            await api.post('/prices/overrides', {
                              client_id:  editing.id,
                              product_id: Number(overrideAddForm.product_id),
                              price:      Number(overrideAddForm.price),
                              valid_from: overrideAddForm.valid_from,
                              valid_to:   overrideAddForm.valid_to || null,
                            })
                            await loadClientOverrides(editing.id)
                            setOverrideAddForm({ product_id: '', price: '', valid_from: tomorrow, valid_to: '' })
                            setOverrideAdding(false)
                          } catch (err) { alert(String(err)) }
                          finally { setOverrideSaving(false) }
                        }}
                        style={{ padding: '5px 12px', background: '#16a34a', color: '#fff', border: 'none',
                          borderRadius: 6, fontSize: 12, cursor: 'pointer', alignSelf: 'flex-end' }}>
                        {overrideSaving ? '...' : 'OK'}
                      </button>
                    </div>
                  )}

                  {clientOverrides.length > 0 ? (
                    <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                      <table style={{ width: '100%', fontSize: '0.82rem', borderCollapse: 'collapse' }}>
                        <thead style={{ position: 'sticky', top: 0 }}>
                          <tr style={{ background: '#f0f4f8' }}>
                            <th style={{ padding: '0.22rem 0.5rem', textAlign: 'left' }}>Виріб</th>
                            <th style={{ padding: '0.22rem 0.5rem', textAlign: 'right' }}>Ціна</th>
                            <th style={{ padding: '0.22rem 0.5rem', textAlign: 'left' }}>Діє з</th>
                            <th style={{ padding: '0.22rem 0.5rem', textAlign: 'left' }}>Діє до</th>
                            <th style={{ padding: '0.22rem 0.5rem', textAlign: 'left' }}>Стан</th>
                            <th style={{ width: 30 }}></th>
                          </tr>
                        </thead>
                        <tbody>
                          {clientOverrides.map(o => {
                            const isActive = o.valid_from <= today && (o.valid_to === null || o.valid_to >= today)
                            const isPast   = o.valid_to !== null && o.valid_to < today
                            const canDelete = o.valid_from > today
                            return (
                              <tr key={o.id} style={{ borderBottom: '1px solid #eee', background: isActive ? '#f0fdf4' : isPast ? '#fafafa' : '#fffbeb' }}>
                                <td style={{ padding: '0.2rem 0.5rem' }}>
                                  {products.find(p => p.id === o.product_id)?.name ?? `#${o.product_id}`}
                                </td>
                                <td style={{ padding: '0.2rem 0.5rem', textAlign: 'right', fontWeight: 600 }}>
                                  {o.price.toFixed(2)} ₴
                                </td>
                                <td style={{ padding: '0.2rem 0.5rem', color: '#64748b' }}>{o.valid_from}</td>
                                <td style={{ padding: '0.2rem 0.5rem', color: '#64748b' }}>{o.valid_to ?? '∞'}</td>
                                <td style={{ padding: '0.2rem 0.5rem', fontSize: 11 }}>
                                  {isActive  ? <span style={{ color: '#16a34a' }}>активна</span>
                                  : isPast   ? <span style={{ color: '#94a3b8' }}>минула</span>
                                  :            <span style={{ color: '#f59e0b' }}>майбутня</span>}
                                </td>
                                <td style={{ padding: '0.2rem 0.3rem' }}>
                                  <button type="button" disabled={!canDelete}
                                    title={canDelete ? 'Видалити' : 'Не можна видалити поточну/минулу ціну'}
                                    onClick={async () => {
                                      if (!editing) return
                                      if (!confirm('Видалити індивідуальну ціну?')) return
                                      await api.delete(`/prices/overrides/${o.id}`)
                                      await loadClientOverrides(editing.id)
                                    }}
                                    style={{ background: 'none', border: 'none', cursor: canDelete ? 'pointer' : 'default',
                                      color: canDelete ? '#ef4444' : '#cbd5e1', fontSize: '1rem' }}>
                                    ×
                                  </button>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div style={{ fontSize: 13, color: '#94a3b8', padding: '12px 0' }}>Індивідуальних цін немає</div>
                  )}
                </div>
              )}
            </div>

            <div className={formStyles.actions} style={{ marginTop: 16 }}>
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

// ─── Системні клієнти ────────────────────────────────────────────────────────

const SYSTEM_KINDS = ['writeoff', 'ration', 'underbaked'] as const
const PROTECTED_KINDS = new Set(['writeoff', 'ration', 'underbaked'])

function SystemClientsTab({ routes }: { routes: Route[] }) {
  const [clients, setClients]   = useState<Client[]>([])
  const [modal, setModal]       = useState(false)
  const [editing, setEditing]   = useState<Client | null>(null)
  const [form, setForm]         = useState<ClientFormState>({ ...emptyClient(), client_kind: 'writeoff' })
  const [saving, setSaving]     = useState(false)
  const [showInactive, setShowInactive] = useState(false)

  const load = () => api.get<Client[]>('/clients/?active_only=false')
    .then(data => setClients(data.filter(c => c.client_kind !== 'customer' && c.client_kind !== 'shop')))
  useEffect(() => { load() }, [])

  const openNew  = () => { setEditing(null); setForm({ ...emptyClient(), client_kind: 'writeoff' }); setModal(true) }
  const openEdit = (c: Client) => {
    setEditing(c)
    setForm({
      full_name:    c.full_name,
      short_name:   c.short_name ?? '',
      address:      c.address ?? '',
      phone:        c.phone ?? '',
      director:     '',
      accountant:   '',
      route_id:     c.route_id?.toString() ?? '',
      discount_pct: c.discount_pct.toString(),
      client_kind:  c.client_kind,
      bot_phones:   c.bot_phones ?? '',
    })
    setModal(true)
  }
  const closeModal = () => setModal(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    const body = {
      full_name:    form.full_name,
      short_name:   form.short_name || null,
      address:      form.address || null,
      phone:        form.phone || null,
      route_id:     form.route_id ? Number(form.route_id) : null,
      discount_pct: Number(form.discount_pct),
      client_kind:  form.client_kind,
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

  const routeName = (id: number | null) => routes.find((r) => r.id === id)?.name ?? '—'

  const activeClients   = clients.filter(c => c.is_active)
  const inactiveClients = clients.filter(c => !c.is_active)

  const renderSysRow = (c: Client, dimmed = false) => (
    <tr key={c.id} style={dimmed ? { opacity: 0.5, background: '#f9fafb' } : undefined}>
      <Td>{c.full_name}</Td>
      <Td>{CLIENT_KIND_LABELS[c.client_kind] ?? c.client_kind}</Td>
      <Td>{routeName(c.route_id)}</Td>
      <Td>
        <button onClick={() => openEdit(c)} style={editBtnStyle}>Редагувати</button>
        {c.is_active === 1 ? (
          PROTECTED_KINDS.has(c.client_kind)
            ? <button disabled title="Системний клієнт — не можна деактивувати" style={{ ...delBtnStyle, opacity: 0.35, cursor: 'not-allowed' }}>Деактивувати</button>
            : <button onClick={async () => { if (!confirm(`Деактивувати "${c.full_name}"?`)) return; await api.delete(`/clients/${c.id}`); load() }} style={delBtnStyle}>Деактивувати</button>
        ) : (
          <button onClick={async () => { await api.put(`/clients/${c.id}`, { is_active: 1 }); load() }} style={{ ...editBtnStyle, color: '#080' }}>Відновити</button>
        )}
      </Td>
    </tr>
  )

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
        <strong>Системні клієнти ({activeClients.length})</strong>
        <button onClick={openNew} style={addBtnStyle}>+ Додати</button>
      </div>

      <table style={tableStyle}>
        <thead>
          <tr style={{ background: '#e8eef5' }}>
            <Th>Назва</Th><Th>Тип</Th><Th>Маршрут</Th><Th>Дії</Th>
          </tr>
        </thead>
        <tbody>
          {activeClients.map(c => renderSysRow(c))}
          {inactiveClients.length > 0 && (
            <tr>
              <td colSpan={4} style={{ padding: '6px 10px', borderTop: '2px dashed #d1d5db' }}>
                <button
                  onClick={() => setShowInactive(v => !v)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: 13, padding: 0 }}
                >
                  {showInactive ? '▲' : '▼'} Деактивовані ({inactiveClients.length})
                </button>
              </td>
            </tr>
          )}
          {showInactive && inactiveClients.map(c => renderSysRow(c, true))}
        </tbody>
      </table>

      {modal && (
        <Modal title={editing ? 'Редагувати системного клієнта' : 'Новий системний клієнт'} onClose={closeModal}>
          <form onSubmit={handleSubmit} className={formStyles.form}>
            <div className={formStyles.field}>
              <label>Повна назва *</label>
              <input required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
            </div>
            <div className={formStyles.field}>
              <label>Скорочена назва</label>
              <input value={form.short_name} onChange={(e) => setForm({ ...form, short_name: e.target.value })} />
            </div>
            <div className={formStyles.field}>
              <label>Тип</label>
              <select value={form.client_kind} onChange={(e) => setForm({ ...form, client_kind: e.target.value })}>
                {SYSTEM_KINDS.map(k => (
                  <option key={k} value={k}>{CLIENT_KIND_LABELS[k]}</option>
                ))}
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

interface BulkPreviewItem {
  product_id:     number
  product_name:   string
  old_price:      number
  new_price:      number
  valid_from:     string
  has_collision:  boolean
  collision_date: string | null
}

const round2 = (v: number) => Math.round(v * 100) / 100

/** Чекбокс що підтримує indeterminate (три стани) */
function IndeterminateCheckbox({ checked, indeterminate, onChange }: {
  checked: boolean; indeterminate: boolean; onChange: (v: boolean) => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { if (ref.current) ref.current.indeterminate = indeterminate }, [indeterminate])
  return <input type="checkbox" ref={ref} checked={checked}
    onChange={e => onChange(e.target.checked)} />
}

/** Рядок у переробленому BulkChangeModal */
interface BulkRow extends BulkPreviewItem {
  checked:       boolean
  locked:        boolean   // true = ціна задана вручну
  manual_price:  string    // поточне значення у полі вводу
  category_id:   number | null
  category_name: string
}

function PricesTab({ products, clients, categories }: {
  products:   Product[]
  clients:    Client[]
  categories: Category[]
}) {
  const today    = new Date().toISOString().slice(0, 10)
  const tomorrow = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10) })()

  type InnerTab = 'base' | 'overrides'
  const [innerTab, setInnerTab] = useState<InnerTab>('base')

  // ── Базові ціни ──
  const [prices,    setPrices]    = useState<Price[]>([])
  const [editPrice, setEditPrice] = useState<Price | null>(null)
  const [newModal,  setNewModal]  = useState(false)
  const [bulkModal, setBulkModal] = useState(false)
  const [newForm, setNewForm]     = useState({ product_id: '', price: '', valid_from: today })
  const [editForm, setEditForm]   = useState({ price: '', effective_date: tomorrow })
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  // Timeframe для Gantt — за замовчуванням: -1 місяць … +1 місяць
  const defaultTimeFrom = (() => {
    const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 10)
  })()
  const defaultTimeTo = (() => {
    const d = new Date(); d.setMonth(d.getMonth() + 1); return d.toISOString().slice(0, 10)
  })()
  const [timeFrom, setTimeFrom] = useState(defaultTimeFrom)
  const [timeTo,   setTimeTo]   = useState(defaultTimeTo)
  // Авто-розширення timeTo при першому завантаженні: якщо є ціни далі за timeTo
  const pricesAutoExtended = useRef(false)
  useEffect(() => {
    if (prices.length === 0 || pricesAutoExtended.current) return
    pricesAutoExtended.current = true
    const maxDate = prices.reduce((m, p) => p.valid_from > m ? p.valid_from : m, '')
    if (!maxDate || maxDate <= today) return
    const d = new Date(maxDate); d.setDate(d.getDate() + 14)
    const smartTo = d.toISOString().slice(0, 10)
    setTimeTo(prev => smartTo > prev ? smartTo : prev)
  }, [prices]) // eslint-disable-line

  // ── Масова зміна (новий стан) ──
  const [bulkDate, setBulkDate]   = useState(tomorrow)
  const [bulkPct,  setBulkPct]    = useState('')
  const [bulkRows, setBulkRows]   = useState<BulkRow[]>([])
  const [bulkLoading, setBulkLoading] = useState(false)

  // ── Індивідуальні ──
  const [overrides,        setOverrides]        = useState<ClientPriceOverride[]>([])
  const [overrideModal,    setOverrideModal]    = useState(false)
  const [expandedClient,   setExpandedClient]   = useState<number | null>(null)
  const [ovTimeFrom,       setOvTimeFrom]       = useState(defaultTimeFrom)
  const [ovTimeTo,         setOvTimeTo]         = useState(defaultTimeTo)
  const ovAutoExtended = useRef(false)
  useEffect(() => {
    if (overrides.length === 0 || ovAutoExtended.current) return
    ovAutoExtended.current = true
    const maxDate = overrides.reduce((m, p) => p.valid_from > m ? p.valid_from : m, '')
    if (!maxDate || maxDate <= today) return
    const d = new Date(maxDate); d.setDate(d.getDate() + 14)
    const smartTo = d.toISOString().slice(0, 10)
    setOvTimeTo(prev => smartTo > prev ? smartTo : prev)
  }, [overrides]) // eslint-disable-line
  const [ovModalClient,    setOvModalClient]    = useState('')
  const [ovModalValidFrom, setOvModalValidFrom] = useState(tomorrow)
  const [ovModalValidTo,   setOvModalValidTo]   = useState('')
  type OvRow = { product_id: number; product_name: string; base_price: number | null; cur_override: ClientPriceOverride | null; new_price: string }
  const [ovModalRows,      setOvModalRows]      = useState<OvRow[]>([])

  const loadPrices    = () => api.get<Price[]>('/prices/?active_only=false').then(setPrices)
  const loadOverrides = () => api.get<ClientPriceOverride[]>('/prices/overrides').then(setOverrides)

  useEffect(() => { loadPrices() }, [])
  useEffect(() => { if (innerTab === 'overrides') loadOverrides() }, [innerTab]) // eslint-disable-line

  const pName = (id: number) => products.find(p => p.id === id)?.name ?? `#${id}`
  const cName = (id: number) => {
    const c = clients.find(c => c.id === id)
    return c ? (c.short_name ?? c.full_name) : `#${id}`
  }

  // Поточна ціна для кожного продукту (активна, найновіша)
  const currentPriceMap = new Map<number, Price>()
  for (const p of prices) {
    if (p.is_active && !currentPriceMap.has(p.product_id)) currentPriceMap.set(p.product_id, p)
  }

  // Продукти без поточної ціни
  const productsWithoutPrice = products.filter(
    p => p.is_active && !currentPriceMap.has(p.id)
  )

  /**
   * Для відображення: якщо сегмент має valid_to=null, але наступний сегмент вже починається —
   * обрізаємо відображення до (next.valid_from - 1 день). БД не змінюється.
   */
  const trimSegments = (segs: GanttPriceSegment[]): GanttPriceSegment[] => {
    const sorted = [...segs].sort((a, b) => a.valid_from.localeCompare(b.valid_from))
    return sorted.map((seg, i) => {
      if (seg.valid_to !== null) return seg
      const next = sorted[i + 1]
      if (!next) return seg
      const d = new Date(next.valid_from)
      d.setDate(d.getDate() - 1)
      return { ...seg, valid_to: d.toISOString().slice(0, 10) }
    })
  }

  // ── Gantt rows (base prices) ────────────────────────────────────────────────
  const ganttRows: GanttRow[] = (() => {
    const rowMap = new Map<number, { product_name: string; prices: GanttPriceSegment[] }>()
    for (const p of prices) {
      if (!rowMap.has(p.product_id)) {
        rowMap.set(p.product_id, { product_name: pName(p.product_id), prices: [] })
      }
      rowMap.get(p.product_id)!.prices.push({
        price_id:   p.id,
        price:      p.price,
        valid_from: p.valid_from,
        valid_to:   p.valid_to ?? null,
      })
    }
    return Array.from(rowMap.entries())
      .map(([product_id, { product_name, prices: segs }]) => ({
        product_id, product_name, prices: trimSegments(segs),
      }))
      .sort((a, b) => a.product_name.localeCompare(b.product_name, 'uk'))
  })()

  // Найдавніша дата серед усіх базових цін (нижня межа слайдера)
  const earliestPriceDate = prices.length > 0
    ? prices.reduce((m, p) => p.valid_from < m ? p.valid_from : m, prices[0].valid_from)
    : undefined

  // Найдавніша дата серед усіх індивідуальних цін
  const earliestOvDate = overrides.length > 0
    ? overrides.reduce((m, o) => o.valid_from < m ? o.valid_from : m, overrides[0].valid_from)
    : undefined

  // ── Редагування — замінює ціну ──────────────────────────────────────────────
  const openEdit = (priceId: number) => {
    const p = prices.find(x => x.id === priceId)
    if (!p) return
    setEditPrice(p)
    setEditForm({ price: String(p.price), effective_date: tomorrow })
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
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg.match(/"detail":"([^"]+)"/)?.[1] ?? msg)
    } finally { setSaving(false) }
  }

  // ── Нова ціна (для продукту без ціни) ──────────────────────────────────────
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
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg.match(/"detail":"([^"]+)"/)?.[1] ?? msg)
    } finally { setSaving(false) }
  }

  // ── Деактивувати ціну (тільки майбутні) ────────────────────────────────────
  const deactivate = async (priceId: number) => {
    const p = prices.find(x => x.id === priceId)
    if (!p) return
    if (p.valid_from <= today) {
      alert('Не можна видалити поточну або минулу ціну')
      return
    }
    if (!confirm('Видалити цю майбутню ціну?')) return
    try {
      await api.delete(`/prices/${priceId}`)
      await loadPrices()
    } catch (err) {
      alert(String(err))
    }
  }

  // ── Масова зміна — завантажити попередній перегляд ─────────────────────────
  const loadBulkPreview = async (pct: string, date: string) => {
    if (!pct || !date) { setBulkRows([]); return }
    setBulkLoading(true)
    try {
      const data = await api.get<{ items: BulkPreviewItem[] }>(
        `/prices/bulk-preview?pct=${pct}&effective_date=${date}`
      )
      setBulkRows(data.items.map(item => {
        const prod = products.find(p => p.id === item.product_id)
        const cat  = categories.find(c => c.id === prod?.category_id)
        return {
          ...item,
          checked:       true,
          locked:        false,
          manual_price:  item.new_price.toFixed(2),
          category_id:   prod?.category_id ?? null,
          category_name: cat?.name ?? 'Інше',
        }
      }))
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg.match(/"detail":"([^"]+)"/)?.[1] ?? msg)
    } finally { setBulkLoading(false) }
  }
  useEffect(() => { if (bulkModal) loadBulkPreview(bulkPct, bulkDate) }, [bulkPct, bulkDate, bulkModal]) // eslint-disable-line

  // Оновити нову ціну в рядку через глобальний % (для незаблокованих)
  const recalcUnlocked = (pct: string) => {
    const p = parseFloat(pct)
    if (isNaN(p)) return
    setBulkRows(prev => prev.map(r =>
      r.locked ? r : { ...r, new_price: round2(r.old_price * (1 + p / 100)), manual_price: round2(r.old_price * (1 + p / 100)).toFixed(2) }
    ))
  }

  // Підтвердити масову зміну
  const submitBulk = async () => {
    const checkedRows = bulkRows.filter(r => r.checked)
    if (checkedRows.length === 0) return
    const hasCollision = checkedRows.some(r => r.has_collision)
    if (hasCollision && !confirm('Деякі вироби мають колізію цін. Продовжити?')) return
    setSaving(true); setError('')
    try {
      // 1. Незаблоковані рядки → bulk-change
      const unlockedChecked  = checkedRows.filter(r => !r.locked)
      const lockedChecked    = checkedRows.filter(r =>  r.locked)
      const excludedIds: number[] = bulkRows
        .filter(r => !r.checked || r.locked)
        .map(r => r.product_id)

      if (unlockedChecked.length > 0) {
        await api.post('/prices/bulk-change', {
          pct:                  parseFloat(bulkPct) || 0,
          effective_date:       bulkDate,
          excluded_product_ids: excludedIds,
        })
      }

      // 2. Заблоковані рядки → replace (по одному)
      for (const row of lockedChecked) {
        const currentPrice = currentPriceMap.get(row.product_id)
        if (!currentPrice) continue
        await api.post('/prices/replace', {
          old_price_id:   currentPrice.id,
          price:          parseFloat(row.manual_price) || row.new_price,
          effective_date: bulkDate,
        })
      }

      setBulkModal(false)
      await loadPrices()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg.match(/"detail":"([^"]+)"/)?.[1] ?? msg)
    } finally { setSaving(false) }
  }

  // ── Індивідуальні ціни ──────────────────────────────────────────────────────
  const populateOvRows = (clientId: string) => {
    const cid = clientId ? Number(clientId) : null
    const activeOverrideMap = new Map<number, ClientPriceOverride>()
    if (cid) {
      for (const o of overrides) {
        if (o.client_id === cid && o.valid_from <= today && (o.valid_to === null || o.valid_to >= today)) {
          if (!activeOverrideMap.has(o.product_id)) activeOverrideMap.set(o.product_id, o)
        }
      }
    }
    setOvModalRows(
      products
        .filter(p => p.is_active)
        .sort((a, b) => a.name.localeCompare(b.name, 'uk'))
        .map(p => ({
          product_id:   p.id,
          product_name: p.name,
          base_price:   currentPriceMap.get(p.id)?.price ?? null,
          cur_override: cid ? (activeOverrideMap.get(p.id) ?? null) : null,
          new_price:    '',
        }))
    )
  }

  const openOverrideModal = (presetClientId = '') => {
    setOvModalClient(presetClientId)
    setOvModalValidFrom(tomorrow)
    setOvModalValidTo('')
    setError('')
    populateOvRows(presetClientId)
    setOverrideModal(true)
  }

  const submitBulkOverride = async (e: FormEvent) => {
    e.preventDefault()
    const toCreate = ovModalRows.filter(r => r.new_price !== '' && parseFloat(r.new_price) > 0)
    if (toCreate.length === 0) return
    setSaving(true); setError('')
    try {
      for (const row of toCreate) {
        await api.post('/prices/overrides', {
          client_id:  Number(ovModalClient),
          product_id: row.product_id,
          price:      parseFloat(row.new_price),
          valid_from: ovModalValidFrom,
          valid_to:   ovModalValidTo || null,
        })
      }
      setOverrideModal(false)
      await loadOverrides()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg.match(/"detail":"([^"]+)"/)?.[1] ?? msg)
    } finally { setSaving(false) }
  }

  const deleteOverride = async (id: number) => {
    const o = overrides.find(x => x.id === id)
    if (!o) return
    if (o.valid_from <= today) {
      alert('Не можна видалити поточну або минулу індивідуальну ціну')
      return
    }
    if (!confirm('Видалити індивідуальну ціну?')) return
    await api.delete(`/prices/overrides/${id}`)
    loadOverrides()
  }

  // ── Редагування одного запису індивідуальної ціни ──
  const [ovEditId,   setOvEditId]   = useState<number | null>(null)
  const [ovEditForm, setOvEditForm] = useState({ price: '', valid_to: '' })

  const openOvEdit = (priceId: number) => {
    const o = overrides.find(x => x.id === priceId)
    if (!o) return
    setOvEditForm({ price: String(o.price), valid_to: o.valid_to ?? '' })
    setOvEditId(priceId)
  }

  const submitOvEdit = async () => {
    const o = overrides.find(x => x.id === ovEditId)
    if (!o) return
    const newPrice = parseFloat(ovEditForm.price)
    if (isNaN(newPrice) || newPrice <= 0) { alert('Введіть коректну ціну'); return }
    setSaving(true)
    try {
      await api.delete(`/prices/overrides/${o.id}`)
      await api.post('/prices/overrides', {
        client_id:  o.client_id,
        product_id: o.product_id,
        price:      newPrice,
        valid_from: o.valid_from,
        valid_to:   ovEditForm.valid_to || null,
      })
      setOvEditId(null)
      loadOverrides()
    } finally { setSaving(false) }
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

  /**
   * Швидкий вибір тимфрейму: рухає ТІЛЬКИ ліву межу (timeFrom).
   * Права межа (timeTo) залишається фіксованою = today+1m або дата майбутньої ціни+1m.
   */
  const quickRange = (backMonths: number, setFrom: (v: string) => void) => {
    const d = new Date(today)
    d.setMonth(d.getMonth() - backMonths)
    setFrom(d.toISOString().slice(0, 10))
  }

  // Кількість місяців між двома ISO датами
  const monthsBetween = (a: string, b: string) => {
    const da = new Date(a), db = new Date(b)
    return (db.getFullYear() - da.getFullYear()) * 12 + db.getMonth() - da.getMonth()
  }

  const QUICK_PRESETS = [
    { label: '2 міс',  back: 1  },
    { label: '4 міс',  back: 3  },
    { label: '6 міс',  back: 5  },
    { label: '1 рік',  back: 11 },
    { label: '2 роки', back: 23 },
  ]

  /**
   * Панель вибору часового діапазону.
   * earliestDate — найдавніша дата в даних (нижня межа слайдера).
   */
  const timeframeBar = (
    from: string, setFrom: (v: string) => void,
    to:   string, setTo:   (v: string) => void,
    earliestDate?: string,
  ) => {
    const earliest = earliestDate ?? from
    // Скільки місяців від найдавнішої дати до сьогодні (макс. діапазон слайдера)
    const maxSlider = Math.max(2, monthsBetween(earliest, today))
    // Поточне значення слайдера = скільки місяців від earliest до from
    const sliderVal = Math.min(maxSlider, Math.max(0, monthsBetween(earliest, from)))

    return (
      <div style={{ marginBottom: 12 }}>
        {/* Рядок з датами + кнопки */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
          <span style={{ fontSize: 13, color: '#64748b' }}>Період:</span>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)}
            style={{ fontSize: 13, padding: '3px 8px', border: '1px solid #cbd5e1', borderRadius: 6 }} />
          <span style={{ color: '#94a3b8' }}>—</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)}
            style={{ fontSize: 13, padding: '3px 8px', border: '1px solid #cbd5e1', borderRadius: 6 }} />
          {QUICK_PRESETS.map(({ label, back }) => (
            <button key={label} onClick={() => quickRange(back, setFrom)}
              style={{ fontSize: 12, padding: '3px 10px', border: '1px solid #cbd5e1', borderRadius: 6,
                background: '#f8fafc', cursor: 'pointer' }}>
              {label}
            </button>
          ))}
        </div>
        {/* Слайдер глибини історії */}
        {earliestDate && maxSlider > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: '#94a3b8', minWidth: 52, textAlign: 'right' }}>
              {earliest.slice(0, 7)}
            </span>
            <input
              type="range"
              min={0}
              max={maxSlider}
              value={sliderVal}
              onChange={e => {
                const v = Number(e.target.value)
                const d = new Date(earliest)
                d.setMonth(d.getMonth() + v)
                setFrom(d.toISOString().slice(0, 10))
              }}
              style={{ flex: 1, cursor: 'pointer', accentColor: '#2563eb' }}
            />
            <span style={{ fontSize: 11, color: '#94a3b8', minWidth: 52 }}>
              {today.slice(0, 7)}
            </span>
            <span style={{ fontSize: 11, color: '#2563eb', minWidth: 56, fontWeight: 500 }}>
              ↤ {from.slice(0, 7)}
            </span>
          </div>
        )}
      </div>
    )
  }

  return (
    <section>
      <div style={{ position: 'sticky', top: 0, zIndex: 10, background: 'white', paddingBottom: 4 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {tabBtn('base', 'Базові ціни')}
          {tabBtn('overrides', 'Індивідуальні ціни клієнтів')}
        </div>

        {/* ── Базові ціни — контролери ── */}
        {innerTab === 'base' && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, flexWrap: 'wrap', gap: 8 }}>
              <strong style={{ fontSize: 14 }}>
                Ціни ({ganttRows.length} виробів)
                {productsWithoutPrice.length > 0 && (
                  <span style={{ color: '#e67e22', fontWeight: 400, marginLeft: 8 }}>
                    ⚠ {productsWithoutPrice.length} без ціни
                  </span>
                )}
              </strong>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => { setBulkModal(true); setError('') }}
                  style={{ ...addBtnStyle, background: '#e67e22' }}>
                  % Масова зміна
                </button>
                <button onClick={() => { setNewModal(true); setError('') }} style={addBtnStyle}>
                  + Нова ціна
                </button>
              </div>
            </div>

            {timeframeBar(timeFrom, setTimeFrom, timeTo, setTimeTo, earliestPriceDate)}
          </>
        )}

        {/* ── Індивідуальні ціни — контролери ── */}
        {innerTab === 'overrides' && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
            <button onClick={() => openOverrideModal()} style={addBtnStyle}>
              + Встановити індивідуальні ціни
            </button>
          </div>
        )}
      </div>

      {/* ── Базові ціни — список ── */}
      {innerTab === 'base' && (
        <>
          <PriceGantt
            rows={ganttRows}
            timeFrom={timeFrom}
            timeTo={timeTo}
            today={today}
            onEdit={openEdit}
            onDelete={deactivate}
          />

          {/* Модал редагування */}
          {editPrice && (
            <Modal title={`Змінити ціну: ${pName(editPrice.product_id)}`} onClose={() => { setEditPrice(null); setError('') }}>
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
                  <input required type="date" min={tomorrow} value={editForm.effective_date}
                    onChange={e => setEditForm({ ...editForm, effective_date: e.target.value })} />
                  <span className={formStyles.hint}>
                    Мінімум завтра. Стара ціна діятиме до {editForm.effective_date
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
                    {products.filter(p => p.is_active).map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                {(() => {
                  if (!newForm.product_id) return null
                  const currentPrice = prices
                    .filter(p => p.product_id === Number(newForm.product_id) && p.valid_from <= today && p.is_active)
                    .sort((a, b) => b.valid_from.localeCompare(a.valid_from))[0]
                  if (!currentPrice) return (
                    <p style={{ margin: '-4px 0 8px', fontSize: 13, color: '#64748b' }}>
                      Поточна ціна: <em>не встановлена</em>
                    </p>
                  )
                  const newVal = parseFloat(newForm.price)
                  const pct = !isNaN(newVal) && newVal > 0 && currentPrice.price > 0
                    ? ((newVal - currentPrice.price) / currentPrice.price * 100)
                    : null
                  return (
                    <p style={{ margin: '-4px 0 8px', fontSize: 13, color: '#64748b' }}>
                      Поточна ціна: <strong style={{ color: '#1e293b' }}>{currentPrice.price.toFixed(2)} ₴</strong>
                      {pct !== null && (
                        <span style={{
                          marginLeft: 10, fontWeight: 600,
                          color: pct > 0 ? '#16a34a' : pct < 0 ? '#dc2626' : '#64748b',
                        }}>
                          {pct > 0 ? '+' : ''}{pct.toFixed(1)}%
                        </span>
                      )}
                    </p>
                  )
                })()}
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
                  <button type="button" onClick={() => { setNewModal(false); setError('') }} className={formStyles.btnSecondary}>
                    Скасувати
                  </button>
                  <button type="submit" disabled={saving} className={formStyles.btnPrimary}>
                    {saving ? 'Збереження...' : 'Зберегти'}
                  </button>
                </div>
              </form>
            </Modal>
          )}

          {/* ── Модал масової зміни (перероблений) ── */}
          {bulkModal && (() => {
            // Групуємо рядки за категорією
            const groupOrder: string[] = []
            const groupMap = new Map<string, BulkRow[]>()
            for (const row of bulkRows) {
              if (!groupMap.has(row.category_name)) {
                groupOrder.push(row.category_name)
                groupMap.set(row.category_name, [])
              }
              groupMap.get(row.category_name)!.push(row)
            }

            const checkedRows  = bulkRows.filter(r => r.checked)
            const allChecked   = bulkRows.length > 0 && bulkRows.every(r => r.checked)
            const anyChecked   = bulkRows.some(r => r.checked)

            // Аналітика
            const avgPct = checkedRows.length > 0
              ? checkedRows.reduce((acc, r) => {
                  const p = r.old_price > 0 ? (parseFloat(r.manual_price) - r.old_price) / r.old_price * 100 : 0
                  return acc + p
                }, 0) / checkedRows.length
              : 0
            const newPrices = checkedRows.map(r => parseFloat(r.manual_price)).filter(v => !isNaN(v))
            const minNew = newPrices.length ? Math.min(...newPrices) : 0
            const maxNew = newPrices.length ? Math.max(...newPrices) : 0
            const totalDelta = checkedRows.reduce((acc, r) =>
              acc + ((parseFloat(r.manual_price) || 0) - r.old_price), 0)

            const thStyle: React.CSSProperties = {
              padding: '0.35rem 0.6rem', textAlign: 'left', fontSize: 13,
              background: '#f8fafc', fontWeight: 600, color: '#475569',
              position: 'sticky', top: 0, zIndex: 1,
              borderBottom: '2px solid #e2e8f0',
            }
            const td = { padding: '0.3rem 0.55rem', borderBottom: '1px solid #f0f0f0', fontSize: 13 }

            return (
              <Modal title="Масова зміна цін" wide onClose={() => { setBulkModal(false); setError(''); setBulkRows([]) }}>
                {/* ── Рядок параметрів ── */}
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
                  <div>
                    <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 3 }}>Дата набуття чинності</label>
                    <input type="date" min={tomorrow} value={bulkDate}
                      onChange={e => setBulkDate(e.target.value)}
                      style={{ padding: '5px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 14 }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 3 }}>Зміна, %</label>
                    <input type="number" step="0.1" value={bulkPct} placeholder="+5 або -10"
                      onChange={e => { setBulkPct(e.target.value); recalcUnlocked(e.target.value) }}
                      style={{ padding: '5px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 14, width: 110 }} />
                  </div>
                  {bulkLoading && <div style={{ fontSize: 13, color: '#94a3b8', alignSelf: 'center' }}>Завантаження...</div>}
                </div>

                {/* ── Аналітика ── */}
                {checkedRows.length > 0 && (
                  <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', background: '#f0f9ff',
                    border: '1px solid #bae6fd', borderRadius: 8, padding: '8px 14px',
                    marginBottom: 10, fontSize: 13 }}>
                    <span style={{ color: '#0369a1' }}>
                      <strong>{checkedRows.length}</strong> із {bulkRows.length} виробів
                    </span>
                    <span style={{ color: avgPct >= 0 ? '#16a34a' : '#dc2626' }}>
                      Середня зміна: <strong>{(avgPct >= 0 ? '+' : '') + avgPct.toFixed(1)}%</strong>
                    </span>
                    <span style={{ color: '#475569' }}>
                      Нові ціни: <strong>{minNew.toFixed(2)} – {maxNew.toFixed(2)} ₴</strong>
                    </span>
                    <span style={{ color: totalDelta >= 0 ? '#16a34a' : '#dc2626' }}>
                      Сума змін: <strong>{(totalDelta >= 0 ? '+' : '') + totalDelta.toFixed(2)} ₴</strong>
                    </span>
                  </div>
                )}

                {/* Колізійне попередження */}
                {bulkRows.some(r => r.checked && r.has_collision) && (
                  <div style={{ background: '#fffbeb', border: '1px solid #fbbf24', borderRadius: 8,
                    padding: '8px 12px', fontSize: 13, color: '#92400e', marginBottom: 10 }}>
                    ⚠ {bulkRows.filter(r => r.checked && r.has_collision).length} виробів мають колізію — вже є ціна з цієї або пізнішої дати
                  </div>
                )}

                {error && <p style={{ color: '#c0392b', margin: '0 0 .5rem', fontSize: 13 }}>{error}</p>}

                {/* ── Таблиця (фіксований заголовок, прокрутка тільки body) ── */}
                <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
                  <table style={{ ...tableStyle, margin: 0, tableLayout: 'fixed', width: '100%' }}>
                    <colgroup>
                      <col style={{ width: 32 }} />
                      <col style={{ width: '28%' }} />
                      <col style={{ width: 82 }} />
                      <col style={{ width: 82 }} />
                      <col style={{ width: 118 }} />
                      <col style={{ width: 68 }} />
                    </colgroup>
                    <thead>
                      <tr>
                        {/* "Всі" checkbox */}
                        <th style={{ ...thStyle, width: 32 }}>
                          <IndeterminateCheckbox
                            checked={allChecked}
                            indeterminate={anyChecked && !allChecked}
                            onChange={v => setBulkRows(prev => prev.map(r => ({ ...r, checked: v })))}
                          />
                        </th>
                        <th style={thStyle}>Виріб</th>
                        <th style={thStyle}>Діє з</th>
                        <th style={thStyle}>Стара ціна</th>
                        <th style={thStyle}>Нова ціна</th>
                        <th style={thStyle}>% зміна</th>
                      </tr>
                    </thead>
                  </table>

                  {/* Прокручуваний tbody */}
                  <div style={{ maxHeight: 360, overflowY: 'auto' }}>
                    <table style={{ ...tableStyle, margin: 0, tableLayout: 'fixed', width: '100%' }}>
                      <colgroup>
                        <col style={{ width: 32 }} />
                        <col style={{ width: '28%' }} />
                        <col style={{ width: 82 }} />
                        <col style={{ width: 82 }} />
                        <col style={{ width: 118 }} />
                        <col style={{ width: 68 }} />
                      </colgroup>
                      <tbody>
                        {bulkRows.length === 0 && !bulkLoading && (
                          <tr><td colSpan={6} style={{ textAlign: 'center', padding: '1.5rem', color: '#94a3b8', fontSize: 13 }}>
                            Введіть % і дату щоб побачити попередній перегляд
                          </td></tr>
                        )}
                        {groupOrder.map(groupName => {
                          const rows = groupMap.get(groupName)!
                          const allG = rows.every(r => r.checked)
                          const anyG = rows.some(r => r.checked)
                          return (
                            <>
                              {/* Рядок-заголовок групи */}
                              <tr key={`g-${groupName}`} style={{ background: '#f1f5f9' }}>
                                <td style={{ ...td, padding: '0.25rem 0.5rem' }}>
                                  <IndeterminateCheckbox
                                    checked={allG}
                                    indeterminate={anyG && !allG}
                                    onChange={v => setBulkRows(prev => prev.map(r =>
                                      r.category_name === groupName ? { ...r, checked: v } : r))}
                                  />
                                </td>
                                <td colSpan={5} style={{ ...td, fontWeight: 700, color: '#334155',
                                  fontSize: 12, letterSpacing: '0.04em', textTransform: 'uppercase',
                                  padding: '0.25rem 0.6rem' }}>
                                  {groupName}
                                  <span style={{ fontWeight: 400, color: '#94a3b8', marginLeft: 6 }}>
                                    ({rows.filter(r => r.checked).length}/{rows.length})
                                  </span>
                                </td>
                              </tr>
                              {/* Рядки виробів групи */}
                              {rows.map(row => {
                                const idx = bulkRows.findIndex(r => r.product_id === row.product_id)
                                const pct = row.old_price > 0
                                  ? ((parseFloat(row.manual_price) || row.new_price) - row.old_price) / row.old_price * 100
                                  : 0
                                const pctStr = (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%'
                                const pctColor = pct > 0 ? '#16a34a' : pct < 0 ? '#dc2626' : '#64748b'
                                return (
                                  <tr key={row.product_id}
                                    style={{ background: row.has_collision && row.checked ? '#fffbeb' : undefined,
                                      opacity: row.checked ? 1 : 0.45 }}>
                                    <td style={td}>
                                      <input type="checkbox" checked={row.checked}
                                        onChange={e => setBulkRows(prev => prev.map((r, j) =>
                                          j === idx ? { ...r, checked: e.target.checked } : r))} />
                                    </td>
                                    <td style={{ ...td, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                      {row.product_name}
                                      {row.has_collision && (
                                        <span style={{ color: '#f59e0b', marginLeft: 5 }}
                                          title={`Конфліктна ціна: ${row.collision_date}`}>⚠</span>
                                      )}
                                    </td>
                                    <td style={{ ...td, fontSize: 11, color: '#94a3b8' }}>{row.valid_from}</td>
                                    <td style={td}>{row.old_price.toFixed(2)}</td>
                                    <td style={td}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                                        <input type="number" step="0.01" min="0.01"
                                          value={row.manual_price}
                                          onChange={e => setBulkRows(prev => prev.map((r, j) =>
                                            j === idx ? { ...r, manual_price: e.target.value, locked: true } : r))}
                                          style={{ width: 70, padding: '2px 5px', border: '1px solid #cbd5e1',
                                            borderRadius: 4, fontSize: 13,
                                            background: row.locked ? '#eff6ff' : undefined }} />
                                        {row.locked && (
                                          <button type="button" title="Зняти блокування"
                                            onClick={() => {
                                              const newP = round2(row.old_price * (1 + (parseFloat(bulkPct) || 0) / 100))
                                              setBulkRows(prev => prev.map((r, j) =>
                                                j === idx ? { ...r, locked: false, manual_price: newP.toFixed(2), new_price: newP } : r))
                                            }}
                                            style={{ background: 'none', border: 'none', cursor: 'pointer',
                                              fontSize: 14, color: '#3b82f6', padding: 0, lineHeight: 1 }}>
                                            🔒
                                          </button>
                                        )}
                                      </div>
                                    </td>
                                    <td style={{ ...td, color: pctColor, fontWeight: 600 }}>{pctStr}</td>
                                  </tr>
                                )
                              })}
                            </>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
                  <button type="button" onClick={() => { setBulkModal(false); setBulkRows([]); setError('') }}
                    className={formStyles.btnSecondary}>
                    Скасувати
                  </button>
                  <button type="button"
                    disabled={saving || checkedRows.length === 0}
                    onClick={submitBulk}
                    className={formStyles.btnPrimary}>
                    {saving ? 'Збереження...' : `Підтвердити зміни (${checkedRows.length})`}
                  </button>
                </div>
              </Modal>
            )
          })()}
        </>
      )}

      {/* ── Індивідуальні ціни ── */}
      {innerTab === 'overrides' && (() => {
        // Group overrides by client
        const clientMap = new Map<number, ClientPriceOverride[]>()
        for (const o of overrides) {
          if (!clientMap.has(o.client_id)) clientMap.set(o.client_id, [])
          clientMap.get(o.client_id)!.push(o)
        }
        const sortedClients = Array.from(clientMap.entries())
          .sort(([a], [b]) => cName(a).localeCompare(cName(b), 'uk'))

        return (
          <>

            {sortedClients.length === 0 && (
              <p style={{ color: '#94a3b8', padding: 24, textAlign: 'center' }}>Немає індивідуальних цін</p>
            )}

            {sortedClients.map(([clientId, cOverrides]) => {
              const isExpanded = expandedClient === clientId
              const activeOvs = cOverrides.filter(
                o => o.valid_from <= today && (o.valid_to === null || o.valid_to >= today)
              )
              const activeSum = activeOvs.reduce((s, o) => s + o.price, 0)
              const toggleExpand = () => setExpandedClient(isExpanded ? null : clientId)

              // Будуємо GanttRow[] з індивідуальних цін клієнта
              const productMap = new Map<number, import('../components/PriceGantt').GanttPriceSegment[]>()
              for (const o of cOverrides) {
                if (!productMap.has(o.product_id)) productMap.set(o.product_id, [])
                productMap.get(o.product_id)!.push({
                  price_id: o.id, price: o.price,
                  valid_from: o.valid_from, valid_to: o.valid_to ?? null,
                })
              }
              const ovGanttRows = Array.from(productMap.entries())
                .sort(([a], [b]) => pName(a).localeCompare(pName(b), 'uk'))
                .map(([pid, segs]) => ({
                  product_id: pid,
                  product_name: pName(pid),
                  prices: [...segs].sort((a, b) => a.valid_from.localeCompare(b.valid_from)),
                }))

              return (
                <div key={clientId} style={{ marginBottom: 6, border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
                  <div onClick={toggleExpand} style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px',
                    background: '#f8fafc', cursor: 'pointer', userSelect: 'none',
                    borderBottom: isExpanded ? '1px solid #e2e8f0' : 'none',
                  }}>
                    <span style={{ fontSize: 12, color: '#64748b', width: 12 }}>{isExpanded ? '▼' : '▶'}</span>
                    <strong style={{ flex: 1, fontSize: 14, color: '#1e293b' }}>{cName(clientId)}</strong>
                    <span style={{ fontSize: 12, color: '#64748b' }}>
                      {cOverrides.length} {cOverrides.length === 1 ? 'запис' : cOverrides.length < 5 ? 'записи' : 'записів'}
                    </span>
                    {activeOvs.length > 0 && (
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#16a34a', background: '#f0fdf4', padding: '2px 8px', borderRadius: 4 }}>
                        активних: {activeOvs.length} · {activeSum.toFixed(2)} ₴
                      </span>
                    )}
                    <button
                      onClick={e => { e.stopPropagation(); openOverrideModal(String(clientId)) }}
                      style={{ fontSize: 12, padding: '3px 10px', border: '1px solid #3b82f6', borderRadius: 6, background: 'white', color: '#2563eb', cursor: 'pointer' }}
                    >+ Ціни</button>
                  </div>
                  {isExpanded && (
                    <div style={{ padding: '8px 0 4px' }}>
                      {timeframeBar(ovTimeFrom, setOvTimeFrom, ovTimeTo, setOvTimeTo, earliestOvDate)}
                      <PriceGantt
                        rows={ovGanttRows}
                        timeFrom={ovTimeFrom}
                        timeTo={ovTimeTo}
                        today={today}
                        onEdit={(id) => openOvEdit(id)}
                        onDelete={(id) => deleteOverride(id)}
                      />
                    </div>
                  )}
                </div>
              )
            })}

            {ovEditId !== null && (() => {
              const o = overrides.find(x => x.id === ovEditId)!
              // min для valid_to: max(valid_from + 1 день, завтра)
              const minValidTo = o.valid_from >= tomorrow
                ? (() => { const d = new Date(o.valid_from); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10) })()
                : tomorrow
              return (
                <Modal title={`Редагувати ціну — ${pName(o.product_id)}`} onClose={() => setOvEditId(null)}>
                  <div className={formStyles.form}>
                    <div className={formStyles.field}>
                      <label>Ціна, ₴ *</label>
                      <input type="number" min="0.01" step="0.01" required
                        value={ovEditForm.price}
                        onChange={e => setOvEditForm(f => ({ ...f, price: e.target.value }))} />
                    </div>
                    <div className={formStyles.field}>
                      <label>Діє з</label>
                      <input type="text" disabled value={o.valid_from}
                        style={{ background: '#f8fafc', color: '#64748b' }} />
                    </div>
                    <div className={formStyles.field}>
                      <label>Діє до <span style={{ fontWeight: 400, color: '#94a3b8' }}>(порожньо = безстроково)</span></label>
                      <input type="date" min={minValidTo}
                        value={ovEditForm.valid_to}
                        onChange={e => setOvEditForm(f => ({ ...f, valid_to: e.target.value }))} />
                    </div>
                    <div className={formStyles.actions}>
                      <button type="button" onClick={() => setOvEditId(null)} className={formStyles.btnSecondary}>Скасувати</button>
                      <button type="button" disabled={saving} onClick={submitOvEdit} className={formStyles.btnPrimary}>
                        {saving ? 'Збереження...' : 'Зберегти'}
                      </button>
                    </div>
                  </div>
                </Modal>
              )
            })()}

            {overrideModal && (
              <Modal title="Індивідуальні ціни клієнта" wide onClose={() => { setOverrideModal(false); setError('') }}>
                <form onSubmit={submitBulkOverride} className={formStyles.form}>
                  {error && <p style={{ color: '#c0392b', margin: '0 0 .5rem' }}>{error}</p>}
                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 12, alignItems: 'flex-end' }}>
                    <div className={formStyles.field} style={{ flex: '1 1 200px', minWidth: 180, margin: 0 }}>
                      <label>Клієнт *</label>
                      <select required value={ovModalClient}
                        onChange={e => { setOvModalClient(e.target.value); populateOvRows(e.target.value) }}>
                        <option value="">— оберіть клієнта —</option>
                        {clients.filter(c => c.is_active).map(c => (
                          <option key={c.id} value={c.id}>{c.short_name ?? c.full_name}</option>
                        ))}
                      </select>
                    </div>
                    <div className={formStyles.field} style={{ flex: '0 0 140px', margin: 0 }}>
                      <label>Діє з *</label>
                      <input required type="date" min={tomorrow} value={ovModalValidFrom}
                        onChange={e => {
                          setOvModalValidFrom(e.target.value)
                          if (ovModalValidTo && ovModalValidTo < e.target.value) setOvModalValidTo(e.target.value)
                        }} />
                    </div>
                    <div className={formStyles.field} style={{ flex: '0 0 160px', margin: 0 }}>
                      <label>Діє до <span style={{ fontWeight: 400, color: '#94a3b8' }}>(необов'язково)</span></label>
                      <input type="date" min={ovModalValidFrom || tomorrow} value={ovModalValidTo}
                        onChange={e => setOvModalValidTo(e.target.value)} />
                    </div>
                  </div>

                  {ovModalClient && (
                    <>
                      <div style={{ maxHeight: 420, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 6 }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                          <thead>
                            <tr>
                              {['Виріб', 'Базова ціна', 'Поточна інд. ціна', 'Нова ціна, ₴', '% від бази'].map(h => (
                                <th key={h} style={{
                                  padding: '0.35rem 0.6rem', textAlign: 'left', fontSize: 13,
                                  background: '#f8fafc', fontWeight: 600, color: '#475569',
                                  position: 'sticky', top: 0, zIndex: 1, borderBottom: '2px solid #e2e8f0',
                                }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {ovModalRows.map((row, idx) => {
                              const newVal = parseFloat(row.new_price)
                              const pct = !isNaN(newVal) && newVal > 0 && row.base_price
                                ? ((newVal - row.base_price) / row.base_price * 100) : null
                              return (
                                <tr key={row.product_id} style={{ background: idx % 2 === 0 ? '#fff' : '#fafafa' }}>
                                  <td style={{ padding: '0.3rem 0.55rem', borderBottom: '1px solid #f0f0f0' }}>{row.product_name}</td>
                                  <td style={{ padding: '0.3rem 0.55rem', borderBottom: '1px solid #f0f0f0', color: '#64748b' }}>
                                    {row.base_price !== null ? `${row.base_price.toFixed(2)} ₴` : '—'}
                                  </td>
                                  <td style={{ padding: '0.3rem 0.55rem', borderBottom: '1px solid #f0f0f0', fontWeight: row.cur_override ? 600 : 400, color: row.cur_override ? '#1e293b' : '#94a3b8' }}>
                                    {row.cur_override ? `${row.cur_override.price.toFixed(2)} ₴` : '—'}
                                  </td>
                                  <td style={{ padding: '0.3rem 0.55rem', borderBottom: '1px solid #f0f0f0' }}>
                                    <input type="number" min="0.01" step="0.01" placeholder="не змінювати"
                                      value={row.new_price}
                                      onChange={e => setOvModalRows(prev => prev.map((r, i) =>
                                        i === idx ? { ...r, new_price: e.target.value } : r
                                      ))}
                                      style={{ width: '100%', padding: '3px 6px', border: '1px solid #cbd5e1', borderRadius: 4, fontSize: 13 }}
                                    />
                                  </td>
                                  <td style={{ padding: '0.3rem 0.55rem', borderBottom: '1px solid #f0f0f0', fontWeight: 600,
                                    color: pct === null ? '#94a3b8' : pct > 0 ? '#16a34a' : pct < 0 ? '#dc2626' : '#64748b',
                                  }}>
                                    {pct !== null ? `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%` : '—'}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                      <p style={{ fontSize: 12, color: '#94a3b8', margin: '6px 0 0' }}>
                        Заповніть ціни лише для потрібних виробів. Порожні рядки пропускаються.
                      </p>
                    </>
                  )}

                  <div className={formStyles.actions}>
                    <button type="button" onClick={() => { setOverrideModal(false); setError('') }} className={formStyles.btnSecondary}>
                      Скасувати
                    </button>
                    <button type="submit" disabled={saving || !ovModalClient || ovModalRows.every(r => !r.new_price || parseFloat(r.new_price) <= 0)} className={formStyles.btnPrimary}>
                      {saving ? 'Збереження...' : `Зберегти (${ovModalRows.filter(r => r.new_price !== '' && parseFloat(r.new_price) > 0).length})`}
                    </button>
                  </div>
                </form>
              </Modal>
            )}
          </>
        )
      })()}
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
  const [showInactive, setShowInactive] = useState(false)

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

  const sorted         = [...categories].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'uk'))
  const sortedActive   = sorted.filter(c => c.is_active)
  const sortedInactive = sorted.filter(c => !c.is_active)

  const renderCatRow = (c: Category, dimmed = false) => (
    <tr key={c.id} style={dimmed ? { opacity: 0.5, background: '#f9fafb' } : undefined}>
      <Td>{c.sort_order}</Td>
      <Td>{c.name}</Td>
      <Td>{c.is_baked ? '✓ Випікається' : '—'}</Td>
      <Td>{c.is_baked ? `${c.reserve_pct}%` : '—'}</Td>
      <Td>
        <button onClick={() => openEdit(c)} style={editBtnStyle}>Редагувати</button>
        <button onClick={() => handleToggle(c)} style={c.is_active ? delBtnStyle : { ...editBtnStyle, color: '#080' }}>
          {c.is_active ? 'Приховати' : 'Відновити'}
        </button>
      </Td>
    </tr>
  )

  return (
    <section>
      <strong>Категорії (відділи) — {sortedActive.length} активних</strong>
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
            <Th>Порядок</Th><Th>Назва</Th><Th>Відділ випічки</Th><Th>Резерв, %</Th><Th>Дії</Th>
          </tr>
        </thead>
        <tbody>
          {sortedActive.map(c => renderCatRow(c))}
          {sortedInactive.length > 0 && (
            <tr>
              <td colSpan={5} style={{ padding: '6px 10px', borderTop: '2px dashed #d1d5db' }}>
                <button
                  onClick={() => setShowInactive(v => !v)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: 13, padding: 0 }}
                >
                  {showInactive ? '▲' : '▼'} Деактивовані ({sortedInactive.length})
                </button>
              </td>
            </tr>
          )}
          {showInactive && sortedInactive.map(c => renderCatRow(c, true))}
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
  const [showInactive, setShowInactive] = useState(false)

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

  const renderRow = (item: SimpleItem, dimmed = false) => (
    <tr key={item.id} style={dimmed ? { opacity: 0.5, background: '#f9fafb' } : undefined}>
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
  )

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
        <strong>{title} ({active.length})</strong>
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
          {active.map(item => renderRow(item))}
          {active.length === 0 && (
            <tr><td colSpan={3} style={{ textAlign: 'center', padding: '1rem', color: '#888' }}>
              Список порожній
            </td></tr>
          )}
          {inactive.length > 0 && (
            <tr>
              <td colSpan={3} style={{ padding: '6px 10px', borderTop: '2px dashed #d1d5db' }}>
                <button
                  onClick={() => setShowInactive(v => !v)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: 13, padding: 0 }}
                >
                  {showInactive ? '▲' : '▼'} Деактивовані ({inactive.length})
                </button>
              </td>
            </tr>
          )}
          {showInactive && inactive.map(item => renderRow(item, true))}
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
  // overflow: hidden прибрано — воно блокує position:sticky на <th>
  boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
}

const Th = ({ children, top }: { children: React.ReactNode; top?: number }) => (
  <th style={{
    padding: '0.45rem 0.8rem', textAlign: 'left', fontWeight: 600, fontSize: '0.875rem',
    ...(top !== undefined ? {
      position: 'sticky', top, zIndex: 5,
      background: '#e8eef5',
      boxShadow: 'inset 0 -1px 0 #d1d5db',
    } : {}),
  }}>
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

type SettingsSection = 'settings_bakery' | 'settings_bot' | 'settings_bot_tpl' | 'settings_issues'

function SettingsTab({ section }: { section: SettingsSection }) {
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
      {section === 'settings_bakery' && <>
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

        {/* ── Додаткові функції (окремі перемикачі) ── */}
        <div style={{ marginTop: '2rem', borderTop: '1px solid #e8eef5', paddingTop: '1.25rem' }}>
          <div style={{ fontWeight: 600, color: '#1a3a5c', marginBottom: '0.75rem', fontSize: '0.9rem' }}>
            Додаткові функції
          </div>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', maxWidth: 520 }}>
            <input
              type="checkbox"
              checked={form['baking_route_reserve'] === '1'}
              onChange={(e) => {
                const val = e.target.checked ? '1' : '0'
                setForm(f => ({ ...f, baking_route_reserve: val }))
                api.put('/settings/', { baking_route_reserve: val }).catch(() => {})
              }}
              style={{ marginTop: 3, width: 16, height: 16, cursor: 'pointer' }}
            />
            <span>
              <span style={{ fontWeight: 500 }}>Резерв для маршруту у розподілі надлишків</span>
              <br />
              <span style={{ fontSize: '0.82rem', color: '#e67e22' }}>
                ⚠ Функція в розробці — увімкнення показує опцію «Маршрут (резерв)» у списку розподілу, але рух товару по маршруту ще не реалізовано.
              </span>
            </span>
          </label>
        </div>

      </>}

      {/* ── Telegram Бот ── */}
      {section === 'settings_bot' && <>
        <h3 style={{ marginTop: 0, marginBottom: '1.25rem' }}>Telegram Бот</h3>
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
      </>}

      {/* ── Шаблони повідомлень бота ── */}
      {section === 'settings_bot_tpl' && (
        <BotTemplatesSection
          settings={settings}
          onReload={load}
          inputStyle={inputStyle}
          fieldStyle={fieldStyle}
          labelStyle={labelStyle}
          addBtnStyle={addBtnStyle}
        />
      )}

      {/* ── Система звернень ── */}
      {section === 'settings_issues' && (
        <IssuesSettingsSection
          settings={settings}
          inputStyle={inputStyle}
          fieldStyle={fieldStyle}
          labelStyle={labelStyle}
          addBtnStyle={addBtnStyle}
        />
      )}
    </section>
  )
}

// ─── Шаблони повідомлень Telegram-бота ────────────────────────────────────────

const BOT_TEMPLATES: { key: string; label: string; hint: string }[] = [
  { key: 'bot_tpl_reminder',      label: 'Нагадування про замовлення',       hint: 'Змінні: {date}' },
  { key: 'bot_tpl_deadline',      label: 'Стоп-прийом замовлень',           hint: 'Змінні: {date}' },
  { key: 'bot_tpl_confirmed',     label: 'Підтверджено оператором',          hint: 'Змінні: {product}, {qty}, {date}, {sum}' },
  { key: 'bot_tpl_rejected',      label: 'Відхилено оператором',             hint: 'Змінні: {product}, {qty}, {date}, {reason}' },
  { key: 'bot_tpl_modified',      label: 'Підтверджено зі змінами',          hint: 'Змінні: {product}, {qty}, {new_qty}, {date}, {sum}, {reason}' },
  { key: 'bot_tpl_invoice_sent',  label: 'Накладна відправлена (PDF)',       hint: 'Змінні: {date}' },
]

function BotTemplatesSection({ settings, onReload, inputStyle, fieldStyle, labelStyle, addBtnStyle }: {
  settings: SettingsMap
  onReload: () => void
  inputStyle: React.CSSProperties
  fieldStyle: React.CSSProperties
  labelStyle: React.CSSProperties
  addBtnStyle: React.CSSProperties
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
      <h3 style={{ marginTop: 0, marginBottom: '1.25rem' }}>Шаблони повідомлень бота</h3>
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

function IssuesSettingsSection({ settings, inputStyle, fieldStyle, labelStyle, addBtnStyle }: {
  settings:    SettingsMap
  inputStyle:  React.CSSProperties
  fieldStyle:  React.CSSProperties
  labelStyle:  React.CSSProperties
  addBtnStyle: React.CSSProperties
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
      <h3 style={{ marginTop: 0, marginBottom: '1.25rem' }}>Система звернень</h3>
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
  { key: 'dashboard', label: 'Дашборд' },
  { key: 'orders',    label: 'Замовлення' },
  { key: 'baking',    label: 'Випічка' },
  { key: 'routes',    label: 'Маршрути' },
  { key: 'shop',      label: 'Магазин' },
  { key: 'finances',  label: 'Фінанси' },
  { key: 'pos',       label: 'POS-каса' },
]

// Підрозділи Довідників (всі конфігуруються)
const ADMIN_SUB_PERMS = ADMIN_TAB_GROUPS
  .map(g => ({ key: g.permKey as string, label: g.label }))

const ALL_ROLES = ['operator', 'accountant', 'admin', 'owner', 'seller'] as const
const ROLE_LABELS_MAP: Record<string, string> = {
  operator:   'Оператор',
  accountant: 'Бухгалтер',
  admin:      'Адміністратор',
  owner:      'Власник',
  seller:     'Продавець',
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

// ─── Вкладка Бекапи ──────────────────────────────────────────────────────────

type BackupMeta = { name: string; size_kb: number; created_at: string; app_version: string }
type ArchivePreview = { cutoff_date: string; tables: Record<string, number>; total: number }
type DemoStatus = { active: boolean; since: string | null; demo_db_exists: boolean }

function ResetDbSection() {
  const [modal,       setModal]       = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [busy,        setBusy]        = useState(false)
  const [err,         setErr]         = useState('')

  const sectionS: React.CSSProperties = {
    background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8,
    padding: '1.25rem 1.5rem', marginBottom: '1rem',
  }
  const s: React.CSSProperties = { fontSize: '0.85rem' }
  const btnS: React.CSSProperties = {
    background: '#2563eb', color: '#fff', border: 'none',
    padding: '0.4rem 1rem', borderRadius: 5, cursor: 'pointer',
    fontSize: '0.85rem', fontWeight: 600,
  }

  const handleReset = async () => {
    setBusy(true); setErr('')
    try {
      const res = await fetch('/api/v1/settings/reset-db', { method: 'POST' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({ detail: res.statusText }))
        throw new Error(data.detail ?? res.statusText)
      }
      setModal(false)
      window.location.reload()
    } catch (e: any) {
      setErr(String(e.message ?? e))
    } finally { setBusy(false) }
  }

  return (
    <div style={{ ...sectionS, borderColor: '#fde8e8' }}>
      <h3 style={{ margin: '0 0 0.6rem', fontSize: '1rem', fontWeight: 700, color: '#c0392b' }}>
        Скидання бази даних
      </h3>
      <p style={{ ...s, color: '#666', marginTop: 0, marginBottom: '0.75rem', maxWidth: 520, lineHeight: 1.5 }}>
        Видаляє всі вироби, клієнтів, замовлення, накладні, ціни, фінанси та всі інші робочі дані.
        Системні клієнти, користувачі та налаштування залишаться.
      </p>
      <button
        style={{ ...btnS, background: '#fff', border: '1.5px solid #e74c3c', color: '#e74c3c' }}
        onClick={() => { setModal(true); setConfirmText(''); setErr('') }}
      >
        Скинути базу даних...
      </button>

      {modal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div style={{ background: '#fff', borderRadius: 10, padding: '1.75rem',
            maxWidth: 460, width: '90%', boxShadow: '0 8px 32px rgba(0,0,0,0.25)' }}
            onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 1rem', color: '#c0392b', fontSize: '1.1rem' }}>Скидання бази даних</h3>
            <p style={{ fontSize: '0.9rem', marginTop: 0, lineHeight: 1.55 }}>
              Ця дія <strong>незворотна</strong>. Будуть видалені всі вироби, клієнти,
              замовлення, накладні, ціни, фінанси та всі інші робочі дані.
            </p>
            <p style={{ fontSize: '0.9rem', marginTop: 0, lineHeight: 1.55 }}>
              Системні клієнти (магазин, списання, пайок), користувачі та налаштування залишаться.
            </p>
            <p style={{ fontSize: '0.9rem', marginBottom: '0.4rem' }}>
              Щоб підтвердити, введіть <strong>СКИНУТИ</strong>:
            </p>
            <input
              autoFocus
              value={confirmText}
              onChange={e => setConfirmText(e.target.value.toUpperCase())}
              placeholder="СКИНУТИ"
              style={{ padding: '0.4rem 0.7rem', border: '1.5px solid #ccc', borderRadius: 4,
                fontSize: '1rem', width: '100%', marginBottom: '0.85rem', boxSizing: 'border-box' }}
            />
            {err && <div style={{ color: '#c0392b', fontSize: '0.85rem', marginBottom: '0.6rem' }}>
              {err}
            </div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button onClick={() => setModal(false)} disabled={busy}
                style={{ background: '#f3f4f6', border: '1px solid #d1d5db', color: '#374151',
                  padding: '0.4rem 1rem', borderRadius: 4, cursor: 'pointer', fontSize: '0.9rem' }}>
                Скасувати
              </button>
              <button
                onClick={handleReset}
                disabled={confirmText !== 'СКИНУТИ' || busy}
                style={{
                  background: confirmText === 'СКИНУТИ' ? '#e74c3c' : '#ccc',
                  color: '#fff', border: 'none', padding: '0.4rem 1.1rem', borderRadius: 4,
                  cursor: confirmText === 'СКИНУТИ' ? 'pointer' : 'not-allowed',
                  fontWeight: 600, fontSize: '0.9rem',
                }}
              >
                {busy ? 'Очищення...' : 'Скинути'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function BackupTab() {
  const [form, setForm]                   = useState<Record<string, string>>({})
  const [savingSettings, setSavingSettings] = useState(false)
  const [savedSettings, setSavedSettings]   = useState(false)

  const [backups, setBackups]             = useState<BackupMeta[]>([])
  const [backingUp, setBackingUp]         = useState(false)

  const [demoStatus, setDemoStatus]       = useState<DemoStatus | null>(null)
  const [demoLoading, setDemoLoading]     = useState(false)

  const [archiveDate, setArchiveDate]     = useState('')
  const [archivePreview, setArchivePreview] = useState<ArchivePreview | null>(null)
  const [archivePreviewing, setArchivePreviewing] = useState(false)
  const [archiving, setArchiving]         = useState(false)
  const [archiveResult, setArchiveResult] = useState<{ deleted_rows: number; freed_mb: number } | null>(null)

  const [restoreModal, setRestoreModal]   = useState<{
    filename: string; backup_version: string; current_version: string
    compatible: boolean; rollback_available: boolean
  } | null>(null)

  const [showImportWizard, setShowImportWizard] = useState(false)

  const BACKUP_SETTINGS = [
    { key: 'backup_enabled',      label: 'Автобекап (0=вимк, 1=увімк)',         type: 'text' },
    { key: 'backup_time',         label: 'Час бекапу (HH:MM)',                   type: 'text' },
    { key: 'backup_keep_count',   label: 'Зберігати бекапів',                    type: 'text' },
    { key: 'backup_local_dir',    label: 'Локальна папка (порожньо = backups/)', type: 'text' },
    { key: 'backup_cloud_1_path', label: 'Google Drive папка',                   type: 'text' },
    { key: 'backup_cloud_2_path', label: 'OneDrive папка',                       type: 'text' },
    { key: 'backup_cloud_3_path', label: 'Dropbox папка',                        type: 'text' },
  ]

  type DetectedFolders = { google: string | null; onedrive: string | null; dropbox: string | null }
  const [detected, setDetected] = useState<DetectedFolders>({ google: null, onedrive: null, dropbox: null })

  const loadAll = async () => {
    try {
      const [cfg, bkps, demo, det] = await Promise.all([
        api.get<Record<string, { value: string }>>('/settings/'),
        api.get<BackupMeta[]>('/backup/list'),
        api.get<DemoStatus>('/backup/demo/status'),
        api.get<DetectedFolders>('/backup/cloud/detect'),
      ])
      const s: Record<string, string> = {}
      BACKUP_SETTINGS.forEach(({ key }) => { s[key] = cfg[key]?.value ?? '' })
      setForm(s)
      setBackups(bkps)
      setDemoStatus(demo)
      setDetected(det)
    } catch { /* ignore */ }
  }

  useEffect(() => { loadAll() }, []) // eslint-disable-line

  const handleSaveSettings = async (e: FormEvent) => {
    e.preventDefault()
    setSavingSettings(true); setSavedSettings(false)
    try {
      await Promise.all(
        Object.entries(form).map(([key, value]) =>
          api.put(`/settings/${key}`, { value, description: '' })
        )
      )
      setSavedSettings(true)
      setTimeout(() => setSavedSettings(false), 2000)
    } finally { setSavingSettings(false) }
  }

  const handleBackupNow = async () => {
    setBackingUp(true)
    try {
      await api.post('/backup/now', {})
      await loadAll()
    } catch (e: unknown) {
      alert(`Помилка бекапу: ${e instanceof Error ? e.message : String(e)}`)
    } finally { setBackingUp(false) }
  }

  const handleDeleteBackup = async (name: string) => {
    if (!confirm(`Видалити бекап ${name}?`)) return
    await api.delete(`/backup/${encodeURIComponent(name)}`)
    setBackups(prev => prev.filter(b => b.name !== name))
  }

  const handleDownloadBackup = (name: string) => {
    const a = document.createElement('a')
    a.href = `/api/v1/backup/download/${encodeURIComponent(name)}`
    a.download = name
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  const handleImportBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    const fd = new FormData()
    fd.append('file', file)
    try {
      await fetch('/api/v1/backup/upload', { method: 'POST', body: fd })
      await loadAll()
    } catch (err) {
      alert(`Помилка імпорту: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const handleRestoreClick = async (b: BackupMeta) => {
    const check = await api.get<{
      compatible: boolean; backup_version: string; current_version: string; rollback_available: boolean
    }>(`/backup/restore/${encodeURIComponent(b.name)}/check`)
    setRestoreModal({ filename: b.name, ...check })
  }

  const handleRestoreConfirm = async (rollback_first: boolean) => {
    if (!restoreModal) return
    setRestoreModal(null)
    await api.post(`/backup/restore/${encodeURIComponent(restoreModal.filename)}?rollback_first=${rollback_first}`, {})
    alert('Запит на відновлення надіслано. Сервер незабаром перезапуститься.')
  }

  const handleDemoEnter = async () => {
    if (!confirm('Увійти в демо режим?\n\nПоточна база буде збережена. Для виходу натисніть "Вийти з демо режиму".')) return
    setDemoLoading(true)
    try {
      await api.post('/backup/demo/enter', {})
      alert('Запит надіслано. Сервер перезапускається в демо режимі...')
      setTimeout(loadAll, 5000)
    } catch (e: unknown) {
      alert(`Помилка: ${e instanceof Error ? e.message : String(e)}`)
    } finally { setDemoLoading(false) }
  }

  const handleDemoExit = async () => {
    if (!confirm('Вийти з демо режиму?\n\nБуде відновлена робоча база даних.')) return
    setDemoLoading(true)
    try {
      await api.post('/backup/demo/exit', {})
      alert('Запит надіслано. Сервер перезапускається...')
      setTimeout(loadAll, 5000)
    } catch (e: unknown) {
      alert(`Помилка: ${e instanceof Error ? e.message : String(e)}`)
    } finally { setDemoLoading(false) }
  }

  const handleArchivePreview = async () => {
    if (!archiveDate) return
    setArchivePreviewing(true); setArchivePreview(null)
    try {
      const data = await api.get<ArchivePreview>(`/backup/archive/preview?cutoff_date=${archiveDate}`)
      setArchivePreview(data)
    } catch (e: unknown) {
      alert(`Помилка: ${e instanceof Error ? e.message : String(e)}`)
    } finally { setArchivePreviewing(false) }
  }

  const handleArchiveRun = async () => {
    if (!archivePreview) return
    if (!confirm(`Видалити ${archivePreview.total} записів до ${archiveDate}?\n\nПеред архівуванням буде зроблено бекап.`)) return
    setArchiving(true); setArchiveResult(null)
    try {
      const result = await api.post<{ deleted_rows: number; freed_mb: number }>(
        `/backup/archive?cutoff_date=${archiveDate}`, {}
      )
      setArchiveResult(result)
      setArchivePreview(null)
      await loadAll()
    } catch (e: unknown) {
      alert(`Помилка архівування: ${e instanceof Error ? e.message : String(e)}`)
    } finally { setArchiving(false) }
  }

  const s: React.CSSProperties = { fontSize: '0.85rem' }
  const inputS: React.CSSProperties = {
    border: '1px solid #d0d8e4', borderRadius: 4, padding: '0.3rem 0.5rem',
    fontSize: '0.85rem', width: '100%', boxSizing: 'border-box',
  }
  const sectionS: React.CSSProperties = {
    background: '#f8fafc', border: '1px solid #dce6f0', borderRadius: 8,
    padding: '1rem 1.25rem', marginBottom: '1.25rem',
  }
  const h3S: React.CSSProperties = { margin: '0 0 0.75rem', fontSize: '0.9rem', color: '#2c3e50' }
  const btnS: React.CSSProperties = {
    background: '#3498db', color: '#fff', border: 'none', borderRadius: 5,
    padding: '0.35rem 0.9rem', cursor: 'pointer', fontSize: '0.85rem',
  }

  return (
    <section style={{ maxWidth: 780, padding: '0.5rem 0' }}>

      {/* ── 1. Налаштування бекапів ── */}
      <div style={sectionS}>
        <h3 style={h3S}>Налаштування автобекапу</h3>
        <form onSubmit={handleSaveSettings}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem 1rem' }}>
            {BACKUP_SETTINGS.map(({ key, label }) => (
              <div key={key}>
                <div style={{ ...s, color: '#666', marginBottom: 2 }}>{label}</div>
                <input style={inputS} value={form[key] ?? ''} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} />
              </div>
            ))}
          </div>
          <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button type="submit" style={btnS} disabled={savingSettings}>
              {savingSettings ? 'Збереження...' : 'Зберегти'}
            </button>
            {savedSettings && <span style={{ color: '#27ae60', fontSize: '0.82rem' }}>✓ Збережено</span>}
          </div>
        </form>
      </div>

      {/* ── 2. Хмарна синхронізація через sync-папки ── */}
      <div style={sectionS}>
        <h3 style={h3S}>Хмарне резервне копіювання</h3>
        <p style={{ fontSize: '0.82rem', color: '#64748b', marginBottom: 12 }}>
          Встановіть desktop-клієнт Google Drive, OneDrive або Dropbox — вони синхронізують локальну папку з хмарою.
          Вкажіть шлях до цієї папки нижче, і бекапи копіюватимуться туди автоматично.
        </p>
        {([
          { id: 'google',   key: 'backup_cloud_1_path', label: 'Google Drive', icon: '🟦',
            hint: 'Зазвичай: C:\\Users\\Ім\'я\\Google Drive' },
          { id: 'onedrive', key: 'backup_cloud_2_path', label: 'OneDrive',     icon: '🟪',
            hint: 'Зазвичай: C:\\Users\\Ім\'я\\OneDrive' },
          { id: 'dropbox',  key: 'backup_cloud_3_path', label: 'Dropbox',      icon: '🟦',
            hint: 'Зазвичай: C:\\Users\\Ім\'я\\Dropbox' },
        ] as const).map(p => {
          const detectedPath = detected[p.id as keyof DetectedFolders]
          const currentPath = form[p.key] ?? ''
          return (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #eef2f7' }}>
              <span style={{ fontSize: 20 }}>{p.icon}</span>
              <div style={{ width: 100, flexShrink: 0 }}>
                <strong style={{ fontSize: '0.88rem' }}>{p.label}</strong>
              </div>
              <div style={{ flex: 1 }}>
                <input
                  type="text"
                  value={currentPath}
                  placeholder={detectedPath ?? p.hint}
                  style={{ ...inputS, width: '100%', boxSizing: 'border-box' }}
                  onChange={e => setForm(f => ({ ...f, [p.key]: e.target.value }))}
                />
              </div>
              {detectedPath && !currentPath && (
                <button
                  style={{ ...btnS, background: '#16a34a', padding: '0.2rem 0.7rem', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
                  onClick={() => setForm(f => ({ ...f, [p.key]: detectedPath }))}
                  title={detectedPath}
                >
                  ✓ Виявлено
                </button>
              )}
              {currentPath && (
                <button
                  style={{ ...btnS, background: '#e74c3c', padding: '0.2rem 0.6rem', fontSize: '0.8rem' }}
                  onClick={() => setForm(f => ({ ...f, [p.key]: '' }))}
                  title="Вимкнути синхронізацію"
                >
                  ✕
                </button>
              )}
            </div>
          )
        })}
        <p style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: 8 }}>
          Після зміни натисніть "Зберегти налаштування" у секції вище. Бекапи також зберігаються у вказаних папках.
        </p>
      </div>

      {/* ── 2. Бекапи ── */}
      <div style={sectionS}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <h3 style={{ ...h3S, margin: 0 }}>Резервні копії</h3>
          <div style={{ display: 'flex', gap: 8 }}>
            <label style={{ ...btnS, background: '#27ae60', cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }}>
              📂 Імпортувати
              <input type="file" accept=".db" style={{ display: 'none' }} onChange={handleImportBackup} />
            </label>
            <button style={btnS} onClick={handleBackupNow} disabled={backingUp}>
              {backingUp ? 'Зберігання...' : '+ Зробити бекап зараз'}
            </button>
            <button
              style={{ ...btnS, background: '#7c3aed' }}
              onClick={() => setShowImportWizard(true)}
            >
              📥 Імпорт з Access
            </button>
          </div>
        </div>
        {backups.length === 0 && (
          <div style={{ ...s, color: '#aaa' }}>Бекапів ще немає</div>
        )}
        {backups.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #dce6f0' }}>
                <th style={{ textAlign: 'left', padding: '0.3rem 0.5rem', color: '#666', fontWeight: 500 }}>Файл</th>
                <th style={{ textAlign: 'right', padding: '0.3rem 0.5rem', color: '#666', fontWeight: 500 }}>Розмір</th>
                <th style={{ textAlign: 'center', padding: '0.3rem 0.5rem', color: '#666', fontWeight: 500 }}>Версія</th>
                <th style={{ padding: '0.3rem 0.5rem' }}></th>
              </tr>
            </thead>
            <tbody>
              {backups.map(b => (
                <tr key={b.name} style={{ borderBottom: '1px solid #eef2f7' }}>
                  <td style={{ padding: '0.3rem 0.5rem' }}>
                    {b.name.replace('bakery_', '').replace('.db', '')}
                    {b.created_at && <span style={{ color: '#aaa', marginLeft: 6 }}>{b.created_at.slice(0, 16).replace('T', ' ')}</span>}
                  </td>
                  <td style={{ padding: '0.3rem 0.5rem', textAlign: 'right', color: '#555' }}>
                    {b.size_kb >= 1024 ? `${(b.size_kb / 1024).toFixed(1)} MB` : `${b.size_kb} KB`}
                  </td>
                  <td style={{ padding: '0.3rem 0.5rem', textAlign: 'center', color: '#888' }}>
                    {b.app_version || '—'}
                  </td>
                  <td style={{ padding: '0.3rem 0.5rem', textAlign: 'right', display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    <button
                      style={{ ...btnS, background: '#27ae60', padding: '0.2rem 0.6rem' }}
                      onClick={() => handleDownloadBackup(b.name)}
                      title="Зберегти файл бекапу"
                    >⬇ Зберегти</button>
                    <button
                      style={{ ...btnS, background: '#6c8ebf', padding: '0.2rem 0.6rem' }}
                      onClick={() => handleRestoreClick(b)}
                    >↩ Відновити</button>
                    <button
                      style={{ ...btnS, background: '#e74c3c', padding: '0.2rem 0.6rem' }}
                      onClick={() => handleDeleteBackup(b.name)}
                    >🗑</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── 3. Демо режим ── */}
      <div style={sectionS}>
        <h3 style={h3S}>Демо режим</h3>
        {demoStatus?.active ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <span style={{ background: '#f39c12', color: '#fff', padding: '0.2rem 0.7rem',
              borderRadius: 12, fontWeight: 600, fontSize: '0.82rem' }}>
              ⚡ АКТИВНИЙ{demoStatus.since ? ` (з ${demoStatus.since.slice(11, 16)})` : ''}
            </span>
            <button style={{ ...btnS, background: '#e74c3c' }} onClick={handleDemoExit} disabled={demoLoading}>
              {demoLoading ? 'Виконується...' : '■ Вийти з демо режиму'}
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <span style={{ ...s, color: '#888' }}>● Неактивний</span>
            <button style={btnS} onClick={handleDemoEnter} disabled={demoLoading || !demoStatus?.demo_db_exists}>
              {demoLoading ? 'Виконується...' : '▶ Увійти в демо режим'}
            </button>
            {!demoStatus?.demo_db_exists && (
              <span style={{ ...s, color: '#e74c3c' }}>
                demo.db відсутня — спочатку згенеруйте:
                <code style={{ background: '#f0f4f8', padding: '0 4px', borderRadius: 3, marginLeft: 4, fontSize: '0.8rem' }}>
                  python scripts/generate_demo_db.py
                </code>
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── 4. Архівування ── */}
      <div style={sectionS}>
        <h3 style={h3S}>Архівування старих даних</h3>
        <p style={{ ...s, color: '#666', marginBottom: '0.75rem', lineHeight: 1.5 }}>
          Видаляє записи старші за вказану дату. Фінансові баланси клієнтів зберігаються у
          вигляді snapshot-запису. Перед виконанням автоматично робиться бекап.
        </p>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <div style={{ ...s, color: '#666', marginBottom: 2 }}>Архівувати дані до (не включно)</div>
            <input
              type="date"
              style={{ ...inputS, width: 160 }}
              value={archiveDate}
              onChange={e => { setArchiveDate(e.target.value); setArchivePreview(null); setArchiveResult(null) }}
            />
          </div>
          <button style={{ ...btnS, background: '#6c8ebf' }} onClick={handleArchivePreview}
            disabled={!archiveDate || archivePreviewing}>
            {archivePreviewing ? 'Перевірка...' : 'Перевірити'}
          </button>
        </div>

        {archivePreview && (
          <div style={{ marginTop: '0.75rem', background: '#fff8e1', border: '1px solid #f0c040',
            borderRadius: 6, padding: '0.75rem', fontSize: '0.82rem' }}>
            <strong style={{ color: '#b7860a' }}>⚠ Буде видалено {archivePreview.total} записів:</strong>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem 1.2rem', marginTop: '0.4rem', color: '#555' }}>
              {Object.entries(archivePreview.tables).filter(([, n]) => n > 0).map(([t, n]) => (
                <span key={t}>{t}: {n}</span>
              ))}
            </div>
            <button style={{ ...btnS, background: '#e74c3c', marginTop: '0.75rem' }}
              onClick={handleArchiveRun} disabled={archiving}>
              {archiving ? 'Архівування...' : 'Архівувати зараз'}
            </button>
          </div>
        )}

        {archiveResult && (
          <div style={{ marginTop: '0.75rem', background: '#eafaf1', border: '1px solid #82e0aa',
            borderRadius: 6, padding: '0.6rem 0.75rem', fontSize: '0.82rem', color: '#1e8449' }}>
            ✓ Видалено {archiveResult.deleted_rows} записів
            {archiveResult.freed_mb > 0 && `, звільнено ${archiveResult.freed_mb} MB`}
          </div>
        )}
      </div>

      {/* ── 5. Скидання бази даних ── */}
      <ResetDbSection />

      {/* ── Майстер імпорту з Access (full-screen modal) ── */}
      {showImportWizard && (
        <ImportPage onClose={() => setShowImportWizard(false)} />
      )}

      {/* ── Модальне вікно відновлення ── */}
      {restoreModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
        }} onClick={() => setRestoreModal(null)}>
          <div style={{
            background: '#fff', borderRadius: 10, padding: '1.5rem', maxWidth: 420, width: '90%',
            boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
          }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 0.75rem', fontSize: '1rem' }}>Відновлення бекапу</h3>
            <p style={{ ...s, lineHeight: 1.6, color: '#444' }}>
              <strong>{restoreModal.filename.replace('bakery_', '').replace('.db', '')}</strong>
            </p>
            {!restoreModal.compatible ? (
              <div style={{ background: '#fff3cd', border: '1px solid #ffc107', borderRadius: 6,
                padding: '0.6rem 0.75rem', marginBottom: '0.75rem', fontSize: '0.82rem' }}>
                ⚠ Бекап з версії <strong>{restoreModal.backup_version}</strong>, поточна <strong>{restoreModal.current_version}</strong>.
                Можлива несумісність схеми БД.
              </div>
            ) : (
              <div style={{ ...s, color: '#27ae60', marginBottom: '0.75rem' }}>
                ✓ Версія збігається ({restoreModal.current_version})
              </div>
            )}
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button style={btnS} onClick={() => handleRestoreConfirm(false)}>
                Відновити
              </button>
              {!restoreModal.compatible && (
                <button
                  style={{ ...btnS, background: restoreModal.rollback_available ? '#e67e22' : '#bbb',
                    cursor: restoreModal.rollback_available ? 'pointer' : 'not-allowed' }}
                  onClick={() => restoreModal.rollback_available && handleRestoreConfirm(true)}
                  title={!restoreModal.rollback_available ? 'Git-тег недоступний' : 'Відкатить версію програми, потім відновить БД'}
                >
                  Відкотити версію і відновити
                </button>
              )}
              <button style={{ ...btnS, background: '#aaa' }} onClick={() => setRestoreModal(null)}>Скасувати</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
