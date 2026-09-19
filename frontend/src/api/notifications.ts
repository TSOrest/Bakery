import { api } from './client'

export interface AppNotification {
  id: number
  type: string
  title: string
  body?: string | null
  meta?: string | null
  created_at: string
  read_at?: string | null
}

export const notificationsApi = {
  list:         () => api.get<AppNotification[]>('/notifications'),
  unreadCount:  () => api.get<{ count: number }>('/notifications/unread-count'),
  markRead:     (id: number) => api.post<{ status: string }>(`/notifications/${id}/read`, null),
  markAllRead:  () => api.post<{ status: string }>('/notifications/read-all', null),
  requestUpdate: (version: string, changelog: string) =>
    api.post<{ status: string; delayed: boolean; other_sessions: number }>(
      '/settings/request-update', { version, changelog },
    ),
}
