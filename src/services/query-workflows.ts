import type { QueryWorkflow, QueryWorkflowCreate, QueryWorkflowList } from '../types/query-workflows'

async function request<T>(path: string, method: 'GET' | 'POST' | 'DELETE', body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
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

export function listQueryWorkflows() {
  return request<QueryWorkflowList>('/api/query-workflows', 'GET')
}

export function createQueryWorkflow(body: QueryWorkflowCreate) {
  return request<QueryWorkflow>('/api/query-workflows', 'POST', body)
}

export function getQueryWorkflow(id: string) {
  return request<QueryWorkflow>(`/api/query-workflows/${id}`, 'GET')
}

export function deleteQueryWorkflow(id: string) {
  return request<{ ok: true }>(`/api/query-workflows/${id}`, 'DELETE')
}
