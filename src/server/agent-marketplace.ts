import { randomUUID } from 'node:crypto'
import { dayCount } from '../lib/enrichments'
import { serverEnv } from '../lib/server-env'
import type {
  AgentLedgerResponse,
  AgentName,
  AgentQuoteLine,
  LedgerEntry,
  WorkflowAgentQuote,
} from '../types/agents'
import type { AiColumnEnrichment, WorkflowEnrichment } from '../types/enrichments'

export const MAX_AGENT_HEX_BATCH = 9
export const AI_COLUMN_ROW_CAP = 200

type QuoteInput = {
  ownerId: string
  workflowId: string
  releaseVersion: string
  selectedHexCount: number
  missingHexes: readonly string[]
  processBatches: readonly string[][]
  enrichments: readonly WorkflowEnrichment[]
  estimatedRows: number
}

type PriceBook = {
  orchestrator_base_cents: number
  process_hex_cents: number
  geofence_base_cents: number
  geofence_vertex_cents: number
  hail_day_hex_cents: number
  ai_row_cents: Record<AiColumnEnrichment['value_type'], number>
}

const ledgerEntries = new Map<string, LedgerEntry[]>()
const MAX_LEDGER_ENTRIES_PER_USER = 500

export async function quoteWorkflowAgents(input: QuoteInput): Promise<WorkflowAgentQuote> {
  const priceBook = readPriceBook()
  const deterministic = buildDeterministicLines(input, priceBook)
  const model = await modelQuoteLines(input, deterministic)
  const lines = deterministic.map((line) => {
    const suggested = model?.get(line.agent)
    const usd = Number.isFinite(suggested) ? Math.max(0, Math.round(suggested as number)) : line.usd_cents
    return {
      ...line,
      usd_cents: usd,
      clamped_usd_cents: clampQuote(line.agent, usd, input, priceBook),
    }
  })
  const total = lines.reduce((sum, line) => sum + line.clamped_usd_cents, 0)
  return {
    workflow_id: input.workflowId,
    owner_user_id: input.ownerId,
    release_version: input.releaseVersion,
    missing_hexes: [...input.missingHexes],
    process_batches: input.processBatches.map((batch) => [...batch]),
    estimated_rows: Math.max(0, Math.min(AI_COLUMN_ROW_CAP, Math.round(input.estimatedRows))),
    lines,
    total_usd_cents: total,
    seeded_credit_usd_cents: seededCreditsCents(),
    balance_usd_cents: balanceForOwner(input.ownerId),
  }
}

export function acceptWorkflowQuote(input: {
  ownerId: string
  workflowId: string
  runId: string
  quote: WorkflowAgentQuote
}): { debit_entry_id: string; tip_total_usd_cents: number; balance_usd_cents: number } {
  const balance = balanceForOwner(input.ownerId)
  if (balance < input.quote.total_usd_cents) {
    throw new Error(
      `Insufficient credits. Need ${formatCents(input.quote.total_usd_cents)} but only ${formatCents(balance)} remains.`,
    )
  }
  const debitEntry = writeEntry(input.ownerId, {
    run_id: input.runId,
    workflow_id: input.workflowId,
    type: 'debit',
    agent: 'user',
    counterparty: 'treasury',
    usd_cents: input.quote.total_usd_cents,
    message: `workflow debit ${formatCents(input.quote.total_usd_cents)}`,
  })
  let tipTotal = 0
  for (const line of input.quote.lines) {
    if (line.clamped_usd_cents <= 0) continue
    writeEntry(input.ownerId, {
      run_id: input.runId,
      workflow_id: input.workflowId,
      type: 'payout',
      agent: line.agent,
      counterparty: 'treasury',
      usd_cents: line.clamped_usd_cents,
      message: `${line.agent} payout ${formatCents(line.clamped_usd_cents)}`,
    })
    const tip = tipForLine(line.clamped_usd_cents)
    if (tip <= 0) continue
    tipTotal += tip
    writeEntry(input.ownerId, {
      run_id: input.runId,
      workflow_id: input.workflowId,
      type: 'tip',
      agent: line.agent,
      counterparty: 'user',
      usd_cents: tip,
      message: `${line.agent} tip ${formatCents(tip)}`,
    })
  }
  return {
    debit_entry_id: debitEntry.id,
    tip_total_usd_cents: tipTotal,
    balance_usd_cents: balanceForOwner(input.ownerId),
  }
}

export function listAgentLedger(ownerId: string): AgentLedgerResponse {
  const entries = [...(ledgerEntries.get(ownerId) ?? [])].sort((left, right) => right.at.localeCompare(left.at))
  let spent = 0
  let tips = 0
  for (const entry of entries) {
    if (entry.type === 'debit') spent += entry.usd_cents
    if (entry.type === 'tip') tips += entry.usd_cents
  }
  return {
    owner_user_id: ownerId,
    seeded_credit_usd_cents: seededCreditsCents(),
    balance_usd_cents: balanceForOwner(ownerId),
    total_spent_usd_cents: spent,
    total_tips_usd_cents: tips,
    entries,
  }
}

