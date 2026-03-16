import { NavLink, Outlet } from 'react-router-dom'
import { useWorkDate } from '../context/DateContext'
import styles from './Layout.module.css'

const TABS = [
  { path: '/orders',   label: 'Замовлення' },
  { path: '/baking',   label: 'Випічка' },
  { path: '/routes',   label: 'Маршрути' },
  { path: '/shop',     label: 'Магазин' },
  { path: '/finances', label: 'Фінанси' },
  { path: '/admin',    label: 'Довідники' },
]

export default function Layout() {
  const { workDate, setWorkDate } = useWorkDate()

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <span className={styles.logo}>🍞 Пекарня</span>
        <nav className={styles.nav}>
          {TABS.map((t) => (
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
        <label className={styles.datePicker}>
          <span>Дата роботи:</span>
          <input
            type="date"
            value={workDate}
            onChange={(e) => setWorkDate(e.target.value)}
          />
        </label>
      </header>

      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  )
}
