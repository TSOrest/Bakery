import { useEffect, useState, type CSSProperties } from 'react'
import { api } from '../../api/client'
import { addBtnStyle, tableStyle } from './shared'

// Основні вкладки (сторінковий доступ — не чіпається гранульованими правами)
const MAIN_PAGE_PERMS = [
  { key: 'orders',    label: 'Замовлення' },
  { key: 'baking',    label: 'Випічка' },
  { key: 'routes',    label: 'Маршрути' },
  { key: 'shop',      label: 'Магазин' },
  { key: 'finances',  label: 'Фінанси' },
  { key: 'pos',       label: 'POS-каса' },
]

// Гранульовані CRUD-блоки (Гранульовані права ролей). Ключ блоку = префікс
// дозволу (`<key>.<дія>`, напр. "admin_clients.edit"), крім "finances" —
// там дозволи вже прямо на цьому ключі без .view (перегляд журналу вже
// покритий сторінковим "Фінанси" вище — окрема .view колонка була б
// дублем). `extra` — некрудні точкові прапорці цього ж розділу (форми
// налаштувань, разові небезпечні дії), не вкладаються в CRUD.
interface ExtraPerm { key: string; label: string }
interface CrudBlock { key: string; label: string; hint: string; actions: string[]; extra?: ExtraPerm[] }

const CRUD_BLOCKS: CrudBlock[] = [
  {
    key: 'admin_goods', label: 'Виробництво',
    hint: 'Вироби, Категорії, Одиниці виміру',
    actions: ['view', 'create', 'edit', 'delete'],
  },
  {
    key: 'admin_clients', label: 'Клієнти',
    hint: 'Клієнти, Маршрути, Групи клієнтів, Системні клієнти',
    actions: ['view', 'create', 'edit', 'delete'],
  },
  {
    key: 'admin_prices', label: 'Ціни та собівартість',
    hint: 'Ціни, Інгредієнти (перегляд Маржі — тим самим "Перегляд")',
    actions: ['view', 'create', 'edit', 'delete'],
  },
  {
    key: 'admin_org', label: 'Організація',
    hint: 'CRUD стосується Фінансових статей; форми налаштувань — окремим прапорцем праворуч',
    actions: ['view', 'create', 'edit', 'delete'],
    extra: [
      { key: 'admin_org.settings', label: 'Редагування налаштувань (Параметри пекарні, Бот, Шаблони, Звернення)' },
    ],
  },
  {
    key: 'admin_system', label: 'Система',
    hint: 'CRUD стосується Користувачів; решта — точкові прапорці праворуч',
    actions: ['view', 'create', 'edit', 'delete'],
    extra: [
      { key: 'admin_system.backup',    label: 'Бекапи та відновлення' },
      { key: 'admin_system.reset_db',  label: 'Скидання бази даних' },
      { key: 'admin_system.import',    label: 'Імпорт з Access' },
      { key: 'admin_system.github',    label: 'GitHub-інтеграція' },
      { key: 'admin_system.db_editor', label: 'Редактор БД' },
    ],
  },
  {
    key: 'finances', label: 'Фінанси — Журнал операцій',
    hint: 'Перегляд журналу вже дає вкладка «Фінанси» вище — тут лише дії',
    actions: ['create', 'edit', 'delete'],
  },
]

const ACTION_LABELS: Record<string, string> = {
  view: 'Перегляд', create: 'Створення', edit: 'Редагування', delete: 'Видалення',
}

// "Додатково" — точкові дозволи, не пов'язані з жодним CRUD-розділом.
// Оформлені як ще один блок (actions: []) — так само перемикається
// підменю, як і решта.
const EXTRA_BLOCK: CrudBlock = {
  key: 'extra', label: 'Додатково',
  hint: 'Точкові дозволи, не пов\'язані з жодним розділом',
  actions: [],
  extra: [
    { key: 'can_install_update', label: 'Встановлення оновлень' },
  ],
}