export function chunkHexesForAgent(cells: readonly string[], batchSize = MAX_AGENT_HEX_BATCH): string[][] {
  const unique = [...new Set(cells.map((cell) => cell.trim()).filter((cell) => cell.length > 0))]
  const batches: string[][] = []
  for (let index = 0; index < unique.length; index += Math.max(1, batchSize)) {
    batches.push(unique.slice(index, index + Math.max(1, batchSize)))
  }
  return batches
}

export function quoteLineText(line: AgentQuoteLine): string {
  return `agent quote ${line.agent} ${line.clamped_usd_cents}c · ${line.reason}`
}

function buildDeterministicLines(input: QuoteInput, priceBook: PriceBook): AgentQuoteLine[] {
  const lines: AgentQuoteLine[] = [
    {
      agent: 'orchestrator',
      usd_cents: priceBook.orchestrator_base_cents,
      clamped_usd_cents: priceBook.orchestrator_base_cents,
      reason: 'workflow orchestration',
    },
  ]
  if (input.missingHexes.length > 0) {
    lines.push({
      agent: 'process',
      usd_cents: input.missingHexes.length * priceBook.process_hex_cents,
      clamped_usd_cents: input.missingHexes.length * priceBook.process_hex_cents,
      reason: `${input.missingHexes.length} missing hexes in ${input.processBatches.length} batch(es)`,
    })
  }
  const geofence = input.enrichments.find((step) => step.kind === 'geofence')
  if (geofence && geofence.kind === 'geofence') {
    const vertices = Math.max(0, (geofence.polygon.coordinates[0]?.length ?? 0) - 1)
    lines.push({
      agent: 'geofence',
      usd_cents: priceBook.geofence_base_cents + vertices * priceBook.geofence_vertex_cents,
      clamped_usd_cents: priceBook.geofence_base_cents + vertices * priceBook.geofence_vertex_cents,
      reason: `${vertices} polygon vertices`,
    })
  }
  const hail = input.enrichments.find((step) => step.kind === 'hail_history')
  if (hail && hail.kind === 'hail_history') {
    const days = dayCount(hail.start_date, hail.end_date)
    lines.push({
      agent: 'hail_history',
      usd_cents: days * input.selectedHexCount * priceBook.hail_day_hex_cents,
      clamped_usd_cents: days * input.selectedHexCount * priceBook.hail_day_hex_cents,
      reason: `${days} days × ${input.selectedHexCount} hexes`,
    })
  }
  const ai = input.enrichments.find((step) => step.kind === 'ai_column')
  if (ai && ai.kind === 'ai_column') {
    const rows = Math.max(0, Math.min(AI_COLUMN_ROW_CAP, Math.round(input.estimatedRows)))
    const perRow = priceBook.ai_row_cents[ai.value_type]
    lines.push({
      agent: 'ai_column',
      usd_cents: rows * perRow,
      clamped_usd_cents: rows * perRow,
      reason: `${rows} rows × ${ai.value_type}`,
    })
  }
  return lines
}

function readPriceBook(): PriceBook {
  return {
    orchestrator_base_cents: intEnv('AGENT_ORCHESTRATOR_BASE_CENTS', 5),
    process_hex_cents: intEnv('AGENT_PROCESS_HEX_CENTS', 25),
    geofence_base_cents: intEnv('AGENT_GEOFENCE_BASE_CENTS', 10),
    geofence_vertex_cents: intEnv('AGENT_GEOFENCE_VERTEX_CENTS', 1),
    hail_day_hex_cents: intEnv('AGENT_HAIL_DAY_HEX_CENTS', 1),
    ai_row_cents: {
      bool: intEnv('AGENT_AI_BOOL_ROW_CENTS', 2),
      enum: intEnv('AGENT_AI_ENUM_ROW_CENTS', 3),
      number: intEnv('AGENT_AI_NUMBER_ROW_CENTS', 4),
      text: intEnv('AGENT_AI_TEXT_ROW_CENTS', 6),
    },
  }
}

