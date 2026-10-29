import { getResolution, isValidCell } from 'h3-js'
import { addDay, asEnrichments } from '../lib/enrichments'
import { defaultInspectFilters, type InspectFilters } from '../lib/feature-rows'
import { compileInspectSql } from '../lib/inspect-sql'
import { boundsForCells } from '../lib/h3'
import { HAIL_MESH_START, MAX_SELECTED_CELLS } from '../lib/limits'
import { defaultOvertureRelease } from '../lib/overture'
import { readDataMode, serverEnv } from '../lib/server-env'
import type { AgentAssistDraftResponse, WorkflowAgentQuote } from '../types/agents'
import type { AiColumnValueType, GeofenceKeep, WorkflowEnrichment } from '../types/enrichments'
import {
  MAX_AGENT_HEX_BATCH,
  chunkHexesForAgent,
  quoteWorkflowAgents,
} from './agent-marketplace'
import { resolveUser } from './auth'
import { getSupabaseClient } from '../lib/supabase'
import { checkHexSnapshots } from './hex-snapshots'

const MOCK_OWNER = 'mock-guest'

export async function quoteAgentAssist(
  body: unknown,
  cookies: Record<string, string>,
): Promise<WorkflowAgentQuote | { error: string; status: number }> {
  const parsed = parseRequest(body)
  if ('error' in parsed) return parsed
  const owner = await assistOwner(cookies)
  if ('error' in owner) return owner
  return buildQuote(owner.ownerId, parsed)
}

export async function draftAgentAssist(
  body: unknown,
  cookies: Record<string, string>,
): Promise<AgentAssistDraftResponse | { error: string; status: number }> {
  const parsed = parseRequest(body)
  if ('error' in parsed) return parsed
  const owner = await assistOwner(cookies)
  if ('error' in owner) return owner

  const enrichments: WorkflowEnrichment[] = [...parsed.enrichments]
  const notes: string[] = []
  if (!enrichments.some((step) => step.kind === 'geofence')) {
    const bounds = boundsForCells(parsed.h3_cells)
    if (bounds) {
      const [westSouth, eastNorth] = bounds
      const [west, south] = westSouth
      const [east, north] = eastNorth
      enrichments.push({
        id: 'geofence',
        kind: 'geofence',
        keep: 'inside',
        polygon: {
          type: 'Polygon',
          coordinates: [
            [
              [west, south],
              [east, south],
              [east, north],
              [west, north],
              [west, south],
            ],
          ],
        },
      })
      notes.push('Added a geofence from the selected hex bounds.')
    }
  }
  const filters = {
    ...defaultInspectFilters,
    kind: 'places' as const,
    confidenceMin: 0.5,
  }
  notes.unshift('Configured the inspect query for places with confidence at least 0.5.')
  if (parsed.prompt) {
    const plan = await planFromPrompt(parsed.prompt)
    if (plan) {
      applyPromptPlan(plan, filters, enrichments)
      notes.unshift(`Applied your prompt: "${truncatePrompt(parsed.prompt)}"`)
    }
  }
  const quote = await buildQuote(owner.ownerId, { ...parsed, enrichments })
  return {
    h3_cells: parsed.h3_cells,
    filters,
    sql: compileInspectSql(parsed.h3_cells, filters, parsed.release_version),
    enrichments,
    quote,
    notes,
  }
}

type ParsedRequest = {
  h3_cells: string[]
  enrichments: WorkflowEnrichment[]
  release_version: string | null
  estimated_rows: number
  prompt: string | null
}

