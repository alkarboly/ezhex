import { randomUUID } from 'node:crypto'
import { attachHail, applyGeofence } from '../lib/enrichments'
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
import type { JobLog } from '../types/workflows'
import { earliestSnapshotDate } from '../lib/hex-snapshots'
import {
  MAX_AGENT_HEX_BATCH,
  acceptWorkflowQuote,
  chunkHexesForAgent,
  quoteLineText,
  quoteWorkflowAgents,
} from './agent-marketplace'
import { applyAiColumnEnrichment } from './ai-column'
import { checkHexSnapshots, prepareWorkflowSnapshots } from './hex-snapshots'
import { createIngestionJob, getIngestionJob, runIngestionJob } from './ingestion-jobs'
import { hailSummariesFor } from './hail-mesh'
import { getQueryWorkflow, requireWorkflowOwner } from './query-workflows'
import type { WorkflowAgentQuote } from '../types/agents'

const mockRuns = new Map<string, QueryWorkflowRun>()

export function resetWorkflowRunsForTests() {
  mockRuns.clear()
}

export async function runQueryWorkflow(
  id: string,
  cookies: Record<string, string>,
  _body?: unknown,
): Promise<QueryWorkflowRun | { error: string; status: number }> {
  const workflow = await getQueryWorkflow(id, cookies)
  if ('error' in workflow) return workflow
  const session = await requireWorkflowOwner(cookies)
  if ('error' in session) return session
  const quote = await quoteForWorkflow(id, session.ownerId, workflow.h3_cells, workflow.enrichments, workflow.release_version)
  const runId = randomUUID()
  const created: QueryWorkflowRun = {
    id: runId,
    workflow_id: id,
    status: 'running',
    row_count: 0,
    error_message: null,
    rows: [],
    release_version: quote.release_version,
    snapshot_status: 'stale',
    historized_hexes: [],
    logs: [],
    quote_total_usd_cents: quote.total_usd_cents,
    tips_usd_cents: 0,
    ledger_debit_id: null,
    created_at: new Date().toISOString(),
    finished_at: null,
  }
  if (quote.total_usd_cents > quote.balance_usd_cents) {
    return {
      error: `Insufficient credits. Need ${formatCents(quote.total_usd_cents)} and only ${formatCents(quote.balance_usd_cents)} remains.`,
      status: 400,
    }
  }
  const log = (level: JobLog['level'], message: string) => {
    created.logs.push({ at: new Date().toISOString(), level, message })
  }
  for (const line of quote.lines) {
    log('info', quoteLineText(line))
    if (line.usd_cents !== line.clamped_usd_cents) {
      log('warn', `agent clamp ${line.agent} ${line.usd_cents}c -> ${line.clamped_usd_cents}c`)
    }
  }
  log('info', `agent accept total ${quote.total_usd_cents}c`)
  try {
    if (quote.missing_hexes.length > 0) {
      log('info', `agent run process started · ${quote.missing_hexes.length} missing hexes`)
      await processMissingHexes(quote, log)
      log('info', 'agent run process succeeded')
    }
    const prepared = await prepareWorkflowSnapshots(workflow.h3_cells, workflow.release_version)
    if ('error' in prepared) return prepared
    created.release_version = prepared.release_version
    created.snapshot_status = prepared.snapshot_status
    created.historized_hexes = prepared.historized_hexes
    const debit = acceptWorkflowQuote({
      ownerId: session.ownerId,
      workflowId: id,
      runId,
      quote,
    })
    created.tips_usd_cents = debit.tip_total_usd_cents
    created.ledger_debit_id = debit.debit_entry_id
    log('info', `ledger debit ${quote.total_usd_cents}c · ${debit.debit_entry_id}`)
    if (debit.tip_total_usd_cents > 0) log('info', `agent tips ${debit.tip_total_usd_cents}c credited`)
    const merged = filterFeatureRows(await loadInspectRows(workflow.h3_cells, prepared.release_version), workflow.filters)
    let rows = merged
    let hailMap: ReadonlyMap<string, HailHexSummary> = new Map()
    for (const step of workflow.enrichments) {
      if (step.kind === 'geofence') {
        const before = rows.length
        rows = applyGeofence(rows, step)
        log('info', `agent run geofence succeeded · ${before} -> ${rows.length} rows`)
        continue
      }
      if (step.kind === 'hail_history') {
        const hail = await hailForWorkflow(session.ownerId, session.accessToken, workflow.h3_cells, step)
        if ('error' in hail) throw new Error(hail.error)
        hailMap = hailSummariesByHex(hail)
        rows = attachHail(rows, hailMap)
        log('info', `agent run hail_history succeeded · ${hail.length} hex summaries`)
        continue
      }
      if (step.kind === 'ai_column') {
        const ai = await applyAiColumnEnrichment(rows, step)
        rows = ai.rows
        for (const warning of ai.warnings) log('warn', warning)
        log(
          'info',
          `agent run ai_column succeeded · ${ai.applied_rows} rows · ${ai.used_model ? 'openai or fallback' : 'deterministic fallback'}`,
        )
      }
    }
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
    if (failed.error_message) logErrorLine(failed.logs, failed.error_message)
    await persistRun(session.ownerId, session.accessToken, failed)
    return failed
  }
}

