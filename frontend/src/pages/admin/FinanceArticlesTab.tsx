import { useEffect, useState, type FormEvent, type CSSProperties } from 'react'
import {
  fetchFinanceArticles, createFinanceArticle, updateFinanceArticle, deleteFinanceArticle,
} from '../../api/financeArticles'
import type { FinanceArticle } from '../../types'

export default function FinanceArticlesTab() {
  const [articles,        setArticles]       = useState<FinanceArticle[]>([])
  const [loading,         setLoading]        = useState(true)
  const [editId,          setEditId]         = useState<number | null>(null)
  const [editName,        setEditName]       = useState('')
  const [editNeedsClient, setEditNeedsClient] = useState(0)
  const [editEditable,    setEditEditable]   = useState(0)
  const [newName,         setNewName]        = useState('')
  const [newDir,          setNewDir]         = useState<'income' | 'expense'>('income')
  const [newNeedsClient,  setNewNeedsClient] = useState(0)
  const [newEditable,     setNewEditable]    = useState(0)
  const [saving,          setSaving]         = useState(false)
  const [error,           setError]          = useState('')

  const s: CSSProperties = { fontSize: '0.85rem' }
  const btnS: CSSProperties = {
    padding: '4px 12px', border: '1px solid #d1d5db', borderRadius: 4,
    background: '#fff', cursor: 'pointer', fontSize: '0.82rem',
  }

  const load = () => {
    setLoading(true)
    fetchFinanceArticles().then(setArticles).finally(() => setLoading(false))
  }
  useEffect(load, [])

  async function handleAdd(e: FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return
    setSaving(true); setError('')
    try {
      await createFinanceArticle({ name: newName.trim(), direction: newDir, needs_client: newNeedsClient, editable: newEditable })
      setNewName(''); setNewNeedsClient(0); setNewEditable(0); load()
    } catch { setError('Помилка збереження') }
    finally { setSaving(false) }
  }

  async function handleSaveEdit(id: number) {
    if (!editName.trim()) return
    setSaving(true); setError('')
    try {
      await updateFinanceArticle(id, { name: editName.trim(), needs_client: editNeedsClient, editable: editEditable })
      setEditId(null); load()
    } catch { setError('Помилка збереження') }
    finally { setSaving(false) }
  }

  async function handleDelete(id: number) {
    if (!confirm('Видалити статтю?')) return
    try {
      await deleteFinanceArticle(id); load()
    } catch { setError('Помилка видалення') }
  }

  const dirLabel = (d: string) => d === 'income' ? 'Надходження' : 'Витрати'
  const dirColor = (d: string) => d === 'income' ? '#27ae60' : '#e74c3c'

  const checkboxStyle: CSSProperties = { width: 15, height: 15, cursor: 'pointer' }

  return (
    <div style={{ maxWidth: 620, padding: '1.25rem' }}>
      <h3 style={{ marginTop: 0, marginBottom: '1rem' }}>Фінансові статті</h3>
      <p style={{ ...s, color: '#6b7280', marginBottom: '1rem' }}>
        Системні статті не можна видалити, лише редагувати назву.
        «Клієнтська» — операція потребує прив'язки до клієнта.
      </p>

      {loading && <p style={s}>Завантаження…</p>}
      {error   && <p style={{ ...s, color: '#e74c3c' }}>{error}</p>}

      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '1.5rem' }}>
        <thead>
          <tr style={{ background: '#f9fafb', borderBottom: '2px solid #e5e7eb' }}>
            <th style={{ ...s, textAlign: 'left', padding: '6px 10px' }}>Назва</th>
            <th style={{ ...s, textAlign: 'left', padding: '6px 10px' }}>Напрям</th>
            <th style={{ ...s, textAlign: 'center', padding: '6px 10px' }}>Клієнтська</th>
            <th style={{ ...s, textAlign: 'center', padding: '6px 10px' }} title="Дозволити редагувати суму операції поточного дня">Редаг.&nbsp;суми</th>
            <th style={{ ...s, padding: '6px 10px' }}></th>
          </tr>
        </thead>
        <tbody>
          {articles.map(a => (
            <tr key={a.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
              <td style={{ padding: '6px 10px' }}>
                {editId === a.id ? (
                  <input
                    autoFocus
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleSaveEdit(a.id); if (e.key === 'Escape') setEditId(null) }}
                    style={{ fontSize: '0.85rem', padding: '3px 6px', border: '1px solid #d1d5db', borderRadius: 3, width: 160 }}
                  />
                ) : (
                  <span style={s}>
                    {a.name}
                    {a.is_system ? <span style={{ fontSize: '0.7rem', color: '#9ca3af', marginLeft: 6 }}>системна</span> : null}
                  </span>
                )}
              </td>
              <td style={{ padding: '6px 10px' }}>
                <span style={{ ...s, color: dirColor(a.direction), fontWeight: 600 }}>
                  {dirLabel(a.direction)}
                </span>
              </td>
              <td style={{ padding: '6px 10px', textAlign: 'center' }}>
                {editId === a.id ? (
                  <input
                    type="checkbox"
                    checked={editNeedsClient === 1}
                    onChange={e => setEditNeedsClient(e.target.checked ? 1 : 0)}
                    style={checkboxStyle}
                  />
                ) : (
                  a.needs_client === 1
                    ? <span style={{ color: '#2563eb', fontSize: '0.8rem', fontWeight: 600 }}>✓</span>
                    : <span style={{ color: '#d1d5db', fontSize: '0.8rem' }}>—</span>
                )}
              </td>
              <td style={{ padding: '6px 10px', textAlign: 'center' }}>
                {editId === a.id ? (
                  <input
                    type="checkbox"
                    checked={editEditable === 1}
                    onChange={e => setEditEditable(e.target.checked ? 1 : 0)}
                    style={checkboxStyle}
                  />
                ) : (
                  a.editable === 1
                    ? <span style={{ color: '#27ae60', fontSize: '0.8rem', fontWeight: 600 }}>✓</span>
                    : <span style={{ color: '#d1d5db', fontSize: '0.8rem' }}>—</span>
                )}
              </td>
              <td style={{ padding: '6px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                {editId === a.id ? (
                  <>
                    <button style={{ ...btnS, background: '#2563eb', color: '#fff', border: 'none', marginRight: 4 }} disabled={saving} onClick={() => handleSaveEdit(a.id)}>Зберегти</button>
                    <button style={btnS} onClick={() => setEditId(null)}>Скасувати</button>
                  </>
                ) : (
                  <>
                    <button style={{ ...btnS, marginRight: 4 }} onClick={() => { setEditId(a.id); setEditName(a.name); setEditNeedsClient(a.needs_client); setEditEditable(a.editable) }} aria-label="Редагувати" title="Редагувати">✎</button>
                    {!a.is_system && (
                      <button style={{ ...btnS, color: '#e74c3c', borderColor: '#fca5a5' }} onClick={() => handleDelete(a.id)} aria-label="Видалити" title="Видалити">×</button>
                    )}
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h4 style={{ ...s, marginBottom: '0.5rem' }}>Додати статтю</h4>
      <form onSubmit={handleAdd} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          value={newName} onChange={e => setNewName(e.target.value)}
          placeholder="Назва статті"
          required
          style={{ fontSize: '0.85rem', padding: '5px 8px', border: '1px solid #d1d5db', borderRadius: 4, minWidth: 180 }}
        />
        <select value={newDir} onChange={e => setNewDir(e.target.value as 'income' | 'expense')}
          style={{ fontSize: '0.85rem', padding: '5px 8px', border: '1px solid #d1d5db', borderRadius: 4 }}>
          <option value="income">Надходження</option>
          <option value="expense">Витрати</option>
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.85rem', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={newNeedsClient === 1}
            onChange={e => setNewNeedsClient(e.target.checked ? 1 : 0)}
            style={checkboxStyle}
          />
          Клієнтська
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.85rem', cursor: 'pointer' }} title="Дозволити редагувати суму операції поточного дня">
          <input
            type="checkbox"
            checked={newEditable === 1}
            onChange={e => setNewEditable(e.target.checked ? 1 : 0)}
            style={checkboxStyle}
          />
          Редаг.&nbsp;суми
        </label>
        <button type="submit" disabled={saving}
          style={{ ...btnS, background: '#2563eb', color: '#fff', border: 'none', padding: '5px 14px' }}>
          + Додати
        </button>
      </form>
    </div>
  )
}
