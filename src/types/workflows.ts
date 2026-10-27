import type { DatasetId } from './datasets'

export const WORKFLOW_DATASETS = ['places', 'addresses', 'buildings'] as const satisfies readonly DatasetId[]
export type WorkflowDataset = (typeof WORKFLOW_DATASETS)[number]

export type WorkflowIngestionPlanRequest = {
  release_version: string
  h3_cells: string[]
  datasets?: WorkflowDataset[]
}

export type WorkflowBoundingBox = {
  west: number
  south: number
  east: number
  north: number
  width_km: number
  height_km: number
  area_km2: number
}

export type WorkflowIngestionLimits = {
  max_hexes: number
  max_bbox_area_km2: number
  max_rows_per_dataset: number
  max_total_rows: number
  h3_resolution: number
  default_release_version: string
}

export type WorkflowIngestionPlan = {
  release_version: string
  h3_resolution: number
  h3_cells: string[]
  hex_set_hash: string
  datasets: WorkflowDataset[]
  bbox: WorkflowBoundingBox
  limits: WorkflowIngestionLimits
  max_rows_by_dataset: Record<WorkflowDataset, number>
  max_total_rows: number
  input_prefix: string
  output_prefix: string
  metrics_prefix: string
  run_id: string
  created_at: string
}

export const INGESTION_JOB_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'cancelled'] as const
export type IngestionJobStatus = (typeof INGESTION_JOB_STATUSES)[number]

export const HEX_DATA_STATUSES = ['ready', 'missing', 'processing'] as const
export type HexDataStatus = (typeof HEX_DATA_STATUSES)[number]

export const HEX_SNAPSHOTS = ['current', 'stale'] as const
export type HexSnapshot = (typeof HEX_SNAPSHOTS)[number]

export type HexAction = 'process' | 'query' | 'workflow'

export const JOB_LOG_LEVELS = ['info', 'warn', 'error'] as const
export type JobLogLevel = (typeof JOB_LOG_LEVELS)[number]

export type JobLog = {
  at: string
  level: JobLogLevel
  message: string
}

export type IngestionJob = {
  id: string
  run_id: string
  status: IngestionJobStatus
  release_version: string
  h3_cells: string[]
  hex_set_hash: string
  datasets: WorkflowDataset[]
  bbox: WorkflowBoundingBox
  plan: WorkflowIngestionPlan
  rows_total: number
  note: string | null
  error_message: string | null
  logs: JobLog[]
  created_at: string
  started_at: string | null
  finished_at: string | null
}

export type HexCoverage = {
  h3: string
  status: HexDataStatus
  snapshot: HexSnapshot | null
  release_version: string | null
  job_id: string | null
}

export type HexCoverageResponse = {
  cells: HexCoverage[]
  current_release_version: string
  ready_count: number
  current_count: number
  stale_count: number
  missing_count: number
  processing_count: number
}