export async function quoteQueryWorkflow(
  workflowId: string,
  cookies: Record<string, string>,
): Promise<WorkflowAgentQuote | { error: string; status: number }> {
  const workflow = await getQueryWorkflow(workflowId, cookies)
  if ('error' in workflow) return workflow
  const session = await requireWorkflowOwner(cookies)
  if ('error' in session) return session
  return quoteForWorkflow(
    workflowId,
    session.ownerId,
    workflow.h3_cells,
    workflow.enrichments,
    workflow.release_version,
  )
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
      'id, workflow_id, status, row_count, error_message, release_version, snapshot_status, historized_hexes, logs, quote_total_usd_cents, tips_usd_cents, ledger_debit_id, created_at, finished_at',
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
    logs: Array.isArray(row.logs) ? asLogs(row.logs) : [],
    quote_total_usd_cents: Number(row.quote_total_usd_cents) || 0,
    tips_usd_cents: Number(row.tips_usd_cents) || 0,
    ledger_debit_id: typeof row.ledger_debit_id === 'string' ? row.ledger_debit_id : null,
    created_at: String(row.created_at),
    finished_at: typeof row.finished_at === 'string' ? row.finished_at : null,
  }))
}

async function hailForWorkflow(
  ownerId: string,
  accessToken: string,
  cells: readonly string[],
  hail: Extract<WorkflowEnrichment, { kind: 'hail_history' }>,
): Promise<HailHexSummary[] | { error: string; status: number }> {
  const check = await checkHexSnapshots(cells)
  const floor = earliestSnapshotDate(check.cells)
  if (floor && floor > hail.end_date) return []
  const start = floor && floor > hail.start_date ? floor : hail.start_date
  return hailSummariesFor(ownerId, accessToken, cells, start, hail.end_date)
}

const INSPECT_THEMES = ['places', 'buildings', 'addresses'] as const

/** Every theme for the hexes, joined into inspect rows (unfiltered). */
export async function loadInspectRows(cells: readonly string[], release: string | null) {
  const [places, buildings, addresses] = await Promise.all(
    INSPECT_THEMES.map((dataset) => provider().runQuery(themeSpec(dataset, cells, release))),
  )
  return mergeFeatureRows(places.rows, buildings.rows, addresses.rows)
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
  let { error } = await client.from('query_workflow_runs').insert({
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
    logs: run.logs,
    quote_total_usd_cents: run.quote_total_usd_cents,
    tips_usd_cents: run.tips_usd_cents,
    ledger_debit_id: run.ledger_debit_id,
    finished_at: run.finished_at,
  })
  if (error && /column|schema cache|PGRST204|does not exist/i.test(error.message)) {
    ;({ error } = await client.from('query_workflow_runs').insert({
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
    }))
  }
  if (error) console.error('[workflow-runs]', error.message)
}

