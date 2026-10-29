import type { AgentPlan, AgentPlanRequest, AgentQueryRequest, AgentQueryResponse } from '../types/agents'

export class AgentRequestError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'AgentRequestError'
    this.status = status
  }
}

async function request<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message =
      typeof payload === 'object' && payload !== null && typeof (payload as { error?: unknown }).error === 'string'
        ? (payload as { error: string }).error
        : `Request failed (${response.status})`
    throw new AgentRequestError(message, response.status)
  }
  return payload as T
}

export function planAgent(body: AgentPlanRequest, signal?: AbortSignal) {
  return request<AgentPlan>('/api/agent/plan', body, signal)
}

export function buildAgentQuery(body: AgentQueryRequest, signal?: AbortSignal) {
  return request<AgentQueryResponse>('/api/agent/query', body, signal)
}
