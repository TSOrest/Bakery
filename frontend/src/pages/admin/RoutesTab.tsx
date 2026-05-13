import { useState, type FormEvent } from 'react'
import { api } from '../../api/client'
import Modal from '../../components/Modal'
import formStyles from '../../components/Form.module.css'
import type { Route } from '../../types'
import { addBtnStyle, editBtnStyle, tableStyle, Th, Td } from './shared'

interface RouteFormState { name: string; sort_order: string }

export default function RoutesTab({ routes, onReload }: { routes: Route[]; onReload: () => void }) {
  const [modal, setModal]     = useState(false)
  const [editing, setEditing] = useState<Route | null>(null)
  const [form, setForm]       = useState<RouteFormState>({ name: '', sort_order: '0' })
  const [saving, setSaving]   = useState(false)

  const openNew  = () => { setEditing(null); setForm({ name: '', sort_order: '0' }); setModal(true) }
  const openEdit = (r: Route) => {
    setEditing(r)
    setForm({ name: r.name, sort_order: r.sort_order.toString() })
    setModal(true)
  }
  const closeModal = () => setModal(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    const body = { name: form.name, sort_order: Number(form.sort_order) }
    try {
      if (editing) {
        await api.put(`/routes/${editing.id}`, body)
      } else {
        await api.post('/routes/', body)
      }
      onReload(); closeModal()
    } finally { setSaving(false) }
  }

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
        <strong>Маршрути ({routes.length})</strong>
        <button onClick={openNew} style={addBtnStyle}>+ Додати маршрут</button>
      </div>

      <table style={tableStyle}>
        <thead>
          <tr style={{ background: '#e8eef5' }}>
            <Th>Назва</Th><Th>Порядок</Th><Th>Активний</Th><Th>Дії</Th>
          </tr>
        </thead>
        <tbody>
          {routes.map((r) => (
            <tr key={r.id}>
              <Td>{r.name}</Td>
              <Td>{r.sort_order}</Td>
              <Td>{r.is_active ? '✓' : '✗'}</Td>
              <Td>
                <button onClick={() => openEdit(r)} style={editBtnStyle}>Редагувати</button>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>

      {modal && (
        <Modal title={editing ? 'Редагувати маршрут' : 'Новий маршрут'} onClose={closeModal}>
          <form onSubmit={handleSubmit} className={formStyles.form}>
            <div className={formStyles.field}>
              <label>Назва маршруту *</label>
              <input required maxLength={100} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="напр. Центр, Північ, Ринок" />
            </div>
            <div className={formStyles.field}>
              <label>Порядок сортування</label>
              <input type="number" min="0" value={form.sort_order}
                onChange={(e) => setForm({ ...form, sort_order: e.target.value })} />
              <span className={formStyles.hint}>Маршрути з меншим числом відображаються першими</span>
            </div>
            <div className={formStyles.actions}>
              <button type="button" onClick={closeModal} className={formStyles.btnSecondary}>Скасувати</button>
              <button type="submit" disabled={saving} className={formStyles.btnPrimary}>
                {saving ? 'Збереження...' : 'Зберегти'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  )
}