function withoutRows(run: QueryWorkflowRun): Omit<QueryWorkflowRun, 'rows'> {
  const { rows: _rows, ...rest } = run
  return rest
}

function publicRunError(message: string): string {
  if (/does not exist|schema cache/i.test(message)) {
    return 'Run supabase/migrations/20261027_workflow_enrichments.sql and supabase/migrations/20261028_agentic_ledger.sql in the Supabase SQL editor.'
  }
  return message.length > 0 && message.length < 180 ? message : 'The workflow run failed.'
}

async function quoteForWorkflow(
  workflowId: string,
  ownerId: string,
  h3Cells: readonly string[],
  enrichments: readonly WorkflowEnrichment[],
  releasePin: string | null,
): Promise<WorkflowAgentQuote> {
  const check = await checkHexSnapshots(h3Cells)
  const missing = check.cells.filter((cell) => !cell.processed).map((cell) => cell.h3)
  const processBatches = chunkHexesForAgent(missing, MAX_AGENT_HEX_BATCH)
  const estimatedRows = Math.max(10, Math.min(200, h3Cells.length * 22))
  return quoteWorkflowAgents({
    ownerId,
    workflowId,
    releaseVersion: releasePin ?? check.current_release_version,
    selectedHexCount: h3Cells.length,
    missingHexes: missing,
    processBatches,
    enrichments,
    estimatedRows,
  })
}

async function processMissingHexes(
  quote: WorkflowAgentQuote,
  log: (level: JobLog['level'], message: string) => void,
) {
  for (const batch of quote.process_batches) {
    await processBatch(batch, quote.release_version, log)
  }
}

async function processBatch(
  batch: readonly string[],
  releaseVersion: string,
  log: (level: JobLog['level'], message: string) => void,
): Promise<void> {
  if (batch.length === 0) return
  try {
    const job = createIngestionJob({
      release_version: releaseVersion,
      h3_cells: [...batch],
      datasets: ['places', 'buildings', 'addresses'],
    })
    runIngestionJob(job.id)
    const done = await waitForJob(job.id)
    if (done.status !== 'succeeded') {
      throw new Error(done.error_message || `Process job ${done.run_id} failed.`)
    }
    log('info', `agent process batch ${batch.length} hexes succeeded · ${done.run_id}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Process batch failed.'
    if (batch.length > 1 && /connected|group|Select at most|too large|Invalid H3 cell/i.test(message)) {
      for (const cell of batch) await processBatch([cell], releaseVersion, log)
      return
    }
    throw new Error(message)
  }
}

async function waitForJob(id: string): Promise<NonNullable<ReturnType<typeof getIngestionJob>>> {
  const timeoutMs = 8 * 60_000
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const job = getIngestionJob(id)
    if (!job) throw new Error(`Process job ${id} disappeared.`)
    if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled') return job
    await delay(250)
  }
  throw new Error(`Process job ${id} timed out.`)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function asLogs(value: unknown[]): JobLog[] {
  const logs: JobLog[] = []
  for (const row of value) {
    if (
      typeof row === 'object' &&
      row !== null &&
      typeof (row as { at?: unknown }).at === 'string' &&
      (row as { level?: unknown }).level &&
      typeof (row as { message?: unknown }).message === 'string'
    ) {
      const level = (row as { level: string }).level
      if (level === 'info' || level === 'warn' || level === 'error') {
        logs.push({
          at: (row as { at: string }).at,
          level,
          message: (row as { message: string }).message,
        })
      }
    }
  }
  return logs
}

function logErrorLine(logs: JobLog[], message: string) {
  logs.push({ at: new Date().toISOString(), level: 'error', message })
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}
