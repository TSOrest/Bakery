import { NavLink, Outlet } from 'react-router-dom'
import { useWorkDate } from '../context/DateContext'
import { useAuth } from '../context/AuthContext'
import styles from './Layout.module.css'

export default function Layout() {
  const { workDate, setWorkDate } = useWorkDate()
  const { user, logout } = useAuth()

  const role = user?.role ?? 'operator'

  const TABS = [
    { path: '/orders',   label: 'Замовлення', roles: ['operator', 'accountant', 'admin', 'owner'] },
    { path: '/baking',   label: 'Випічка',    roles: ['operator', 'admin'] },
    { path: '/routes',   label: 'Маршрути',   roles: ['operator', 'admin'] },
    { path: '/shop',     label: 'Магазин',    roles: ['operator', 'admin'] },
    { path: '/finances', label: 'Фінанси',    roles: ['accountant', 'admin'] },
    { path: '/admin',    label: 'Довідники',  roles: ['admin'] },
  ]

  const visibleTabs = TABS.filter((t) => t.roles.includes(role))

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
