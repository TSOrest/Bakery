import { useEffect, useRef, useState, type FormEvent } from 'react'
import { api } from '../../api/client'
import {
  startDeviceFlow, pollDeviceFlow, getGitHubStatus, githubLogout, type GitHubStatus,
} from '../../api/auth_github'
import { addBtnStyle, delBtnStyle, editBtnStyle } from './shared'

// ─── Налаштування ─────────────────────────────────────────────────────────────

interface SettingEntry { value: string; description: string }
type SettingsMap = Record<string, SettingEntry>

const SETTINGS_LABELS: Record<string, string> = {
  bakery_name:       'Назва пекарні',
  director:          'ПІБ директора',
  accountant_name:   'ПІБ бухгалтера',
  address:           'Адреса',
  city:              'Місто',
  phone:             'Телефон',
  edrpou:            'Код ЄДРПОУ',
  iban:              'IBAN рахунок',
  bank:              'Банк',
  order_lock_time:          'Час блокування замовлень',
  order_past_days:          'Днів назад для редагування замовлень',
  work_date_next_day_time:  'Час переходу дати роботи на завтра',
}

export type SettingsSection = 'settings_bakery' | 'settings_bot' | 'settings_bot_tpl' | 'settings_issues'

export default function SettingsTab({ section }: { section: SettingsSection }) {
  const [settings, setSettings] = useState<SettingsMap>({})
  const [form,     setForm]     = useState<Record<string, string>>({})
  const [saving,   setSaving]   = useState(false)
  const [saved,    setSaved]    = useState(false)

  // Telegram
  const [tgToken,   setTgToken]   = useState('')
  const [tgPhones,  setTgPhones]  = useState('')   // через кому
  const [tgRunning, setTgRunning] = useState(false)
  const [tgChats,   setTgChats]   = useState<{ chat_id: string; phone: string }[]>([])
  const [tgSaving,  setTgSaving]  = useState(false)
  const [tgMsg,     setTgMsg]     = useState('')
  const [showToken, setShowToken] = useState(false)

  const load = () =>
    api.get<SettingsMap>('/settings/').then((data) => {
      setSettings(data)
      const vals: Record<string, string> = {}
      Object.entries(SETTINGS_LABELS).forEach(([k]) => {
        vals[k] = data[k]?.value ?? ''
      })
      setForm(vals)
      setTgToken(data['telegram_bot_token']?.value ?? '')
      setTgPhones(data['telegram_allowed_phones']?.value ?? '')
    })

  const loadTgStatus = () =>
    api.get<{ running: boolean }>('/settings/telegram/status').then(d => setTgRunning(d.running))

  const loadTgChats = () =>
    api.get<{ chats: { chat_id: string; phone: string }[] }>('/settings/telegram/authorized')
      .then(d => setTgChats(d.chats))

  useEffect(() => {
    load()
    loadTgStatus()
    loadTgChats()
    const id = setInterval(loadTgStatus, 10000)
    return () => clearInterval(id)
  }, []) // eslint-disable-line

  const handleSave = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true); setSaved(false)
    try {
      await Promise.all(
        Object.entries(form).map(([key, value]) =>
          api.put(`/settings/${key}`, { value, description: settings[key]?.description ?? '' })
        )
      )
      setSaved(true)
      await load()
    } finally { setSaving(false) }
  }

  const saveTgSettings = async () => {
    setTgSaving(true); setTgMsg('')
    try {
      await api.put('/settings/telegram_bot_token',    { value: tgToken })
      await api.put('/settings/telegram_allowed_phones', { value: tgPhones })
      // Перезапускаємо бота з новим токеном
      const res = await api.post<{ running: boolean; has_token: boolean }>(
        '/settings/telegram/restart', null
      )
      setTgRunning(res.running)
      setTgMsg(res.running ? '✓ Бот запущено' : res.has_token ? '⚠ Не вдалось запустити — перевірте токен' : 'Токен не задано — бот не запущено')
    } catch (err) {
      setTgMsg(String(err))
    } finally { setTgSaving(false) }
  }

  const stopBot = async () => {
    await api.post('/settings/telegram/stop', null)
    setTgRunning(false); setTgMsg('Бот зупинено')
  }

  const revokeChat = async (chatId: string) => {
    await api.delete(`/settings/telegram/authorized/${chatId}`)
    await loadTgChats()
  }

  const fieldStyle: React.CSSProperties = {
    display: 'flex', flexDirection: 'column', gap: '0.25rem', marginBottom: '0.85rem',
  }
  const labelStyle: React.CSSProperties = { fontSize: '0.85rem', fontWeight: 500, color: '#444' }
  const inputStyle: React.CSSProperties = {
    padding: '0.4rem 0.6rem', border: '1px solid #ccc', borderRadius: '4px',
    fontSize: '0.9rem', maxWidth: '420px',
  }

  const sectionHead: React.CSSProperties = {
    fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: '0.08em', color: '#7a8899', margin: '1.5rem 0 0.75rem',
  }

  return (
    <section>
      {/* ── Параметри пекарні ── */}
      {section === 'settings_bakery' && <>
        <h3 style={{ marginTop: 0, marginBottom: '1.25rem' }}>Параметри пекарні</h3>
        <form onSubmit={handleSave}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 2rem', maxWidth: '860px' }}>
            {Object.entries(SETTINGS_LABELS).map(([key, label]) => (
              <div key={key} style={fieldStyle}>
                <label style={labelStyle}>{label}</label>
                <input
                  style={inputStyle}
                  value={form[key] ?? ''}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                />
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginTop: '0.5rem' }}>
            <button type="submit" disabled={saving} style={addBtnStyle}>
              {saving ? 'Збереження...' : 'Зберегти'}
            </button>
            {saved && <span style={{ color: '#2e7d32', fontSize: '0.9rem' }}>✓ Збережено</span>}
          </div>
        </form>

        {/* ── Додаткові функції (окремі перемикачі) ── */}
        <div style={{ marginTop: '2rem', borderTop: '1px solid #e8eef5', paddingTop: '1.25rem' }}>
          <div style={{ fontWeight: 600, color: '#1a3a5c', marginBottom: '0.75rem', fontSize: '0.9rem' }}>
            Додаткові функції
          </div>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', maxWidth: 520 }}>
            <input
              type="checkbox"
              checked={form['baking_route_reserve'] === '1'}
              onChange={(e) => {
                const val = e.target.checked ? '1' : '0'
                setForm(f => ({ ...f, baking_route_reserve: val }))
                api.put('/settings/', { baking_route_reserve: val }).catch(() => {})
              }}
              style={{ marginTop: 3, width: 16, height: 16, cursor: 'pointer' }}
            />
            <span>
              <span style={{ fontWeight: 500 }}>Резерв для маршруту у розподілі надлишків</span>
              <br />
              <span style={{ fontSize: '0.82rem', color: '#e67e22' }}>
                ⚠ Функція в розробці — увімкнення показує опцію «Маршрут (резерв)» у списку розподілу, але рух товару по маршруту ще не реалізовано.
              </span>
            </span>
          </label>
        </div>

      </>}

      {/* ── Telegram Бот ── */}
      {section === 'settings_bot' && <>
        <h3 style={{ marginTop: 0, marginBottom: '1.25rem' }}>Telegram Бот</h3>
        <div style={{ maxWidth: 520, background: '#f8fafc', border: '1px solid #dde3ea', borderRadius: 8, padding: '1rem 1.25rem' }}>

          {/* Статус */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <span style={{
              width: 10, height: 10, borderRadius: '50%',
              background: tgRunning ? '#27ae60' : '#e74c3c', display: 'inline-block',
            }} />
            <span style={{ fontWeight: 600 }}>{tgRunning ? 'Бот запущено' : 'Бот зупинено'}</span>
            {tgRunning && (
              <button onClick={stopBot} style={{ ...delBtnStyle, marginLeft: 'auto' }}>Зупинити</button>
            )}
          </div>

          {/* Токен */}
          <div style={fieldStyle}>
            <label style={labelStyle}>Bot Token (від @BotFather)</label>
            <div style={{ display: 'flex', gap: 6, maxWidth: 420 }}>
              <input
                type={showToken ? 'text' : 'password'}
                style={{ ...inputStyle, flex: 1, maxWidth: 'none' }}
                value={tgToken}
                onChange={e => setTgToken(e.target.value)}
                placeholder="1234567890:AAF..."
              />
              <button type="button" onClick={() => setShowToken(v => !v)}
                style={{ ...editBtnStyle, whiteSpace: 'nowrap' }}>
                {showToken ? 'Сховати' : 'Показати'}
              </button>
            </div>
          </div>

          {/* Дозволені телефони */}
          <div style={fieldStyle}>
            <label style={labelStyle}>Дозволені номери телефонів</label>
            <textarea
              style={{ ...inputStyle, maxWidth: 'none', width: '100%', height: 70, resize: 'vertical', fontFamily: 'monospace', fontSize: '0.85rem' }}
              value={tgPhones}
              onChange={e => setTgPhones(e.target.value)}
              placeholder="+380501234567, +380671234567"
            />
            <span style={{ fontSize: 12, color: '#888' }}>Через кому. Формат: +380XXXXXXXXX</span>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button onClick={saveTgSettings} disabled={tgSaving} style={addBtnStyle}>
              {tgSaving ? 'Збереження...' : 'Зберегти і перезапустити'}
            </button>
            {tgMsg && (
              <span style={{ fontSize: 13, color: tgMsg.startsWith('✓') ? '#27ae60' : '#e74c3c' }}>
                {tgMsg}
              </span>
            )}
          </div>

          {/* Авторизовані користувачі */}
          {tgChats.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ ...sectionHead, margin: '0 0 8px' }}>Авторизовані користувачі</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#e8eef5' }}>
                    <th style={{ padding: '5px 8px', textAlign: 'left' }}>Chat ID</th>
                    <th style={{ padding: '5px 8px', textAlign: 'left' }}>Телефон</th>
                    <th style={{ width: 60 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {tgChats.map(c => (
                    <tr key={c.chat_id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <td style={{ padding: '5px 8px', fontFamily: 'monospace' }}>{c.chat_id}</td>
                      <td style={{ padding: '5px 8px' }}>{c.phone}</td>
                      <td style={{ padding: '5px 8px', textAlign: 'center' }}>
                        <button onClick={() => revokeChat(c.chat_id)} style={delBtnStyle}
                          title="Відкликати доступ" aria-label="Відкликати доступ">✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Інструкція */}
          <details style={{ marginTop: 14, fontSize: 13, color: '#555' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Як налаштувати бота</summary>
            <ol style={{ marginTop: 8, paddingLeft: 18, lineHeight: 1.7 }}>
              <li>Напишіть <code>@BotFather</code> в Telegram → <code>/newbot</code></li>
              <li>Введіть назву та username бота (напр. <code>MyBakeryBot</code>)</li>
              <li>Скопіюйте токен у поле вище</li>
              <li>Додайте свій номер телефону в список дозволених</li>
              <li>Натисніть "Зберегти і перезапустити"</li>
              <li>Знайдіть бота в Telegram → <code>/start</code> → поділіться номером</li>
            </ol>
          </details>
        </div>
      </>}

      {/* ── Шаблони повідомлень бота ── */}
      {section === 'settings_bot_tpl' && (
        <BotTemplatesSection
          settings={settings}
          onReload={load}
          inputStyle={inputStyle}
          fieldStyle={fieldStyle}
          labelStyle={labelStyle}
          addBtnStyle={addBtnStyle}
        />
      )}

      {/* ── Система звернень ── */}
      {section === 'settings_issues' && (
        <IssuesSettingsSection
          settings={settings}
          inputStyle={inputStyle}
          fieldStyle={fieldStyle}
          labelStyle={labelStyle}
          addBtnStyle={addBtnStyle}
        />
      )}
    </section>
  )
}

// ─── Шаблони повідомлень Telegram-бота ────────────────────────────────────────

const BOT_TEMPLATES: { key: string; label: string; hint: string }[] = [
  { key: 'bot_tpl_reminder',      label: 'Нагадування про замовлення',       hint: 'Змінні: {date}' },
  { key: 'bot_tpl_deadline',      label: 'Стоп-прийом замовлень',           hint: 'Змінні: {date}' },
  { key: 'bot_tpl_confirmed',     label: 'Підтверджено оператором',          hint: 'Змінні: {product}, {qty}, {date}, {sum}' },
  { key: 'bot_tpl_rejected',      label: 'Відхилено оператором',             hint: 'Змінні: {product}, {qty}, {date}, {reason}' },
  { key: 'bot_tpl_modified',      label: 'Підтверджено зі змінами',          hint: 'Змінні: {product}, {qty}, {new_qty}, {date}, {sum}, {reason}' },
  { key: 'bot_tpl_invoice_sent',  label: 'Накладна відправлена (PDF)',       hint: 'Змінні: {date}' },
]

function BotTemplatesSection({ settings, onReload, inputStyle, fieldStyle, labelStyle, addBtnStyle }: {
  settings: SettingsMap
  onReload: () => void
  inputStyle: React.CSSProperties
  fieldStyle: React.CSSProperties
  labelStyle: React.CSSProperties
  addBtnStyle: React.CSSProperties
}) {
  const [form, setForm] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    const vals: Record<string, string> = {}
    BOT_TEMPLATES.forEach(({ key }) => { vals[key] = settings[key]?.value ?? '' })
    setForm(vals)
  }, [settings])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true); setSaved(false)
    try {
      await Promise.all(
        BOT_TEMPLATES.map(({ key }) =>
          api.put(`/settings/${key}`, { value: form[key] ?? '', description: settings[key]?.description ?? '' })
        )
      )
      setSaved(true)
      onReload()
    } finally { setSaving(false) }
  }

  return (
    <>
      <h3 style={{ marginTop: 0, marginBottom: '1.25rem' }}>Шаблони повідомлень бота</h3>
      <form onSubmit={handleSave} style={{ maxWidth: 640 }}>
        {BOT_TEMPLATES.map(({ key, label, hint }) => (
          <div key={key} style={fieldStyle}>
            <label style={labelStyle}>{label}</label>
            <textarea
              style={{ ...inputStyle, maxWidth: 'none', width: '100%', height: 64, resize: 'vertical', fontFamily: 'monospace', fontSize: '0.83rem' }}
              value={form[key] ?? ''}
              onChange={e => setForm({ ...form, [key]: e.target.value })}
            />
            <span style={{ fontSize: 11, color: '#888' }}>{hint}</span>
          </div>
        ))}
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginTop: '0.25rem' }}>
          <button type="submit" disabled={saving} style={addBtnStyle}>
            {saving ? 'Збереження...' : 'Зберегти шаблони'}
          </button>
          {saved && <span style={{ color: '#2e7d32', fontSize: '0.9rem' }}>✓ Збережено</span>}
        </div>
      </form>
    </>
  )
}

// ─── Блок налаштувань системи звернень (GitHub OAuth) ─────────────────────────

type FlowState = 'idle' | 'waiting' | 'authorized'

function IssuesSettingsSection({ settings, inputStyle, fieldStyle, labelStyle, addBtnStyle }: {
  settings:    SettingsMap
  inputStyle:  React.CSSProperties
  fieldStyle:  React.CSSProperties
  labelStyle:  React.CSSProperties
  addBtnStyle: React.CSSProperties
}) {
  const [repo,      setRepo]      = useState(settings['github_repo']?.value ?? 'TSOrest/Bakery')
  const [repoMsg,   setRepoMsg]   = useState('')
  const [ghStatus,  setGhStatus]  = useState<GitHubStatus | null>(null)
  const [flowState, setFlowState] = useState<FlowState>('idle')
  const [userCode,  setUserCode]  = useState('')
  const [verifyUri, setVerifyUri] = useState('')
  const [flowMsg,   setFlowMsg]   = useState('')
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stoppedRef = useRef(false)

  useEffect(() => {
    setRepo(settings['github_repo']?.value ?? 'TSOrest/Bakery')
  }, [settings])

  useEffect(() => {
    getGitHubStatus().then(s => {
      setGhStatus(s)
      if (s.authorized) setFlowState('authorized')
    }).catch(() => {})
  }, [])

  // Зупиняємо polling при розмонтуванні
  useEffect(() => () => {
    stoppedRef.current = true
    if (pollRef.current) clearTimeout(pollRef.current)
  }, [])

  // Рекурсивний polling — надійніший за setInterval
  const schedulePoll = (deviceCode: string, interval: number) => {
    if (stoppedRef.current) return
    pollRef.current = setTimeout(async () => {
      if (stoppedRef.current) return
      try {
        const res = await pollDeviceFlow(deviceCode)
        if (res.status === 'authorized') {
          setGhStatus({ authorized: true, login: res.login, name: res.name, avatar_url: res.avatar_url })
          setFlowState('authorized')
          setFlowMsg('✓ Авторизовано')
        } else if (res.status === 'pending') {
          schedulePoll(deviceCode, interval)  // наступний крок
        } else {
          setFlowState('idle')
          setFlowMsg(res.status === 'access_denied' ? 'Доступ відхилено' : 'Час очікування вичерпано')
        }
      } catch (e: unknown) {
        setFlowState('idle')
        setFlowMsg(e instanceof Error ? e.message : 'Помилка polling')
      }
    }, interval * 1000)
  }

  const startFlow = async () => {
    stoppedRef.current = false
    if (pollRef.current) clearTimeout(pollRef.current)
    setFlowMsg(''); setFlowState('idle')
    try {
      const data = await startDeviceFlow()
      setUserCode(data.user_code)
      setVerifyUri(data.verification_uri)
      setFlowState('waiting')
      window.open(data.verification_uri, '_blank', 'noopener')
      schedulePoll(data.device_code, data.interval)
    } catch (e: unknown) {
      setFlowMsg(e instanceof Error ? e.message : 'Помилка запуску авторизації')
    }
  }

  const logout = async () => {
    await githubLogout()
    setGhStatus({ authorized: false })
    setFlowState('idle')
    setFlowMsg('')
  }

  const saveRepo = async () => {
    setRepoMsg('')
    try {
      await api.put('/settings/github_repo', { value: repo, description: 'GitHub репозиторій (owner/repo)' })
      setRepoMsg('✓ Збережено')
    } catch { setRepoMsg('Помилка') }
  }

  return (
    <>
      <h3 style={{ marginTop: 0, marginBottom: '1.25rem' }}>Система звернень</h3>
      <div style={{ maxWidth: 520, background: '#f8fafc', border: '1px solid #dde3ea', borderRadius: 8, padding: '1rem 1.25rem' }}>

        {/* Статус авторизації */}
        {flowState === 'authorized' && ghStatus?.authorized ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            {ghStatus.avatar_url && (
              <img src={ghStatus.avatar_url} alt={ghStatus.login} style={{ width: 36, height: 36, borderRadius: '50%', border: '1px solid #d0d7de' }} />
            )}
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{ghStatus.name || ghStatus.login}</div>
              <div style={{ fontSize: 12, color: '#6e7781' }}>@{ghStatus.login}</div>
            </div>
            <span style={{ marginLeft: 'auto', fontSize: 12, color: '#27ae60', fontWeight: 600 }}>✓ Авторизовано</span>
            <button onClick={logout} style={{ ...addBtnStyle, background: '#6c757d', fontSize: 12 }}>
              Вийти
            </button>
          </div>
        ) : flowState === 'waiting' ? (
          <div style={{ marginBottom: 14, padding: '12px 14px', background: '#fff8e1', border: '1px solid #ffe082', borderRadius: 6 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Авторизація GitHub</div>
            <div style={{ fontSize: 13, marginBottom: 10 }}>
              Відкрийте <strong>{verifyUri}</strong> і введіть код:
            </div>
            <div style={{
              fontSize: 28, fontFamily: 'monospace', fontWeight: 700, letterSpacing: '0.2em',
              textAlign: 'center', padding: '10px 0', color: '#1a3a5c',
            }}>
              {userCode}
            </div>
            <div style={{ fontSize: 12, color: '#888', textAlign: 'center', marginTop: 6 }}>
              Очікуємо підтвердження...
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button
                onClick={() => window.open(verifyUri, '_blank', 'noopener')}
                style={{ ...addBtnStyle, flex: 1, textAlign: 'center' }}
              >
                Відкрити github.com/login/device ↗
              </button>
              <button
                onClick={startFlow}
                style={{ ...addBtnStyle, background: '#6c757d', whiteSpace: 'nowrap' }}
                title="Отримати новий код і почати спочатку"
              >
                Почати знову
              </button>
            </div>
          </div>
        ) : (
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#e74c3c', display: 'inline-block' }} />
              <span style={{ fontWeight: 600 }}>Не авторизовано</span>
            </div>
            <div style={{ fontSize: 12, color: '#888', marginTop: 4, marginBottom: 10 }}>
              Авторизуйте GitHub-акаунт пекарні — від його імені будуть надсилатись звернення та завантажуватись оновлення.
            </div>
            <button onClick={startFlow} style={addBtnStyle}>
              Авторизуватись через GitHub
            </button>
          </div>
        )}

        {flowMsg && (
          <div style={{ fontSize: 13, color: flowMsg.startsWith('✓') ? '#27ae60' : '#e74c3c', marginBottom: 10 }}>
            {flowMsg}
          </div>
        )}

        {/* Репозиторій */}
        <div style={fieldStyle}>
          <label style={labelStyle}>Репозиторій</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              style={{ ...inputStyle, flex: 1, maxWidth: 'none' }}
              value={repo}
              onChange={e => setRepo(e.target.value)}
              placeholder="owner/repo"
            />
            <button onClick={saveRepo} style={{ ...addBtnStyle, whiteSpace: 'nowrap' }}>
              Зберегти
            </button>
          </div>
          {repoMsg && <span style={{ fontSize: 12, color: repoMsg.startsWith('✓') ? '#27ae60' : '#e74c3c' }}>{repoMsg}</span>}
          <span style={{ fontSize: 12, color: '#888' }}>Формат: owner/repo (напр. TSOrest/Bakery)</span>
        </div>
      </div>
    </>
  )
}