const ALL_BLOCKS: CrudBlock[] = [...CRUD_BLOCKS, EXTRA_BLOCK]

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
  const [activeBlock, setActiveBlock] = useState<string>(ALL_BLOCKS[0].key)

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
  const tdStyle: CSSProperties = {
    padding: '0.45rem 0.75rem', textAlign: 'center',
    borderBottom: '1px solid #f0f0f0',
  }
  const tdSepStyle: CSSProperties = {
    ...tdStyle, borderLeft: '2px solid #c8d6e5', background: '#f7f9fc',
  }
  const thSepStyle: CSSProperties = { ...thStyle, borderLeft: '2px solid #c8d6e5' }

  const CheckCell = ({ role, permKey, sep }: { role: string; permKey: string; sep?: boolean }) => (
    <td style={sep ? tdSepStyle : tdStyle}>
      {role === 'admin' ? (
        <span style={{ color: '#27ae60', fontSize: 16 }}>✓</span>
      ) : (
        <input
          type="checkbox"
          checked={perms[role]?.has(permKey) ?? false}
          onChange={() => toggle(role, permKey)}
          style={{ cursor: 'pointer', width: '16px', height: '16px' }}
        />
      )}
    </td>
  )

  return (
    <section>
      <h3 style={{ marginTop: 0, marginBottom: '0.5rem' }}>Доступ ролей до розділів</h3>
      <p style={{ fontSize: '0.82rem', color: '#666', marginBottom: '1rem' }}>
        Оператори та бухгалтери бачать лише дозволені розділи. Адміністратор завжди має повний доступ.
      </p>
      <div style={{ overflowX: 'auto', marginBottom: '2rem' }}>
        <table style={{ ...tableStyle, width: 'auto' }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, textAlign: 'left' }}>Роль</th>
              {MAIN_PAGE_PERMS.map(t => (
                <th key={t.key} style={thStyle}>{t.label}</th>
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
                    <CheckCell key={t.key} role={role} permKey={t.key} />
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <h3 style={{ marginBottom: '0.25rem' }}>Детальні права в Довідниках і Фінансах</h3>
      <p style={{ fontSize: '0.82rem', color: '#666', marginBottom: '1rem' }}>
        Хто може лише переглядати розділ, а хто — ще й створювати, редагувати
        чи видаляти записи. Заміняє колишній єдиний прапорець "видно вкладку"
        на окремі дозволи на кожну дію.
      </p>

      {/* ── Підменю розділів ── */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: '1.25rem' }}>
        {ALL_BLOCKS.map(block => {
          const isActive = activeBlock === block.key
          return (
            <button
              key={block.key}
              onClick={() => setActiveBlock(block.key)}
              style={{
                padding: '6px 14px', border: 'none', cursor: 'pointer', fontSize: 13,
                background: isActive ? '#1565c0' : '#e8eef5',
                color: isActive ? '#fff' : '#333',
                borderRadius: 6, fontWeight: isActive ? 600 : 400,
              }}
            >
              {block.label}
            </button>
          )
        })}
      </div>

      {ALL_BLOCKS.filter(block => block.key === activeBlock).map(block => (
        <div key={block.key} style={{ marginBottom: '1.75rem' }}>
          <div style={{ fontWeight: 600, fontSize: '0.88rem', color: '#1a3a5c' }}>{block.label}</div>
          <div style={{ fontSize: '0.78rem', color: '#888', marginBottom: '0.5rem' }}>{block.hint}</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ ...tableStyle, width: 'auto' }}>
              <thead>
                <tr>
                  <th style={{ ...thStyle, textAlign: 'left' }}>Роль</th>
                  {block.actions.map(a => (
                    <th key={a} style={thStyle}>{ACTION_LABELS[a]}</th>
                  ))}
                  {(block.extra ?? []).map((e, i) => (
                    <th key={e.key} style={i === 0 && block.actions.length > 0 ? thSepStyle : thStyle}>{e.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ALL_ROLES.map(role => {
                  const isAdmin = role === 'admin'
                  return (
                    <tr key={role} style={isAdmin ? { background: '#f0f4f8' } : undefined}>
                      <td style={{ ...tdStyle, textAlign: 'left', fontWeight: 500, whiteSpace: 'nowrap' }}>
                        {ROLE_LABELS_MAP[role]}
                      </td>
                      {block.actions.map(a => (
                        <CheckCell key={a} role={role} permKey={`${block.key}.${a}`} />
                      ))}
                      {(block.extra ?? []).map((e, i) => (
                        <CheckCell key={e.key} role={role} permKey={e.key} sep={i === 0 && block.actions.length > 0} />
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginTop: '1rem' }}>
        <button onClick={handleSave} disabled={saving} style={addBtnStyle}>
          {saving ? 'Збереження...' : 'Зберегти права'}
        </button>
        {saved && <span style={{ color: '#2e7d32', fontSize: '0.9rem' }}>✓ Збережено</span>}
      </div>
      <p style={{ fontSize: '0.82rem', color: '#888', marginTop: '0.75rem' }}>
        Зміни набудуть чинності після наступного входу в систему. Права ролей
        редагує лише адміністратор — цей розділ недоступний навіть за
        делегованим дозволом на налаштування.
      </p>
    </section>
  )
}
