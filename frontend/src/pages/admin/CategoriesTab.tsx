import { useState, type FormEvent } from 'react'
import { api } from '../../api/client'
import Modal from '../../components/Modal'
import formStyles from '../../components/Form.module.css'
import type { Category } from '../../types'
import { addBtnStyle, delBtnStyle, editBtnStyle, tableStyle, Th, Td } from './shared'

interface CategoryFormState { name: string; is_baked: boolean; reserve_pct: string; sort_order: string }
const emptyCategoryForm = (): CategoryFormState => ({ name: '', is_baked: true, reserve_pct: '5', sort_order: '0' })

export default function CategoriesTab({ categories, onReload }: { categories: Category[]; onReload: () => void }) {
  const [modal,   setModal]   = useState(false)
  const [editing, setEditing] = useState<Category | null>(null)
  const [form,    setForm]    = useState<CategoryFormState>(emptyCategoryForm())
  const [saving,  setSaving]  = useState(false)
  const [newName, setNewName] = useState('')
  const [error,   setError]   = useState<string | null>(null)
  const [showInactive, setShowInactive] = useState(false)

  const openEdit = (c: Category) => {
    setEditing(c)
    setError(null)
    setForm({ name: c.name, is_baked: !!c.is_baked, reserve_pct: String(c.reserve_pct), sort_order: String(c.sort_order) })
    setModal(true)
  }

  const handleSave = async (e: FormEvent) => {
    e.preventDefault()
    if (!editing) return
    setSaving(true)
    setError(null)
    try {
      await api.put(`/categories/${editing.id}`, {
        name:        form.name,
        is_baked:    form.is_baked ? 1 : 0,
        reserve_pct: Number(form.reserve_pct),
        sort_order:  Number(form.sort_order),
      })
      onReload()
      setModal(false)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const detail = msg.match(/"detail":"([^"]+)"/)?.[1] ?? msg
      setError(detail)
    } finally { setSaving(false) }
  }

  const handleAdd = async () => {
    const name = newName.trim()
    if (!name) return
    setSaving(true)
    setError(null)
    try {
      await api.post('/categories', null, `name=${encodeURIComponent(name)}`)
      setNewName('')
      onReload()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const detail = msg.match(/"detail":"([^"]+)"/)?.[1] ?? msg
      setError(detail)
    } finally { setSaving(false) }
  }

  const handleToggle = async (c: Category) => {
    if (!confirm(`${c.is_active ? 'Приховати' : 'Відновити'} категорію "${c.name}"?`)) return
    await api.put(`/categories/${c.id}`, { is_active: c.is_active ? 0 : 1 })
    onReload()
  }

  const sorted         = [...categories].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'uk'))
  const sortedActive   = sorted.filter(c => c.is_active)
  const sortedInactive = sorted.filter(c => !c.is_active)

  const renderCatRow = (c: Category, dimmed = false) => (
    <tr key={c.id} style={dimmed ? { opacity: 0.5, background: '#f9fafb' } : undefined}>
      <Td>{c.sort_order}</Td>
      <Td>{c.name}</Td>
      <Td>{c.is_baked ? '✓ Випікається' : '—'}</Td>
      <Td>{c.is_baked ? `${c.reserve_pct}%` : '—'}</Td>
      <Td>
        <button onClick={() => openEdit(c)} style={editBtnStyle}>Редагувати</button>
        <button onClick={() => handleToggle(c)} style={c.is_active ? delBtnStyle : { ...editBtnStyle, color: '#080' }}>
          {c.is_active ? 'Приховати' : 'Відновити'}
        </button>
      </Td>
    </tr>
  )

  return (
    <section>
      <strong>Категорії (відділи) — {sortedActive.length} активних</strong>
      <div style={{ display: 'flex', gap: '0.5rem', margin: '0.75rem 0', flexWrap: 'wrap' }}>
        <input value={newName} onChange={(e) => { setNewName(e.target.value); setError(null) }}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          placeholder="напр. Хліб, Булки, Магазин"
          style={{ padding: '0.4rem 0.6rem', border: '1px solid #ccc', borderRadius: '4px', fontSize: '0.9rem', flex: 1, maxWidth: '260px' }} />
        <button onClick={handleAdd} disabled={saving || !newName.trim()} style={addBtnStyle}>+ Додати категорію</button>
        {error && !modal && <span style={{ color: '#c00', fontSize: '0.85rem', alignSelf: 'center' }}>⚠ {error}</span>}
      </div>
      <table style={tableStyle}>
        <thead>
          <tr style={{ background: '#e8eef5' }}>
            <Th>Порядок</Th><Th>Назва</Th><Th>Відділ випічки</Th><Th>Резерв, %</Th><Th>Дії</Th>
          </tr>
        </thead>
        <tbody>
          {sortedActive.map(c => renderCatRow(c))}
          {sortedInactive.length > 0 && (
            <tr>
              <td colSpan={5} style={{ padding: '6px 10px', borderTop: '2px dashed #d1d5db' }}>
                <button
                  onClick={() => setShowInactive(v => !v)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: 13, padding: 0 }}
                >
                  {showInactive ? '▲' : '▼'} Деактивовані ({sortedInactive.length})
                </button>
              </td>
            </tr>
          )}
          {showInactive && sortedInactive.map(c => renderCatRow(c, true))}
        </tbody>
      </table>

      {modal && editing && (
        <Modal title={`Редагувати категорію: ${editing.name}`} onClose={() => setModal(false)}>
          <form onSubmit={handleSave} className={formStyles.form}>
            <div className={formStyles.field}>
              <label>Назва *</label>
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className={formStyles.field}>
              <label>
                <input type="checkbox" checked={form.is_baked} onChange={(e) => setForm({ ...form, is_baked: e.target.checked })} />
                {' '}Відділ випічки (товари цієї категорії випікаються)
              </label>
            </div>
            {form.is_baked && (
              <div className={formStyles.field}>
                <label>Резерв, %</label>
                <input type="number" min="0" max="100" step="0.1" value={form.reserve_pct}
                  onChange={(e) => setForm({ ...form, reserve_pct: e.target.value })} />
                <span className={formStyles.hint}>Додаток до замовленої кількості при формуванні завдання на випічку</span>
              </div>
            )}
            <div className={formStyles.field}>
              <label>Порядок сортування</label>
              <input type="number" step="1" value={form.sort_order}
                onChange={(e) => setForm({ ...form, sort_order: e.target.value })} />
            </div>
            {error && <div style={{ color: '#c00', fontSize: '0.85rem', marginBottom: '0.5rem' }}>⚠ {error}</div>}
            <div className={formStyles.actions}>
              <button type="button" onClick={() => setModal(false)} className={formStyles.btnSecondary}>Скасувати</button>
              <button type="submit" disabled={saving} className={formStyles.btnPrimary}>{saving ? 'Збереження...' : 'Зберегти'}</button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  )
}
