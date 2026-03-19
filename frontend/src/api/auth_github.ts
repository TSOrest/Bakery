import { api } from './client'

export interface DeviceFlowStart {
  device_code:      string
  user_code:        string
  verification_uri: string
  expires_in:       number
  interval:         number
}

export interface DeviceFlowPoll {
  status:     'pending' | 'authorized' | 'access_denied' | 'expired'
  login?:     string
  name?:      string
  avatar_url?: string
}

export interface GitHubStatus {
  authorized:  boolean
  login?:      string
  name?:       string
  avatar_url?: string
}

export const startDeviceFlow  = (): Promise<DeviceFlowStart> =>
  api.post<DeviceFlowStart>('/auth/github/start', null)

export const pollDeviceFlow = (device_code: string): Promise<DeviceFlowPoll> =>
  api.post<DeviceFlowPoll>('/auth/github/poll', { device_code })

export const getGitHubStatus = (): Promise<GitHubStatus> =>
  api.get<GitHubStatus>('/auth/github/status')

export const githubLogout = (): Promise<void> =>
  api.delete('/auth/github/logout')
