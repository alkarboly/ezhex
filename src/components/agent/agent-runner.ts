import type { QueryClient } from '@tanstack/react-query'
import { latLngToCell } from 'h3-js'
import { connectedHexBatches } from '../../lib/hex-batches'
import { compileInspectSql } from '../../lib/inspect-sql'
import { H3_RESOLUTION, MAX_AGENT_HEX_BATCH } from '../../lib/limits'
import { fitGeofencePolygon, polygonVertexCount } from '../../lib/polygon-input'
import { AgentRequestError, buildAgentQuery, planAgent } from '../../services/agent'
import { createQueryWorkflow, enrichHail, runQueryWorkflow } from '../../services/query-workflows'
import { createIngestionJob, getHexStatus, getIngestionJob } from '../../services/workflow-ingestion'
import {
  newAgentTurn,
  useAgent,
  type AgentBatch,
  type AgentErrorKind,
  type AgentStep,
  type AgentStepId,
  type AgentTurn,
} from '../../store/agent-store'
import { useExplorer } from '../../store/explorer-store'
import type { AgentPlan, AgentPrevious, AgentQueryResponse, AgentViewContext } from '../../types/agents'
import type { GeofencePolygon, HailHistoryEnrichment, WorkflowEnrichment } from '../../types/enrichments'
import type { IngestionJob } from '../../types/workflows'

type RunnerConfig = {
  client: QueryClient | null
  getView: () => AgentViewContext | null
  /** Screen x where the open agent panel ends, so the inspect window opens beside it. */
  panelRight: () => number
  desktop: () => boolean
}

const POLL_MS = 1_200
const JOB_TIMEOUT_MS = 10 * 60_000
/** Cached and mock jobs finish instantly. A short floor keeps each batch visible. */
const MIN_BATCH_MS = 650
const REVEAL_FRAMES = 16
const REVEAL_FRAME_MS = 55

const config: RunnerConfig = {
  client: null,
  getView: () => null,
  panelRight: () => 0,
  desktop: () => true,
}
let controller: AbortController | null = null

class StepError extends Error {
  readonly kind: AgentErrorKind

  constructor(message: string, kind: AgentErrorKind = 'generic') {
    super(message)
    this.name = 'StepError'
    this.kind = kind
  }
}

export function configureAgentRunner(next: Partial<RunnerConfig>) {
  Object.assign(config, next)
}

export function stopAgent() {
  controller?.abort()
  const latest = useAgent.getState().turns[useAgent.getState().turns.length - 1]
  if (latest?.status === 'confirm') {
    patchStep(latest.id, 'region', {
      state: 'skipped',
      detail: 'Stopped before processing.',
      endedAt: Date.now(),
    })
    patch(latest.id, { status: 'stopped' })
  }
}

export function agentPrompt(prompt: string) {
  useAgent.getState().setOpen(true)
  void runAgent(prompt)
}

export async function runAgent(prompt: string): Promise<void> {
  const text = prompt.trim()
  if (!text || controller) return
  const agent = useAgent.getState()
  const previous = previousContext()
  const id = makeId()
  agent.addTurn(newAgentTurn(id, text))
  const local = new AbortController()
  controller = local
  const signal = local.signal
  let current: AgentStepId = 'plan'
  try {
    begin(id, 'plan', 'Reading your request')
    const explorer = useExplorer.getState()
    const plan = await planAgent(
      {
        prompt: text,
        selection: explorer.selectedCells,
        view: config.getView(),
        polygon: agent.attachment?.polygon ?? null,
        weather: agent.weather,
        previous,
      },
      signal,
    )
    patch(id, { plan })
    finish(id, 'plan', plan.used_model ? 'Planned with the model' : 'Planned with built-in rules')

    current = 'region'
    await showRegion(id, plan, signal)
  } catch (error) {
    if (signal.aborted) stopTurn(id, current)
    else failTurn(id, current, error)
  } finally {
    if (controller === local) controller = null
    useAgent.getState().setProcessingCells([])
  }
}

