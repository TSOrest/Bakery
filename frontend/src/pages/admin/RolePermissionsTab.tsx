import { useEffect, useState, type CSSProperties } from 'react'
import { api } from '../../api/client'
import { ADMIN_TAB_GROUPS } from '../AdminPage'
import { addBtnStyle, tableStyle } from './shared'

// Основні вкладки (не Довідники)
const MAIN_PAGE_PERMS = [
  { key: 'orders',    label: 'Замовлення' },
  { key: 'baking',    label: 'Випічка' },
  { key: 'routes',    label: 'Маршрути' },
  { key: 'shop',      label: 'Магазин' },
  { key: 'finances',  label: 'Фінанси' },
  { key: 'pos',       label: 'POS-каса' },
]

// Підрозділи Довідників (всі конфігуруються)
const ADMIN_SUB_PERMS = ADMIN_TAB_GROUPS
  .map(g => ({ key: g.permKey as string, label: g.label }))

const ALL_ROLES = ['operator', 'accountant', 'admin', 'owner', 'seller'] as const
const ROLE_LABELS_MAP: Record<string, string> = {
  operator:   'Оператор',
  accountant: 'Бухгалтер',
  admin:      'Адміністратор',
  owner:      'Власник',
  seller:     'Продавець',
}

export default function RolePermissionsTab({ onSaved }: { onSaved: () => Promise<void> }) {
  const [perms,  setPerms]  = useState<Record<string, Set<string>>>({})
  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(false)

  const load = () =>
    api.get<Record<string, { value: string }>>('/settings/').then((data) => {
      try {
        const raw: Record<string, string[]> = JSON.parse(data.role_permissions?.value ?? '{}')
        const map: Record<string, Set<string>> = {}
        ALL_ROLES.forEach((r) => { map[r] = new Set(raw[r] ?? []) })
        setPerms(map)
      } catch { /* ignore */ }
    })

  useEffect(() => { load() }, [])

  const toggle = (role: string, key: string) => {
    setPerms((prev) => {
      const next = { ...prev, [role]: new Set(prev[role]) }
      if (next[role].has(key)) next[role].delete(key)
      else next[role].add(key)
      return next
    })
    setSaved(false)
  }

  const handleSave = async () => {
    setSaving(true)
    setSaved(false)
    try {
      const json: Record<string, string[]> = {}
      ALL_ROLES.forEach((r) => { json[r] = Array.from(perms[r] ?? []) })
      await api.put('/settings/role_permissions', { value: JSON.stringify(json) })
      setSaved(true)
      await onSaved()
    } finally {
      setSaving(false)
    }
  }

  const thStyle: CSSProperties = {
    padding: '0.5rem 0.75rem', textAlign: 'center', fontWeight: 600,
    fontSize: '0.8rem', background: '#e8eef5', whiteSpace: 'nowrap',
  }
  const thGroupStyle: CSSProperties = {
    padding: '0.3rem 0.75rem', textAlign: 'center', fontWeight: 700,
    fontSize: '0.68rem', background: '#dde6f0', color: '#555',
    textTransform: 'uppercase', letterSpacing: '0.05em',
  }
  const tdStyle: CSSProperties = {
    padding: '0.45rem 0.75rem', textAlign: 'center',
    borderBottom: '1px solid #f0f0f0',
  }
  const tdSepStyle: CSSProperties = {
    ...tdStyle, borderLeft: '2px solid #c8d6e5', background: '#f7f9fc',
  }

  return (
    <section>
      <h3 style={{ marginTop: 0, marginBottom: '0.5rem' }}>Доступ ролей до розділів</h3>
      <p style={{ fontSize: '0.82rem', color: '#666', marginBottom: '1rem' }}>
        Оператори та бухгалтери бачать лише дозволені розділи. Адміністратор завжди має повний доступ.
      </p>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ ...tableStyle, width: 'auto' }}>
          <thead>
            {/* Рядок групових заголовків */}
            <tr>
              <th style={{ ...thGroupStyle, textAlign: 'left', background: '#e8eef5' }} rowSpan={2}>Роль</th>
              <th style={{ ...thGroupStyle }} colSpan={MAIN_PAGE_PERMS.length}>Основні розділи</th>
              <th style={{ ...thGroupStyle, borderLeft: '2px solid #c8d6e5' }} colSpan={ADMIN_SUB_PERMS.length}>Довідники</th>
            </tr>
            {/* Рядок конкретних колонок */}
            <tr>
              {MAIN_PAGE_PERMS.map(t => (
                <th key={t.key} style={thStyle}>{t.label}</th>
              ))}
              {ADMIN_SUB_PERMS.map((t, i) => (
                <th key={t.key} style={{ ...thStyle, ...(i === 0 ? { borderLeft: '2px solid #c8d6e5' } : {}) }}>
                  {t.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ALL_ROLES.map((role) => {
              const isAdmin = role === 'admin'
              return (
                <tr key={role} style={isAdmin ? { background: '#f0f4f8' } : undefined}>
                  <td style={{ ...tdStyle, textAlign: 'left', fontWeight: 500, whiteSpace: 'nowrap' }}>
                    {ROLE_LABELS_MAP[role]}
                    {isAdmin && <span style={{ fontSize: 10, color: '#888', marginLeft: 6 }}>(завжди всі)</span>}
                  </td>
                  {MAIN_PAGE_PERMS.map(t => (
                    <td key={t.key} style={tdStyle}>
                      {isAdmin ? (
                        <span style={{ color: '#27ae60', fontSize: 16 }}>✓</span>
                      ) : (
                        <input
                          type="checkbox"
                          checked={perms[role]?.has(t.key) ?? false}
                          onChange={() => toggle(role, t.key)}
                          style={{ cursor: 'pointer', width: '16px', height: '16px' }}
                        />
                      )}
                    </td>
                  ))}
                  {ADMIN_SUB_PERMS.map((t, i) => (
                    <td key={t.key} style={i === 0 ? tdSepStyle : tdStyle}>
                      {isAdmin ? (
                        <span style={{ color: '#27ae60', fontSize: 16 }}>✓</span>
                      ) : (
                        <input
                          type="checkbox"
                          checked={perms[role]?.has(t.key) ?? false}
                          onChange={() => toggle(role, t.key)}
                          style={{ cursor: 'pointer', width: '16px', height: '16px' }}
                        />
                      )}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginTop: '1rem' }}>
        <button onClick={handleSave} disabled={saving} style={addBtnStyle}>
          {saving ? 'Збереження...' : 'Зберегти права'}
        </button>
        {saved && <span style={{ color: '#2e7d32', fontSize: '0.9rem' }}>✓ Збережено</span>}
      </div>
      <p style={{ fontSize: '0.82rem', color: '#888', marginTop: '0.75rem' }}>
        Зміни набудуть чинності після наступного входу в систему.
      </p>
    </section>
  )
}
