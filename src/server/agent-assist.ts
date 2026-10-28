import { getResolution, isValidCell } from 'h3-js'
import { addDay, asEnrichments } from '../lib/enrichments'
import { boundsForCells } from '../lib/h3'
import { HAIL_MESH_START, MAX_SELECTED_CELLS } from '../lib/limits'
import { defaultOvertureRelease } from '../lib/overture'
import { readDataMode } from '../lib/server-env'
import type { AgentAssistDraftResponse, WorkflowAgentQuote } from '../types/agents'
import type { WorkflowEnrichment } from '../types/enrichments'
import {
  MAX_AGENT_HEX_BATCH,
  chunkHexesForAgent,
  quoteWorkflowAgents,
} from './agent-marketplace'
import { resolveUser } from './auth'
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
  if (!enrichments.some((step) => step.kind === 'hail_history')) {
    const end = new Date().toISOString().slice(0, 10)
    let start = addDay(end, -29)
    if (start < HAIL_MESH_START) start = HAIL_MESH_START
    enrichments.push({ id: 'hail_history', kind: 'hail_history', start_date: start, end_date: end })
    notes.push('Added a 30-day hail history window.')
  }
  if (!enrichments.some((step) => step.kind === 'ai_column')) {
    enrichments.push({
      id: 'ai_column',
      kind: 'ai_column',
      column: 'broker_signal',
      value_type: 'bool',
      prompt: 'Is this row likely useful to a data broker lead list?',
      source_fields: ['name', 'category', 'main_category', 'address', 'operating_status'],
    })
    notes.push('Added a default AI row classifier (`broker_signal`).')
  }
  const quote = await buildQuote(owner.ownerId, { ...parsed, enrichments })
  return { enrichments, quote, notes }
}

type ParsedRequest = {
  h3_cells: string[]
  enrichments: WorkflowEnrichment[]
  release_version: string | null
  estimated_rows: number
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
  return { h3_cells: cells, enrichments, release_version, estimated_rows }
}

async function assistOwner(
  cookies: Record<string, string>,
): Promise<{ ownerId: string } | { error: string; status: number }> {
  if (readDataMode().resolved === 'mock') return { ownerId: MOCK_OWNER }
  const resolved = await resolveUser(cookies)
  if (!resolved.user) return { error: 'Sign in to use agent assist.', status: 401 }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
