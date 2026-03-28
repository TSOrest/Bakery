import { useEffect, useState, type FormEvent } from 'react'
import { api } from '../api/client'

const ROLE_OPTIONS = [
  { value: 'operator',   label: 'Оператор' },
  { value: 'accountant', label: 'Бухгалтер' },
  { value: 'admin',      label: 'Адміністратор' },
  { value: 'owner',      label: 'Власник' },
  { value: 'seller',     label: 'Продавець' },
]

interface UserRow {
  id: number
  username: string
  full_name: string
  role: string
  role_label: string
  is_active: number
}

const th: React.CSSProperties = {
  padding: '0.4rem 0.75rem', background: '#e8eef5', fontWeight: 600,
  borderBottom: '2px solid #c5d8ed', textAlign: 'left', fontSize: '0.88rem',
}
const td: React.CSSProperties = {
  padding: '0.35rem 0.75rem', borderBottom: '1px solid #eee', verticalAlign: 'middle',
}
const inpStyle: React.CSSProperties = {
  padding: '0.25rem 0.4rem', border: '1px solid #ccc', borderRadius: 3, fontSize: '0.88rem',
}

export default function UsersTab() {
  const [users,    setUsers]    = useState<UserRow[]>([])
  const [form,     setForm]     = useState({ username: '', password: '', full_name: '', role: 'operator' })
  const [editId,   setEditId]   = useState<number | null>(null)
  const [editData, setEditData] = useState({ full_name: '', role: '', password: '' })
  const [error,    setError]    = useState<string | null>(null)

  const load = () =>
    api.get<UserRow[]>('/auth/users').then(setUsers).catch(() => setUsers([]))

  useEffect(() => { load() }, [])

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    try {
      await api.post('/auth/users', form)
      setForm({ username: '', password: '', full_name: '', role: 'operator' })
      load()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Помилка')
    }
  }

  const startEdit = (u: UserRow) => {
    setEditId(u.id)
    setEditData({ full_name: u.full_name, role: u.role, password: '' })
  }

  const saveEdit = async (id: number) => {
    const patch: Record<string, unknown> = { role: editData.role, full_name: editData.full_name }
    if (editData.password) patch.password = editData.password
    await api.put(`/auth/users/${id}`, patch)
    setEditId(null)
    load()
  }

  const toggleActive = async (u: UserRow) => {
    await api.put(`/auth/users/${u.id}`, { is_active: u.is_active ? 0 : 1 })
    load()
  }

  return (
    <section>
      <h3 style={{ margin: '0 0 1rem', fontSize: '1rem', color: '#1a3a5c' }}>Користувачі системи</h3>

      {error && (
        <div style={{ background: '#fdf0ef', border: '1px solid #f5c6cb', color: '#721c24', borderRadius: 4, padding: '0.5rem 0.75rem', marginBottom: '1rem', fontSize: '0.88rem' }}>
          {error}
        </div>
      )}

      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
        <thead>
          <tr>
            <th style={th}>Логін</th>
            <th style={th}>Ім'я</th>
            <th style={th}>Роль</th>
            <th style={th}>Статус</th>
            <th style={th}>Дії</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) =>
            editId === u.id ? (
              <tr key={u.id}>
                <td style={td}><strong>{u.username}</strong></td>
                <td style={td}>
                  <input value={editData.full_name} onChange={(e) => setEditData((d) => ({ ...d, full_name: e.target.value }))}
                    style={{ ...inpStyle, width: 140 }} />
                </td>
                <td style={td}>
                  <select value={editData.role} onChange={(e) => setEditData((d) => ({ ...d, role: e.target.value }))}
                    style={{ ...inpStyle }}>
                    {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                </td>
                <td style={td}>
                  <input value={editData.password} onChange={(e) => setEditData((d) => ({ ...d, password: e.target.value }))}
                    type="password" placeholder="новий пароль"
                    style={{ ...inpStyle, width: 130 }} />
                </td>
                <td style={{ ...td, display: 'flex', gap: '0.35rem' }}>
                  <button onClick={() => saveEdit(u.id)}
                    style={{ background: '#1a3a5c', color: '#fff', border: 'none', padding: '0.25rem 0.6rem', borderRadius: 3, cursor: 'pointer', fontSize: '0.82rem' }}>
                    Зберегти
                  </button>
                  <button onClick={() => setEditId(null)}
                    style={{ background: '#fff', border: '1px solid #ccc', padding: '0.25rem 0.5rem', borderRadius: 3, cursor: 'pointer', fontSize: '0.82rem' }}>
                    Скасувати
                  </button>
                </td>
              </tr>
            ) : (
              <tr key={u.id} style={{ opacity: u.is_active ? 1 : 0.5 }}>
                <td style={td}><strong>{u.username}</strong></td>
                <td style={td}>{u.full_name || '—'}</td>
                <td style={td}>{u.role_label}</td>
                <td style={td}>
                  <span style={{
                    fontSize: '0.78rem', padding: '0.1rem 0.4rem', borderRadius: 10, fontWeight: 600,
                    background: u.is_active ? '#d4edda' : '#f8d7da',
                    color: u.is_active ? '#155724' : '#721c24',
                  }}>
                    {u.is_active ? 'Активний' : 'Вимкнений'}
                  </span>
                </td>
                <td style={{ ...td, display: 'flex', gap: '0.35rem' }}>
                  <button onClick={() => startEdit(u)}
                    style={{ background: '#fff', border: '1px solid #1a3a5c', color: '#1a3a5c', padding: '0.2rem 0.5rem', borderRadius: 3, cursor: 'pointer', fontSize: '0.8rem' }}>
                    Редагувати
                  </button>
                  <button onClick={() => toggleActive(u)}
                    style={{ background: '#fff', border: `1px solid ${u.is_active ? '#e67e22' : '#27ae60'}`, color: u.is_active ? '#e67e22' : '#27ae60', padding: '0.2rem 0.5rem', borderRadius: 3, cursor: 'pointer', fontSize: '0.8rem' }}>
                    {u.is_active ? 'Вимкнути' : 'Увімкнути'}
                  </button>
                </td>
              </tr>
            )
          )}
        </tbody>
      </table>

      <h4 style={{ margin: '0 0 0.75rem', fontSize: '0.95rem', color: '#1a3a5c' }}>Додати користувача</h4>
      <form onSubmit={handleCreate} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        {([['username', 'Логін', 'text'], ['full_name', "Ім'я", 'text'], ['password', 'Пароль', 'password']] as [keyof typeof form, string, string][]).map(([key, label, type]) => (
          <label key={key} style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', fontSize: '0.82rem' }}>
            {label}
            <input type={type} required={key !== 'full_name'} value={form[key]}
              onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
              style={{ padding: '0.35rem 0.5rem', border: '1px solid #ccc', borderRadius: 4, fontSize: '0.88rem', width: 130 }} />
          </label>
        ))}
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', fontSize: '0.82rem' }}>
          Роль
          <select value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
            style={{ padding: '0.35rem 0.5rem', border: '1px solid #ccc', borderRadius: 4, fontSize: '0.88rem' }}>
            {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </label>
        <button type="submit"
          style={{ padding: '0.35rem 1rem', background: '#1a3a5c', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.88rem', alignSelf: 'flex-end' }}>
          + Додати
        </button>
      </form>
    </section>
  )
}
