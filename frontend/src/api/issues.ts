import { api } from './client'

export interface Issue {
  number: number
  title: string
  state: 'open' | 'closed'
  created_at: string
  updated_at: string
  url: string
  body: string
  labels: string[]
  comments: number
}

export interface IssueComment {
  id: number
  body: string
  created_at: string
  author: string
  author_avatar?: string
}

export interface IssueCreate {
  title:      string
  body:       string
  issue_type: 'bug' | 'suggestion' | 'question'
}

export const fetchIssues = (): Promise<Issue[]> =>
  api.get<Issue[]>('/issues/')

export const createIssue = (data: IssueCreate): Promise<Issue> =>
  api.post<Issue>('/issues/', data)

export const fetchComments = (number: number): Promise<IssueComment[]> =>
  api.get<IssueComment[]>(`/issues/${number}/comments`)

export const addComment = (number: number, body: string): Promise<{ id: number }> =>
  api.post(`/issues/${number}/comments`, { body })

export async function uploadAsset(file: File): Promise<{ url: string; markdown: string }> {
  const form = new FormData()
  form.append('file', file, file.name || 'screenshot.png')
  // Для multipart/form-data api.post не підходить (серіалізує JSON).
  // Тому raw fetch + ручне додавання Authorization header з localStorage.
  const token = localStorage.getItem('bakery_token')
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch('/api/v1/issues/assets', { method: 'POST', body: form, headers })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}