/** Continue after the person confirms the hexes on the map. */
export async function confirmAgentHexes(id: string): Promise<void> {
  const turn = findTurn(id)
  if (!turn || turn.status !== 'confirm' || !turn.plan || controller) return
  const selected = useExplorer.getState().selectedCells
  if (selected.length === 0) {
    patchStep(id, 'region', { detail: 'Select at least one hex on the map, then confirm.' })
    return
  }
  const local = new AbortController()
  controller = local
  const signal = local.signal
  let current: AgentStepId = 'region'
  patch(id, { status: 'working', error: null })
  try {
    const plan = await applyConfirmedHexes(id, turn.plan, selected)
    current = 'process'
    const cells = await processHexes(id, plan, signal)
    current = 'query'
    const query = await composeQuery(id, turn.prompt, plan, cells, signal)
    current = 'weather'
    await previewWeather(id, cells, query, signal)
    current = 'review'
    patchStep(id, 'review', { state: 'waiting', startedAt: Date.now(), detail: 'Waiting for your approval' })
    patch(id, { status: 'review' })
    useAgent.getState().markUnread()
  } catch (error) {
    if (signal.aborted) stopTurn(id, current)
    else failTurn(id, current, error)
  } finally {
    if (controller === local) controller = null
    useAgent.getState().setProcessingCells([])
  }
}

export async function approveAgent(id: string): Promise<void> {
  const turn = findTurn(id)
  if (!turn || turn.status !== 'review' || !turn.query || controller) return
  const local = new AbortController()
  controller = local
  patch(id, { status: 'running', error: null })
  finish(id, 'review', 'Approved')
  begin(id, 'run', turn.workflow ? 'Running the saved workflow' : 'Saving the workflow')
  try {
    const workflow = turn.workflow ?? (await saveWorkflow(turn, turn.query))
    patch(id, { workflow })
    patchStep(id, 'run', { detail: 'Agents running · process, enrich, ledger' })
    const run = await runQueryWorkflow(workflow.id)
    if (run.status === 'failed') throw new Error(run.error_message || 'The workflow run failed.')
    patch(id, {
      status: 'done',
      result: {
        workflowId: workflow.id,
        workflowName: workflow.name,
        runId: run.id,
        rowCount: run.row_count,
        rows: run.rows,
        spentCents: run.quote_total_usd_cents,
        tipsCents: run.tips_usd_cents,
      },
    })
    finish(id, 'run', `${run.row_count} rows · ${formatUsd(run.quote_total_usd_cents)} charged`)
    void config.client?.invalidateQueries({ queryKey: ['query-workflows'] })
    void config.client?.invalidateQueries({ queryKey: ['agent-ledger'] })
    useAgent.getState().markUnread()
  } catch (error) {
    const message = messageOf(error)
    patchStep(id, 'run', { state: 'error', endedAt: Date.now(), detail: message })
    patchStep(id, 'review', { state: 'waiting', endedAt: null, detail: 'Fix the issue, then approve again' })
    patch(id, { status: 'review', error: { message, kind: errorKind(error), step: 'run' } })
  } finally {
    if (controller === local) controller = null
  }
}

/** Attach a custom region for the next prompt and outline it on the map. */
export function attachAgentPolygon(polygon: GeofencePolygon, label: string) {
  const fitted = fitGeofencePolygon(polygon)
  useAgent.getState().setAttachment({
    polygon: fitted.polygon,
    label,
    vertices: polygonVertexCount(fitted.polygon),
    simplified: fitted.simplified,
  })
  const explorer = useExplorer.getState()
  explorer.upsertDraftEnrichment({ id: 'geofence', kind: 'geofence', keep: 'inside', polygon: fitted.polygon })
  const ring = fitted.polygon.coordinates[0]
  const lngs = ring.map((point) => point[0])
  const lats = ring.map((point) => point[1])
  explorer.fitToCells([
    latLngToCell(Math.min(...lats), Math.min(...lngs), H3_RESOLUTION),
    latLngToCell(Math.max(...lats), Math.max(...lngs), H3_RESOLUTION),
  ])
}

/** Opens the inspect table and add-ons panel so a person can change what the agent built. */
export function reviewInInspect() {
  const explorer = useExplorer.getState()
  if (config.desktop()) explorer.setInspectPosition({ x: config.panelRight() + 16, y: 64 })
  else useAgent.getState().setOpen(false)
  explorer.setInspectOpen(true)
  explorer.setEnrichOpen(true)
}

// ---------- steps ----------

