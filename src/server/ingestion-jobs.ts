import { randomUUID } from 'node:crypto'
import { mockCoverageCells } from '../lib/h3'
import { MAX_VIEWPORT_CELLS } from '../lib/limits'
import { readDataMode } from '../lib/server-env'
import { compareOvertureRelease, defaultOvertureRelease } from '../lib/overture'
import { ingestMockCellsNow } from '../services/mock-provider'
import { supabaseHexReleases } from '../services/supabase-provider'
import { ingestOverturePlan } from './overture-ingest'
import type {
  HexCoverage,
  HexCoverageResponse,
  HexSnapshot,
  IngestionJob,
  JobLogLevel,
  WorkflowIngestionPlanRequest,
} from '../types/workflows'
import { planWorkflowIngestion } from './workflow-ingestion'

const MAX_JOBS = 200
const jobs = new Map<string, IngestionJob>()
let mockReady: Set<string> | null = null

function mockReadyCells(): ReadonlySet<string> {
  if (!mockReady) mockReady = new Set(mockCoverageCells())
  return mockReady
}

export function listIngestionJobs(): IngestionJob[] {
  for (const job of [...jobs.values()]) {
    if (job.status === 'queued') runIngestionJob(job.id)
  }
  return [...jobs.values()].sort((left, right) => right.created_at.localeCompare(left.created_at))
}

export function getIngestionJob(id: string): IngestionJob | null {
  return jobs.get(id) ?? null
}

export function createIngestionJob(body: unknown): IngestionJob {
  const plan = planWorkflowIngestion(body)
  const existing = [...jobs.values()].find(
    (job) =>
      job.release_version === plan.release_version &&
      job.hex_set_hash === plan.hex_set_hash &&
      sameDatasets(job.datasets, plan.datasets) &&
      (job.status === 'queued' || job.status === 'running' || job.status === 'succeeded'),
  )
  if (existing) return existing

  const now = new Date().toISOString()
  const mock = readDataMode().resolved === 'mock'
  const covered = plan.h3_cells.every((cell) => mockReadyCells().has(cell))
  const ready = mock && covered
  const job: IngestionJob = {
    id: randomUUID(),
    run_id: plan.run_id,
    status: ready ? 'succeeded' : 'queued',
    release_version: plan.release_version,
    h3_cells: plan.h3_cells,
    hex_set_hash: plan.hex_set_hash,
    datasets: plan.datasets,
    bbox: plan.bbox,
    plan,
    rows_total: 0,
    note: ready
      ? 'These hexes already have processed rows.'
      : 'Processing selected hexes on this server.',
    error_message: null,
    logs: [],
    created_at: now,
    started_at: ready ? now : null,
    finished_at: ready ? now : null,
  }
  appendLog(
    job,
    'info',
    `Created ${job.run_id} · ${readDataMode().resolved} · release ${job.release_version} · ${job.h3_cells.length} hexes · ${job.datasets.join(', ')} · ${job.bbox.area_km2} km2`,
  )
  appendLog(job, 'info', `Hexes ${job.h3_cells.join(', ')}`)
  if (ready) {
    appendLog(job, 'info', 'These hexes already have mock coverage. Marked ready.')
  }
  remember(job)
  if (ready) return job
  if (mock) return runIngestionJob(job.id)
  return startOvertureJob(job.id)
}

export function runIngestionJob(id: string): IngestionJob {
  const job = jobs.get(id)
  if (!job) throw new Error('No such ingestion job.')
  if (job.status === 'succeeded' || job.status === 'running') return job
  if (job.status === 'cancelled') throw new Error('This job was cancelled.')

  const now = new Date().toISOString()
  if (readDataMode().resolved === 'supabase') return startOvertureJob(id)

  job.status = 'running'
  job.started_at = now
  job.note = 'Processing selected hexes.'
  appendLog(job, 'info', `Mock ingest started for ${job.h3_cells.length} hexes.`)
  const result = ingestMockCellsNow(job.h3_cells)
  const finished = new Date().toISOString()
  job.status = 'succeeded'
  job.finished_at = finished
  job.rows_total = result.rows
  job.error_message = null
  job.note =
    result.added.length > 0
      ? `Processed ${result.added.length} hexes · ${result.rows} rows. Ready to query.`
      : `These hexes already had rows · ${result.rows} total. Ready to query.`
  appendLog(
    job,
    'info',
    result.added.length > 0
      ? `Mock ingest added ${result.added.length} hexes (${result.added.join(', ')}) · ${result.rows} rows.`
      : `Mock ingest reused coverage · ${result.rows} rows.`,
  )
  return job
}

