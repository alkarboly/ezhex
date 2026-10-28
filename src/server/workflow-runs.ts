import { randomUUID } from 'node:crypto'
import { applyEnrichments } from '../lib/enrichments'
import { filterFeatureRows, mergeFeatureRows } from '../lib/feature-rows'
import { hailSummariesByHex } from '../lib/hail-mesh'
import { MAX_QUERY_LIMIT } from '../lib/limits'
import { readDataMode } from '../lib/server-env'
import { createUserClient } from '../lib/supabase'
import { mockProvider } from '../services/mock-provider'
import { supabaseProvider } from '../services/supabase-provider'
import { defaultSort, DATASET_IDS } from '../types/datasets'
import type { HailHexSummary, QueryWorkflowRun, WorkflowEnrichment } from '../types/enrichments'
import type { QuerySpec } from '../types/queries'
import { earliestSnapshotDate } from '../lib/hex-snapshots'
import { checkHexSnapshots, prepareWorkflowSnapshots } from './hex-snapshots'
import { hailSummariesFor } from './hail-mesh'
import { getQueryWorkflow, requireWorkflowOwner } from './query-workflows'

const mockRuns = new Map<string, QueryWorkflowRun>()

export function resetWorkflowRunsForTests() {
  mockRuns.clear()
}

export async function runQueryWorkflow(
  id: string,
  cookies: Record<string, string>,
): Promise<QueryWorkflowRun | { error: string; status: number }> {
  const workflow = await getQueryWorkflow(id, cookies)
  if ('error' in workflow) return workflow
  const session = await requireWorkflowOwner(cookies)
  if ('error' in session) return session
  const prepared = await prepareWorkflowSnapshots(workflow.h3_cells, workflow.release_version)
  if ('error' in prepared) return prepared
  const created: QueryWorkflowRun = {
    id: randomUUID(),
    workflow_id: id,
    status: 'running',
    row_count: 0,
    error_message: null,
    rows: [],
    release_version: prepared.release_version,
    snapshot_status: prepared.snapshot_status,
    historized_hexes: prepared.historized_hexes,
    created_at: new Date().toISOString(),
    finished_at: null,
  }
  try {
    const [places, buildings, addresses] = await Promise.all(
      DATASET_IDS.map((dataset) =>
        provider().runQuery(themeSpec(dataset, workflow.h3_cells, prepared.release_version)),
      ),
    )
    const merged = filterFeatureRows(mergeFeatureRows(places.rows, buildings.rows, addresses.rows), workflow.filters)
    const hail = await hailForWorkflow(
      session.ownerId,
      session.accessToken,
      workflow.h3_cells,
      workflow.enrichments,
    )
    if ('error' in hail) throw new Error(hail.error)
    const rows = applyEnrichments(merged, workflow.enrichments, hailSummariesByHex(hail))
    const finished: QueryWorkflowRun = {
      ...created,
      status: 'succeeded',
      row_count: rows.length,
      rows,
      finished_at: new Date().toISOString(),
    }
    await persistRun(session.ownerId, session.accessToken, finished)
    return finished
  } catch (error) {
    const failed: QueryWorkflowRun = {
      ...created,
      status: 'failed',
      error_message: error instanceof Error ? error.message : 'The workflow run failed.',
      finished_at: new Date().toISOString(),
    }
    await persistRun(session.ownerId, session.accessToken, failed)
    return failed
  }
}

