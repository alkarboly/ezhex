import type { AuthSession } from '../types/auth'

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    headers: body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message =
      isRecord(payload) && typeof payload.error === 'string' ? payload.error : `Request failed (${response.status})`
    throw new Error(message)
  }
  return payload as T
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function fetchAuthSession() {
  return request<AuthSession>('/api/auth/session')
}

export function signUpAccount(email: string, password: string) {
  return request<AuthSession & { needs_confirmation?: boolean }>('/api/auth/signup', { email, password })
}

export function signInAccount(email: string, password: string) {
  return request<AuthSession>('/api/auth/signin', { email, password })
}

export function signOutAccount() {
  return request<AuthSession>('/api/auth/signout', {})
}

export function deleteAccount(password: string) {
  return request<AuthSession>('/api/auth/delete', { password, confirm: 'DELETE' })
}