async function showRegion(id: string, plan: AgentPlan, signal: AbortSignal) {
  begin(id, 'region', plan.region.label)
  const explorer = useExplorer.getState()
  if (explorer.inspectOpen || explorer.inspectReplay) explorer.exitQuery()
  explorer.setHailSummaries([])
  explorer.setDraftEnrichments(
    plan.region.polygon
      ? [{ id: 'geofence', kind: 'geofence', keep: plan.intent.geofence_keep ?? 'inside', polygon: plan.region.polygon }]
      : [],
  )
  explorer.revealCells([])
  explorer.fitToCells(plan.h3_cells)
  await sleep(420, signal)
  const total = plan.h3_cells.length
  const frames = Math.min(REVEAL_FRAMES, total)
  for (let frame = 1; frame <= frames; frame += 1) {
    const count = Math.ceil((total * frame) / frames)
    useExplorer.getState().revealCells(plan.h3_cells.slice(0, count))
    patch(id, { revealed: count })
    await sleep(REVEAL_FRAME_MS, signal)
  }
  patchStep(id, 'region', {
    state: 'waiting',
    detail: `Confirm ${plural(total, 'hex', 'hexes')} · click the map to add or remove`,
  })
  patch(id, { status: 'confirm' })
  useAgent.getState().markUnread()
}

async function applyConfirmedHexes(id: string, plan: AgentPlan, cells: readonly string[]): Promise<AgentPlan> {
  begin(id, 'region', `Checking ${plural(cells.length, 'hex', 'hexes')}`)
  const coverage = await getHexStatus(cells)
  const status = new Map(coverage.cells.map((cell) => [cell.h3, cell]))
  const ready = cells.filter((cell) => status.get(cell)?.status === 'ready')
  const missing = cells.filter((cell) => status.get(cell)?.status !== 'ready' && status.get(cell)?.status !== 'processing')
  const processingJobs = [
    ...new Set(
      cells
        .map((cell) => status.get(cell))
        .filter((cell) => cell?.status === 'processing' && cell.job_id)
        .map((cell) => cell?.job_id as string),
    ),
  ]
  const next: AgentPlan = {
    ...plan,
    h3_cells: [...cells],
    ready,
    missing,
    processing_jobs: processingJobs,
    batches: connectedHexBatches(missing, MAX_AGENT_HEX_BATCH),
    release_version: coverage.current_release_version,
  }
  patch(id, { plan: next, revealed: cells.length })
  finish(
    id,
    'region',
    `${plural(cells.length, 'hex', 'hexes')} confirmed · ${ready.length} ready · ${missing.length} to process`,
  )
  return next
}

async function processHexes(id: string, plan: AgentPlan, signal: AbortSignal): Promise<string[]> {
  if (plan.batches.length === 0 && plan.processing_jobs.length === 0) {
    patchStep(id, 'process', { state: 'skipped', detail: `All ${plural(plan.h3_cells.length, 'hex', 'hexes')} have data` })
    return plan.h3_cells
  }
  begin(
    id,
    'process',
    plan.batches.length > 0
      ? `${plural(plan.missing.length, 'new hex', 'new hexes')} · one job each`
      : 'Waiting for a job that is already running',
  )
  patch(id, {
    batches: plan.batches.map((cells, index) => ({
      index,
      cells,
      state: 'queued',
      jobId: null,
      runId: null,
      rows: null,
      log: null,
      error: null,
    })),
  })
  for (const jobId of plan.processing_jobs) {
    try {
      await followJob(await getIngestionJob(jobId), signal, () => {})
    } catch (error) {
      if (signal.aborted) throw error
    }
  }
  const failed = new Set<string>()
  let rows = 0
  for (const [index, cells] of plan.batches.entries()) {
    useAgent.getState().setProcessingCells(cells)
    patchBatch(id, index, { state: 'running', log: 'Creating the ingest job' })
    const started = performance.now()
    try {
      const payload = {
        release_version: plan.release_version,
        h3_cells: cells,
        datasets: ['places', 'buildings', 'addresses'] as ['places', 'buildings', 'addresses'],
      }
      const created = await createIngestionJob(payload)
      patchBatch(id, index, { jobId: created.id, runId: created.run_id, log: lastLog(created) })
      const done = await followJob(
        created,
        signal,
        (job) => patchBatch(id, index, { log: lastLog(job) }),
        () => createIngestionJob(payload),
      )
      const elapsed = performance.now() - started
      if (elapsed < MIN_BATCH_MS) await sleep(MIN_BATCH_MS - elapsed, signal)
      if (done.status !== 'succeeded') throw new Error(done.error_message || `Job ${done.run_id} ${done.status}.`)
      rows += done.rows_total
      patchBatch(id, index, { state: 'done', rows: done.rows_total, log: done.note ?? lastLog(done) })
    } catch (error) {
      if (signal.aborted) throw error
      for (const cell of cells) failed.add(cell)
      patchBatch(id, index, { state: 'error', error: messageOf(error) })
    }
    void config.client?.invalidateQueries({ queryKey: ['hex-status'] })
  }
  useAgent.getState().setProcessingCells([])
  void config.client?.invalidateQueries({ queryKey: ['ingestion-jobs'] })
  const kept = plan.h3_cells.filter((cell) => !failed.has(cell))
  if (kept.length === 0) throw new StepError('No hexes could be processed. The Jobs page has the logs.')
  if (failed.size > 0) {
    useExplorer.getState().revealCells(kept)
    patch(id, (turn) => (turn.plan ? { plan: { ...turn.plan, h3_cells: kept } } : {}))
  }
  finish(
    id,
    'process',
    failed.size > 0
      ? `${plural(failed.size, 'hex', 'hexes')} failed and were left out · ${formatRows(rows)} rows added`
      : `${plural(plan.missing.length, 'hex', 'hexes')} processed · ${formatRows(rows)} rows`,
  )
  return kept
}

