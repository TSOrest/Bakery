import api from './client'

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

export interface IssueCreate {
  title: string
  body: string
  issue_type: 'bug' | 'suggestion' | 'question'
}

export const fetchIssues = (): Promise<Issue[]> =>
  api.get<Issue[]>('/issues/')

export const createIssue = (data: IssueCreate): Promise<Issue> =>
  api.post<Issue>('/issues/', data)
