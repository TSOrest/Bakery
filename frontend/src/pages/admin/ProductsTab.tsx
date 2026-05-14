import { useEffect, useRef, useState, type FormEvent } from 'react'
import { api } from '../../api/client'
import Modal from '../../components/Modal'
import formStyles from '../../components/Form.module.css'
import type { Category, Product, Unit } from '../../types'
import { addBtnStyle, delBtnStyle, editBtnStyle, tableStyle, Th, Td } from './shared'

interface ProductFormState {
  name: string
  short_name: string
  weight: string
  unit_id: string
  category_id: string
  initial_price: string  // тільки при створенні; порожньо = не встановлювати
}

const emptyProduct = (): ProductFormState => ({
  name: '', short_name: '', weight: '', unit_id: '', category_id: '', initial_price: '',
})

export default function ProductsTab({
  products, units, categories, onReload,
}: {
  products: Product[]
  units: Unit[]
  categories: Category[]
  onReload: () => void
}) {
  const [modal, setModal]         = useState(false)
  const [editing, setEditing]     = useState<Product | null>(null)
  const [form, setForm]           = useState<ProductFormState>(emptyProduct())
  const [saving, setSaving]       = useState(false)
  const [showInactive, setShowInactive] = useState(false)
  const controlsRef = useRef<HTMLDivElement>(null)
  const [theadTop, setTheadTop] = useState(50)
  useEffect(() => {
    if (controlsRef.current) setTheadTop(controlsRef.current.offsetHeight)
  })

  const openNew  = () => { setEditing(null); setForm(emptyProduct()); setModal(true) }
  const openEdit = (p: Product) => {
    setEditing(p)
    setForm({
      name:          p.name,
      short_name:    p.short_name ?? '',
      weight:        p.weight?.toString() ?? '',
      unit_id:       p.unit_id?.toString() ?? '',
      category_id:   p.category_id?.toString() ?? '',
      initial_price: '',
    })
    setModal(true)
  }
  const closeModal = () => setModal(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    const body = {
      name:        form.name,
      short_name:  form.short_name || null,
      weight:      form.weight ? Number(form.weight) : null,
      unit_id:     form.unit_id ? Number(form.unit_id) : null,
      category_id: form.category_id ? Number(form.category_id) : null,
    }
    try {
      if (editing) {
        await api.put(`/products/${editing.id}`, body)
      } else {
        const created = await api.post<{ id: number }>('/products/', body)
        // Автоматично створюємо базову ціну якщо вказана при створенні
        const price = parseFloat(form.initial_price)
        if (created?.id && price > 0) {
          const today = new Date().toISOString().slice(0, 10)
          await api.post('/prices/', {
            product_id: created.id,
            price,
            valid_from: today,
          })
        }
      }
      onReload()
      closeModal()
    } finally {
      setSaving(false)
    }
  }

  const handleDeactivate = async (p: Product) => {
    if (!confirm(`Деактивувати виріб "${p.name}"?`)) return
    await api.delete(`/products/${p.id}`)
    onReload()
  }

  const activeProducts   = products.filter(p => p.is_active)
  const inactiveProducts = products.filter(p => !p.is_active)

  const renderProductRow = (p: Product) => (
    <tr key={p.id}>
      <Td>{p.name}</Td>
      <Td>{p.short_name ?? '—'}</Td>
      <Td>{categories.find((c) => c.id === p.category_id)?.name ?? '—'}</Td>
      <Td>{p.weight ?? '—'}</Td>
      <Td>
        <button onClick={() => openEdit(p)} style={editBtnStyle}>Редагувати</button>
        {p.is_active === 1 ? (
          <button onClick={() => handleDeactivate(p)} style={delBtnStyle}>Деактивувати</button>
        ) : (
          <button onClick={async () => { await api.put(`/products/${p.id}`, { is_active: 1 }); onReload() }} style={{ ...editBtnStyle, color: '#080' }}>Відновити</button>
        )}
      </Td>
    </tr>
  )

  return (
    <section>
      <div ref={controlsRef} style={{ position: 'sticky', top: 0, zIndex: 10, background: 'white', paddingBottom: 6, marginBottom: 2 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
          <strong>Вироби ({activeProducts.length})</strong>
          <button onClick={openNew} style={addBtnStyle}>+ Додати виріб</button>
        </div>
      </div>

      <table style={tableStyle}>
        <thead>
          <tr>
            <Th top={theadTop}>Назва</Th>
            <Th top={theadTop}>Скорочена</Th>
            <Th top={theadTop}>Категорія</Th>
            <Th top={theadTop}>Вага, кг</Th>
            <Th top={theadTop}>Дії</Th>
          </tr>
        </thead>
        <tbody>
          {activeProducts.map(renderProductRow)}
          {inactiveProducts.length > 0 && (
            <tr>
              <td colSpan={5} style={{ padding: '6px 10px', borderTop: '2px dashed #d1d5db' }}>
                <button
                  onClick={() => setShowInactive(v => !v)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: 13, padding: 0 }}
                >
                  {showInactive ? '▲' : '▼'} Деактивовані ({inactiveProducts.length})
                </button>
              </td>
            </tr>
          )}
          {showInactive && inactiveProducts.map(p => (
            <tr key={p.id} style={{ opacity: 0.5, background: '#f9fafb' }}>
              <Td>{p.name}</Td>
              <Td>{p.short_name ?? '—'}</Td>
              <Td>{categories.find((c) => c.id === p.category_id)?.name ?? '—'}</Td>
              <Td>{p.weight ?? '—'}</Td>
              <Td>
                <button onClick={() => openEdit(p)} style={editBtnStyle}>Редагувати</button>
                <button onClick={async () => { await api.put(`/products/${p.id}`, { is_active: 1 }); onReload() }} style={{ ...editBtnStyle, color: '#080' }}>Відновити</button>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>

      {modal && (
        <Modal title={editing ? 'Редагувати виріб' : 'Новий виріб'} onClose={closeModal}>
          <form onSubmit={handleSubmit} className={formStyles.form}>
            <div className={formStyles.field}>
              <label>Назва *</label>
              <input required maxLength={200} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className={formStyles.field}>
              <label>Скорочена назва</label>
              <input maxLength={100} value={form.short_name} onChange={(e) => setForm({ ...form, short_name: e.target.value })} />
              <span className={formStyles.hint}>Відображається в таблиці замовлень</span>
            </div>
            <div className={formStyles.field}>
              <label>Вага (кг)</label>
              <input type="number" step="0.001" min="0" value={form.weight}
                onChange={(e) => setForm({ ...form, weight: e.target.value })} />
            </div>
            <div className={formStyles.field}>
              <label>Одиниця виміру</label>
              <select value={form.unit_id} onChange={(e) => setForm({ ...form, unit_id: e.target.value })}>
                <option value="">— не вказано —</option>
                {units.filter((u) => u.is_active).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
            <div className={formStyles.field}>
              <label>Категорія</label>
              <select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
                <option value="">— не вказано —</option>
                {categories.filter((c) => c.is_active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            {!editing && (
              <div className={formStyles.field}>
                <label>Базова ціна, грн</label>
                <input
                  type="number" step="0.01" min="0"
                  value={form.initial_price}
                  onChange={(e) => setForm({ ...form, initial_price: e.target.value })}
                  placeholder="Наприклад: 27.50"
                />
                <span className={formStyles.hint}>Встановлюється з сьогоднішньої дати</span>
              </div>
            )}
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
