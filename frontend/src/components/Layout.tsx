import { NavLink, Outlet } from 'react-router-dom'
import { useWorkDate } from '../context/DateContext'
import { useAuth } from '../context/AuthContext'
import styles from './Layout.module.css'

export default function Layout() {
  const { workDate, setWorkDate } = useWorkDate()
  const { user, logout, permissions } = useAuth()
  const role = user?.role ?? 'operator'

  // Усі вкладки з ключем що відповідає role_permissions
  const ALL_TABS = [
    { path: '/orders',   label: 'Замовлення', key: 'orders'   },
    { path: '/baking',   label: 'Випічка',    key: 'baking'   },
    { path: '/routes',   label: 'Маршрути',   key: 'routes'   },
    { path: '/shop',     label: 'Магазин',    key: 'shop'     },
    { path: '/finances', label: 'Фінанси',    key: 'finances' },
    { path: '/admin',    label: 'Довідники',  key: 'admin'    },
  ]

  // Якщо дозволи завантажені — фільтруємо за ними, інакше fallback
  const FALLBACK: Record<string, string[]> = {
    operator:   ['orders', 'baking', 'routes', 'shop'],
    accountant: ['orders', 'finances'],
    admin:      ['orders', 'baking', 'routes', 'shop', 'finances', 'admin'],
    owner:      ['orders'],
  }
  const allowed = (permissions[role] ?? FALLBACK[role] ?? []) as string[]
  const visibleTabs = ALL_TABS.filter((t) => allowed.includes(t.key))

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <span className={styles.logo}>🍞 Пекарня</span>
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
    </div>
  )
}
