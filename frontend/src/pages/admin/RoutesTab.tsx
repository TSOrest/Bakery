import { useState, type FormEvent } from 'react'
import { api } from '../../api/client'
import Modal from '../../components/Modal'
import formStyles from '../../components/Form.module.css'
import { useToast } from '../../components/Toast'
import type { Route } from '../../types'
import { addBtnStyle, delBtnStyle, editBtnStyle, tableStyle, Th, Td } from './shared'

interface RouteFormState { name: string; sort_order: string }

export default function RoutesTab({ routes, onReload }: { routes: Route[]; onReload: () => void }) {
  const toast = useToast()
  const [modal, setModal]     = useState(false)
  const [editing, setEditing] = useState<Route | null>(null)
  const [form, setForm]       = useState<RouteFormState>({ name: '', sort_order: '0' })
  const [saving, setSaving]   = useState(false)

  // Стан для деактивації з переносом
  const [deactivating, setDeactivating] = useState<{
    route: Route
    activeClients: number
    targetId: string  // ID цільового маршруту як string (для <select>)
  } | null>(null)
  const [deactSaving, setDeactSaving] = useState(false)

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

  const openDeactivate = async (r: Route) => {
    try {
      const res = await api.get<{ active_clients: number }>(`/routes/${r.id}/clients-count`)
      const n = res.active_clients
      if (n === 0) {
        if (!confirm(`Деактивувати маршрут "${r.name}"?`)) return
        await api.delete(`/routes/${r.id}`)
        onReload()
        toast.success('Маршрут деактивовано')
      } else {
        // Відкриваємо модалку з вибором цільового маршруту
        const firstTarget = routes.find(t => t.is_active && t.id !== r.id)
        setDeactivating({ route: r, activeClients: n, targetId: firstTarget?.id?.toString() ?? '' })
      }
    } catch (err) {
      toast.error(`Не вдалося отримати дані маршруту: ${err}`)
    }
  }

  const handleDeactivateWithReassign = async () => {
    if (!deactivating) return
    const targetId = Number(deactivating.targetId)
    if (!targetId) {
      toast.warning('Оберіть цільовий маршрут')
      return
    }
    setDeactSaving(true)
    try {
      await api.delete(`/routes/${deactivating.route.id}?reassign_to_id=${targetId}`)
      onReload()
      const target = routes.find(t => t.id === targetId)
      toast.success(`Перенесено ${deactivating.activeClients} клієнтів на "${target?.name ?? ''}", маршрут деактивовано`)
      setDeactivating(null)
    } catch (err) {
      toast.error(`Помилка: ${err}`)
    } finally { setDeactSaving(false) }
  }

  const activeRoutes   = routes.filter(r => r.is_active)
  const inactiveRoutes = routes.filter(r => !r.is_active)
  const [showInactive, setShowInactive] = useState(false)

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
        <strong>Маршрути ({activeRoutes.length})</strong>
        <button onClick={openNew} style={addBtnStyle}>+ Додати маршрут</button>
      </div>

      <table style={tableStyle}>
        <thead>
          <tr style={{ background: '#e8eef5' }}>
            <Th>Назва</Th><Th>Порядок</Th><Th>Дії</Th>
          </tr>
        </thead>
        <tbody>
          {activeRoutes.map((r) => (
            <tr key={r.id}>
              <Td>{r.name}</Td>
              <Td>{r.sort_order}</Td>
              <Td>
                <button onClick={() => openEdit(r)} style={editBtnStyle}>Редагувати</button>
                <button onClick={() => openDeactivate(r)} style={delBtnStyle}>Деактивувати</button>
              </Td>
            </tr>
          ))}
          {inactiveRoutes.length > 0 && (
            <tr>
              <td colSpan={3} style={{ padding: '6px 10px', borderTop: '2px dashed #d1d5db' }}>
                <button
                  onClick={() => setShowInactive(v => !v)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: 13, padding: 0 }}
                >
                  {showInactive ? '▲' : '▼'} Деактивовані ({inactiveRoutes.length})
                </button>
              </td>
            </tr>
          )}
          {showInactive && inactiveRoutes.map((r) => (
            <tr key={r.id} style={{ opacity: 0.5, background: '#f9fafb' }}>
              <Td>{r.name}</Td>
              <Td>{r.sort_order}</Td>
              <Td>
                <button onClick={async () => {
                  await api.put(`/routes/${r.id}`, { name: r.name, sort_order: r.sort_order, is_active: 1 })
                  onReload()
                }} style={{ ...editBtnStyle, color: '#080' }}>Відновити</button>
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

      {deactivating && (
        <Modal title={`Деактивація: ${deactivating.route.name}`} onClose={() => setDeactivating(null)}>
          <div className={formStyles.form}>
            <p style={{ marginTop: 0, fontSize: '0.92rem' }}>
              Маршрут має <strong>{deactivating.activeClients}</strong> активних клієнтів.
              Перенесіть їх на інший маршрут перед деактивацією.
            </p>
            <div className={formStyles.field}>
              <label>Цільовий маршрут *</label>
              <select value={deactivating.targetId}
                onChange={(e) => setDeactivating({ ...deactivating, targetId: e.target.value })}>
                <option value="">— оберіть —</option>
                {activeRoutes
                  .filter(r => r.id !== deactivating.route.id)
                  .map(r => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
              </select>
              <span className={formStyles.hint}>
                Усі {deactivating.activeClients} клієнтів буде перенесено на цей маршрут,
                після чого "{deactivating.route.name}" деактивується.
              </span>
            </div>
            <div className={formStyles.actions}>
              <button type="button" onClick={() => setDeactivating(null)} className={formStyles.btnSecondary}>
                Скасувати
              </button>
              <button type="button" onClick={handleDeactivateWithReassign}
                disabled={deactSaving || !deactivating.targetId}
                className={formStyles.btnPrimary}>
                {deactSaving ? 'Перенос...' : 'Перенести і деактивувати'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  )
}