export async function hexCoverageFor(cells: readonly string[]): Promise<HexCoverageResponse> {
  if (cells.length > MAX_VIEWPORT_CELLS) {
    throw new Error(`Ask for at most ${MAX_VIEWPORT_CELLS} hexes.`)
  }
  const unique = [...new Set(cells)]
  const currentRelease = defaultOvertureRelease()
  const ready = mockReadyCells()
  const releases =
    readDataMode().resolved === 'supabase'
      ? await supabaseHexReleases(unique)
      : new Map(unique.filter((cell) => ready.has(cell)).map((cell) => [cell, currentRelease] as const))
  const listed = unique.map((h3) => coverageForCell(h3, releases, currentRelease))
  return {
    cells: listed,
    current_release_version: currentRelease,
    ready_count: listed.filter((cell) => cell.status === 'ready').length,
    current_count: listed.filter((cell) => cell.snapshot === 'current').length,
    stale_count: listed.filter((cell) => cell.snapshot === 'stale').length,
    missing_count: listed.filter((cell) => cell.status === 'missing').length,
    processing_count: listed.filter((cell) => cell.status === 'processing').length,
  }
}

export function asHexCoverageRequest(body: unknown): { h3_cells: string[] } | null {
  if (typeof body !== 'object' || body === null || !Array.isArray((body as { h3_cells?: unknown }).h3_cells)) {
    return null
  }
  const cells = (body as { h3_cells: unknown[] }).h3_cells
  if (!cells.every((cell) => typeof cell === 'string')) return null
  return { h3_cells: cells }
}

export function asJobCreateRequest(body: unknown): WorkflowIngestionPlanRequest | null {
  if (typeof body !== 'object' || body === null) return null
  const record = body as Record<string, unknown>
  if (typeof record.release_version !== 'string' || !Array.isArray(record.h3_cells)) return null
  return body as WorkflowIngestionPlanRequest
}

function coverageForCell(
  h3: string,
  releases: ReadonlyMap<string, string>,
  currentRelease: string,
): HexCoverage {
  const processing = [...jobs.values()].find(
    (job) => job.h3_cells.includes(h3) && (job.status === 'queued' || job.status === 'running'),
  )
  if (processing) {
    return { h3, status: 'processing', snapshot: null, release_version: null, job_id: processing.id }
  }

  const succeeded = [...jobs.values()].find((job) => job.h3_cells.includes(h3) && job.status === 'succeeded')
  const stored = releases.get(h3) ?? null
  const release = newerRelease(stored, succeeded?.release_version ?? null)
  if (release || succeeded) {
    return {
      h3,
      status: 'ready',
      snapshot: snapshotFor(release ?? succeeded?.release_version ?? currentRelease, currentRelease),
      release_version: release ?? succeeded?.release_version ?? null,
      job_id: succeeded?.id ?? null,
    }
  }
  return { h3, status: 'missing', snapshot: null, release_version: null, job_id: null }
}

function snapshotFor(release: string, currentRelease: string): HexSnapshot {
  return compareOvertureRelease(release, currentRelease) >= 0 ? 'current' : 'stale'
}

function newerRelease(left: string | null, right: string | null): string | null {
  if (!left) return right
  if (!right) return left
  return compareOvertureRelease(left, right) >= 0 ? left : right
}

function startOvertureJob(id: string): IngestionJob {
  const job = jobs.get(id)
  if (!job) throw new Error('No such ingestion job.')
  if (job.status === 'succeeded' || job.status === 'running') return job
  if (job.status === 'cancelled') throw new Error('This job was cancelled.')
  const now = new Date().toISOString()
  job.status = 'running'
  job.started_at = now
  job.finished_at = null
  job.error_message = null
  job.note = 'Downloading Overture for these hexes.'
  appendLog(job, 'info', 'Starting Overture download on this Node process.')
  void finishOvertureJob(id)
  return job
}

async function finishOvertureJob(id: string) {
  const job = jobs.get(id)
  if (!job) return
  try {
    const result = await ingestOverturePlan(job.plan, (level, message) => appendLog(job, level, message))
    job.status = 'succeeded'
    job.finished_at = new Date().toISOString()
    job.rows_total = result.rows
    job.error_message = null
    job.note = `Processed ${result.rows} Overture rows. Ready to query.`
    const elapsed = job.started_at ? Date.now() - Date.parse(job.started_at) : 0
    appendLog(
      job,
      'info',
      `Succeeded in ${elapsed}ms · ${result.rows} rows · ${Object.entries(result.by_dataset)
        .map(([dataset, count]) => `${dataset} ${count ?? 0}`)
        .join(' · ')}`,
    )
  } catch (error) {
    job.status = 'failed'
    job.finished_at = new Date().toISOString()
    job.error_message = error instanceof Error ? error.message : 'Overture ingest failed.'
    job.note = job.error_message
    appendLog(job, 'error', job.error_message)
  }
}

const MAX_LOGS = 200

function appendLog(job: IngestionJob, level: JobLogLevel, message: string) {
  if (!job.logs) job.logs = []
  job.logs.push({ at: new Date().toISOString(), level, message })
  if (job.logs.length > MAX_LOGS) job.logs.splice(0, job.logs.length - MAX_LOGS)
}

function sameDatasets(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false
  const next = new Set(right)
  return left.every((dataset) => next.has(dataset))
}

function remember(job: IngestionJob) {
  jobs.set(job.id, job)
  if (jobs.size <= MAX_JOBS) return
  const oldest = listIngestionJobs().at(-1)
  if (oldest) jobs.delete(oldest.id)
}
