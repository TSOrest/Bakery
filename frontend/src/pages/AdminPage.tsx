import { useEffect, useState, useRef, type FormEvent } from 'react'
import { startDeviceFlow, pollDeviceFlow, getGitHubStatus, githubLogout, type GitHubStatus } from '../api/auth_github'
import { api } from '../api/client'
import type { Client, Product, Route, Unit, Category } from '../types'
import UsersTab from './UsersTab'
import ImportPage from './ImportPage'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../components/Toast'

// ─── Винесені вкладки (split v1.1.0) ─────────────────────────────────────────
import FinanceArticlesTab from './admin/FinanceArticlesTab'
import CategoriesTab from './admin/CategoriesTab'
import RoutesTab from './admin/RoutesTab'
import SimpleListTab from './admin/SimpleListTab'
import SystemClientsTab from './admin/SystemClientsTab'
import ProductsTab from './admin/ProductsTab'
import ClientsTab from './admin/ClientsTab'
import PricesTab from './admin/PricesTab'
import IngredientsTab from './admin/IngredientsTab'
import MarginTab from './admin/MarginTab'
import ResetDbSection from './admin/ResetDbSection'
import {
  addBtnStyle, delBtnStyle, editBtnStyle, tableStyle,
} from './admin/shared'

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

// ─── Системні клієнти ────────────────────────────────────────────────────────

// ─── Маршрути ────────────────────────────────────────────────────────────────


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
  order_lock_time:          'Час блокування замовлень',
  order_past_days:          'Днів назад для редагування замовлень',
  work_date_next_day_time:  'Час переходу дати роботи на завтра',
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
                          title="Відкликати доступ" aria-label="Відкликати доступ">✕</button>
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

// ─── Вкладка Бекапи ──────────────────────────────────────────────────────────

type BackupMeta = { name: string; size_kb: number; created_at: string; app_version: string }
type ArchivePreview = { cutoff_date: string; tables: Record<string, number>; total: number }
type DemoStatus = { active: boolean; since: string | null; demo_db_exists: boolean }

function BackupTab() {
  const toast = useToast()
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
  const [testingCloud, setTestingCloud] = useState<string | null>(null)  // key якого зараз тестуємо

  const handleTestCloud = async (key: string, path: string) => {
    if (!path) return
    setTestingCloud(key)
    try {
      const res = await api.post<{ status: string; detail: string }>(
        '/backup/cloud/test', { path },
      )
      if (res.status === 'ok') {
        toast.success(res.detail)
      } else {
        toast.error(res.detail)
      }
    } catch (err) {
      toast.error('Не вдалось виконати перевірку: ' + String(err))
    } finally {
      setTestingCloud(null)
    }
  }

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
      toast.error(`Помилка бекапу: ${e instanceof Error ? e.message : String(e)}`)
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
      toast.error(`Помилка імпорту: ${err instanceof Error ? err.message : String(err)}`)
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
    toast.info('Запит на відновлення надіслано. Сервер незабаром перезапуститься.')
  }

  const handleDemoEnter = async () => {
    if (!confirm('Увійти в демо режим?\n\nПоточна база буде збережена. Для виходу натисніть "Вийти з демо режиму".')) return
    setDemoLoading(true)
    try {
      await api.post('/backup/demo/enter', {})
      toast.info('Запит надіслано. Сервер перезапускається в демо режимі...')
      setTimeout(loadAll, 5000)
    } catch (e: unknown) {
      toast.error(`Помилка: ${e instanceof Error ? e.message : String(e)}`)
    } finally { setDemoLoading(false) }
  }

  const handleDemoExit = async () => {
    if (!confirm('Вийти з демо режиму?\n\nБуде відновлена робоча база даних.')) return
    setDemoLoading(true)
    try {
      await api.post('/backup/demo/exit', {})
      toast.info('Запит надіслано. Сервер перезапускається...')
      setTimeout(loadAll, 5000)
    } catch (e: unknown) {
      toast.error(`Помилка: ${e instanceof Error ? e.message : String(e)}`)
    } finally { setDemoLoading(false) }
  }

  const handleArchivePreview = async () => {
    if (!archiveDate) return
    setArchivePreviewing(true); setArchivePreview(null)
    try {
      const data = await api.get<ArchivePreview>(`/backup/archive/preview?cutoff_date=${archiveDate}`)
      setArchivePreview(data)
    } catch (e: unknown) {
      toast.error(`Помилка: ${e instanceof Error ? e.message : String(e)}`)
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
      toast.error(`Помилка архівування: ${e instanceof Error ? e.message : String(e)}`)
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
                <>
                  <button
                    style={{ ...btnS, background: '#3b82f6', padding: '0.2rem 0.6rem', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
                    onClick={() => handleTestCloud(p.key, currentPath)}
                    disabled={testingCloud === p.key}
                    title="Перевірити доступність папки"
                  >
                    {testingCloud === p.key ? '...' : '🔍 Перевірити'}
                  </button>
                  <button
                    style={{ ...btnS, background: '#e74c3c', padding: '0.2rem 0.6rem', fontSize: '0.8rem' }}
                    onClick={() => setForm(f => ({ ...f, [p.key]: '' }))}
                    title="Вимкнути синхронізацію"
                  >
                    ✕
                  </button>
                </>
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