function parseRequest(body: unknown): ParsedRequest | { error: string; status: number } {
  if (!isRecord(body) || !Array.isArray(body.h3_cells)) {
    return { error: 'Request body must include h3_cells.', status: 400 }
  }
  const cells = [...new Set(body.h3_cells.filter((cell): cell is string => typeof cell === 'string').map((cell) => cell.trim()))]
  if (cells.length === 0) return { error: 'Choose at least one hex.', status: 400 }
  if (cells.length > MAX_SELECTED_CELLS) return { error: `Selection is limited to ${MAX_SELECTED_CELLS} cells.`, status: 400 }
  for (const cell of cells) {
    if (!isValidCell(cell) || getResolution(cell) !== 8) {
      return { error: 'Every hex must be a resolution-8 cell.', status: 400 }
    }
  }
  const enrichments = asEnrichments(body.enrichments ?? [])
  if (!enrichments) return { error: 'Enrichments are invalid.', status: 400 }
  const release_version =
    typeof body.release_version === 'string' && body.release_version.trim().length > 0
      ? body.release_version.trim()
      : null
  const estimated = Number(body.estimated_rows)
  const estimated_rows = Number.isFinite(estimated) ? Math.max(10, Math.min(200, Math.round(estimated))) : Math.max(10, Math.min(200, cells.length * 22))
  const prompt =
    typeof body.prompt === 'string' && body.prompt.trim().length > 0
      ? body.prompt.trim().slice(0, 1500)
      : null
  return { h3_cells: cells, enrichments, release_version, estimated_rows, prompt }
}

export async function assistOwner(
  cookies: Record<string, string>,
): Promise<{ ownerId: string } | { error: string; status: number }> {
  if (readDataMode().resolved === 'mock' || !getSupabaseClient()) return { ownerId: MOCK_OWNER }
  const resolved = await resolveUser(cookies)
  if (!resolved.user) return { error: 'Sign in to use the agent.', status: 401 }
  return { ownerId: resolved.user.id }
}

async function buildQuote(ownerId: string, parsed: ParsedRequest): Promise<WorkflowAgentQuote> {
  const snapshots = await checkHexSnapshots(parsed.h3_cells)
  const missing = snapshots.cells.filter((cell) => !cell.processed).map((cell) => cell.h3)
  const release = parsed.release_version ?? snapshots.current_release_version ?? defaultOvertureRelease()
  return quoteWorkflowAgents({
    ownerId,
    workflowId: `assist-${parsed.h3_cells.length}`,
    releaseVersion: release,
    selectedHexCount: parsed.h3_cells.length,
    missingHexes: missing,
    processBatches: chunkHexesForAgent(missing, MAX_AGENT_HEX_BATCH),
    enrichments: parsed.enrichments,
    estimatedRows: parsed.estimated_rows,
  })
}

type PromptPlan = {
  kind?: InspectFilters['kind']
  confidence_min?: number | null
  geofence_keep?: GeofenceKeep
  hail_days?: number
  ai_value_type?: AiColumnValueType
  ai_column?: string
  ai_prompt?: string
  ai_source_fields?: string[]
  ai_enum_values?: string[]
}

async function planFromPrompt(prompt: string): Promise<PromptPlan | null> {
  const heuristic = heuristicPromptPlan(prompt)
  const model = await modelPromptPlan(prompt)
  if (!model) return hasPromptPlan(heuristic) ? heuristic : null
  const merged: PromptPlan = {
    ...heuristic,
    ...model,
    ai_source_fields: model.ai_source_fields ?? heuristic.ai_source_fields,
    ai_enum_values: model.ai_enum_values ?? heuristic.ai_enum_values,
  }
  return hasPromptPlan(merged) ? merged : null
}

async function modelPromptPlan(prompt: string): Promise<PromptPlan | null> {
  const key = serverEnv('OPENAI_QUOTE_API_KEY') || serverEnv('OPENAI_API_KEY')
  if (!key) return null
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
              'Return only JSON. Keys are optional: kind ("all"|"places"|"buildings"|"addresses"), confidence_min (0.5|0.7|0.9|null), geofence_keep ("inside"|"outside"), hail_days (1-366), ai_value_type ("bool"|"enum"|"number"|"text"), ai_column (snake_case), ai_prompt (string), ai_source_fields (array of strings), ai_enum_values (array of strings when enum).',
          },
          { role: 'user', content: prompt },
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
    return sanitizePromptPlan(parsed)
  } catch {
    return null
  }
}

