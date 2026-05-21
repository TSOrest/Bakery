import { type ReactNode } from 'react'
import styles from './Modal.module.css'

interface Props {
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean              // 860px — масові операції, таблиці
  xwide?: boolean             // 980px — 3-колонкові форми
  fullscreen?: boolean        // 100vw × 100vh — перекриває панель навігації
  headerExtra?: ReactNode     // ReactNode перед кнопкою ✕ у header-смузі
}

export default function Modal({ title, onClose, children, wide, xwide, fullscreen, headerExtra }: Props) {
  const sizeClass = fullscreen
    ? styles.modalFullscreen
    : xwide ? styles.modalXWide : wide ? styles.modalWide : ''
  return (
    <div className={`${styles.overlay} ${fullscreen ? styles.overlayFullscreen : ''}`}>
      <div className={`${styles.modal} ${sizeClass}`}>
        <div className={styles.header}>
          <h3 className={styles.title}>{title}</h3>
          <div className={styles.headerRight}>
            {headerExtra}
            <button className={styles.close} onClick={onClose}>✕</button>
          </div>
        </div>
        <div className={styles.body}>{children}</div>
      </div>
    </div>
  )
}
