import { randomUUID } from 'node:crypto'
import { mockCoverageCells } from '../lib/h3'
import { MAX_VIEWPORT_CELLS } from '../lib/limits'
import { readDataMode } from '../lib/server-env'
import type {
  HexCoverage,
  HexCoverageResponse,
  IngestionJob,
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
      ? 'These hexes already have mock coverage. The job is marked ready without a Spark run.'
      : 'Queued for the Spark runner. The Node process does not execute Spark.',
    error_message: null,
    created_at: now,
    started_at: ready ? now : null,
    finished_at: ready ? now : null,
  }
  remember(job)
  return job
}

export function hexCoverageFor(cells: readonly string[]): HexCoverageResponse {
  if (cells.length > MAX_VIEWPORT_CELLS) {
    throw new Error(`Ask for at most ${MAX_VIEWPORT_CELLS} hexes.`)
  }
  const unique = [...new Set(cells)]
  const listed = unique.map((h3) => coverageForCell(h3))
  return {
    cells: listed,
    ready_count: listed.filter((cell) => cell.status === 'ready').length,
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

function coverageForCell(h3: string): HexCoverage {
  const processing = [...jobs.values()].find(
    (job) => job.h3_cells.includes(h3) && (job.status === 'queued' || job.status === 'running'),
  )
  if (processing) return { h3, status: 'processing', job_id: processing.id }

  const succeeded = [...jobs.values()].find((job) => job.h3_cells.includes(h3) && job.status === 'succeeded')
  if (succeeded) return { h3, status: 'ready', job_id: succeeded.id }

  if (readDataMode().resolved === 'mock' && mockReadyCells().has(h3)) {
    return { h3, status: 'ready', job_id: null }
  }
  return { h3, status: 'missing', job_id: null }
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
