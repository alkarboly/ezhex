import type {
  HexCoverageResponse,
  IngestionJob,
  WorkflowIngestionLimits,
  WorkflowIngestionPlan,
  WorkflowIngestionPlanRequest,
} from '../types/workflows'
import type { QuerySchemasResponse } from '../types/query-schemas'

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers:
      body === undefined
        ? { accept: 'application/json' }
        : { accept: 'application/json', 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message =
      isRecord(payload) && typeof payload.error === 'string' ? payload.error : `Request failed (${response.status})`
    throw new Error(message)
  }
  return payload as T
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function getWorkflowIngestionLimits() {
  return request<WorkflowIngestionLimits>('/api/workflow-ingestion/limits')
}

export function createWorkflowIngestionPlan(input: WorkflowIngestionPlanRequest) {
  return request<WorkflowIngestionPlan>('/api/workflow-ingestion/plan', input)
}

export function getQuerySchemas() {
  return request<QuerySchemasResponse>('/api/query-schemas')
}

export function createIngestionJob(input: WorkflowIngestionPlanRequest) {
  return request<IngestionJob>('/api/workflow-ingestion/jobs', input)
}

export function listIngestionJobs() {
  return request<IngestionJob[]>('/api/workflow-ingestion/jobs')
}

export function getHexStatus(h3Cells: readonly string[]) {
  return request<HexCoverageResponse>('/api/hex-status', { h3_cells: [...h3Cells] })
}
