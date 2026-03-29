import { type ReactNode } from 'react'
import styles from './Modal.module.css'

interface Props {
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean   // 860px — масові операції, таблиці
  xwide?: boolean  // 980px — 3-колонкові форми
}

export default function Modal({ title, onClose, children, wide, xwide }: Props) {
  const sizeClass = xwide ? styles.modalXWide : wide ? styles.modalWide : ''
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={`${styles.modal} ${sizeClass}`} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h3 className={styles.title}>{title}</h3>
          <button className={styles.close} onClick={onClose}>✕</button>
        </div>
        <div className={styles.body}>{children}</div>
      </div>
    </div>
  )
}
