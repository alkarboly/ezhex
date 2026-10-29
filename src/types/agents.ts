export const AGENT_NAMES = ['orchestrator', 'process', 'geofence', 'hail_history', 'ai_column'] as const
export type AgentName = (typeof AGENT_NAMES)[number]

export type AgentQuoteLine = {
  agent: AgentName
  /** Raw amount suggested by a model or by the default quote logic. */
  usd_cents: number
  /** Final amount after the server-side price-book clamp. */
  clamped_usd_cents: number
  reason: string
}

export type WorkflowAgentQuote = {
  workflow_id: string
  owner_user_id: string | null
  release_version: string
  missing_hexes: string[]
  process_batches: string[][]
  estimated_rows: number
  lines: AgentQuoteLine[]
  total_usd_cents: number
  seeded_credit_usd_cents: number
  balance_usd_cents: number
}

export const LEDGER_ENTRY_TYPES = ['debit', 'credit', 'tip', 'payout'] as const
export type LedgerEntryType = (typeof LEDGER_ENTRY_TYPES)[number]

export type LedgerEntry = {
  id: string
  owner_user_id: string
  at: string
  run_id: string
  workflow_id: string | null
  type: LedgerEntryType
  agent: AgentName | 'user' | 'treasury'
  counterparty: string
  usd_cents: number
  message: string
}

export type AgentLedgerResponse = {
  owner_user_id: string
  seeded_credit_usd_cents: number
  balance_usd_cents: number
  total_spent_usd_cents: number
  total_tips_usd_cents: number
  entries: LedgerEntry[]
}

export type AgentAssistQuoteRequest = {
  h3_cells: string[]
  enrichments: import('./enrichments').WorkflowEnrichment[]
  release_version?: string | null
  estimated_rows?: number
}

export type AgentAssistDraftResponse = {
  h3_cells: string[]
  filters: import('../lib/feature-rows').InspectFilters
  sql: string
  enrichments: import('./enrichments').WorkflowEnrichment[]
  quote: WorkflowAgentQuote
  notes: string[]
}
