import type { GeoJsonPosition } from '../lib/geojson'
import type { FeatureRow } from '../lib/feature-rows'
import type { QuerySnapshotStatus } from './releases'

export const ENRICHMENT_KINDS = ['geofence', 'hail_history'] as const
export type EnrichmentKind = (typeof ENRICHMENT_KINDS)[number]

export type GeofenceKeep = 'inside' | 'outside'

export type GeofencePolygon = {
  type: 'Polygon'
  coordinates: GeoJsonPosition[][]
}

export type GeofenceEnrichment = {
  id: string
  kind: 'geofence'
  /** Keep rows inside the polygon, or keep rows outside it. */
  keep: GeofenceKeep
  polygon: GeofencePolygon
}

export type HailHistoryEnrichment = {
  id: string
  kind: 'hail_history'
  start_date: string
  end_date: string
}

export type WorkflowEnrichment = GeofenceEnrichment | HailHistoryEnrichment

export type HailHexStat = {
  h3: string
  day: string
  mesh_mm_max: number | null
  source_key: string | null
}

export type HailHexSummary = {
  h3: string
  hail_mm_max: number | null
  hail_days: number
  hail_last_date: string | null
}

export type QueryWorkflowRunStatus = 'queued' | 'running' | 'succeeded' | 'failed'

export type QueryWorkflowRun = {
  id: string
  workflow_id: string
  status: QueryWorkflowRunStatus
  row_count: number
  error_message: string | null
  rows: FeatureRow[]
  release_version: string | null
  snapshot_status: QuerySnapshotStatus | null
  historized_hexes: string[]
  created_at: string
  finished_at: string | null
}

export type HailEnrichRequest = {
  h3_cells: string[]
  start_date: string
  end_date: string
}

export type HailEnrichResponse = {
  cells: HailHexSummary[]
  start_date: string
  end_date: string
  source: 'NOAA MRMS MESH_Max_1440min'
  days: number
}
