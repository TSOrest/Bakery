import { NavLink, Outlet } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useWorkDate } from '../context/DateContext'
import { useAuth } from '../context/AuthContext'
import { api } from '../api/client'
import styles from './Layout.module.css'
import IssuesWidget from './IssuesWidget'

export default function Layout() {
  const { workDate, setWorkDate } = useWorkDate()
  const { user, logout, permissions } = useAuth()
  const [bakeryName, setBakeryName] = useState('Пекарня')

  useEffect(() => {
    api.get<Record<string, { value: string }>>('/settings/')
      .then(s => { if (s.bakery_name?.value) setBakeryName(s.bakery_name.value) })
      .catch(() => {})
  }, [])
  const role = user?.role ?? 'operator'

  // Усі вкладки з ключем що відповідає role_permissions
  const ALL_TABS = [
    { path: '/',         label: 'Дашборд',    key: 'dashboard', exact: true },
    { path: '/orders',   label: 'Замовлення', key: 'orders'   },
    { path: '/baking',   label: 'Випічка',    key: 'baking'   },
    { path: '/routes',   label: 'Маршрути',   key: 'routes'   },
    { path: '/shop',     label: 'Магазин',    key: 'shop'     },
    { path: '/finances', label: 'Фінанси',    key: 'finances' },
    { path: '/admin',     label: 'Довідники',  key: 'admin'     },
    { path: '/db-editor', label: '🗄 БД',      key: 'db-editor' },
  ]

  // Адмін завжди має всі права — ігноруємо permissions для нього
  const ADMIN_KEYS = ALL_TABS.map(t => t.key)
  const FALLBACK: Record<string, string[]> = {
    operator:   ['dashboard', 'orders', 'baking', 'routes', 'shop'],
    accountant: ['dashboard', 'orders', 'finances'],
    admin:      ADMIN_KEYS,
    owner:      ['dashboard'],
  }
  const allowed = role === 'admin'
    ? ADMIN_KEYS
    : (permissions[role] ?? FALLBACK[role] ?? []) as string[]
  const visibleTabs = ALL_TABS.filter((t) => {
    if (t.key === 'admin') {
      // Показувати Довідники якщо є 'admin' АБО будь-який 'admin_*' дозвіл
      return allowed.includes('admin') || allowed.some(k => k.startsWith('admin_'))
    }
    return allowed.includes(t.key)
  })

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <span className={styles.logo}>🍞 {bakeryName}</span>
        <nav className={styles.nav}>
          {visibleTabs.map((t) => (
            <NavLink
              key={t.path}
              to={t.path}
              className={({ isActive }) =>
                isActive ? `${styles.tab} ${styles.active}` : styles.tab
              }
            >
              {t.label}
            </NavLink>
          ))}
        </nav>
        <div className={styles.headerRight}>
          <label className={styles.datePicker}>
            <span>Дата роботи:</span>
            <input
              type="date"
              value={workDate}
              onChange={(e) => setWorkDate(e.target.value)}
            />
          </label>
          <div className={styles.userInfo}>
            <span className={styles.userName}>
              {user?.full_name || user?.username}
            </span>
            <span className={styles.userRole}>{user?.role_label}</span>
            <button className={styles.logoutBtn} onClick={logout} title="Вийти">
              ⏻
            </button>
          </div>
        </div>
      </header>

      <main className={styles.main}>
        <Outlet />
      </main>
      <IssuesWidget />
    </div>
  )
}
