import { useState, useEffect } from 'react'
import { fetchIssues, createIssue, fetchComments, addComment, Issue, IssueComment, IssueCreate } from '../api/issues'
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

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('uk-UA', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// ─── Розгорнута картка звернення з коментарями ────────────────────────────────

function IssueDetail({ issue }: { issue: Issue }) {
  const [comments,     setComments]     = useState<IssueComment[]>([])
  const [loadingCom,   setLoadingCom]   = useState(false)
  const [replyText,    setReplyText]    = useState('')
  const [sending,      setSending]      = useState(false)
  const [sendErr,      setSendErr]      = useState('')

  useEffect(() => {
    if (issue.comments === 0) return
    setLoadingCom(true)
    fetchComments(issue.number)
      .then(setComments)
      .finally(() => setLoadingCom(false))
  }, [issue.number, issue.comments])

  async function handleReply() {
    if (!replyText.trim()) return
    setSending(true); setSendErr('')
    try {
      await addComment(issue.number, replyText.trim())
      setReplyText('')
      // reload comments
      const updated = await fetchComments(issue.number)
      setComments(updated)
    } catch {
      setSendErr('Не вдалося надіслати. Перевірте підключення.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className={styles.issueBody}>
      {/* Оригінальний текст */}
      <div className={styles.messageBlock}>
        <div className={styles.messageHeader}>
          <span className={styles.messageAuthor}>Ваше звернення</span>
          <span className={styles.messageDate}>{formatDateTime(issue.created_at)}</span>
        </div>
        <pre className={styles.issueBodyText}>{issue.body || '—'}</pre>
      </div>

      {/* Коментарі */}
      {loadingCom && <p className={styles.hint} style={{ padding: '8px 0' }}>Завантаження відповідей...</p>}

      {comments.map(c => (
        <div key={c.id} className={`${styles.messageBlock} ${styles.messageReply}`}>
          <div className={styles.messageHeader}>
            <span className={styles.messageAuthor}>Відповідь розробника</span>
            <span className={styles.messageDate}>{formatDateTime(c.created_at)}</span>
          </div>
          <pre className={styles.issueBodyText}>{c.body}</pre>
        </div>
      ))}

      {/* Форма відповіді (тільки для відкритих або якщо є коментарі для уточнення) */}
      <div className={styles.replyForm}>
        <textarea
          className={styles.textarea}
          rows={3}
          placeholder="Уточнення або додаткова інформація..."
          value={replyText}
          onChange={e => setReplyText(e.target.value)}
        />
        {sendErr && <p className={styles.error}>{sendErr}</p>}
        <button
          className={styles.replyBtn}
          onClick={handleReply}
          disabled={sending || !replyText.trim()}
        >
          {sending ? 'Надсилаємо...' : 'Надіслати уточнення'}
        </button>
      </div>
    </div>
  )
}

// ─── Головний віджет ──────────────────────────────────────────────────────────

export default function IssuesWidget() {
  const [open,     setOpen]     = useState(false)
  const [tab,      setTab]      = useState<Tab>('new')
  const [issues,   setIssues]   = useState<Issue[]>([])
  const [loading,  setLoading]  = useState(false)
  const [sending,  setSending]  = useState(false)
  const [error,    setError]    = useState('')
  const [success,  setSuccess]  = useState('')
  const [expanded, setExpanded] = useState<number | null>(null)

  const [form, setForm] = useState<IssueCreate>({
    title: '', body: '', issue_type: 'bug',
  })

  useEffect(() => {
    if (open && tab === 'list') loadIssues()
  }, [open, tab])

  async function loadIssues() {
    setLoading(true); setError('')
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
    setSending(true); setError(''); setSuccess('')
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

  function toggleExpand(number: number) {
    setExpanded(prev => prev === number ? null : number)
  }

  return (
    <>
      <button
        className={styles.fab}
        onClick={() => { setOpen(true); setSuccess(''); setError('') }}
        title="Звернення та підтримка"
      >
        💬
      </button>

      {open && (
        <div className={styles.backdrop} onClick={() => setOpen(false)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>

            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>Підтримка</h2>
              <button className={styles.closeBtn} onClick={() => setOpen(false)}>✕</button>
            </div>

            <div className={styles.tabs}>
              <button
                className={`${styles.tabBtn} ${tab === 'new' ? styles.tabActive : ''}`}
                onClick={() => setTab('new')}
              >Нове звернення</button>
              <button
                className={`${styles.tabBtn} ${tab === 'list' ? styles.tabActive : ''}`}
                onClick={() => setTab('list')}
              >Мої звернення</button>
            </div>

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
                      onClick={() => toggleExpand(issue.number)}
                    >
                      <span className={`${styles.badge} ${issue.state === 'open' ? styles.badgeOpen : styles.badgeClosed}`}>
                        {STATE_LABEL[issue.state] ?? issue.state}
                      </span>
                      <span className={styles.issueTitle}>#{issue.number} {issue.title}</span>
                      <span className={styles.issueDate}>{formatDate(issue.created_at)}</span>
                      {issue.comments > 0 && (
                        <span className={styles.commentCount} title="Є відповіді">
                          💬 {issue.comments}
                        </span>
                      )}
                      <span className={styles.chevron}>{expanded === issue.number ? '▲' : '▼'}</span>
                    </div>
                    {expanded === issue.number && <IssueDetail issue={issue} />}
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
