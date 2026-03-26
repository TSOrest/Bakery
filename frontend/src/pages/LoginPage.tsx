import { useEffect, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useAuth } from '../context/AuthContext'
import styles from './LoginPage.module.css'

interface PublicUser {
  id:         number
  username:   string
  full_name:  string
  role:       string
  role_label: string
}

const ROLE_COLORS: Record<string, string> = {
  admin:      '#1a3a5c',
  operator:   '#2e7d32',
  accountant: '#6a1b9a',
  owner:      '#b45309',
}

const ROLE_ICONS: Record<string, string> = {
  admin:      '⚙',
  operator:   '🏭',
  accountant: '📊',
  owner:      '👑',
}

function getInitials(user: PublicUser): string {
  const name = user.full_name || user.username
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

export default function LoginPage() {
  const { login } = useAuth()
  const [users,    setUsers]    = useState<PublicUser[]>([])
  const [selected, setSelected] = useState<PublicUser | null>(null)
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState<string | null>(null)
  const [loading,  setLoading]  = useState(false)
  const [isDemo,   setIsDemo]   = useState(false)

  useEffect(() => {
    fetch('/api/v1/auth/public-users')
      .then((r) => r.json())
      .then(setUsers)
      .catch(() => setUsers([]))
    fetch('/api/v1/backup/demo/status')
      .then((r) => r.json())
      .then((d) => setIsDemo(!!d.active))
      .catch(() => {})
  }, [])

  const select = (u: PublicUser) => {
    setSelected(u)
    setPassword('')
    setError(null)
  }

  const handleLogin = async (e?: FormEvent) => {
    e?.preventDefault()
    if (!selected) return
    setError(null)
    setLoading(true)
    try {
      await login(selected.username, password)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Невірний пароль')
      setPassword('')
    } finally {
      setLoading(false)
    }
  }

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleLogin()
  }

  return (
    <div className={styles.page}>
      {/* Декоративна смуга зверху */}
      <div className={styles.topBar} />

      <div className={styles.content}>
        <div className={styles.header}>
          <span className={styles.headerIcon}>🍞</span>
          <div>
            <div className={styles.headerTitle}>Пекарня</div>
            <div className={styles.headerSub}>Оберіть користувача для входу</div>
          </div>
        </div>

        {isDemo && (
          <div style={{
            background: '#fff8e1', border: '1px solid #f59e0b', borderRadius: 6,
            padding: '8px 12px', marginBottom: 12, fontSize: 13, color: '#92400e',
          }}>
            ⚡ <strong>Демо режим</strong> — пароль = логін
            {' '}(наприклад: <code>admin</code> → <code>admin</code>)
          </div>
        )}

        <div className={styles.divider} />

        {/* Основні користувачі */}
        {(() => {
          const main   = users.filter(u => u.role !== 'admin')
          const admins = users.filter(u => u.role === 'admin')
          const renderCard = (u: PublicUser) => {
            const color = ROLE_COLORS[u.role] ?? '#1a3a5c'
            const isSelected = selected?.id === u.id
            return (
              <button
                key={u.id}
                className={`${styles.userCard} ${isSelected ? styles.userCardActive : ''}`}
                onClick={() => select(u)}
              >
                <div className={styles.avatar} style={{ background: color }}>
                  {getInitials(u)}
                  <span className={styles.roleIcon}>{ROLE_ICONS[u.role] ?? '👤'}</span>
                </div>
                <div className={styles.userInfo}>
                  <div className={styles.userName}>{u.full_name || u.username}</div>
                  <div className={styles.userRole}>{u.role_label}</div>
                </div>
                {isSelected && <div className={styles.arrow}>▶</div>}
              </button>
            )
          }
          return (
            <>
              <div className={styles.userList}>
                {main.map(u => renderCard(u))}
              </div>

              {admins.length > 0 && (
                <div className={styles.adminSection}>
                  <span className={styles.adminLabel}>Адміністратори</span>
                  <div className={styles.adminList}>
                    {admins.map(u => {
                      const isSelected = selected?.id === u.id
                      return (
                        <button
                          key={u.id}
                          className={`${styles.adminCard} ${isSelected ? styles.userCardActive : ''}`}
                          onClick={() => select(u)}
                        >
                          <div className={styles.adminAvatar}>
                            {getInitials(u)}
                          </div>
                          <span className={styles.adminName}>{u.full_name || u.username}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </>
          )
        })()}

        {/* Панель пароля */}
        {selected && (
          <div className={styles.pwPanel}>
            <div className={styles.divider} />
            <form className={styles.pwForm} onSubmit={handleLogin}>
              <div className={styles.pwWho}>
                <span style={{ color: ROLE_COLORS[selected.role] ?? '#1a3a5c', fontWeight: 700 }}>
                  {selected.full_name || selected.username}
                </span>
                <span className={styles.pwRoleBadge}>{selected.role_label}</span>
              </div>

              {error && <div className={styles.pwError}>{error}</div>}

              <div className={styles.pwRow}>
                <input
                  type="password"
                  className={styles.pwInput}
                  placeholder="Пароль"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={handleKey}
                  autoFocus
                />
                <button
                  type="submit"
                  className={styles.pwBtn}
                  disabled={loading}
                  title="Увійти"
                >
                  {loading ? '…' : '▶'}
                </button>
              </div>
            </form>
          </div>
        )}

        <div className={styles.divider} />
        <div className={styles.footer}>
          Після входу вийдіть зі свого облікового запису перед тим як залишити робоче місце
        </div>
      </div>

      <div className={styles.bottomBar} />
    </div>
  )
}
