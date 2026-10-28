import type { AgentAssistDraftResponse, AgentAssistQuoteRequest, WorkflowAgentQuote } from '../types/agents'

async function request<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message =
      typeof payload === 'object' && payload !== null && typeof (payload as { error?: unknown }).error === 'string'
        ? (payload as { error: string }).error
        : `Request failed (${response.status})`
    throw new Error(message)
  }
  return payload as T
}

export function quoteAgentAssist(body: AgentAssistQuoteRequest) {
  return request<WorkflowAgentQuote>('/api/agent-assist/quote', body)
}

export function draftAgentAssist(body: AgentAssistQuoteRequest) {
  return request<AgentAssistDraftResponse>('/api/agent-assist/draft', body)
}
