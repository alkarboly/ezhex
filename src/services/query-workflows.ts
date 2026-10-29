import type { HailEnrichRequest, HailEnrichResponse, QueryWorkflowRun } from '../types/enrichments'
import type { WorkflowAgentQuote } from '../types/agents'
import type { HexSnapshotCheck } from '../types/releases'
import type {
  QueryWorkflow,
  QueryWorkflowCreate,
  QueryWorkflowList,
  QueryWorkflowNewDataCheck,
  QueryWorkflowPatch,
} from '../types/query-workflows'

async function request<T>(path: string, method: 'GET' | 'POST' | 'DELETE' | 'PATCH', body?: unknown): Promise<T> {
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

export function patchQueryWorkflow(id: string, body: QueryWorkflowPatch) {
  return request<QueryWorkflow>(`/api/query-workflows/${id}`, 'PATCH', body)
}

export function runQueryWorkflow(id: string) {
  return request<QueryWorkflowRun>(`/api/query-workflows/${id}/run`, 'POST', {})
}

export function quoteQueryWorkflow(id: string) {
  return request<WorkflowAgentQuote>(`/api/query-workflows/${id}/quote`, 'POST', {})
}

export function listQueryWorkflowRuns(id: string) {
  return request<Omit<QueryWorkflowRun, 'rows'>[]>(`/api/query-workflows/${id}/runs`, 'GET')
}

export function enrichHail(body: HailEnrichRequest) {
  return request<HailEnrichResponse>('/api/enrichments/hail', 'POST', body)
}

export function checkHexSnapshots(h3_cells: readonly string[]) {
  return request<HexSnapshotCheck>('/api/hex-snapshots/check', 'POST', { h3_cells })
}

export function checkQueryWorkflowNewData(id: string) {
  return request<QueryWorkflowNewDataCheck>(`/api/query-workflows/${id}/check-new-data`, 'POST', {})
}
