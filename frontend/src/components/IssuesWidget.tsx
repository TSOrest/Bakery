import { useState, useEffect, useRef, useCallback } from 'react'
import {
  fetchIssues, createIssue, fetchComments, addComment, uploadAsset,
  Issue, IssueComment, IssueCreate,
} from '../api/issues'
import styles from './IssuesWidget.module.css'

type Tab = 'new' | 'list'

const TYPE_OPTIONS = [
  { value: 'bug',        label: '🐛 Помилка' },
  { value: 'suggestion', label: '💡 Пропозиція' },
  { value: 'question',   label: '❓ Питання' },
]
const TYPE_COLORS: Record<string, string> = {
  bug: '#cf222e', enhancement: '#0969da', question: '#8250df',
}
const LABEL_UA: Record<string, string> = {
  'client-report': '', bug: 'Помилка', enhancement: 'Пропозиція', question: 'Питання',
}

function relativeTime(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60)   return 'щойно'
  if (diff < 3600) return `${Math.floor(diff / 60)} хв тому`
  if (diff < 86400) return `${Math.floor(diff / 3600)} год тому`
  return new Date(iso).toLocaleDateString('uk-UA', { day: '2-digit', month: 'short', year: 'numeric' })
}

function absDate(iso: string) {
  return new Date(iso).toLocaleString('uk-UA', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function getSystemInfo(): string {
  const page    = window.location.pathname
  const ua      = navigator.userAgent.match(/(Chrome|Firefox|Safari|Edge)\/[\d.]+/)?.[0] ?? 'Браузер невідомий'
  const time    = new Date().toLocaleString('uk-UA')
  return `\n\n---\n<details>\n<summary>Системна інформація</summary>\n\n- **Сторінка:** \`${page}\`\n- **Браузер:** ${ua}\n- **Час:** ${time}\n</details>`
}

// ─── Markdown renderer (мінімальний) ──────────────────────────────────────────
// Рендеримо лише базові елементи які GitHub використовує в issues
function renderMarkdown(text: string) {
  // images: ![alt](url)
  let html = text
    .replace(/!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g,
      (_, alt, url) => `<img src="${url}" alt="${alt}" style="max-width:100%;border-radius:6px;margin-top:8px;" />`)
    // bold: **text**
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    // inline code: `code`
    .replace(/`([^`]+)`/g, '<code style="background:#f6f8fa;padding:2px 5px;border-radius:4px;font-size:0.85em;">$1</code>')
    // details/summary block — pass through as HTML
    // horizontal rule
    .replace(/^---$/gm, '<hr style="border:none;border-top:1px solid #d0d7de;margin:12px 0;" />')
    // line breaks
    .replace(/\n/g, '<br />')

  return <span dangerouslySetInnerHTML={{ __html: html }} />
}

// ─── Avatar ───────────────────────────────────────────────────────────────────
function Avatar({ name, color }: { name: string; color: string }) {
  return (
    <div className={styles.avatar} style={{ background: color }}>
      {name[0].toUpperCase()}
    </div>
  )
}

// ─── Один коментар у стилі GitHub ─────────────────────────────────────────────
function CommentCard({
  body, createdAt, isAuthor,
}: { body: string; createdAt: string; isAuthor: boolean }) {
  return (
    <div className={`${styles.commentCard} ${isAuthor ? styles.commentCardAuthor : styles.commentCardDev}`}>
      <div className={styles.commentHeader}>
        <strong className={styles.commentAuthorName}>
          {isAuthor ? 'Ви' : 'Розробник'}
        </strong>
        {!isAuthor && <span className={styles.devBadge}>Розробник</span>}
        <span className={styles.commentTime} title={absDate(createdAt)}>
          {relativeTime(createdAt)}
        </span>
      </div>
      <div className={styles.commentBody}>
        {renderMarkdown(body)}
      </div>
    </div>
  )
}

// ─── Розгорнуте обговорення ────────────────────────────────────────────────────
const OWNER_LOGIN = 'TSOrest'  // GitHub login розробника

function IssueThread({ issue, onReload }: { issue: Issue; onReload: () => void }) {
  const [comments,   setComments]   = useState<IssueComment[]>([])
  const [loading,    setLoading]    = useState(false)
  const [replyText,  setReplyText]  = useState('')
  const [screenshot, setScreenshot] = useState<File | null>(null)
  const [preview,    setPreview]    = useState<string | null>(null)
  const [sending,    setSending]    = useState(false)
  const [uploading,  setUploading]  = useState(false)
  const [err,        setErr]        = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setLoading(true)
    fetchComments(issue.number)
      .then(setComments)
      .finally(() => setLoading(false))
  }, [issue.number])

  const attachImage = useCallback((file: File) => {
    setScreenshot(file)
    setPreview(URL.createObjectURL(file))
  }, [])

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    for (const item of e.clipboardData.items) {
      if (item.type.startsWith('image/')) {
        const f = item.getAsFile()
        if (f) attachImage(f)
      }
    }
  }, [attachImage])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) attachImage(f)
  }

  const removeScreenshot = () => {
    setScreenshot(null)
    if (preview) URL.revokeObjectURL(preview)
    setPreview(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function handleReply() {
    if (!replyText.trim() && !screenshot) return
    setSending(true); setErr('')
    try {
      let body = replyText.trim()

      if (screenshot) {
        setUploading(true)
        try {
          const { markdown } = await uploadAsset(screenshot)
          body = body ? `${body}\n\n${markdown}` : markdown
        } catch {
          body = body
            ? `${body}\n\n> ⚠️ Скріншот не вдалося завантажити`
            : '> ⚠️ Скріншот не вдалося завантажити'
        } finally {
          setUploading(false)
        }
      }

      await addComment(issue.number, body)
      setReplyText(''); removeScreenshot()
      const updated = await fetchComments(issue.number)
      setComments(updated)
      onReload()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Помилка надсилання')
    } finally {
      setSending(false)
    }
  }

  const typeLabel = issue.labels.find(l => l !== 'client-report') ?? ''

  return (
    <div className={styles.thread}>
      {/* Заголовок issue */}
      <div className={styles.threadTitle}>
        <h3 className={styles.issueName}>#{issue.number} {issue.title}</h3>
        <div className={styles.threadMeta}>
          <span className={`${styles.stateBadge} ${issue.state === 'open' ? styles.stateOpen : styles.stateClosed}`}>
            {issue.state === 'open' ? '● Відкрито' : '✓ Вирішено'}
          </span>
          {typeLabel && LABEL_UA[typeLabel] && (
            <span className={styles.typeLabel} style={{ background: TYPE_COLORS[typeLabel] ?? '#6e7781' }}>
              {LABEL_UA[typeLabel]}
            </span>
          )}
        </div>
      </div>

      {/* Тіло звернення */}
      <div className={styles.timelineItem}>
        <Avatar name="В" color="#0969da" />
        <CommentCard body={issue.body || '—'} createdAt={issue.created_at} isAuthor={true} />
      </div>

      {/* Коментарі */}
      {loading && <p className={styles.loadingHint}>Завантаження відповідей...</p>}
      {comments.map(c => (
        <div key={c.id} className={styles.timelineItem}>
          <Avatar
            name={c.author === OWNER_LOGIN ? 'Р' : c.author[0]}
            color={c.author === OWNER_LOGIN ? '#6e40c9' : '#0969da'}
          />
          <CommentCard
            body={c.body}
            createdAt={c.created_at}
            isAuthor={c.author !== OWNER_LOGIN}
          />
        </div>
      ))}

      {/* Закрито-банер */}
      {issue.state === 'closed' && (
        <div className={styles.closedBanner}>
          ✓ Це звернення вирішено. Якщо проблема залишилась — напишіть уточнення нижче.
        </div>
      )}

      {/* Форма відповіді */}
      <div className={styles.timelineItem}>
        <Avatar name="В" color="#0969da" />
        <div className={styles.replyBox} onPaste={handlePaste}>
          <div className={styles.replyHeader}>Уточнення або додаткова інформація</div>
          <textarea
            className={styles.replyTextarea}
            rows={3}
            placeholder="Напишіть відповідь... (Ctrl+V для вставки скріншоту)"
            value={replyText}
            onChange={e => setReplyText(e.target.value)}
          />
          {preview && (
            <div className={styles.previewWrap}>
              <img src={preview} alt="screenshot" className={styles.previewImg} />
              <button className={styles.removeImg} onClick={removeScreenshot}>✕</button>
            </div>
          )}
          {err && <p className={styles.inlineErr}>{err}</p>}
          <div className={styles.replyFooter}>
            <button
              className={styles.attachBtn}
              type="button"
              onClick={() => fileRef.current?.click()}
              title="Прикріпити зображення"
            >
              📎 Скріншот
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
            <button
              className={styles.replySubmitBtn}
              onClick={handleReply}
              disabled={sending || (!replyText.trim() && !screenshot)}
            >
              {uploading ? 'Завантаження...' : sending ? 'Надсилаємо...' : 'Надіслати'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Головний віджет ──────────────────────────────────────────────────────────

export default function IssuesWidget() {
  const [open,      setOpen]      = useState(false)
  const [tab,       setTab]       = useState<Tab>('new')
  const [issues,    setIssues]    = useState<Issue[]>([])
  const [loading,   setLoading]   = useState(false)
  const [sending,   setSending]   = useState(false)
  const [error,     setError]     = useState('')
  const [success,   setSuccess]   = useState('')
  const [activeNum, setActiveNum] = useState<number | null>(null)
  const [screenshot, setScreenshot] = useState<File | null>(null)
  const [preview,    setPreview]    = useState<string | null>(null)
  const [uploading,  setUploading]  = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const [form, setForm] = useState<IssueCreate>({ title: '', body: '', issue_type: 'bug' })

  useEffect(() => {
    if (open && tab === 'list') loadIssues()
  }, [open, tab])

  async function loadIssues() {
    setLoading(true); setError('')
    try { setIssues(await fetchIssues()) }
    catch { setError('Не вдалося завантажити звернення') }
    finally { setLoading(false) }
  }

  const attachImage = (file: File) => {
    setScreenshot(file)
    setPreview(URL.createObjectURL(file))
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    for (const item of e.clipboardData.items) {
      if (item.type.startsWith('image/')) {
        const f = item.getAsFile()
        if (f) attachImage(f)
      }
    }
  }

  const removeScreenshot = () => {
    setScreenshot(null)
    if (preview) URL.revokeObjectURL(preview)
    setPreview(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.title.trim()) return
    setSending(true); setError(''); setSuccess('')
    try {
      let body = form.body + getSystemInfo()
      let imageWarning = ''

      if (screenshot) {
        setUploading(true)
        try {
          const { markdown } = await uploadAsset(screenshot)
          body += `\n\n${markdown}`
        } catch {
          imageWarning = ' Скріншот не вдалося завантажити — потрібні права Contents: Write у токені.'
          body += '\n\n> ⚠️ Скріншот не вдалося завантажити (недостатньо прав токена)'
        } finally {
          setUploading(false)
        }
      }

      await createIssue({ ...form, body })
      setSuccess(`Звернення надіслано!${imageWarning}`)
      setForm({ title: '', body: '', issue_type: 'bug' })
      removeScreenshot()
    } catch {
      setError('Помилка надсилання. Перевірте підключення до інтернету.')
    } finally {
      setSending(false)
    }
  }

  const activeIssue = issues.find(i => i.number === activeNum) ?? null

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
        <div className={styles.backdrop} onClick={() => { setOpen(false); setActiveNum(null) }}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>

            <div className={styles.modalHeader}>
              {activeIssue ? (
                <button className={styles.backBtn} onClick={() => setActiveNum(null)}>← Назад</button>
              ) : (
                <h2 className={styles.modalTitle}>Підтримка</h2>
              )}
              <button className={styles.closeBtn} onClick={() => { setOpen(false); setActiveNum(null) }}>✕</button>
            </div>

            {/* Обговорення конкретного issue */}
            {activeIssue && (
              <div className={styles.threadScroll}>
                <IssueThread issue={activeIssue} onReload={loadIssues} />
              </div>
            )}

            {/* Список або форма */}
            {!activeIssue && (
              <>
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

                {/* ── Форма нового звернення ── */}
                {tab === 'new' && (
                  <form onSubmit={handleSubmit} className={styles.form} onPaste={handlePaste}>
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
                        placeholder="Детальний опис... (Ctrl+V щоб вставити скріншот)"
                        rows={4}
                        value={form.body}
                        onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
                      />
                    </label>

                    {preview && (
                      <div className={styles.previewWrap}>
                        <img src={preview} alt="screenshot" className={styles.previewImg} />
                        <button type="button" className={styles.removeImg} onClick={removeScreenshot}>✕</button>
                      </div>
                    )}

                    <div className={styles.formNote}>
                      ℹ️ До звернення автоматично додається поточна сторінка, браузер і час
                    </div>

                    {error   && <p className={styles.error}>{error}</p>}
                    {success && <p className={styles.success}>{success}</p>}

                    <div className={styles.formFooter}>
                      <button
                        type="button"
                        className={styles.attachBtn}
                        onClick={() => fileRef.current?.click()}
                      >
                        📎 Скріншот
                      </button>
                      <input
                        ref={fileRef}
                        type="file"
                        accept="image/*"
                        style={{ display: 'none' }}
                        onChange={e => { const f = e.target.files?.[0]; if (f) attachImage(f) }}
                      />
                      <button
                        type="submit"
                        className={styles.submitBtn}
                        disabled={sending || !form.title.trim()}
                      >
                        {uploading ? 'Завантаження...' : sending ? 'Надсилаємо...' : 'Надіслати'}
                      </button>
                    </div>
                  </form>
                )}

                {/* ── Список звернень ── */}
                {tab === 'list' && (
                  <div className={styles.list}>
                    {loading && <p className={styles.hint}>Завантаження...</p>}
                    {error   && <p className={styles.error}>{error}</p>}
                    {!loading && !error && issues.length === 0 && (
                      <p className={styles.hint}>Звернень поки немає</p>
                    )}
                    {issues.map(issue => (
                      <button
                        key={issue.number}
                        className={styles.issueRow}
                        onClick={() => setActiveNum(issue.number)}
                      >
                        <span className={`${styles.issueIcon} ${issue.state === 'open' ? styles.iconOpen : styles.iconClosed}`}>
                          {issue.state === 'open' ? '●' : '✓'}
                        </span>
                        <span className={styles.issueRowTitle}>
                          <span className={styles.issueRowName}>#{issue.number} {issue.title}</span>
                          <span className={styles.issueRowDate}>{relativeTime(issue.updated_at)}</span>
                        </span>
                        {issue.comments > 0 && (
                          <span className={styles.issueRowComments}>💬 {issue.comments}</span>
                        )}
                        <span className={styles.issueRowArrow}>›</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