function heuristicPromptPlan(prompt: string): PromptPlan {
  const text = prompt.toLowerCase()
  const plan: PromptPlan = {}
  if (/\ball\b|\beverything\b|\bany theme\b/.test(text)) plan.kind = 'all'
  else if (/\bbuildings?\b/.test(text)) plan.kind = 'buildings'
  else if (/\baddresses?\b/.test(text)) plan.kind = 'addresses'
  else if (/\bplaces?\b|\bbusiness(?:es)?\b|\bleads?\b/.test(text)) plan.kind = 'places'

  if (/\b0\.9\b|high confidence|strict confidence/.test(text)) plan.confidence_min = 0.9
  else if (/\b0\.7\b|medium confidence/.test(text)) plan.confidence_min = 0.7
  else if (/\b0\.5\b|confidence/.test(text)) plan.confidence_min = 0.5

  if (/\b(?:hail|weather|storm|mesh|noaa)\b/.test(text)) {
    const dayMatch = text.match(/\b(\d{1,3})\s*day/)
    if (dayMatch) plan.hail_days = clampInt(Number(dayMatch[1]), 1, 366)
    else if (text.includes('last week')) plan.hail_days = 7
    else if (text.includes('last month')) plan.hail_days = 30
    else if (text.includes('last quarter')) plan.hail_days = 90
    else plan.hail_days = 30
  }

  if (/\boutside\b|\bexclude\b|\bwithout\b/.test(text)) plan.geofence_keep = 'outside'
  else if (/\binside\b|\bwithin\b/.test(text)) plan.geofence_keep = 'inside'

  if (/\bscore\b|\bnumeric\b|\bnumber\b/.test(text)) plan.ai_value_type = 'number'
  else if (/\bclassify\b|\benum\b|\blow\b.*\bhigh\b/.test(text)) plan.ai_value_type = 'enum'
  else if (/\bbool\b|\btrue\b|\bfalse\b|\byes\b\/\bno\b|\blikely\b/.test(text)) plan.ai_value_type = 'bool'

  if (plan.ai_value_type) {
    plan.ai_prompt = prompt.trim()
    if (plan.ai_value_type === 'enum') plan.ai_enum_values = ['low', 'medium', 'high']
  }
  return plan
}

function sanitizePromptPlan(value: unknown): PromptPlan | null {
  if (!isRecord(value)) return null
  const next: PromptPlan = {}
  if (value.kind === 'all' || value.kind === 'places' || value.kind === 'buildings' || value.kind === 'addresses') {
    next.kind = value.kind
  }
  const confidence = normalizeConfidence(value.confidence_min)
  if (confidence !== undefined) next.confidence_min = confidence
  if (value.geofence_keep === 'inside' || value.geofence_keep === 'outside') next.geofence_keep = value.geofence_keep
  if (value.hail_days != null) {
    const days = Number(value.hail_days)
    if (Number.isFinite(days)) next.hail_days = clampInt(Math.round(days), 1, 366)
  }
  if (value.ai_value_type === 'bool' || value.ai_value_type === 'enum' || value.ai_value_type === 'number' || value.ai_value_type === 'text') {
    next.ai_value_type = value.ai_value_type
  }
  if (typeof value.ai_column === 'string') next.ai_column = value.ai_column
  if (typeof value.ai_prompt === 'string') next.ai_prompt = value.ai_prompt.trim().slice(0, 600)
  if (Array.isArray(value.ai_source_fields)) {
    next.ai_source_fields = normalizeStringList(value.ai_source_fields, 20)
  } else if (typeof value.ai_source_fields === 'string') {
    next.ai_source_fields = normalizeStringList(value.ai_source_fields.split(/[\s,]+/g), 20)
  }
  if (Array.isArray(value.ai_enum_values)) {
    next.ai_enum_values = normalizeStringList(value.ai_enum_values, 32)
  } else if (typeof value.ai_enum_values === 'string') {
    next.ai_enum_values = normalizeStringList(value.ai_enum_values.split(/[\n,]+/g), 32)
  }
  return hasPromptPlan(next) ? next : null
}

