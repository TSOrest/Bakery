import { useState } from 'react'
import { addBtnStyle, delBtnStyle, editBtnStyle, tableStyle, Th, Td, type SimpleItem } from './shared'

/**
 * Універсальна вкладка для простих довідників (одиниці виміру).
 * Категорії мають окрему вкладку через специфічні поля (is_baked, reserve_pct).
 */
export default function SimpleListTab({
  title, items, addLabel, placeholder, onAdd, onUpdate,
}: {
  title: string
  items: SimpleItem[]
  addLabel: string
  placeholder: string
  onAdd: (name: string) => Promise<unknown>
  onUpdate: (id: number, patch: { name?: string; is_active?: number }) => Promise<unknown>
}) {
  const [newName, setNewName]       = useState('')
  const [saving,  setSaving]        = useState(false)
  const [editItem, setEditItem]     = useState<SimpleItem | null>(null)
  const [editName, setEditName]     = useState('')
  const [showInactive, setShowInactive] = useState(false)

  const handleAdd = async () => {
    const name = newName.trim()
    if (!name) return
    setSaving(true)
    try { await onAdd(name); setNewName('') }
    finally { setSaving(false) }
  }

  const openEdit = (item: SimpleItem) => { setEditItem(item); setEditName(item.name) }

  const handleRename = async () => {
    if (!editItem) return
    const name = editName.trim()
    if (!name || name === editItem.name) { setEditItem(null); return }
    await onUpdate(editItem.id, { name })
    setEditItem(null)
  }

  const handleToggleActive = async (item: SimpleItem) => {
    const label = item.is_active ? 'приховати' : 'відновити'
    if (!confirm(`${label} "${item.name}"?`)) return
    await onUpdate(item.id, { is_active: item.is_active ? 0 : 1 })
  }

  const active   = items.filter((i) => i.is_active)
  const inactive = items.filter((i) => !i.is_active)

  const renderRow = (item: SimpleItem, dimmed = false) => (
    <tr key={item.id} style={dimmed ? { opacity: 0.5, background: '#f9fafb' } : undefined}>
      <Td>{item.id}</Td>
      <Td>
        {editItem?.id === item.id ? (
          <span style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
            <input
              autoFocus
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') setEditItem(null) }}
              style={{ padding: '0.2rem 0.4rem', border: '1px solid #bcd', borderRadius: '3px', fontSize: '0.9rem' }}
            />
            <button onClick={handleRename} style={editBtnStyle}>Зберегти</button>
            <button onClick={() => setEditItem(null)} style={{ ...editBtnStyle, color: '#888' }} aria-label="Скасувати" title="Скасувати">✕</button>
          </span>
        ) : (
          item.name
        )}
      </Td>
      <Td>
        {editItem?.id !== item.id && (
          <button onClick={() => openEdit(item)} style={editBtnStyle}>Перейменувати</button>
        )}
        <button
          onClick={() => handleToggleActive(item)}
          style={item.is_active ? delBtnStyle : { ...editBtnStyle, color: '#080' }}
        >
          {item.is_active ? 'Приховати' : 'Відновити'}
        </button>
      </Td>
    </tr>
  )

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
        <strong>{title} ({active.length})</strong>
      </div>

      {/* Форма додавання */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          placeholder={placeholder}
          style={{ padding: '0.4rem 0.6rem', border: '1px solid #ccc', borderRadius: '4px', fontSize: '0.9rem', flex: 1, maxWidth: '260px' }}
        />
        <button onClick={handleAdd} disabled={saving || !newName.trim()} style={addBtnStyle}>
          {addLabel}
        </button>
      </div>

      <table style={tableStyle}>
        <thead>
          <tr style={{ background: '#e8eef5' }}>
            <Th>ID</Th><Th>Назва</Th><Th>Дії</Th>
          </tr>
        </thead>
        <tbody>
          {active.map(item => renderRow(item))}
          {active.length === 0 && (
            <tr><td colSpan={3} style={{ textAlign: 'center', padding: '1rem', color: '#888' }}>
              Список порожній
            </td></tr>
          )}
          {inactive.length > 0 && (
            <tr>
              <td colSpan={3} style={{ padding: '6px 10px', borderTop: '2px dashed #d1d5db' }}>
                <button
                  onClick={() => setShowInactive(v => !v)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: 13, padding: 0 }}
                >
                  {showInactive ? '▲' : '▼'} Деактивовані ({inactive.length})
                </button>
              </td>
            </tr>
          )}
          {showInactive && inactive.map(item => renderRow(item, true))}
        </tbody>
      </table>
    </section>
  )
}