function clampQuote(agent: AgentName, value: number, input: QuoteInput, priceBook: PriceBook): number {
  const clean = Math.max(0, Math.round(value))
  if (agent === 'orchestrator') return Math.min(clean, priceBook.orchestrator_base_cents)
  if (agent === 'process') return Math.min(clean, input.missingHexes.length * priceBook.process_hex_cents)
  if (agent === 'geofence') {
    const geofence = input.enrichments.find((step) => step.kind === 'geofence')
    const vertices = geofence && geofence.kind === 'geofence' ? Math.max(0, (geofence.polygon.coordinates[0]?.length ?? 0) - 1) : 0
    return Math.min(clean, priceBook.geofence_base_cents + vertices * priceBook.geofence_vertex_cents)
  }
  if (agent === 'hail_history') {
    const hail = input.enrichments.find((step) => step.kind === 'hail_history')
    const days = hail && hail.kind === 'hail_history' ? dayCount(hail.start_date, hail.end_date) : 0
    return Math.min(clean, days * input.selectedHexCount * priceBook.hail_day_hex_cents)
  }
  const ai = input.enrichments.find((step) => step.kind === 'ai_column')
  if (!ai || ai.kind !== 'ai_column') return 0
  const rows = Math.max(0, Math.min(AI_COLUMN_ROW_CAP, Math.round(input.estimatedRows)))
  return Math.min(clean, rows * priceBook.ai_row_cents[ai.value_type])
}

async function modelQuoteLines(input: QuoteInput, deterministic: readonly AgentQuoteLine[]): Promise<Map<AgentName, number> | null> {
  const key = serverEnv('OPENAI_QUOTE_API_KEY') || serverEnv('OPENAI_API_KEY')
  if (!key) return null
  const payload = {
    selected_hexes: input.selectedHexCount,
    missing_hexes: input.missingHexes.length,
    process_batches: input.processBatches.length,
    estimated_rows: Math.max(0, Math.min(AI_COLUMN_ROW_CAP, Math.round(input.estimatedRows))),
    enrichments: input.enrichments.map((step) => step.kind),
    deterministic_lines: deterministic.map((line) => ({ agent: line.agent, usd_cents: line.usd_cents, reason: line.reason })),
  }
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: serverEnv('OPENAI_QUOTE_MODEL') || serverEnv('OPENAI_MODEL') || 'gpt-4o-mini',
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'You return only JSON with one key `lines`. `lines` is an array of objects: { "agent": "<agent>", "usd_cents": <non-negative integer> }. Do not add agents that are not in the request.',
          },
          { role: 'user', content: JSON.stringify(payload) },
        ],
      }),
    })
    if (!response.ok) return null
    const json = (await response.json()) as unknown
    const text =
      isRecord(json) &&
      Array.isArray(json.choices) &&
      isRecord(json.choices[0]) &&
      isRecord(json.choices[0].message) &&
      typeof json.choices[0].message.content === 'string'
        ? json.choices[0].message.content
        : null
    if (!text) return null
    const parsed = JSON.parse(text) as unknown
    if (!isRecord(parsed) || !Array.isArray(parsed.lines)) return null
    const out = new Map<AgentName, number>()
    for (const row of parsed.lines) {
      if (!isRecord(row) || typeof row.agent !== 'string') continue
      if (!['orchestrator', 'process', 'geofence', 'hail_history', 'ai_column'].includes(row.agent)) continue
      const cents = Number(row.usd_cents)
      if (!Number.isFinite(cents)) continue
      out.set(row.agent as AgentName, Math.max(0, Math.round(cents)))
    }
    return out
  } catch {
    return null
  }
}

function tipForLine(usdCents: number): number {
  if (usdCents <= 0) return 0
  const basisPoints = intEnv('AGENT_TIP_BPS', 500)
  const tip = Math.round((usdCents * basisPoints) / 10_000)
  return Math.max(1, tip)
}

function seededCreditsCents(): number {
  return intEnv('LEDGER_SEED_CENTS', 5_000)
}

function balanceForOwner(ownerId: string): number {
  let balance = seededCreditsCents()
  for (const entry of ledgerEntries.get(ownerId) ?? []) {
    if (entry.type === 'debit') balance -= entry.usd_cents
    else if (entry.type === 'credit' || entry.type === 'tip') balance += entry.usd_cents
  }
  return balance
}

function writeEntry(
  ownerId: string,
  input: Omit<LedgerEntry, 'id' | 'owner_user_id' | 'at'>,
): LedgerEntry {
  const entry: LedgerEntry = {
    ...input,
    id: randomUUID(),
    owner_user_id: ownerId,
    at: new Date().toISOString(),
  }
  const next = ledgerEntries.get(ownerId) ?? []
  next.push(entry)
  if (next.length > MAX_LEDGER_ENTRIES_PER_USER) next.splice(0, next.length - MAX_LEDGER_ENTRIES_PER_USER)
  ledgerEntries.set(ownerId, next)
  return entry
}

function intEnv(name: string, fallback: number): number {
  const value = Number.parseInt(serverEnv(name), 10)
  if (!Number.isFinite(value)) return fallback
  return Math.max(0, value)
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
