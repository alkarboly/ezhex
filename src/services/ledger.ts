import type { AgentLedgerResponse } from '../types/agents'

export async function getAgentLedger(): Promise<AgentLedgerResponse> {
  const response = await fetch('/api/ledger', { headers: { accept: 'application/json' }, credentials: 'same-origin' })
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message =
      typeof payload === 'object' && payload !== null && typeof (payload as { error?: unknown }).error === 'string'
        ? (payload as { error: string }).error
        : `Request failed (${response.status})`
    throw new Error(message)
  }
  return payload as AgentLedgerResponse
}
