import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { Client, Product, Route, Unit, Category } from '../types'
import UsersTab from './UsersTab'
import { useAuth } from '../context/AuthContext'

// ─── Винесені вкладки (split v1.1.0) ─────────────────────────────────────────
import FinanceArticlesTab from './admin/FinanceArticlesTab'
import CategoriesTab from './admin/CategoriesTab'
import RoutesTab from './admin/RoutesTab'
import ClientGroupsTab from './admin/ClientGroupsTab'
import SimpleListTab from './admin/SimpleListTab'
import SystemClientsTab from './admin/SystemClientsTab'
import ProductsTab from './admin/ProductsTab'
import ClientsTab from './admin/ClientsTab'
import PricesTab from './admin/PricesTab'
import IngredientsTab from './admin/IngredientsTab'
import MarginTab from './admin/MarginTab'
import SettingsTab from './admin/SettingsTab'
import RolePermissionsTab from './admin/RolePermissionsTab'
import BackupTab from './admin/BackupTab'

// Конфіг вкладок і ADMIN_TAB_GROUPS винесено у tabConfig.ts
// щоб уникнути circular import AdminPage ↔ RolePermissionsTab
import { ADMIN_TAB_GROUPS, type Tab } from './admin/tabConfig'

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
        {activeTab === 'client_groups' && <ClientGroupsTab routes={routes} />}
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


// ─── Інгредієнти ─────────────────────────────────────────────────────────────