function applyPromptPlan(
  plan: PromptPlan,
  filters: InspectFilters,
  enrichments: WorkflowEnrichment[],
) {
  if (plan.kind) filters.kind = plan.kind
  if (filters.kind === 'places') {
    filters.confidenceMin = plan.confidence_min ?? 0.5
  } else {
    filters.confidenceMin = null
  }

  if (plan.geofence_keep) {
    const index = enrichments.findIndex((step) => step.kind === 'geofence')
    if (index >= 0) {
      const geofence = enrichments[index]
      if (geofence.kind === 'geofence') enrichments[index] = { ...geofence, keep: plan.geofence_keep }
    }
  }

  if (plan.hail_days != null) {
    const end = new Date().toISOString().slice(0, 10)
    let start = addDay(end, -(plan.hail_days - 1))
    if (start < HAIL_MESH_START) start = HAIL_MESH_START
    const hail = { id: 'hail_history', kind: 'hail_history', start_date: start, end_date: end } as const
    const index = enrichments.findIndex((step) => step.kind === 'hail_history')
    if (index >= 0) enrichments[index] = hail
    else enrichments.push(hail)
  }

  if (plan.ai_value_type || plan.ai_column || (plan.ai_prompt && plan.ai_prompt.length >= 6)) {
    const aiIndex = enrichments.findIndex((step) => step.kind === 'ai_column')
    const existing = aiIndex >= 0 ? enrichments[aiIndex] : null
    const current = existing?.kind === 'ai_column' ? existing : null
    const valueType = plan.ai_value_type ?? current?.value_type ?? 'text'
    const column = normalizeAiColumn(plan.ai_column) ?? current?.column ?? 'ai_column'
    const prompt =
      plan.ai_prompt && plan.ai_prompt.length >= 6
        ? plan.ai_prompt
        : current?.prompt ?? 'Score or label this row using the listed fields.'
    const sourceFields =
      plan.ai_source_fields && plan.ai_source_fields.length > 0
        ? plan.ai_source_fields
        : current?.source_fields ?? ['name', 'category', 'main_category', 'address', 'operating_status']
    const enumValues =
      valueType === 'enum'
        ? (plan.ai_enum_values && plan.ai_enum_values.length >= 2
            ? plan.ai_enum_values
            : current?.enum_values ?? ['low', 'medium', 'high'])
        : undefined
    const next = {
      id: current?.id ?? 'ai_column',
      kind: 'ai_column' as const,
      column,
      value_type: valueType,
      prompt,
      source_fields: sourceFields,
      ...(enumValues ? { enum_values: enumValues } : {}),
    }
    if (aiIndex >= 0) enrichments[aiIndex] = next
    else enrichments.push(next)
  }
}

function hasPromptPlan(plan: PromptPlan): boolean {
  return (
    plan.kind != null ||
    plan.confidence_min !== undefined ||
    plan.geofence_keep != null ||
    plan.hail_days != null ||
    plan.ai_value_type != null ||
    plan.ai_column != null ||
    plan.ai_prompt != null ||
    (plan.ai_source_fields?.length ?? 0) > 0 ||
    (plan.ai_enum_values?.length ?? 0) > 0
  )
}

function truncatePrompt(prompt: string): string {
  const clean = prompt.replace(/\s+/g, ' ').trim()
  return clean.length <= 140 ? clean : `${clean.slice(0, 137)}...`
}

function normalizeConfidence(value: unknown): number | null | undefined {
  if (value == null) return null
  const raw = Number(value)
  if (!Number.isFinite(raw)) return undefined
  const normalized = raw > 1 && raw <= 100 ? raw / 100 : raw
  if (normalized >= 0.85) return 0.9
  if (normalized >= 0.6) return 0.7
  if (normalized > 0) return 0.5
  return null
}

function normalizeAiColumn(value: string | undefined): string | null {
  if (!value) return null
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(normalized)) return null
  if (normalized.startsWith('overture_')) return null
  return normalized
}

function normalizeStringList(values: readonly unknown[], max: number): string[] {
  return [...new Set(values.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean))].slice(0, max)
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
