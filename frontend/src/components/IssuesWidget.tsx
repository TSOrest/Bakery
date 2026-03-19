import { useState, useEffect } from 'react'
import { fetchIssues, createIssue, Issue, IssueCreate } from '../api/issues'
import styles from './IssuesWidget.module.css'

type Tab = 'new' | 'list'

const TYPE_OPTIONS = [
  { value: 'bug',        label: '🐛 Помилка' },
  { value: 'suggestion', label: '💡 Пропозиція' },
  { value: 'question',   label: '❓ Питання' },
]

const STATE_LABEL: Record<string, string> = {
  open:   'відкрито',
  closed: 'вирішено',
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('uk-UA', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  })
}

export default function IssuesWidget() {
  const [open,    setOpen]    = useState(false)
  const [tab,     setTab]     = useState<Tab>('new')
  const [issues,  setIssues]  = useState<Issue[]>([])
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [error,   setError]   = useState('')
  const [success, setSuccess] = useState('')
  const [expanded, setExpanded] = useState<number | null>(null)

  const [form, setForm] = useState<IssueCreate>({
    title: '', body: '', issue_type: 'bug',
  })

  useEffect(() => {
    if (open && tab === 'list') loadIssues()
  }, [open, tab])

  async function loadIssues() {
    setLoading(true)
    setError('')
    try {
      setIssues(await fetchIssues())
    } catch {
      setError('Не вдалося завантажити звернення')
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.title.trim() || !form.body.trim()) return
    setSending(true)
    setError('')
    setSuccess('')
    try {
      await createIssue(form)
      setSuccess('Звернення надіслано! Ми розглянемо його найближчим часом.')
      setForm({ title: '', body: '', issue_type: 'bug' })
    } catch {
      setError('Помилка надсилання. Перевірте підключення до інтернету.')
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      {/* Floating button */}
      <button
        className={styles.fab}
        onClick={() => { setOpen(true); setSuccess(''); setError('') }}
        title="Звернення та підтримка"
      >
        💬
      </button>

      {/* Modal */}
      {open && (
        <div className={styles.backdrop} onClick={() => setOpen(false)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>Підтримка</h2>
              <button className={styles.closeBtn} onClick={() => setOpen(false)}>✕</button>
            </div>

            {/* Tabs */}
            <div className={styles.tabs}>
              <button
                className={`${styles.tabBtn} ${tab === 'new' ? styles.tabActive : ''}`}
                onClick={() => setTab('new')}
              >Нове звернення</button>
              <button
                className={`${styles.tabBtn} ${tab === 'list' ? styles.tabActive : ''}`}
                onClick={() => setTab('list')}
              >Всі звернення</button>
            </div>

            {/* Tab: New issue */}
            {tab === 'new' && (
              <form onSubmit={handleSubmit} className={styles.form}>
                <label className={styles.label}>
                  Тип
                  <select
                    className={styles.select}
                    value={form.issue_type}
                    onChange={e => setForm(f => ({ ...f, issue_type: e.target.value as IssueCreate['issue_type'] }))}
                  >
                    {TYPE_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </label>

                <label className={styles.label}>
                  Заголовок
                  <input
                    className={styles.input}
                    type="text"
                    placeholder="Коротко опишіть проблему або пропозицію"
                    value={form.title}
                    onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                    required
                  />
                </label>

                <label className={styles.label}>
                  Опис
                  <textarea
                    className={styles.textarea}
                    placeholder="Детальний опис: що сталось, які кроки призвели до проблеми, що очікувалось..."
                    rows={5}
                    value={form.body}
                    onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
                    required
                  />
                </label>

                {error   && <p className={styles.error}>{error}</p>}
                {success && <p className={styles.success}>{success}</p>}

                <button
                  type="submit"
                  className={styles.submitBtn}
                  disabled={sending || !form.title.trim() || !form.body.trim()}
                >
                  {sending ? 'Надсилаємо...' : 'Надіслати'}
                </button>
              </form>
            )}

            {/* Tab: Issues list */}
            {tab === 'list' && (
              <div className={styles.list}>
                {loading && <p className={styles.hint}>Завантаження...</p>}
                {error   && <p className={styles.error}>{error}</p>}
                {!loading && !error && issues.length === 0 && (
                  <p className={styles.hint}>Звернень поки немає</p>
                )}
                {issues.map(issue => (
                  <div key={issue.number} className={styles.issueCard}>
                    <div
                      className={styles.issueHeader}
                      onClick={() => setExpanded(expanded === issue.number ? null : issue.number)}
                    >
                      <span className={`${styles.badge} ${issue.state === 'open' ? styles.badgeOpen : styles.badgeClosed}`}>
                        {STATE_LABEL[issue.state] ?? issue.state}
                      </span>
                      <span className={styles.issueTitle}>#{issue.number} {issue.title}</span>
                      <span className={styles.issueDate}>{formatDate(issue.created_at)}</span>
                    </div>
                    {expanded === issue.number && (
                      <div className={styles.issueBody}>
                        <pre className={styles.issueBodyText}>{issue.body || '—'}</pre>
                        <a href={issue.url} target="_blank" rel="noreferrer" className={styles.ghLink}>
                          Відкрити на GitHub ↗
                        </a>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
