import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'

export interface AuthUser {
  id:         number
  username:   string
  full_name:  string
  role:       string   // operator | accountant | admin | owner
  role_label: string
}

interface AuthContextValue {
  user:    AuthUser | null
  token:   string | null
  login:   (username: string, password: string) => Promise<void>
  logout:  () => Promise<void>
  loading: boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

const TOKEN_KEY = 'bakery_token'
const BASE = '/api/v1'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user,    setUser]    = useState<AuthUser | null>(null)
  const [token,   setToken]   = useState<string | null>(() => localStorage.getItem(TOKEN_KEY))
  const [loading, setLoading] = useState(true)

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
      .then((u: AuthUser) => {
        setUser(u)
        setToken(savedToken)
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
  }

  return (
    <AuthContext.Provider value={{ user, token, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
