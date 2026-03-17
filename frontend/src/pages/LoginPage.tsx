import { useState, type FormEvent } from 'react'
import { useAuth } from '../context/AuthContext'
import styles from './LoginPage.module.css'

export default function LoginPage() {
  const { login } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState<string | null>(null)
  const [loading,  setLoading]  = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await login(username, password)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Помилка входу')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.page}>
      <form className={styles.card} onSubmit={handleSubmit}>
        <div className={styles.logo}>🍞</div>
        <h1 className={styles.title}>Пекарня</h1>
        <p className={styles.subtitle}>Введіть дані для входу</p>

        {error && <div className={styles.error}>{error}</div>}

        <label className={styles.label}>
          Логін
          <input
            className={styles.input}
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            required
          />
        </label>

        <label className={styles.label}>
          Пароль
          <input
            className={styles.input}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>

        <button className={styles.btn} type="submit" disabled={loading}>
          {loading ? 'Вхід...' : 'Увійти'}
        </button>
      </form>
    </div>
  )
}
