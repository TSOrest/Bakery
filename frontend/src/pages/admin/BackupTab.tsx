import { useEffect, useState, type FormEvent } from 'react'
import { api } from '../../api/client'
import { useToast } from '../../components/Toast'
import ImportPage from '../ImportPage'
import ResetDbSection from './ResetDbSection'

// ─── Вкладка Бекапи ──────────────────────────────────────────────────────────

type BackupMeta = { name: string; size_kb: number; created_at: string; app_version: string }
type ArchivePreview = { cutoff_date: string; tables: Record<string, number>; total: number }
type DemoStatus = { active: boolean; since: string | null; demo_db_exists: boolean }

export default function BackupTab() {
  const toast = useToast()
  const [form, setForm]                   = useState<Record<string, string>>({})
  const [savingSettings, setSavingSettings] = useState(false)
  const [savedSettings, setSavedSettings]   = useState(false)

  const [backups, setBackups]             = useState<BackupMeta[]>([])
  const [backingUp, setBackingUp]         = useState(false)

  const [demoStatus, setDemoStatus]       = useState<DemoStatus | null>(null)
  const [demoLoading, setDemoLoading]     = useState(false)

  const [archiveDate, setArchiveDate]     = useState('')
  const [archivePreview, setArchivePreview] = useState<ArchivePreview | null>(null)
  const [archivePreviewing, setArchivePreviewing] = useState(false)
  const [archiving, setArchiving]         = useState(false)
  const [archiveResult, setArchiveResult] = useState<{ deleted_rows: number; freed_mb: number } | null>(null)

  const [restoreModal, setRestoreModal]   = useState<{
    filename: string; backup_version: string; current_version: string
    compatible: boolean; rollback_available: boolean
  } | null>(null)

  const [showImportWizard, setShowImportWizard] = useState(false)

  const BACKUP_SETTINGS = [
    { key: 'backup_enabled',      label: 'Автобекап (0=вимк, 1=увімк)',         type: 'text' },
    { key: 'backup_time',         label: 'Час бекапу (HH:MM)',                   type: 'text' },
    { key: 'backup_keep_count',   label: 'Зберігати бекапів',                    type: 'text' },
    { key: 'backup_local_dir',    label: 'Локальна папка (порожньо = backups/)', type: 'text' },
    { key: 'backup_cloud_1_path', label: 'Google Drive папка',                   type: 'text' },
    { key: 'backup_cloud_2_path', label: 'OneDrive папка',                       type: 'text' },
    { key: 'backup_cloud_3_path', label: 'Dropbox папка',                        type: 'text' },
  ]

  type DetectedFolders = { google: string | null; onedrive: string | null; dropbox: string | null }
  const [detected, setDetected] = useState<DetectedFolders>({ google: null, onedrive: null, dropbox: null })
  const [testingCloud, setTestingCloud] = useState<string | null>(null)  // key якого зараз тестуємо

  const handleTestCloud = async (key: string, path: string) => {
    if (!path) return
    setTestingCloud(key)
    try {
      const res = await api.post<{ status: string; detail: string }>(
        '/backup/cloud/test', { path },
      )
      if (res.status === 'ok') {
        toast.success(res.detail)
      } else {
        toast.error(res.detail)
      }
    } catch (err) {
      toast.error('Не вдалось виконати перевірку: ' + String(err))
    } finally {
      setTestingCloud(null)
    }
  }

  const loadAll = async () => {
    try {
      const [cfg, bkps, demo, det] = await Promise.all([
        api.get<Record<string, { value: string }>>('/settings/'),
        api.get<BackupMeta[]>('/backup/list'),
        api.get<DemoStatus>('/backup/demo/status'),
        api.get<DetectedFolders>('/backup/cloud/detect'),
      ])
      const s: Record<string, string> = {}
      BACKUP_SETTINGS.forEach(({ key }) => { s[key] = cfg[key]?.value ?? '' })
      setForm(s)
      setBackups(bkps)
      setDemoStatus(demo)
      setDetected(det)
    } catch { /* ignore */ }
  }

  useEffect(() => { loadAll() }, []) // eslint-disable-line

  const handleSaveSettings = async (e: FormEvent) => {
    e.preventDefault()
    setSavingSettings(true); setSavedSettings(false)
    try {
      await Promise.all(
        Object.entries(form).map(([key, value]) =>
          api.put(`/settings/${key}`, { value, description: '' })
        )
      )
      setSavedSettings(true)
      setTimeout(() => setSavedSettings(false), 2000)
    } finally { setSavingSettings(false) }
  }

  const handleBackupNow = async () => {
    setBackingUp(true)
    try {
      await api.post('/backup/now', {})
      await loadAll()
    } catch (e: unknown) {
      toast.error(`Помилка бекапу: ${e instanceof Error ? e.message : String(e)}`)
    } finally { setBackingUp(false) }
  }

  const handleDeleteBackup = async (name: string) => {
    if (!confirm(`Видалити бекап ${name}?`)) return
    await api.delete(`/backup/${encodeURIComponent(name)}`)
    setBackups(prev => prev.filter(b => b.name !== name))
  }

  const handleDownloadBackup = (name: string) => {
    const a = document.createElement('a')
    a.href = `/api/v1/backup/download/${encodeURIComponent(name)}`
    a.download = name
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  const handleImportBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    const fd = new FormData()
    fd.append('file', file)
    try {
      await fetch('/api/v1/backup/upload', { method: 'POST', body: fd })
      await loadAll()
    } catch (err) {
      toast.error(`Помилка імпорту: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const handleRestoreClick = async (b: BackupMeta) => {
    const check = await api.get<{
      compatible: boolean; backup_version: string; current_version: string; rollback_available: boolean
    }>(`/backup/restore/${encodeURIComponent(b.name)}/check`)
    setRestoreModal({ filename: b.name, ...check })
  }

  const handleRestoreConfirm = async (rollback_first: boolean) => {
    if (!restoreModal) return
    setRestoreModal(null)
    await api.post(`/backup/restore/${encodeURIComponent(restoreModal.filename)}?rollback_first=${rollback_first}`, {})
    toast.info('Запит на відновлення надіслано. Сервер незабаром перезапуститься.')
  }

  const handleDemoEnter = async () => {
    if (!confirm('Увійти в демо режим?\n\nПоточна база буде збережена. Для виходу натисніть "Вийти з демо режиму".')) return
    setDemoLoading(true)
    try {
      await api.post('/backup/demo/enter', {})
      toast.info('Запит надіслано. Сервер перезапускається в демо режимі...')
      setTimeout(loadAll, 5000)
    } catch (e: unknown) {
      toast.error(`Помилка: ${e instanceof Error ? e.message : String(e)}`)
    } finally { setDemoLoading(false) }
  }

  const handleDemoExit = async () => {
    if (!confirm('Вийти з демо режиму?\n\nБуде відновлена робоча база даних.')) return
    setDemoLoading(true)
    try {
      await api.post('/backup/demo/exit', {})
      toast.info('Запит надіслано. Сервер перезапускається...')
      setTimeout(loadAll, 5000)
    } catch (e: unknown) {
      toast.error(`Помилка: ${e instanceof Error ? e.message : String(e)}`)
    } finally { setDemoLoading(false) }
  }

  const handleArchivePreview = async () => {
    if (!archiveDate) return
    setArchivePreviewing(true); setArchivePreview(null)
    try {
      const data = await api.get<ArchivePreview>(`/backup/archive/preview?cutoff_date=${archiveDate}`)
      setArchivePreview(data)
    } catch (e: unknown) {
      toast.error(`Помилка: ${e instanceof Error ? e.message : String(e)}`)
    } finally { setArchivePreviewing(false) }
  }

  const handleArchiveRun = async () => {
    if (!archivePreview) return
    if (!confirm(`Видалити ${archivePreview.total} записів до ${archiveDate}?\n\nПеред архівуванням буде зроблено бекап.`)) return
    setArchiving(true); setArchiveResult(null)
    try {
      const result = await api.post<{ deleted_rows: number; freed_mb: number }>(
        `/backup/archive?cutoff_date=${archiveDate}`, {}
      )
      setArchiveResult(result)
      setArchivePreview(null)
      await loadAll()
    } catch (e: unknown) {
      toast.error(`Помилка архівування: ${e instanceof Error ? e.message : String(e)}`)
    } finally { setArchiving(false) }
  }

  const s: React.CSSProperties = { fontSize: '0.85rem' }
  const inputS: React.CSSProperties = {
    border: '1px solid #d0d8e4', borderRadius: 4, padding: '0.3rem 0.5rem',
    fontSize: '0.85rem', width: '100%', boxSizing: 'border-box',
  }
  const sectionS: React.CSSProperties = {
    background: '#f8fafc', border: '1px solid #dce6f0', borderRadius: 8,
    padding: '1rem 1.25rem', marginBottom: '1.25rem',
  }
  const h3S: React.CSSProperties = { margin: '0 0 0.75rem', fontSize: '0.9rem', color: '#2c3e50' }
  const btnS: React.CSSProperties = {
    background: '#3498db', color: '#fff', border: 'none', borderRadius: 5,
    padding: '0.35rem 0.9rem', cursor: 'pointer', fontSize: '0.85rem',
  }

  return (
    <section style={{ maxWidth: 780, padding: '0.5rem 0' }}>

      {/* ── 1. Налаштування бекапів ── */}
      <div style={sectionS}>
        <h3 style={h3S}>Налаштування автобекапу</h3>
        <form onSubmit={handleSaveSettings}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem 1rem' }}>
            {BACKUP_SETTINGS.map(({ key, label }) => (
              <div key={key}>
                <div style={{ ...s, color: '#666', marginBottom: 2 }}>{label}</div>
                <input style={inputS} value={form[key] ?? ''} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} />
              </div>
            ))}
          </div>
          <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button type="submit" style={btnS} disabled={savingSettings}>
              {savingSettings ? 'Збереження...' : 'Зберегти'}
            </button>
            {savedSettings && <span style={{ color: '#27ae60', fontSize: '0.82rem' }}>✓ Збережено</span>}
          </div>
        </form>
      </div>

      {/* ── 2. Хмарна синхронізація через sync-папки ── */}
      <div style={sectionS}>
        <h3 style={h3S}>Хмарне резервне копіювання</h3>
        <p style={{ fontSize: '0.82rem', color: '#64748b', marginBottom: 12 }}>
          Встановіть desktop-клієнт Google Drive, OneDrive або Dropbox — вони синхронізують локальну папку з хмарою.
          Вкажіть шлях до цієї папки нижче, і бекапи копіюватимуться туди автоматично.
        </p>
        {([
          { id: 'google',   key: 'backup_cloud_1_path', label: 'Google Drive', icon: '🟦',
            hint: 'Зазвичай: C:\\Users\\Ім\'я\\Google Drive' },
          { id: 'onedrive', key: 'backup_cloud_2_path', label: 'OneDrive',     icon: '🟪',
            hint: 'Зазвичай: C:\\Users\\Ім\'я\\OneDrive' },
          { id: 'dropbox',  key: 'backup_cloud_3_path', label: 'Dropbox',      icon: '🟦',
            hint: 'Зазвичай: C:\\Users\\Ім\'я\\Dropbox' },
        ] as const).map(p => {
          const detectedPath = detected[p.id as keyof DetectedFolders]
          const currentPath = form[p.key] ?? ''
          return (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #eef2f7' }}>
              <span style={{ fontSize: 20 }}>{p.icon}</span>
              <div style={{ width: 100, flexShrink: 0 }}>
                <strong style={{ fontSize: '0.88rem' }}>{p.label}</strong>
              </div>
              <div style={{ flex: 1 }}>
                <input
                  type="text"
                  value={currentPath}
                  placeholder={detectedPath ?? p.hint}
                  style={{ ...inputS, width: '100%', boxSizing: 'border-box' }}
                  onChange={e => setForm(f => ({ ...f, [p.key]: e.target.value }))}
                />
              </div>
              {detectedPath && !currentPath && (
                <button
                  style={{ ...btnS, background: '#16a34a', padding: '0.2rem 0.7rem', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
                  onClick={() => setForm(f => ({ ...f, [p.key]: detectedPath }))}
                  title={detectedPath}
                >
                  ✓ Виявлено
                </button>
              )}
              {currentPath && (
                <>
                  <button
                    style={{ ...btnS, background: '#3b82f6', padding: '0.2rem 0.6rem', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
                    onClick={() => handleTestCloud(p.key, currentPath)}
                    disabled={testingCloud === p.key}
                    title="Перевірити доступність папки"
                  >
                    {testingCloud === p.key ? '...' : '🔍 Перевірити'}
                  </button>
                  <button
                    style={{ ...btnS, background: '#e74c3c', padding: '0.2rem 0.6rem', fontSize: '0.8rem' }}
                    onClick={() => setForm(f => ({ ...f, [p.key]: '' }))}
                    title="Вимкнути синхронізацію"
                  >
                    ✕
                  </button>
                </>
              )}
            </div>
          )
        })}
        <p style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: 8 }}>
          Після зміни натисніть "Зберегти налаштування" у секції вище. Бекапи також зберігаються у вказаних папках.
        </p>
      </div>

      {/* ── 2. Бекапи ── */}
      <div style={sectionS}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <h3 style={{ ...h3S, margin: 0 }}>Резервні копії</h3>
          <div style={{ display: 'flex', gap: 8 }}>
            <label style={{ ...btnS, background: '#27ae60', cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }}>
              📂 Імпортувати
              <input type="file" accept=".db" style={{ display: 'none' }} onChange={handleImportBackup} />
            </label>
            <button style={btnS} onClick={handleBackupNow} disabled={backingUp}>
              {backingUp ? 'Зберігання...' : '+ Зробити бекап зараз'}
            </button>
            <button
              style={{ ...btnS, background: '#7c3aed' }}
              onClick={() => setShowImportWizard(true)}
            >
              📥 Імпорт з Access
            </button>
          </div>
        </div>
        {backups.length === 0 && (
          <div style={{ ...s, color: '#aaa' }}>Бекапів ще немає</div>
        )}
        {backups.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #dce6f0' }}>
                <th style={{ textAlign: 'left', padding: '0.3rem 0.5rem', color: '#666', fontWeight: 500 }}>Файл</th>
                <th style={{ textAlign: 'right', padding: '0.3rem 0.5rem', color: '#666', fontWeight: 500 }}>Розмір</th>
                <th style={{ textAlign: 'center', padding: '0.3rem 0.5rem', color: '#666', fontWeight: 500 }}>Версія</th>
                <th style={{ padding: '0.3rem 0.5rem' }}></th>
              </tr>
            </thead>
            <tbody>
              {backups.map(b => (
                <tr key={b.name} style={{ borderBottom: '1px solid #eef2f7' }}>
                  <td style={{ padding: '0.3rem 0.5rem' }}>
                    {b.name.replace('bakery_', '').replace('.db', '')}
                    {b.created_at && <span style={{ color: '#aaa', marginLeft: 6 }}>{b.created_at.slice(0, 16).replace('T', ' ')}</span>}
                  </td>
                  <td style={{ padding: '0.3rem 0.5rem', textAlign: 'right', color: '#555' }}>
                    {b.size_kb >= 1024 ? `${(b.size_kb / 1024).toFixed(1)} MB` : `${b.size_kb} KB`}
                  </td>
                  <td style={{ padding: '0.3rem 0.5rem', textAlign: 'center', color: '#888' }}>
                    {b.app_version || '—'}
                  </td>
                  <td style={{ padding: '0.3rem 0.5rem', textAlign: 'right', display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    <button
                      style={{ ...btnS, background: '#27ae60', padding: '0.2rem 0.6rem' }}
                      onClick={() => handleDownloadBackup(b.name)}
                      title="Зберегти файл бекапу"
                    >⬇ Зберегти</button>
                    <button
                      style={{ ...btnS, background: '#6c8ebf', padding: '0.2rem 0.6rem' }}
                      onClick={() => handleRestoreClick(b)}
                    >↩ Відновити</button>
                    <button
                      style={{ ...btnS, background: '#e74c3c', padding: '0.2rem 0.6rem' }}
                      onClick={() => handleDeleteBackup(b.name)}
                    >🗑</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── 3. Демо режим ── */}
      <div style={sectionS}>
        <h3 style={h3S}>Демо режим</h3>
        {demoStatus?.active ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <span style={{ background: '#f39c12', color: '#fff', padding: '0.2rem 0.7rem',
              borderRadius: 12, fontWeight: 600, fontSize: '0.82rem' }}>
              ⚡ АКТИВНИЙ{demoStatus.since ? ` (з ${demoStatus.since.slice(11, 16)})` : ''}
            </span>
            <button style={{ ...btnS, background: '#e74c3c' }} onClick={handleDemoExit} disabled={demoLoading}>
              {demoLoading ? 'Виконується...' : '■ Вийти з демо режиму'}
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <span style={{ ...s, color: '#888' }}>● Неактивний</span>
            <button style={btnS} onClick={handleDemoEnter} disabled={demoLoading || !demoStatus?.demo_db_exists}>
              {demoLoading ? 'Виконується...' : '▶ Увійти в демо режим'}
            </button>
            {!demoStatus?.demo_db_exists && (
              <span style={{ ...s, color: '#e74c3c' }}>
                demo.db відсутня — спочатку згенеруйте:
                <code style={{ background: '#f0f4f8', padding: '0 4px', borderRadius: 3, marginLeft: 4, fontSize: '0.8rem' }}>
                  python scripts/generate_demo_db.py
                </code>
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── 4. Архівування ── */}
      <div style={sectionS}>
        <h3 style={h3S}>Архівування старих даних</h3>
        <p style={{ ...s, color: '#666', marginBottom: '0.75rem', lineHeight: 1.5 }}>
          Видаляє записи старші за вказану дату. Фінансові баланси клієнтів зберігаються у
          вигляді snapshot-запису. Перед виконанням автоматично робиться бекап.
        </p>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <div style={{ ...s, color: '#666', marginBottom: 2 }}>Архівувати дані до (не включно)</div>
            <input
              type="date"
              style={{ ...inputS, width: 160 }}
              value={archiveDate}
              onChange={e => { setArchiveDate(e.target.value); setArchivePreview(null); setArchiveResult(null) }}
            />
          </div>
          <button style={{ ...btnS, background: '#6c8ebf' }} onClick={handleArchivePreview}
            disabled={!archiveDate || archivePreviewing}>
            {archivePreviewing ? 'Перевірка...' : 'Перевірити'}
          </button>
        </div>

        {archivePreview && (
          <div style={{ marginTop: '0.75rem', background: '#fff8e1', border: '1px solid #f0c040',
            borderRadius: 6, padding: '0.75rem', fontSize: '0.82rem' }}>
            <strong style={{ color: '#b7860a' }}>⚠ Буде видалено {archivePreview.total} записів:</strong>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem 1.2rem', marginTop: '0.4rem', color: '#555' }}>
              {Object.entries(archivePreview.tables).filter(([, n]) => n > 0).map(([t, n]) => (
                <span key={t}>{t}: {n}</span>
              ))}
            </div>
            <button style={{ ...btnS, background: '#e74c3c', marginTop: '0.75rem' }}
              onClick={handleArchiveRun} disabled={archiving}>
              {archiving ? 'Архівування...' : 'Архівувати зараз'}
            </button>
          </div>
        )}

        {archiveResult && (
          <div style={{ marginTop: '0.75rem', background: '#eafaf1', border: '1px solid #82e0aa',
            borderRadius: 6, padding: '0.6rem 0.75rem', fontSize: '0.82rem', color: '#1e8449' }}>
            ✓ Видалено {archiveResult.deleted_rows} записів
            {archiveResult.freed_mb > 0 && `, звільнено ${archiveResult.freed_mb} MB`}
          </div>
        )}
      </div>

      {/* ── 5. Скидання бази даних ── */}
      <ResetDbSection />

      {/* ── Майстер імпорту з Access (full-screen modal) ── */}
      {showImportWizard && (
        <ImportPage onClose={() => setShowImportWizard(false)} />
      )}

      {/* ── Модальне вікно відновлення ── */}
      {restoreModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
        }} onClick={() => setRestoreModal(null)}>
          <div style={{
            background: '#fff', borderRadius: 10, padding: '1.5rem', maxWidth: 420, width: '90%',
            boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
          }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 0.75rem', fontSize: '1rem' }}>Відновлення бекапу</h3>
            <p style={{ ...s, lineHeight: 1.6, color: '#444' }}>
              <strong>{restoreModal.filename.replace('bakery_', '').replace('.db', '')}</strong>
            </p>
            {!restoreModal.compatible ? (
              <div style={{ background: '#fff3cd', border: '1px solid #ffc107', borderRadius: 6,
                padding: '0.6rem 0.75rem', marginBottom: '0.75rem', fontSize: '0.82rem' }}>
                ⚠ Бекап з версії <strong>{restoreModal.backup_version}</strong>, поточна <strong>{restoreModal.current_version}</strong>.
                Можлива несумісність схеми БД.
              </div>
            ) : (
              <div style={{ ...s, color: '#27ae60', marginBottom: '0.75rem' }}>
                ✓ Версія збігається ({restoreModal.current_version})
              </div>
            )}
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button style={btnS} onClick={() => handleRestoreConfirm(false)}>
                Відновити
              </button>
              {!restoreModal.compatible && (
                <button
                  style={{ ...btnS, background: restoreModal.rollback_available ? '#e67e22' : '#bbb',
                    cursor: restoreModal.rollback_available ? 'pointer' : 'not-allowed' }}
                  onClick={() => restoreModal.rollback_available && handleRestoreConfirm(true)}
                  title={!restoreModal.rollback_available ? 'Git-тег недоступний' : 'Відкатить версію програми, потім відновить БД'}
                >
                  Відкотити версію і відновити
                </button>
              )}
              <button style={{ ...btnS, background: '#aaa' }} onClick={() => setRestoreModal(null)}>Скасувати</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
