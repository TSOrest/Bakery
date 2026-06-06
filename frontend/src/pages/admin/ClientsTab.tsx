import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { api } from '../../api/client'
import Modal from '../../components/Modal'
import formStyles from '../../components/Form.module.css'
import { useToast } from '../../components/Toast'
import type { Client, ClientGroup, ClientPriceOverride, Product, Route } from '../../types'
import {
  addBtnStyle, delBtnStyle, editBtnStyle, tableStyle, Th, Td,
  emptyClient, type ClientFormState,
} from './shared'

interface BotUser {
  id: number; chat_id: string; phone: string | null
  first_name: string | null; authorized_at: string | null; is_active: number
}

export default function ClientsTab({ routes, products }: { routes: Route[]; products: Product[] }) {
  const toast = useToast()
  const today    = new Date().toISOString().slice(0, 10)
  const tomorrow = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10) })()
  const [clients, setClients]   = useState<Client[]>([])
  const [modal, setModal]       = useState(false)
  const [editing, setEditing]   = useState<Client | null>(null)
  const [form, setForm]         = useState<ClientFormState>(emptyClient())
  const [saving, setSaving]     = useState(false)
  const [botUsers, setBotUsers] = useState<BotUser[]>([])
  const [showInactive, setShowInactive] = useState(false)
  const controlsRef = useRef<HTMLDivElement>(null)
  const [theadTop, setTheadTop] = useState(50)
  useEffect(() => {
    if (controlsRef.current) setTheadTop(controlsRef.current.offsetHeight)
  })

  // Індивідуальні ціни клієнта
  const [clientOverrides,    setClientOverrides]    = useState<ClientPriceOverride[]>([])
  const [overrideAddForm,    setOverrideAddForm]    = useState({ product_id: '', price: '', valid_from: today, valid_to: '' })
  const [overrideAdding,     setOverrideAdding]     = useState(false)
  const [overrideSaving,     setOverrideSaving]     = useState(false)

  const loadClientOverrides = (clientId: number) =>
    api.get<ClientPriceOverride[]>(`/prices/overrides?client_id=${clientId}`)
      .then(setClientOverrides)
      .catch(() => setClientOverrides([]))

  const [clientGroups, setClientGroups] = useState<ClientGroup[]>([])

  const load = () => api.get<Client[]>('/clients/?active_only=false')
    .then(data => setClients(data.filter(c => c.client_kind === 'customer' || c.client_kind === 'shop')))
  useEffect(() => { load() }, [])
  useEffect(() => {
    api.get<ClientGroup[]>('/client-groups/').then(setClientGroups).catch(() => {})
  }, [])

  const openNew  = () => { setEditing(null); setForm(emptyClient()); setBotUsers([]); setModal(true) }
  const openEdit = (c: Client) => {
    setEditing(c)
    setForm({
      full_name:   c.full_name,
      short_name:  c.short_name ?? '',
      address:     c.address ?? '',
      phone:       c.phone ?? '',
      director:    c.director ?? '',
      accountant:  c.accountant ?? '',
      route_id:    c.route_id?.toString() ?? '',
      discount_pct: c.discount_pct.toString(),
      client_kind:  c.client_kind ?? 'customer',
      bot_phones:  c.bot_phones ?? '',
      client_group_id: c.client_group_id?.toString() ?? '',
    })
    api.get<BotUser[]>(`/bot/clients/${c.id}/bot-users`).then(setBotUsers).catch(() => setBotUsers([]))
    loadClientOverrides(c.id)
    setOverrideAdding(false)
    setOverrideAddForm({ product_id: '', price: '', valid_from: tomorrow, valid_to: '' })
    setModal(true)
  }
  const closeModal = () => { setModal(false); setBotUsers([]); setClientOverrides([]) }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    const body = {
      full_name:   form.full_name,
      short_name:  form.short_name || null,
      address:     form.address || null,
      phone:       form.phone || null,
      director:    form.director || null,
      accountant:  form.accountant || null,
      route_id:    form.route_id ? Number(form.route_id) : null,
      discount_pct: Number(form.discount_pct),
      client_kind: form.client_kind || 'customer',
      bot_phones:  form.bot_phones.trim() || null,
      client_group_id: form.client_group_id ? Number(form.client_group_id) : null,
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

  const handleDeactivate = async (c: Client) => {
    if (!confirm(`Деактивувати клієнта "${c.full_name}"?`)) return
    await api.delete(`/clients/${c.id}`)
    load()
  }

  const routeName = (id: number | null) => routes.find((r) => r.id === id)?.name ?? '—'

  const activeClients   = clients.filter(c => c.is_active)
  const inactiveClients = clients.filter(c => !c.is_active)

  const renderClientRow = (c: Client, dimmed = false) => (
    <tr key={c.id} style={dimmed ? { opacity: 0.5, background: '#f9fafb' } : undefined}>
      <Td>{c.full_name}</Td>
      <Td>{c.short_name ?? '—'}</Td>
      <Td>{routeName(c.route_id)}</Td>
      <Td>{c.discount_pct}</Td>
      <Td>{c.phone ?? '—'}</Td>
      <Td>
        <button onClick={() => openEdit(c)} style={editBtnStyle}>Редагувати</button>
        {c.is_active === 1
          ? <button onClick={() => handleDeactivate(c)} style={delBtnStyle}>Деактивувати</button>
          : <button onClick={async () => { await api.put(`/clients/${c.id}`, { is_active: 1 }); load() }} style={{ ...editBtnStyle, color: '#080' }}>Відновити</button>
        }
      </Td>
    </tr>
  )

  const SECTION_HEADER_STYLE: CSSProperties = {
    background: '#f0f4f8', padding: '4px 10px', fontSize: 11,
    fontWeight: 600, color: '#475569', letterSpacing: '0.05em', textTransform: 'uppercase',
  }

  return (
    <section>
      <div ref={controlsRef} style={{ position: 'sticky', top: 0, zIndex: 10, background: 'white', paddingBottom: 6, marginBottom: 2 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
          <strong>Клієнти ({activeClients.length})</strong>
          <button onClick={openNew} style={addBtnStyle}>+ Додати клієнта</button>
        </div>
      </div>

      {(() => {
        const activeShops     = activeClients.filter(c => c.client_kind === 'shop')
        const activeCustomers = activeClients.filter(c => c.client_kind !== 'shop')
        return (
          <table style={tableStyle}>
            <thead>
              <tr>
                <Th top={theadTop}>Назва</Th>
                <Th top={theadTop}>Скорочена</Th>
                <Th top={theadTop}>Маршрут</Th>
                <Th top={theadTop}>Знижка %</Th>
                <Th top={theadTop}>Телефон</Th>
                <Th top={theadTop}>Дії</Th>
              </tr>
            </thead>
            <tbody>
              {activeShops.length > 0 && (
                <tr><td colSpan={6} style={SECTION_HEADER_STYLE}>Магазини ({activeShops.length})</td></tr>
              )}
              {activeShops.map(c => renderClientRow(c))}
              {activeShops.length > 0 && activeCustomers.length > 0 && (
                <tr><td colSpan={6} style={SECTION_HEADER_STYLE}>Клієнти ({activeCustomers.length})</td></tr>
              )}
              {activeCustomers.map(c => renderClientRow(c))}
              {inactiveClients.length > 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: '6px 10px', borderTop: '2px dashed #d1d5db' }}>
                    <button
                      onClick={() => setShowInactive(v => !v)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: 13, padding: 0 }}
                    >
                      {showInactive ? '▲' : '▼'} Деактивовані ({inactiveClients.length})
                    </button>
                  </td>
                </tr>
              )}
              {showInactive && inactiveClients.map(c => renderClientRow(c, true))}
            </tbody>
          </table>
        )
      })()}

      {modal && (
        <Modal title={editing ? 'Редагувати клієнта' : 'Новий клієнт'} onClose={closeModal} xwide={!!editing}>
          <form onSubmit={handleSubmit} className={formStyles.form}>
            <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>

              {/* ── Колонка 1: Основні дані ── */}
              <div style={{ flex: '0 0 200px' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Основні дані</div>
                {!editing && (
                  <div className={formStyles.field}>
                    <label>Тип *</label>
                    <select value={form.client_kind} onChange={(e) => setForm({ ...form, client_kind: e.target.value })}>
                      <option value="customer">Клієнт</option>
                      <option value="shop">Магазин</option>
                    </select>
                  </div>
                )}
                <div className={formStyles.field}>
                  <label>Повна назва *</label>
                  <input required maxLength={200} value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
                </div>
                <div className={formStyles.field}>
                  <label>Скорочена назва</label>
                  <input maxLength={100} value={form.short_name} onChange={(e) => setForm({ ...form, short_name: e.target.value })} />
                  <span className={formStyles.hint}>Відображається в таблиці замовлень</span>
                </div>
                <div className={formStyles.field}>
                  <label>Маршрут</label>
                  <select value={form.route_id} onChange={(e) => setForm({ ...form, route_id: e.target.value, client_group_id: '' })}>
                    <option value="">— не призначено —</option>
                    {routes.filter((r) => r.is_active).map((r) => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                </div>
                <div className={formStyles.field}>
                  <label>Група клієнтів</label>
                  <select
                    value={form.client_group_id}
                    onChange={(e) => setForm({ ...form, client_group_id: e.target.value })}
                    disabled={!form.route_id}
                  >
                    <option value="">— без групи —</option>
                    {clientGroups
                      .filter(g => g.route_id === Number(form.route_id))
                      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'uk'))
                      .map(g => (
                        <option key={g.id} value={g.id}>{g.name}</option>
                      ))}
                  </select>
                  <span className={formStyles.hint}>
                    {form.route_id
                      ? 'Зміна маршруту скидає групу (групи прив\'язані до маршруту).'
                      : 'Спочатку оберіть маршрут.'}
                  </span>
                </div>
                <div className={formStyles.field}>
                  <label>Адреса</label>
                  <input maxLength={300} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
                </div>
                <div className={formStyles.field}>
                  <label>Телефон</label>
                  <input maxLength={50} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                </div>
              </div>

              {/* ── Колонка 2: Реквізити та бот ── */}
              <div style={{ flex: '0 0 210px' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Реквізити</div>
                <div className={formStyles.field}>
                  <label>Директор</label>
                  <input maxLength={200} value={form.director} onChange={(e) => setForm({ ...form, director: e.target.value })} />
                </div>
                <div className={formStyles.field}>
                  <label>Бухгалтер</label>
                  <input maxLength={200} value={form.accountant} onChange={(e) => setForm({ ...form, accountant: e.target.value })} />
                </div>
                <div className={formStyles.field}>
                  <label>Телефони для бота</label>
                  <input maxLength={200} value={form.bot_phones}
                    onChange={(e) => setForm({ ...form, bot_phones: e.target.value })}
                    placeholder="+380501234567, +380671234567" />
                  <span className={formStyles.hint}>Через кому. Бот звіряє при авторизації.</span>
                </div>
                {editing && botUsers.length > 0 && (
                  <div className={formStyles.field}>
                    <label>Авторизовані в боті</label>
                    <table style={{ width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ background: '#f0f4f8' }}>
                          <th style={{ padding: '0.2rem 0.4rem', textAlign: 'left' }}>Ім'я</th>
                          <th style={{ padding: '0.2rem 0.4rem', textAlign: 'left' }}>Телефон</th>
                          <th style={{ width: 28 }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {botUsers.map((u) => (
                          <tr key={u.id} style={{ opacity: u.is_active ? 1 : 0.5, borderBottom: '1px solid #eee' }}>
                            <td style={{ padding: '0.18rem 0.4rem' }}>{u.first_name ?? '—'}</td>
                            <td style={{ padding: '0.18rem 0.4rem', color: '#64748b' }}>{u.phone ?? '—'}</td>
                            <td style={{ padding: '0.18rem 0.3rem' }}>
                              <button type="button" title="Відкликати авторизацію"
                                onClick={async () => {
                                  if (!confirm(`Відкликати авторизацію ${u.first_name ?? u.chat_id}?`)) return
                                  await api.delete(`/bot/clients/${editing.id}/bot-users/${u.id}`)
                                  setBotUsers((prev) => prev.filter((x) => x.id !== u.id))
                                }}
                                style={{ background: '#fde', border: '1px solid #e88', borderRadius: 3, cursor: 'pointer', padding: '0.1rem 0.35rem', color: '#900', fontSize: '0.78rem' }}
                                aria-label="Відкликати доступ"
                              >✕</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* ── Колонка 3: Ціноутворення (тільки при редагуванні) ── */}
              {editing && (
                <div style={{ flex: '0 0 440px', borderLeft: '1px solid #e2e8f0', paddingLeft: 20 }}>
                  {/* Знижка */}
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Ціноутворення</div>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginBottom: 14 }}>
                    <div className={formStyles.field} style={{ margin: 0, flex: '0 0 100px' }}>
                      <label>Знижка %</label>
                      <input type="number" min="0" max="100" step="0.1" value={form.discount_pct}
                        onChange={(e) => setForm({ ...form, discount_pct: e.target.value })} />
                    </div>
                    <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.6, padding: '5px 8px', background: '#f8fafc', borderRadius: 6, border: '1px solid #e2e8f0', flex: 1 }}>
                      Пріоритет ціни:<br />
                      <strong style={{ color: '#dc2626' }}>Р</strong> Ручна&nbsp;→&nbsp;<strong style={{ color: '#2563eb' }}>І</strong> Інд.&nbsp;→&nbsp;<strong style={{ color: '#ea580c' }}>%</strong> Знижка&nbsp;→&nbsp;<strong style={{ color: '#16a34a' }}>Б</strong> Базова
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Індивідуальні ціни</div>
                    <button type="button" onClick={() => setOverrideAdding(!overrideAdding)}
                      style={{ fontSize: 12, padding: '2px 10px', border: '1px solid #3b82f6', borderRadius: 6,
                        background: overrideAdding ? '#eff6ff' : '#fff', color: '#3b82f6', cursor: 'pointer' }}>
                      {overrideAdding ? 'Скасувати' : '+ Додати'}
                    </button>
                  </div>

                  {overrideAdding && (
                    <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8,
                      padding: '10px 12px', marginBottom: 8, display: 'grid',
                      gridTemplateColumns: '1fr auto auto auto auto', gap: 6, alignItems: 'flex-end' }}>
                      <div>
                        <div style={{ fontSize: 11, color: '#64748b', marginBottom: 2 }}>Виріб *</div>
                        <select required value={overrideAddForm.product_id}
                          onChange={e => setOverrideAddForm({ ...overrideAddForm, product_id: e.target.value })}
                          style={{ width: '100%', padding: '4px 6px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 12 }}>
                          <option value="">— оберіть —</option>
                          {products.filter(p => p.is_active).map(p => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: '#64748b', marginBottom: 2 }}>Ціна, ₴ *</div>
                        <input type="number" step="0.01" min="0.01" required
                          value={overrideAddForm.price} placeholder="0.00"
                          onChange={e => setOverrideAddForm({ ...overrideAddForm, price: e.target.value })}
                          style={{ padding: '4px 6px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 12, width: 72 }} />
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: '#64748b', marginBottom: 2 }}>Діє з *</div>
                        <input type="date" required min={tomorrow} value={overrideAddForm.valid_from}
                          onChange={e => {
                            setOverrideAddForm({ ...overrideAddForm, valid_from: e.target.value,
                              valid_to: overrideAddForm.valid_to && overrideAddForm.valid_to < e.target.value ? e.target.value : overrideAddForm.valid_to
                            })
                          }}
                          style={{ padding: '4px 6px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 12 }} />
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: '#64748b', marginBottom: 2 }}>Діє до</div>
                        <input type="date" min={overrideAddForm.valid_from || tomorrow} value={overrideAddForm.valid_to}
                          onChange={e => setOverrideAddForm({ ...overrideAddForm, valid_to: e.target.value })}
                          style={{ padding: '4px 6px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 12 }} />
                      </div>
                      <button type="button" disabled={overrideSaving || !overrideAddForm.product_id || !overrideAddForm.price}
                        onClick={async () => {
                          if (!editing) return
                          setOverrideSaving(true)
                          try {
                            await api.post('/prices/overrides', {
                              client_id:  editing.id,
                              product_id: Number(overrideAddForm.product_id),
                              price:      Number(overrideAddForm.price),
                              valid_from: overrideAddForm.valid_from,
                              valid_to:   overrideAddForm.valid_to || null,
                            })
                            await loadClientOverrides(editing.id)
                            setOverrideAddForm({ product_id: '', price: '', valid_from: tomorrow, valid_to: '' })
                            setOverrideAdding(false)
                          } catch (err) { toast.error(String(err)) }
                          finally { setOverrideSaving(false) }
                        }}
                        style={{ padding: '5px 12px', background: '#16a34a', color: '#fff', border: 'none',
                          borderRadius: 6, fontSize: 12, cursor: 'pointer', alignSelf: 'flex-end' }}>
                        {overrideSaving ? '...' : 'OK'}
                      </button>
                    </div>
                  )}

                  {clientOverrides.length > 0 ? (
                    <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                      <table style={{ width: '100%', fontSize: '0.82rem', borderCollapse: 'collapse' }}>
                        <thead style={{ position: 'sticky', top: 0 }}>
                          <tr style={{ background: '#f0f4f8' }}>
                            <th style={{ padding: '0.22rem 0.5rem', textAlign: 'left' }}>Виріб</th>
                            <th style={{ padding: '0.22rem 0.5rem', textAlign: 'right' }}>Ціна</th>
                            <th style={{ padding: '0.22rem 0.5rem', textAlign: 'left' }}>Діє з</th>
                            <th style={{ padding: '0.22rem 0.5rem', textAlign: 'left' }}>Діє до</th>
                            <th style={{ padding: '0.22rem 0.5rem', textAlign: 'left' }}>Стан</th>
                            <th style={{ width: 30 }}></th>
                          </tr>
                        </thead>
                        <tbody>
                          {clientOverrides.map(o => {
                            const isActive = o.valid_from <= today && (o.valid_to === null || o.valid_to >= today)
                            const isPast   = o.valid_to !== null && o.valid_to < today
                            const canDelete = o.valid_from > today
                            return (
                              <tr key={o.id} style={{ borderBottom: '1px solid #eee', background: isActive ? '#f0fdf4' : isPast ? '#fafafa' : '#fffbeb' }}>
                                <td style={{ padding: '0.2rem 0.5rem' }}>
                                  {products.find(p => p.id === o.product_id)?.name ?? `#${o.product_id}`}
                                </td>
                                <td style={{ padding: '0.2rem 0.5rem', textAlign: 'right', fontWeight: 600 }}>
                                  {o.price.toFixed(2)} ₴
                                </td>
                                <td style={{ padding: '0.2rem 0.5rem', color: '#64748b' }}>{o.valid_from}</td>
                                <td style={{ padding: '0.2rem 0.5rem', color: '#64748b' }}>{o.valid_to ?? '∞'}</td>
                                <td style={{ padding: '0.2rem 0.5rem', fontSize: 11 }}>
                                  {isActive  ? <span style={{ color: '#16a34a' }}>активна</span>
                                  : isPast   ? <span style={{ color: '#94a3b8' }}>минула</span>
                                  :            <span style={{ color: '#f59e0b' }}>майбутня</span>}
                                </td>
                                <td style={{ padding: '0.2rem 0.3rem' }}>
                                  <button type="button" disabled={!canDelete}
                                    title={canDelete ? 'Видалити' : 'Не можна видалити поточну/минулу ціну'}
                                    onClick={async () => {
                                      if (!editing) return
                                      if (!confirm('Видалити індивідуальну ціну?')) return
                                      await api.delete(`/prices/overrides/${o.id}`)
                                      await loadClientOverrides(editing.id)
                                    }}
                                    style={{ background: 'none', border: 'none', cursor: canDelete ? 'pointer' : 'default',
                                      color: canDelete ? '#ef4444' : '#cbd5e1', fontSize: '1rem' }}>
                                    ×
                                  </button>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div style={{ fontSize: 13, color: '#94a3b8', padding: '12px 0' }}>Індивідуальних цін немає</div>
                  )}
                </div>
              )}
            </div>

            <div className={formStyles.actions} style={{ marginTop: 16 }}>
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