export async function listQueryWorkflowRuns(
  workflowId: string,
  cookies: Record<string, string>,
): Promise<Omit<QueryWorkflowRun, 'rows'>[] | { error: string; status: number }> {
  const workflow = await getQueryWorkflow(workflowId, cookies)
  if ('error' in workflow) return workflow
  const session = await requireWorkflowOwner(cookies)
  if ('error' in session) return session
  if (readDataMode().resolved === 'mock') {
    return [...mockRuns.values()]
      .filter((run) => run.workflow_id === workflowId)
      .sort((left, right) => right.created_at.localeCompare(left.created_at))
      .map(withoutRows)
  }
  const client = createUserClient(session.accessToken)
  if (!client) return { error: 'Set SUPABASE_URL and SUPABASE_ANON_KEY on the server to run workflows.', status: 503 }
  const { data, error } = await client
    .from('query_workflow_runs')
    .select(
      'id, workflow_id, status, row_count, error_message, release_version, snapshot_status, historized_hexes, created_at, finished_at',
    )
    .eq('workflow_id', workflowId)
    .order('created_at', { ascending: false })
    .limit(20)
  if (error) return { error: publicRunError(error.message), status: 400 }
  return (data ?? []).map((row) => ({
    id: String(row.id),
    workflow_id: String(row.workflow_id),
    status: row.status as QueryWorkflowRun['status'],
    row_count: Number(row.row_count) || 0,
    error_message: typeof row.error_message === 'string' ? row.error_message : null,
    release_version: typeof row.release_version === 'string' ? row.release_version : null,
    snapshot_status:
      row.snapshot_status === 'current' || row.snapshot_status === 'stale' || row.snapshot_status === 'historical'
        ? row.snapshot_status
        : null,
    historized_hexes: Array.isArray(row.historized_hexes)
      ? row.historized_hexes.filter((cell): cell is string => typeof cell === 'string')
      : [],
    created_at: String(row.created_at),
    finished_at: typeof row.finished_at === 'string' ? row.finished_at : null,
  }))
}

async function hailForWorkflow(
  ownerId: string,
  accessToken: string,
  cells: readonly string[],
  enrichments: readonly WorkflowEnrichment[],
): Promise<HailHexSummary[] | { error: string; status: number }> {
  const hail = enrichments.find((step) => step.kind === 'hail_history')
  if (!hail || hail.kind !== 'hail_history') return []
  const check = await checkHexSnapshots(cells)
  const floor = earliestSnapshotDate(check.cells)
  if (floor && floor > hail.end_date) return []
  const start = floor && floor > hail.start_date ? floor : hail.start_date
  return hailSummariesFor(ownerId, accessToken, cells, start, hail.end_date)
}

function themeSpec(
  dataset: (typeof DATASET_IDS)[number],
  cells: readonly string[],
  release: string | null,
): QuerySpec {
  const sort = defaultSort(dataset)
  return {
    dataset,
    h3_cells: [...cells],
    filters: [],
    sort,
    limit: MAX_QUERY_LIMIT,
    offset: 0,
    ...(release ? { release_version: release } : {}),
  }
}

function provider() {
  return readDataMode().resolved === 'supabase' ? supabaseProvider : mockProvider
}

async function persistRun(ownerId: string, accessToken: string, run: QueryWorkflowRun) {
  if (readDataMode().resolved === 'mock') {
    mockRuns.set(run.id, run)
    return
  }
  const client = createUserClient(accessToken)
  if (!client) return
  await client.from('query_workflow_runs').insert({
    id: run.id,
    workflow_id: run.workflow_id,
    owner_user_id: ownerId,
    status: run.status,
    row_count: run.row_count,
    error_message: run.error_message,
    result_rows: run.rows,
    release_version: run.release_version,
    snapshot_status: run.snapshot_status,
    historized_hexes: run.historized_hexes,
    finished_at: run.finished_at,
  })
}

function withoutRows(run: QueryWorkflowRun): Omit<QueryWorkflowRun, 'rows'> {
  const { rows: _rows, ...rest } = run
  return rest
}

function publicRunError(message: string): string {
  if (/does not exist|schema cache/i.test(message)) {
    return 'Run supabase/migrations/20261027_workflow_enrichments.sql in the Supabase SQL editor.'
  }
  return message.length > 0 && message.length < 180 ? message : 'The workflow run failed.'
}
