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
  prompt?: string
}

export type AgentAssistDraftResponse = {
  h3_cells: string[]
  filters: import('../lib/feature-rows').InspectFilters
  sql: string
  enrichments: import('./enrichments').WorkflowEnrichment[]
  quote: WorkflowAgentQuote
  notes: string[]
}

export const AGENT_REGION_KINDS = ['selection', 'view', 'place', 'point', 'polygon', 'previous'] as const
export type AgentRegionKind = (typeof AGENT_REGION_KINDS)[number]

export const AGENT_PRESENCE_FIELDS = ['phone', 'email', 'socials', 'official_id'] as const
export type AgentPresenceField = (typeof AGENT_PRESENCE_FIELDS)[number]

export type AgentAiColumn = {
  column: string
  value_type: import('./enrichments').AiColumnValueType
  prompt: string
  source_fields: string[]
  enum_values?: string[]
}

/** Structured reading of one agent prompt. The model fills it; the server validates every field. */
export type AgentIntent = {
  region: { kind: AgentRegionKind; place: string | null; radius_km: number | null }
  dataset: import('../lib/feature-rows').InspectFilters['kind']
  category_terms: string[]
  search: string | null
  confidence_min: number | null
  open_only: boolean
  require: AgentPresenceField[]
  geofence_keep: import('./enrichments').GeofenceKeep | null
  hail_days: number | null
  ai_column: AgentAiColumn | null
  workflow_name: string
}

export type AgentRegion = {
  kind: Exclude<AgentRegionKind, 'previous'>
  label: string
  center: { lat: number; lng: number }
  radius_km: number | null
  /** Circle or custom polygon. Becomes the geofence. Null for selection and view regions. */
  polygon: import('./enrichments').GeofencePolygon | null
}

export type AgentViewContext = {
  center: { lat: number; lng: number }
  bounds: { west: number; south: number; east: number; north: number } | null
  zoom: number
}

export type AgentPrevious = {
  intent: AgentIntent
  region: AgentRegion
  h3_cells: string[]
}

export type AgentPlanRequest = {
  prompt: string
  selection?: string[]
  view?: AgentViewContext | null
  polygon?: import('./enrichments').GeofencePolygon | null
  /** Composer weather toggle. Forces hail_history on. */
  weather?: boolean
  previous?: AgentPrevious | null
}

export type AgentPlan = {
  id: string
  reply: string
  used_model: boolean
  intent: AgentIntent
  region: AgentRegion
  /** Ordered from the region center outward. */
  h3_cells: string[]
  ready: string[]
  missing: string[]
  /** Jobs already running for some of these hexes. */
  processing_jobs: string[]
  /** One missing hex per ingest job. */
  batches: string[][]
  release_version: string
  max_new_hexes: number
  notes: string[]
}

export type AgentQueryRequest = {
  prompt: string
  h3_cells: string[]
  intent: AgentIntent
  region: AgentRegion
}

export type AgentCategoryPick = { value: string; count: number }

export type AgentQueryResponse = {
  filters: import('../lib/feature-rows').InspectFilters
  sql: string
  enrichments: import('./enrichments').WorkflowEnrichment[]
  categories: AgentCategoryPick[]
  observed_categories: number
  total_rows: number
  matched_rows: number
  fenced_rows: number | null
  sample: import('../lib/feature-rows').FeatureRow[]
  workflow_name: string
  /** Requested hail window plus the first-snapshot floor the run clamps to. */
  hail_window: { start_date: string; end_date: string; floor: string | null } | null
  quote: WorkflowAgentQuote
  notes: string[]
  used_model: boolean
}
