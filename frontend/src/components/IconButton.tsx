/**
 * Icon-only button з автоматичним дублюванням title→aria-label.
 *
 * Замість:
 *   <button onClick={...} title="Видалити" aria-label="Видалити">✕</button>
 *
 * Просто:
 *   <IconButton onClick={...} label="Видалити">✕</IconButton>
 *
 * Або з власним styling:
 *   <IconButton label="Закрити" className={styles.closeBtn} onClick={onClose}>✕</IconButton>
 */
import { type ButtonHTMLAttributes, type ReactNode, memo } from 'react'

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'title'> {
  /** Описова назва дії для screen readers і tooltip-у. Обов'язкова — icon-кнопка без неї недоступна. */
  label: string
  children: ReactNode
}

export const IconButton = memo(function IconButton({
  label,
  children,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={rest.type ?? 'button'}
      aria-label={label}
      title={label}
      {...rest}
    >
      {children}
    </button>
  )
})

export default IconButton