async function composeQuery(
  id: string,
  prompt: string,
  plan: AgentPlan,
  cells: string[],
  signal: AbortSignal,
): Promise<AgentQueryResponse> {
  begin(id, 'query', `Reading rows in ${plural(cells.length, 'hex', 'hexes')}`)
  const query = await buildAgentQuery({ prompt, h3_cells: cells, intent: plan.intent, region: plan.region }, signal)
  patch(id, { query })
  useExplorer.getState().applyAgentQuery({
    h3_cells: cells,
    filters: query.filters,
    sql: query.sql,
    enrichments: query.enrichments,
    workflowName: query.workflow_name,
    openInspect: false,
    openEnrich: false,
    fit: false,
    notice: null,
  })
  const kept = query.fenced_rows ?? query.matched_rows
  finish(id, 'query', `${formatRows(kept)} of ${formatRows(query.total_rows)} rows selected`)
  return query
}

async function previewWeather(id: string, cells: string[], query: AgentQueryResponse, signal: AbortSignal) {
  const hail = query.enrichments.find((step): step is HailHistoryEnrichment => step.kind === 'hail_history')
  if (!hail) {
    patchStep(id, 'weather', { state: 'skipped', detail: 'Not requested' })
    return
  }
  begin(id, 'weather', `NOAA MRMS MESH · ${hail.start_date} to ${hail.end_date}`)
  try {
    const result = await enrichHail({ h3_cells: cells, start_date: hail.start_date, end_date: hail.end_date })
    if (signal.aborted) return
    const explorer = useExplorer.getState()
    explorer.setHailSummaries(result.cells)
    explorer.setDraftEnrichments(
      explorer.draftEnrichments.map((step): WorkflowEnrichment =>
        step.kind === 'hail_history' ? { ...step, start_date: result.start_date, end_date: result.end_date } : step,
      ),
    )
    patch(id, { hail: { start: result.start_date, end: result.end_date, days: result.days, cells: result.cells } })
    const hit = result.cells.filter((cell) => cell.hail_days > 0)
    const max = Math.max(0, ...result.cells.map((cell) => cell.hail_mm_max ?? 0))
    finish(
      id,
      'weather',
      hit.length > 0
        ? `Hail in ${plural(hit.length, 'hex', 'hexes')} · max ${max.toFixed(1)} mm over ${result.days} days`
        : `No hail in ${result.days} days`,
    )
  } catch (error) {
    if (signal.aborted) return
    const message = messageOf(error)
    patch(id, { hailError: message })
    patchStep(id, 'weather', { state: 'error', endedAt: Date.now(), detail: message })
  }
}

