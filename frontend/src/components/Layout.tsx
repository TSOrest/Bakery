import { NavLink, Outlet } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useWorkDate } from '../context/DateContext'
import { useAuth } from '../context/AuthContext'
import { api } from '../api/client'
import styles from './Layout.module.css'
import IssuesWidget from './IssuesWidget'

function localDateISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function computeEffectiveDate(nextDayTime: string): string {
  const now = new Date()
  const [h, m] = nextDayTime.split(':').map(Number)
  const cutoff = new Date(); cutoff.setHours(isNaN(h) ? 18 : h, isNaN(m) ? 0 : m, 0, 0)
  if (now >= cutoff) {
    const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1)
    return localDateISO(tomorrow)
  }
  return localDateISO(now)
}

export default function Layout() {
  const { workDate, setWorkDate } = useWorkDate()
  const { user, logout, permissions } = useAuth()
  const [bakeryName,       setBakeryName]       = useState('Пекарня')
  const [effectiveDate,    setEffectiveDate]    = useState(() => computeEffectiveDate('18:00'))

  useEffect(() => {
    api.get<Record<string, { value: string }>>('/settings/')
      .then(s => {
        if (s.bakery_name?.value) setBakeryName(s.bakery_name.value)
        const nextDayTime = s.work_date_next_day_time?.value ?? '18:00'
        const eff = computeEffectiveDate(nextDayTime)
        setEffectiveDate(eff)
        setWorkDate(eff)   // встановлюємо правильну початкову дату після завантаження налаштувань
      })
      .catch(() => {})
  }, []) // eslint-disable-line
  const role = user?.role ?? 'operator'

  // Усі вкладки з ключем що відповідає role_permissions
  const ALL_TABS = [
    { path: '/',         label: 'Дашборд',    key: 'dashboard', exact: true },
    { path: '/orders',   label: 'Замовлення', key: 'orders'   },
    { path: '/baking',   label: 'Випічка',    key: 'baking'   },
    { path: '/routes',   label: 'Маршрути',   key: 'routes'   },
    { path: '/shop',     label: 'Магазин',    key: 'shop'     },
    { path: '/finances', label: 'Фінанси',    key: 'finances' },
    { path: '/admin',     label: 'Налаштування', key: 'admin'   },
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
          <label className={`${styles.datePicker} ${workDate !== effectiveDate ? styles.datePickerWarn : ''}`}>
            <span>Дата роботи:</span>
            <input
              type="date"
              value={workDate}
              onChange={(e) => setWorkDate(e.target.value)}
              className={workDate !== effectiveDate ? styles.dateInputWarn : ''}
            />
            {workDate !== effectiveDate && (
              <span className={styles.dateWarnBadge} title={`Поточна дата: ${effectiveDate}`}>⚠</span>
            )}
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
