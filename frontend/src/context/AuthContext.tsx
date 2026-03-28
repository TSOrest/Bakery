import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'

export interface AuthUser {
  id:         number
  username:   string
  full_name:  string
  role:       string   // operator | accountant | admin | owner
  role_label: string
}

// key = role, value = list of page keys (orders, baking, routes, shop, finances, admin)
export type RolePermissions = Record<string, string[]>

interface AuthContextValue {
  user:        AuthUser | null
  token:       string | null
  permissions: RolePermissions
  login:       (username: string, password: string) => Promise<void>
  logout:      () => Promise<void>
  reloadPermissions: () => Promise<void>
  loading:     boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

const TOKEN_KEY = 'bakery_token'
const BASE = '/api/v1'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user,        setUser]        = useState<AuthUser | null>(null)
  const [token,       setToken]       = useState<string | null>(() => localStorage.getItem(TOKEN_KEY))
  const [permissions, setPermissions] = useState<RolePermissions>({})
  const [loading,     setLoading]     = useState(true)

  const fetchPermissions = async (t: string) => {
    try {
      const res = await fetch(`${BASE}/settings/`, { headers: { Authorization: `Bearer ${t}` } })
      if (!res.ok) return
      const data = await res.json()
      const raw = data.role_permissions?.value
      if (raw) setPermissions(JSON.parse(raw))
    } catch { /* ігноруємо */ }
  }

  // Відновлення сесії при завантаженні
  useEffect(() => {
    const savedToken = localStorage.getItem(TOKEN_KEY)
    if (!savedToken) {
      setLoading(false)
      return
    }
    fetch(`${BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${savedToken}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error('invalid token')
        return res.json()
      })
      .then(async (u: AuthUser) => {
        setUser(u)
        setToken(savedToken)
        await fetchPermissions(savedToken)
      })
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY)
        setToken(null)
      })
      .finally(() => setLoading(false))
  }, [])

  const login = async (username: string, password: string) => {
    const res = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.detail ?? 'Невірний логін або пароль')
    }
    const data = await res.json()
    localStorage.setItem(TOKEN_KEY, data.token)
    setToken(data.token)
    setUser(data.user)
    await fetchPermissions(data.token)
  }

  const logout = async () => {
    const t = localStorage.getItem(TOKEN_KEY)
    if (t) {
      await fetch(`${BASE}/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${t}` },
      }).catch(() => {})
    }
    localStorage.removeItem(TOKEN_KEY)
    setToken(null)
    setUser(null)
    setPermissions({})
  }

  const reloadPermissions = async () => {
    const t = localStorage.getItem(TOKEN_KEY)
    if (t) await fetchPermissions(t)
  }

  return (
    <AuthContext.Provider value={{ user, token, permissions, login, logout, reloadPermissions, loading }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
