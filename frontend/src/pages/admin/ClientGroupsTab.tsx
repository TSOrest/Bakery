import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { api } from '../../api/client'
import Modal from '../../components/Modal'
import formStyles from '../../components/Form.module.css'
import { useToast } from '../../components/Toast'
import { useConfirm } from '../../components/ConfirmDialog'
import type { Client, ClientGroup, Route } from '../../types'
import { addBtnStyle, delBtnStyle, editBtnStyle, tableStyle, Th, Td } from './shared'

interface GroupFormState {
  name: string
  route_id: string
  sort_order: string
}

export default function ClientGroupsTab({ routes }: { routes: Route[] }) {
  const toast = useToast()
  const confirm = useConfirm()

  const [groups, setGroups]     = useState<ClientGroup[]>([])
  const [clients, setClients]   = useState<Client[]>([])
  const [loading, setLoading]   = useState(true)
  const [selectedRouteId, setSelectedRouteId] = useState<number | null>(null)

  const [modal, setModal]       = useState(false)
  const [editing, setEditing]   = useState<ClientGroup | null>(null)
  const [form, setForm]         = useState<GroupFormState>({ name: '', route_id: '', sort_order: '0' })
  const [saving, setSaving]     = useState(false)

  const [membersModal, setMembersModal] = useState<ClientGroup | null>(null)
  const [memberIds, setMemberIds]       = useState<Set<number>>(new Set())
  const [savingMembers, setSavingMembers] = useState(false)

  const activeRoutes = useMemo(
    () => routes.filter(r => r.is_active).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'uk')),
    [routes],
  )

  useEffect(() => {
    if (selectedRouteId === null && activeRoutes.length > 0) {
      setSelectedRouteId(activeRoutes[0].id)
    }
  }, [activeRoutes, selectedRouteId])

  const reload = async () => {
    setLoading(true)
    try {
      const [gs, cs] = await Promise.all([
        api.get<ClientGroup[]>('/client-groups/'),
        api.get<Client[]>('/clients/?active_only=false'),
      ])
      setGroups(gs)
      setClients(cs)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { reload() }, [])

  const groupsForRoute = useMemo(
    () => groups
      .filter(g => g.route_id === selectedRouteId)
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'uk')),
    [groups, selectedRouteId],
  )

  const clientsOfRoute = useMemo(
    () => clients
      .filter(c => c.is_active && c.route_id === selectedRouteId && c.client_kind === 'customer')
      .sort((a, b) => (a.short_name ?? a.full_name).localeCompare(b.short_name ?? b.full_name, 'uk')),
    [clients, selectedRouteId],
  )

  // ── Створення / редагування ──
  const openNew = () => {
    if (!selectedRouteId) return
    setEditing(null)
    setForm({ name: '', route_id: String(selectedRouteId), sort_order: '0' })
    setModal(true)
  }
  const openEdit = (g: ClientGroup) => {
    setEditing(g)
    setForm({ name: g.name, route_id: String(g.route_id), sort_order: String(g.sort_order) })
    setModal(true)
  }
  const closeModal = () => setModal(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) return
    setSaving(true)
    try {
      if (editing) {
        await api.put(`/client-groups/${editing.id}`, {
          name: form.name.trim(),
          sort_order: Number(form.sort_order) || 0,
        })
        toast.success('Групу оновлено')
      } else {
        await api.post('/client-groups/', {
          name: form.name.trim(),
          route_id: Number(form.route_id),
          sort_order: Number(form.sort_order) || 0,
        })
        toast.success('Групу створено')
      }
      await reload()
      closeModal()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Помилка')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (g: ClientGroup) => {
    const ok = await confirm({
      message: `Видалити групу "${g.name}"? Клієнти не видаляються — вони стають "Без групи".`,
      danger: true,
      confirmText: 'Видалити',
    })
    if (!ok) return
    try {
      await api.delete(`/client-groups/${g.id}`)
      toast.success('Групу видалено')
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Помилка')
    }
  }

  // ── Призначення клієнтів ──
  const openMembers = async (g: ClientGroup) => {
    setMembersModal(g)
    try {
      const ids = await api.get<number[]>(`/client-groups/${g.id}/members`)
      setMemberIds(new Set(ids))
    } catch {
      setMemberIds(new Set())
    }
  }
  const toggleMember = (cid: number) => {
    setMemberIds(prev => {
      const next = new Set(prev)
      if (next.has(cid)) next.delete(cid); else next.add(cid)
      return next
    })
  }
  const saveMembers = async () => {
    if (!membersModal) return
    setSavingMembers(true)
    try {
      await api.put(`/client-groups/${membersModal.id}/members`, Array.from(memberIds))
      toast.success('Склад групи оновлено')
      await reload()
      setMembersModal(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Помилка')
    } finally {
      setSavingMembers(false)
    }
  }

  // ── Render ──
  return (
    <div style={{ padding: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <label style={{ fontSize: '0.9rem' }}>
          Маршрут:&nbsp;
          <select
            value={selectedRouteId ?? ''}
            onChange={e => setSelectedRouteId(Number(e.target.value))}
            style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #c5d0dc' }}
          >
            {activeRoutes.map(r => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </label>
        <button style={addBtnStyle} onClick={openNew} disabled={!selectedRouteId}>+ Нова група</button>
        {loading && <span style={{ fontSize: 13, color: '#888' }}>Завантаження…</span>}
      </div>

      <table style={tableStyle}>
        <thead>
          <tr>
            <Th>Назва групи</Th>
            <Th>Порядок</Th>
            <Th>Клієнтів</Th>
            <Th>Дії</Th>
          </tr>
        </thead>
        <tbody>
          {groupsForRoute.map(g => (
            <tr key={g.id}>
              <Td>{g.name}</Td>
              <Td>{g.sort_order}</Td>
              <Td>{g.member_count}</Td>
              <Td>
                <button style={editBtnStyle} onClick={() => openMembers(g)}>Клієнти групи</button>
                <button style={editBtnStyle} onClick={() => openEdit(g)}>Редагувати</button>
                <button style={delBtnStyle} onClick={() => handleDelete(g)}>Видалити</button>
              </Td>
            </tr>
          ))}
          {groupsForRoute.length === 0 && !loading && (
            <tr><td colSpan={4} style={{ padding: 24, textAlign: 'center', color: '#888' }}>
              На цьому маршруті ще немає груп. Створіть нову кнопкою «+ Нова група».
            </td></tr>
          )}
        </tbody>
      </table>

      {modal && (
        <Modal title={editing ? 'Редагувати групу' : 'Нова група клієнтів'} onClose={closeModal}>
          <form onSubmit={handleSubmit} className={formStyles.form}>
            <div className={formStyles.field}>
              <label>Назва *</label>
              <input
                required maxLength={100}
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="напр. Центр, Перший район"
              />
            </div>
            <div className={formStyles.field}>
              <label>Маршрут</label>
              <input
                value={activeRoutes.find(r => r.id === Number(form.route_id))?.name ?? ''}
                disabled
              />
              <span className={formStyles.hint}>
                Маршрут групи не можна змінити. Якщо потрібна група на іншому маршруті — створіть нову.
              </span>
            </div>
            <div className={formStyles.field}>
              <label>Порядок сортування</label>
              <input
                type="number" min="0"
                value={form.sort_order}
                onChange={e => setForm({ ...form, sort_order: e.target.value })}
              />
              <span className={formStyles.hint}>Менше число — група відображається раніше у друкованому листі.</span>
            </div>
            <div className={formStyles.actions}>
              <button type="button" onClick={closeModal} className={formStyles.btnSecondary}>Скасувати</button>
              <button type="submit" disabled={saving} className={formStyles.btnPrimary}>
                {saving ? 'Збереження…' : 'Зберегти'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {membersModal && (
        <Modal
          title={`Клієнти групи «${membersModal.name}»`}
          onClose={() => setMembersModal(null)}
          wide
        >
          <div style={{ padding: '0.5rem 0' }}>
            <p style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>
              Відмітьте клієнтів маршруту «{activeRoutes.find(r => r.id === membersModal.route_id)?.name}»,
              які входять у цю групу.
            </p>
            <div style={{ maxHeight: 400, overflowY: 'auto', border: '1px solid #e5eaf0', borderRadius: 4 }}>
              {clientsOfRoute.length === 0 ? (
                <p style={{ padding: 16, color: '#888' }}>На маршруті немає активних клієнтів.</p>
              ) : clientsOfRoute.map(c => {
                const assigned = c.client_group_id != null && c.client_group_id !== membersModal.id
                const checked = memberIds.has(c.id)
                return (
                  <label
                    key={c.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '6px 12px', borderBottom: '1px solid #f0f0f0',
                      cursor: 'pointer',
                      background: assigned && !checked ? '#fff8e6' : undefined,
                    }}
                  >
                    <input type="checkbox" checked={checked} onChange={() => toggleMember(c.id)} />
                    <span style={{ flex: 1 }}>{c.short_name ?? c.full_name}</span>
                    {assigned && !checked && (
                      <span style={{ fontSize: 11, color: '#a66', fontStyle: 'italic' }}>
                        зараз у іншій групі
                      </span>
                    )}
                  </label>
                )
              })}
            </div>
            <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setMembersModal(null)} className={formStyles.btnSecondary}>Скасувати</button>
              <button onClick={saveMembers} disabled={savingMembers} className={formStyles.btnPrimary}>
                {savingMembers ? 'Збереження…' : 'Зберегти'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
