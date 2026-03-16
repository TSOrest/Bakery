// Базовий fetch-клієнт для API

const BASE = '/api/v1'

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${res.status} ${res.statusText}: ${text}`)
  }

  // 204 No Content
  if (res.status === 204) return undefined as T

  return res.json() as Promise<T>
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  // queryString — опціональні query-параметри вже у вигляді "key=val&..."
  post: <T>(path: string, body: unknown, queryString?: string) =>
    request<T>(queryString ? `${path}?${queryString}` : path, {
      method: 'POST',
      body: body !== null ? JSON.stringify(body) : undefined,
    }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: (path: string) => request<void>(path, { method: 'DELETE' }),
}
