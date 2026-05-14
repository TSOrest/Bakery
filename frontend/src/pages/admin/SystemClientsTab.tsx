import { useEffect, useState, type FormEvent } from 'react'
import { api } from '../../api/client'
import Modal from '../../components/Modal'
import formStyles from '../../components/Form.module.css'
import type { Client, Route } from '../../types'
import {
  addBtnStyle, delBtnStyle, editBtnStyle, tableStyle, Th, Td,
  CLIENT_KIND_LABELS, SYSTEM_KINDS, PROTECTED_KINDS,
  emptyClient, type ClientFormState,
} from './shared'

export default function SystemClientsTab({ routes }: { routes: Route[] }) {
  const [clients, setClients]   = useState<Client[]>([])
  const [modal, setModal]       = useState(false)
  const [editing, setEditing]   = useState<Client | null>(null)
  const [form, setForm]         = useState<ClientFormState>({ ...emptyClient(), client_kind: 'writeoff' })
  const [saving, setSaving]     = useState(false)
  const [showInactive, setShowInactive] = useState(false)

  const load = () => api.get<Client[]>('/clients/?active_only=false')
    .then(data => setClients(data.filter(c => c.client_kind !== 'customer' && c.client_kind !== 'shop')))
  useEffect(() => { load() }, [])

  const openNew  = () => { setEditing(null); setForm({ ...emptyClient(), client_kind: 'writeoff' }); setModal(true) }
  const openEdit = (c: Client) => {
    setEditing(c)
    setForm({
      full_name:    c.full_name,
      short_name:   c.short_name ?? '',
      address:      c.address ?? '',
      phone:        c.phone ?? '',
      director:     '',
      accountant:   '',
      route_id:     c.route_id?.toString() ?? '',
      discount_pct: c.discount_pct.toString(),
      client_kind:  c.client_kind,
      bot_phones:   c.bot_phones ?? '',
    })
    setModal(true)
  }
  const closeModal = () => setModal(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    const body = {
      full_name:    form.full_name,
      short_name:   form.short_name || null,
      address:      form.address || null,
      phone:        form.phone || null,
      route_id:     form.route_id ? Number(form.route_id) : null,
      discount_pct: Number(form.discount_pct),
      client_kind:  form.client_kind,
    }
    try {
      if (editing) {
        await api.put(`/clients/${editing.id}`, body)
      } else {
        await api.post('/clients/', body)
      }
      load(); closeModal()
    } finally { setSaving(false) }
  }

  const routeName = (id: number | null) => routes.find((r) => r.id === id)?.name ?? '—'

  const activeClients   = clients.filter(c => c.is_active)
  const inactiveClients = clients.filter(c => !c.is_active)

  const renderSysRow = (c: Client, dimmed = false) => (
    <tr key={c.id} style={dimmed ? { opacity: 0.5, background: '#f9fafb' } : undefined}>
      <Td>{c.full_name}</Td>
      <Td>{CLIENT_KIND_LABELS[c.client_kind] ?? c.client_kind}</Td>
      <Td>{routeName(c.route_id)}</Td>
      <Td>
        <button onClick={() => openEdit(c)} style={editBtnStyle}>Редагувати</button>
        {c.is_active === 1 ? (
          PROTECTED_KINDS.has(c.client_kind)
            ? <button disabled title="Системний клієнт — не можна деактивувати" style={{ ...delBtnStyle, opacity: 0.35, cursor: 'not-allowed' }}>Деактивувати</button>
            : <button onClick={async () => { if (!confirm(`Деактивувати "${c.full_name}"?`)) return; await api.delete(`/clients/${c.id}`); load() }} style={delBtnStyle}>Деактивувати</button>
        ) : (
          <button onClick={async () => { await api.put(`/clients/${c.id}`, { is_active: 1 }); load() }} style={{ ...editBtnStyle, color: '#080' }}>Відновити</button>
        )}
      </Td>
    </tr>
  )

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
        <strong>Системні клієнти ({activeClients.length})</strong>
        <button onClick={openNew} style={addBtnStyle}>+ Додати</button>
      </div>

      <table style={tableStyle}>
        <thead>
          <tr style={{ background: '#e8eef5' }}>
            <Th>Назва</Th><Th>Тип</Th><Th>Маршрут</Th><Th>Дії</Th>
          </tr>
        </thead>
        <tbody>
          {activeClients.map(c => renderSysRow(c))}
          {inactiveClients.length > 0 && (
            <tr>
              <td colSpan={4} style={{ padding: '6px 10px', borderTop: '2px dashed #d1d5db' }}>
                <button
                  onClick={() => setShowInactive(v => !v)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: 13, padding: 0 }}
                >
                  {showInactive ? '▲' : '▼'} Деактивовані ({inactiveClients.length})
                </button>
              </td>
            </tr>
          )}
          {showInactive && inactiveClients.map(c => renderSysRow(c, true))}
        </tbody>
      </table>

      {modal && (
        <Modal title={editing ? 'Редагувати системного клієнта' : 'Новий системний клієнт'} onClose={closeModal}>
          <form onSubmit={handleSubmit} className={formStyles.form}>
            <div className={formStyles.field}>
              <label>Повна назва *</label>
              <input required maxLength={200} value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
            </div>
            <div className={formStyles.field}>
              <label>Скорочена назва</label>
              <input maxLength={100} value={form.short_name} onChange={(e) => setForm({ ...form, short_name: e.target.value })} />
            </div>
            <div className={formStyles.field}>
              <label>Тип</label>
              <select value={form.client_kind} onChange={(e) => setForm({ ...form, client_kind: e.target.value })}>
                {SYSTEM_KINDS.map(k => (
                  <option key={k} value={k}>{CLIENT_KIND_LABELS[k]}</option>
                ))}
              </select>
            </div>
            <div className={formStyles.field}>
              <label>Маршрут</label>
              <select value={form.route_id} onChange={(e) => setForm({ ...form, route_id: e.target.value })}>
                <option value="">— не призначено —</option>
                {routes.filter((r) => r.is_active).map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
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
