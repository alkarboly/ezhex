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
