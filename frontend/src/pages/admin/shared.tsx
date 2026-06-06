/**
 * Спільні UI-помічники і стилі для admin-вкладок.
 * Раніше були inline у AdminPage.tsx; винесені під час split-у v1.1.0.
 */
import type { CSSProperties, ReactNode } from 'react'

// ─── Стилі кнопок ────────────────────────────────────────────────────────────

export const addBtnStyle: CSSProperties = {
  padding: '0.4rem 1rem',
  background: '#1a3a5c',
  color: '#fff',
  border: 'none',
  borderRadius: '4px',
  cursor: 'pointer',
  fontSize: '0.9rem',
}

export const editBtnStyle: CSSProperties = {
  padding: '0.2rem 0.6rem',
  marginRight: '0.4rem',
  background: '#e8eef5',
  border: '1px solid #bcd',
  borderRadius: '3px',
  cursor: 'pointer',
  fontSize: '0.8rem',
}

export const delBtnStyle: CSSProperties = {
  padding: '0.2rem 0.6rem',
  background: '#fff0f0',
  border: '1px solid #f5b8b8',
  borderRadius: '3px',
  cursor: 'pointer',
  fontSize: '0.8rem',
  color: '#c00',
}

export const tableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  background: '#fff',
  borderRadius: '6px',
  // overflow: hidden прибрано — воно блокує position:sticky на <th>
  boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
}

// ─── UI-помічники ────────────────────────────────────────────────────────────

export const Th = ({ children, top }: { children: ReactNode; top?: number }) => (
  <th style={{
    padding: '0.45rem 0.8rem', textAlign: 'left', fontWeight: 600, fontSize: '0.875rem',
    ...(top !== undefined ? {
      position: 'sticky', top, zIndex: 5,
      background: '#e8eef5',
      boxShadow: 'inset 0 -1px 0 #d1d5db',
    } : {}),
  }}>
    {children}
  </th>
)

export const Td = ({ children }: { children: ReactNode }) => (
  <td style={{ padding: '0.4rem 0.8rem', borderBottom: '1px solid #f0f0f0', fontSize: '0.9rem' }}>
    {children}
  </td>
)

// ─── Типи ────────────────────────────────────────────────────────────────────

export interface SimpleItem {
  id: number
  name: string
  is_active: number
}

// ─── Клієнти (форма + ярлики) ────────────────────────────────────────────────
// ClientFormState спільний для ClientsTab і SystemClientsTab

export interface ClientFormState {
  full_name: string; short_name: string; address: string
  phone: string; director: string; accountant: string
  route_id: string; discount_pct: string
  client_kind: string; bot_phones: string
  client_group_id: string
}

export const emptyClient = (): ClientFormState => ({
  full_name: '', short_name: '', address: '', phone: '',
  director: '', accountant: '', route_id: '', discount_pct: '0',
  client_kind: 'customer', bot_phones: '',
  client_group_id: '',
})

export const CLIENT_KIND_LABELS: Record<string, string> = {
  customer:   'Клієнт',
  shop:       'Власний магазин',
  writeoff:   'Списання',
  ration:     'Пайок',
  underbaked: 'Недопечено',
}

export const SYSTEM_KINDS = ['writeoff', 'ration', 'underbaked'] as const
export const PROTECTED_KINDS = new Set<string>(['writeoff', 'ration', 'underbaked'])
