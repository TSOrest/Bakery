import { useEffect, useState, type FormEvent } from 'react'
import Modal from '../../components/Modal'
import formStyles from '../../components/Form.module.css'
import { useToast } from '../../components/Toast'
import type { Ingredient, Product, ProductIngredient, Unit } from '../../types'
import {
  fetchIngredients, createIngredient, updateIngredient, deleteIngredient,
  fetchProductIngredients, addProductIngredient, removeProductIngredient,
} from '../../api/ingredients'
import { addBtnStyle, delBtnStyle, editBtnStyle, tableStyle, Th, Td } from './shared'

export default function IngredientsTab({ units, products }: { units: Unit[]; products: Product[] }) {
  const toast = useToast()
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [editIng, setEditIng]         = useState<Ingredient | null>(null)
  const [addModal, setAddModal]       = useState(false)
  const [compProduct, setCompProduct] = useState<Product | null>(null)
  const [composition, setComposition] = useState<ProductIngredient[]>([])
  const [saving, setSaving]           = useState(false)
  const [error,  setError]            = useState('')

  const [addForm, setAddForm]   = useState({ name: '', unit_id: '', price_per_unit: '' })
  const [editForm, setEditForm] = useState({ name: '', unit_id: '', price_per_unit: '' })
  const [compForm, setCompForm] = useState({ ingredient_id: '', qty_per_unit: '' })

  const load = async () => setIngredients(await fetchIngredients())

  useEffect(() => { load() }, [])

  const openComp = async (p: Product) => {
    setCompProduct(p)
    setComposition(await fetchProductIngredients(p.id))
  }

  const submitAdd = async (e: FormEvent) => {
    e.preventDefault(); setSaving(true); setError('')
    try {
      await createIngredient({
        name: addForm.name,
        unit_id: addForm.unit_id ? Number(addForm.unit_id) : null,
        price_per_unit: Number(addForm.price_per_unit),
      })
      setAddModal(false)
      setAddForm({ name: '', unit_id: '', price_per_unit: '' })
      await load()
    } catch (err) { setError(String(err)) }
    finally { setSaving(false) }
  }

  const submitEdit = async (e: FormEvent) => {
    e.preventDefault()
    if (!editIng) return
    setSaving(true); setError('')
    try {
      await updateIngredient(editIng.id, {
        name: editForm.name,
        unit_id: editForm.unit_id ? Number(editForm.unit_id) : null,
        price_per_unit: Number(editForm.price_per_unit),
      })
      setEditIng(null)
      await load()
      if (compProduct) setComposition(await fetchProductIngredients(compProduct.id))
    } catch (err) { setError(String(err)) }
    finally { setSaving(false) }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('Видалити інгредієнт?')) return
    try { await deleteIngredient(id); await load() }
    catch (err) { toast.error(String(err)) }
  }

  const submitAddComp = async (e: FormEvent) => {
    e.preventDefault()
    if (!compProduct) return
    setSaving(true); setError('')
    try {
      await addProductIngredient(compProduct.id, {
        ingredient_id: Number(compForm.ingredient_id),
        qty_per_unit:  Number(compForm.qty_per_unit),
      })
      setCompForm({ ingredient_id: '', qty_per_unit: '' })
      setComposition(await fetchProductIngredients(compProduct.id))
    } catch (err) { setError(String(err)) }
    finally { setSaving(false) }
  }

  const handleRemoveComp = async (piId: number) => {
    if (!compProduct) return
    await removeProductIngredient(compProduct.id, piId)
    setComposition(await fetchProductIngredients(compProduct.id))
  }

  const uName = (id: number | null) => units.find(u => u.id === id)?.name ?? ''
  const totalCost = composition.reduce((s, r) => s + r.line_cost, 0)

  return (
    <section>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>

        {/* Ліва колонка: список інгредієнтів */}
        <div style={{ flex: '1 1 420px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
            <h3 style={{ margin: 0 }}>Інгредієнти / Сировина</h3>
            <button onClick={() => setAddModal(true)} style={addBtnStyle}>+ Додати</button>
          </div>

          <table style={tableStyle}>
            <thead>
              <tr style={{ background: '#e8eef5' }}>
                <Th>Назва</Th><Th>Од. виміру</Th><Th>Ціна / од.</Th><Th>Оновлено</Th><th style={{ width: 80 }}></th>
              </tr>
            </thead>
            <tbody>
              {ingredients.map(ing => (
                <tr key={ing.id}>
                  <Td>{ing.name}</Td>
                  <Td>{uName(ing.unit_id)}</Td>
                  <Td><strong>{ing.price_per_unit.toFixed(2)}</strong></Td>
                  <Td><span style={{ fontSize: 12, color: '#888' }}>{ing.price_updated_at?.slice(0, 10) ?? '—'}</span></Td>
                  <Td>
                    <button onClick={() => { setEditIng(ing); setEditForm({ name: ing.name, unit_id: String(ing.unit_id ?? ''), price_per_unit: String(ing.price_per_unit) }) }} style={{ ...editBtnStyle, marginRight: 4 }} aria-label="Редагувати" title="Редагувати">✎</button>
                    <button onClick={() => handleDelete(ing.id)} style={delBtnStyle} aria-label="Видалити" title="Видалити">✕</button>
                  </Td>
                </tr>
              ))}
              {ingredients.length === 0 && (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: '1rem', color: '#888' }}>Інгредієнти не додані</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Права колонка: склад виробу */}
        <div style={{ flex: '1 1 380px' }}>
          <div style={{ marginBottom: 10 }}>
            <h3 style={{ margin: '0 0 8px' }}>Склад виробу</h3>
            <select
              value={compProduct?.id ?? ''}
              onChange={e => {
                const p = products.find(p => p.id === Number(e.target.value))
                if (p) openComp(p); else { setCompProduct(null); setComposition([]) }
              }}
              style={{ padding: '5px 10px', border: '1px solid #ccc', borderRadius: 4, width: '100%' }}
            >
              <option value="">— оберіть виріб —</option>
              {products.filter(p => p.is_active).map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {compProduct && (
            <>
              <table style={tableStyle}>
                <thead>
                  <tr style={{ background: '#e8eef5' }}>
                    <Th>Інгредієнт</Th><Th>К-сть</Th><Th>Од.</Th><Th>Ціна</Th><Th>Сума</Th><th style={{ width: 36 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {composition.map(r => (
                    <tr key={r.id}>
                      <Td>{r.ingredient_name}</Td>
                      <Td>{r.qty_per_unit}</Td>
                      <Td>{r.unit_name}</Td>
                      <Td>{r.price_per_unit.toFixed(2)}</Td>
                      <Td><strong>{r.line_cost.toFixed(4)}</strong></Td>
                      <Td>
                        <button onClick={() => handleRemoveComp(r.id)} style={delBtnStyle} aria-label="Видалити" title="Видалити">✕</button>
                      </Td>
                    </tr>
                  ))}
                  {composition.length === 0 && (
                    <tr><td colSpan={6} style={{ textAlign: 'center', padding: '0.75rem', color: '#888' }}>Склад порожній</td></tr>
                  )}
                  {composition.length > 0 && (
                    <tr style={{ background: '#f0f4f8', fontWeight: 600 }}>
                      <td colSpan={4} style={{ padding: '6px 10px', textAlign: 'right' }}>Собівартість:</td>
                      <Td>{totalCost.toFixed(4)} грн</Td>
                      <td></td>
                    </tr>
                  )}
                </tbody>
              </table>

              <form onSubmit={submitAddComp} style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                <select required value={compForm.ingredient_id}
                  onChange={e => setCompForm({ ...compForm, ingredient_id: e.target.value })}
                  style={{ flex: 2, padding: '5px 8px', border: '1px solid #ccc', borderRadius: 4, minWidth: 140 }}>
                  <option value="">— інгредієнт —</option>
                  {ingredients
                    .filter(i => !composition.find(c => c.ingredient_id === i.id))
                    .map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
                <input required type="number" step="any" min="0.0001"
                  placeholder="К-сть" value={compForm.qty_per_unit}
                  onChange={e => setCompForm({ ...compForm, qty_per_unit: e.target.value })}
                  style={{ flex: 1, padding: '5px 8px', border: '1px solid #ccc', borderRadius: 4, minWidth: 80 }} />
                <button type="submit" disabled={saving} style={addBtnStyle}>+ Додати</button>
              </form>
              {error && <p style={{ color: '#c0392b', marginTop: 6, fontSize: 13 }}>{error}</p>}
            </>
          )}
        </div>
      </div>

      {addModal && (
        <Modal title="Новий інгредієнт" onClose={() => { setAddModal(false); setError('') }}>
          <form onSubmit={submitAdd} className={formStyles.form}>
            {error && <p style={{ color: '#c0392b', margin: '0 0 .5rem' }}>{error}</p>}
            <div className={formStyles.field}>
              <label>Назва *</label>
              <input required autoFocus maxLength={200} value={addForm.name}
                onChange={e => setAddForm({ ...addForm, name: e.target.value })} />
            </div>
            <div className={formStyles.field}>
              <label>Одиниця виміру</label>
              <select value={addForm.unit_id} onChange={e => setAddForm({ ...addForm, unit_id: e.target.value })}>
                <option value="">— не вказано —</option>
                {units.filter(u => u.is_active).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
            <div className={formStyles.field}>
              <label>Ціна за одиницю, грн</label>
              <input type="number" step="0.0001" min="0" value={addForm.price_per_unit}
                onChange={e => setAddForm({ ...addForm, price_per_unit: e.target.value })} placeholder="0.00" />
            </div>
            <div className={formStyles.actions}>
              <button type="button" onClick={() => setAddModal(false)} className={formStyles.btnSecondary}>Скасувати</button>
              <button type="submit" disabled={saving} className={formStyles.btnPrimary}>{saving ? 'Збереження...' : 'Зберегти'}</button>
            </div>
          </form>
        </Modal>
      )}

      {editIng && (
        <Modal title={`Редагувати: ${editIng.name}`} onClose={() => { setEditIng(null); setError('') }}>
          <form onSubmit={submitEdit} className={formStyles.form}>
            {error && <p style={{ color: '#c0392b', margin: '0 0 .5rem' }}>{error}</p>}
            <div className={formStyles.field}>
              <label>Назва *</label>
              <input required autoFocus maxLength={200} value={editForm.name}
                onChange={e => setEditForm({ ...editForm, name: e.target.value })} />
            </div>
            <div className={formStyles.field}>
              <label>Одиниця виміру</label>
              <select value={editForm.unit_id} onChange={e => setEditForm({ ...editForm, unit_id: e.target.value })}>
                <option value="">— не вказано —</option>
                {units.filter(u => u.is_active).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
            <div className={formStyles.field}>
              <label>Ціна за одиницю, грн</label>
              <input type="number" step="0.0001" min="0" value={editForm.price_per_unit}
                onChange={e => setEditForm({ ...editForm, price_per_unit: e.target.value })} />
              <span className={formStyles.hint}>Після збереження собівартість виробів перерахується автоматично</span>
            </div>
            <div className={formStyles.actions}>
              <button type="button" onClick={() => setEditIng(null)} className={formStyles.btnSecondary}>Скасувати</button>
              <button type="submit" disabled={saving} className={formStyles.btnPrimary}>{saving ? 'Збереження...' : 'Зберегти'}</button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  )
}