async function saveWorkflow(turn: AgentTurn, query: AgentQueryResponse): Promise<{ id: string; name: string }> {
  const explorer = useExplorer.getState()
  const cells = explorer.selectedCells.length > 0 ? explorer.selectedCells : (turn.plan?.h3_cells ?? [])
  if (cells.length === 0) throw new StepError('Select at least one hex, then approve again.')
  const filters = explorer.inspectOpen ? explorer.inspectFilters : query.filters
  const name = `${query.workflow_name || 'Agent workflow'} · ${clockLabel()}`.slice(0, 120)
  const saved = await createQueryWorkflow({
    name,
    sql: compileInspectSql(cells, filters, explorer.inspectRelease),
    custom_sql: false,
    h3_cells: [...cells],
    filters,
    enrichments: explorer.draftEnrichments,
    release_version: explorer.inspectRelease,
  })
  return { id: saved.id, name: saved.name }
}

async function followJob(
  start: IngestionJob,
  signal: AbortSignal,
  onUpdate: (job: IngestionJob) => void,
  recreate?: () => Promise<IngestionJob>,
): Promise<IngestionJob> {
  let job = start
  const began = Date.now()
  let retried = false
  while (job.status === 'queued' || job.status === 'running') {
    if (Date.now() - began > JOB_TIMEOUT_MS) {
      throw new Error('This job is taking more than 10 minutes. It keeps running on the Jobs page.')
    }
    await sleep(POLL_MS, signal)
    try {
      job = await getIngestionJob(job.id)
    } catch (error) {
      const missing = error instanceof Error && /No such ingestion job/i.test(error.message)
      if (!missing || !recreate || retried) throw error
      retried = true
      job = await recreate()
    }
    onUpdate(job)
  }
  return job
}

// ---------- turn state ----------

function previousContext(): AgentPrevious | null {
  const turns = useAgent.getState().turns
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index]
    if (turn.plan && turn.query && turn.status !== 'error' && turn.status !== 'stopped') {
      return { intent: turn.plan.intent, region: turn.plan.region, h3_cells: turn.plan.h3_cells }
    }
  }
  return null
}

function findTurn(id: string): AgentTurn | undefined {
  return useAgent.getState().turns.find((turn) => turn.id === id)
}

function patch(id: string, value: Partial<AgentTurn> | ((turn: AgentTurn) => Partial<AgentTurn>)) {
  useAgent.getState().patchTurn(id, value)
}

function patchStep(id: string, step: AgentStepId, value: Partial<AgentStep>) {
  useAgent.getState().patchStep(id, step, value)
}

function patchBatch(id: string, index: number, value: Partial<AgentBatch>) {
  useAgent.getState().patchBatch(id, index, value)
}

function begin(id: string, step: AgentStepId, detail: string) {
  patchStep(id, step, { state: 'active', detail, startedAt: Date.now(), endedAt: null })
}

function finish(id: string, step: AgentStepId, detail: string) {
  patchStep(id, step, { state: 'done', detail, endedAt: Date.now() })
}

function stopTurn(id: string, step: AgentStepId) {
  patchStep(id, step, { state: 'skipped', detail: 'Stopped. Jobs that already started keep running on the server.', endedAt: Date.now() })
  patch(id, { status: 'stopped' })
}

function failTurn(id: string, step: AgentStepId, error: unknown) {
  const message = messageOf(error)
  patchStep(id, step, { state: 'error', detail: message, endedAt: Date.now() })
  patch(id, { status: 'error', error: { message, kind: errorKind(error), step } })
  useAgent.getState().markUnread()
}

function errorKind(error: unknown): AgentErrorKind {
  if (error instanceof StepError) return error.kind
  if (error instanceof AgentRequestError && error.status === 401) return 'auth'
  const message = messageOf(error)
  if (/sign in/i.test(message)) return 'auth'
  if (/workflow limit/i.test(message)) return 'limit'
  if (/insufficient credits/i.test(message)) return 'credits'
  return 'generic'
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Something went wrong.'
}

function lastLog(job: IngestionJob): string | null {
  return job.logs[job.logs.length - 1]?.message ?? job.note
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Stopped', 'AbortError'))
      return
    }
    const onAbort = () => {
      window.clearTimeout(timer)
      reject(new DOMException('Stopped', 'AbortError'))
    }
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function makeId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `turn-${Date.now()}-${Math.round(Math.random() * 1e6)}`
}

function clockLabel(): string {
  const now = new Date()
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`
}

function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`
}

function formatRows(count: number): string {
  return count.toLocaleString()
}

export function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}
