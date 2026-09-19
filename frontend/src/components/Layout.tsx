import { NavLink, Outlet } from 'react-router-dom'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useWorkDate } from '../context/DateContext'
import { useAuth } from '../context/AuthContext'
import { api } from '../api/client'
import styles from './Layout.module.css'
import IssuesWidget from './IssuesWidget'
import NotificationBell from './NotificationBell'

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
  const [shopPriceAlert,   setShopPriceAlert]   = useState(false)
  const [demoActive,       setDemoActive]       = useState(false)

  // Для періодичної перевірки переходу дати (нижче) без перестворення
  // таймера при кожній зміні стану.
  const nextDayTimeRef = useRef('18:00')
  const effectiveDateRef = useRef(effectiveDate)
  const workDateRef = useRef(workDate)
  useEffect(() => { effectiveDateRef.current = effectiveDate }, [effectiveDate])
  useEffect(() => { workDateRef.current = workDate }, [workDate])

  useEffect(() => {
    api.get<Record<string, { value: string }>>('/settings/')
      .then(s => {
        if (s.bakery_name?.value) setBakeryName(s.bakery_name.value)
        const nextDayTime = s.work_date_next_day_time?.value ?? '18:00'
        nextDayTimeRef.current = nextDayTime
        const eff = computeEffectiveDate(nextDayTime)
        setEffectiveDate(eff)
        setWorkDate(eff)   // встановлюємо правильну початкову дату після завантаження налаштувань
      })
      .catch(() => {})
  }, []) // eslint-disable-line

  // Демо-режим раніше показувався лише на LoginPage (до входу) — після
  // входу в жодному місці Layout не було індикатора, тож персонал,
  // працюючи з демо-копією бази, не бачив цього на жодній сторінці.
  useEffect(() => {
    api.get<{ active: boolean }>('/backup/demo/status')
      .then(d => setDemoActive(!!d.active))
      .catch(() => {})
  }, [])

  // Дата роботи мала переходити на завтра сама, коли настає час переходу
  // (work_date_next_day_time) — але раніше це рахувалось ЛИШЕ один раз при
  // відкритті сторінки. Якщо застосунок лишається відкритим (напр. на
  // планшеті цілий день) і час переходу настає без перезавантаження —
  // дата не рухалась сама. Перевіряємо раз на хвилину; рухаємо робочу дату
  // ТІЛЬКИ якщо оператор і досі на автоматичній даті (не відходив вручну
  // назад на іншу дату) — ручний вибір ніколи не перебивається.
  useEffect(() => {
    const check = () => {
      const eff = computeEffectiveDate(nextDayTimeRef.current)
      if (eff !== effectiveDateRef.current) {
        if (workDateRef.current === effectiveDateRef.current) {
          setWorkDate(eff)
        }
        setEffectiveDate(eff)
      }
    }
    const timer = setInterval(check, 60 * 1000)
    return () => clearInterval(timer)
  }, []) // eslint-disable-line

  useEffect(() => {
    const check = () =>
      api.get<{ has_alert: boolean }>('/shop/price-change-alert')
        .then(r => setShopPriceAlert(r.has_alert)).catch(() => {})
    check()
    const timer = setInterval(check, 5 * 60 * 1000) // перевіряємо раз на 5 хв
    return () => clearInterval(timer)
  }, []) // eslint-disable-line
  const role = user?.role ?? 'operator'

  // Усі вкладки з ключем що відповідає role_permissions
  const ALL_TABS = [
    { path: '/orders',   label: 'Замовлення', key: 'orders'   },
    { path: '/routes',   label: 'Маршрути',   key: 'routes'   },
    { path: '/baking',   label: 'Випічка',    key: 'baking'   },
    { path: '/shop',     label: 'Магазин',    key: 'shop'     },
    { path: '/finances', label: 'Фінанси',    key: 'finances' },
    { path: '/admin',     label: 'Налаштування', key: 'admin'   },
  ]

  // Адмін завжди має всі права — ігноруємо permissions для нього
  const ADMIN_KEYS = ALL_TABS.map(t => t.key)
  const FALLBACK: Record<string, string[]> = {
    operator:   ['dashboard', 'orders', 'baking', 'routes', 'shop', 'reports'],
    accountant: ['dashboard', 'orders', 'finances', 'reports'],
    admin:      ADMIN_KEYS,
    owner:      ['dashboard'],
  }
  const allowed = role === 'admin'
    ? ADMIN_KEYS
    : (permissions[role] ?? FALLBACK[role] ?? []) as string[]
  const visibleTabs = ALL_TABS.filter((t) => {
    if (t.key === 'admin') {
      return allowed.includes('admin') || allowed.some(k => k.startsWith('admin_'))
    }
    // Фінанси показуємо якщо є 'finances', 'reports' або 'dashboard' (дашборд тепер всередині)
    if (t.key === 'finances') return allowed.includes('finances') || allowed.includes('reports') || allowed.includes('dashboard')
    return allowed.includes(t.key)
  })

  // ── Логотип+меню+права частина мають лишатись в одному рядку. Якщо меню
  // (найгнучкіша частина) туди не влазить — переносимо ЛИШЕ його на другий
  // рядок, вирівняне вліво. Точна ширина рахується виміром прихованої
  // "пробної" копії меню (завжди в один рядок, поза потоком), бо лише вона
  // дає справжню ширину без урахування власного внутрішнього переносу. ──
  const headerRowRef = useRef<HTMLDivElement>(null)
  const logoRef      = useRef<HTMLSpanElement>(null)
  const navProbeRef  = useRef<HTMLElement>(null)
  const rightRef     = useRef<HTMLDivElement>(null)
  const [navWraps, setNavWraps] = useState(false)

  useLayoutEffect(() => {
    const row = headerRowRef.current
    if (!row) return
    const GAP = 16 // 1rem — по одному проміжку з кожного боку меню, коли воно в рядку
    const measure = () => {
      const available = row.clientWidth
      const logoW  = logoRef.current?.offsetWidth ?? 0
      const navW   = navProbeRef.current?.offsetWidth ?? 0
      const rightW = rightRef.current?.offsetWidth ?? 0
      setNavWraps(logoW + navW + rightW + GAP * 2 > available)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(row)
    return () => ro.disconnect()
  }, [visibleTabs.length, bakeryName, user, shopPriceAlert, workDate, effectiveDate])

  const tabsContent = visibleTabs.map((t) => (
    <NavLink
      key={t.path}
      to={t.path}
      className={({ isActive }) =>
        isActive ? `${styles.tab} ${styles.active}` : styles.tab
      }
      title={t.key === 'admin' ? 'Налаштування' : undefined}
    >
      {t.key === 'admin' ? (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      ) : t.key === 'shop' && shopPriceAlert ? (
        <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
          {t.label}
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#f59e0b', display: 'inline-block', flexShrink: 0 }} title="Є зміна ціни — рекомендується провести звірку" />
        </span>
      ) : t.label}
    </NavLink>
  ))

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div className={styles.headerRow} ref={headerRowRef}>
          <span className={styles.logo} ref={logoRef}>🍞 {bakeryName}</span>
          {!navWraps && <nav className={styles.nav}>{tabsContent}</nav>}
          <div className={styles.headerRight} ref={rightRef}>
            <NotificationBell />
            <NavLink to="/help" className={({ isActive }) => isActive ? `${styles.tab} ${styles.active}` : styles.tab} title="Довідник користувача" style={{ fontSize: '1rem', padding: '0.3rem 0.6rem' }}>❓</NavLink>
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
          {/* Прихована проба — завжди в один рядок, лише для виміру природної ширини меню */}
          <nav className={`${styles.nav} ${styles.navProbe}`} ref={navProbeRef} aria-hidden="true">
            {tabsContent}
          </nav>
        </div>
        {navWraps && <nav className={`${styles.nav} ${styles.navWrapped}`}>{tabsContent}</nav>}
      </header>

      {demoActive && (
        <div
          style={{
            background: '#fff3cd', color: '#856404', borderBottom: '1px solid #ffe69c',
            padding: '6px 16px', fontSize: '0.85rem', fontWeight: 600, textAlign: 'center',
          }}
        >
          ⚠ ДЕМО-РЕЖИМ — це не жива продакшн-база, зміни тут не впливають на реальні дані
        </div>
      )}

      <main className={styles.main}>
        <Outlet />
      </main>
      <IssuesWidget />
    </div>
  )
}
