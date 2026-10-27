import { createHash } from 'node:crypto'
import { areNeighborCells, cellToBoundary, getResolution, isValidCell } from 'h3-js'
import { H3_RESOLUTION } from '../lib/limits'
import { defaultOvertureRelease } from '../lib/overture'
import { serverEnv } from '../lib/server-env'
import {
  WORKFLOW_DATASETS,
  type WorkflowBoundingBox,
  type WorkflowDataset,
  type WorkflowIngestionLimits,
  type WorkflowIngestionPlan,
  type WorkflowIngestionPlanRequest,
} from '../types/workflows'

const HARD_MAX_HEXES = 20
const HARD_MAX_BBOX_AREA_KM2 = 220
const HARD_MAX_ROWS_PER_DATASET = 1_000_000
const HARD_MAX_TOTAL_ROWS = 2_000_000
const KM_PER_DEGREE_LAT = 110.574

type PlanRequestParsed = {
  releaseVersion: string
  datasets: WorkflowDataset[]
  cells: string[]
}

export function workflowIngestionLimits(): WorkflowIngestionLimits {
  return {
    max_hexes: HARD_MAX_HEXES,
    max_bbox_area_km2: clampNumber('WORKFLOW_MAX_BBOX_AREA_KM2', 180, HARD_MAX_BBOX_AREA_KM2),
    max_rows_per_dataset: clampInt(
      'WORKFLOW_MAX_ROWS_PER_DATASET',
      400_000,
      HARD_MAX_ROWS_PER_DATASET,
    ),
    max_total_rows: clampInt('WORKFLOW_MAX_TOTAL_ROWS', 900_000, HARD_MAX_TOTAL_ROWS),
    h3_resolution: H3_RESOLUTION,
    default_release_version: defaultOvertureRelease(),
  }
}

export function planWorkflowIngestion(body: unknown): WorkflowIngestionPlan {
  const parsed = parseRequest(body)
  const limits = workflowIngestionLimits()
  const bbox = boundsForCells(parsed.cells)
  if (bbox.area_km2 > limits.max_bbox_area_km2) {
    throw new Error(
      `Selection is too large (${round2(bbox.area_km2)} km2). Max allowed is ${limits.max_bbox_area_km2} km2.`,
    )
  }

  const maxRowsByDataset = Object.fromEntries(
    parsed.datasets.map((dataset) => [dataset, limits.max_rows_per_dataset]),
  ) as Record<WorkflowDataset, number>
  const maxTotalRows = Math.min(limits.max_total_rows, parsed.datasets.length * limits.max_rows_per_dataset)
  const normalized = [...parsed.cells].sort()
  const hexSetHash = createHash('sha256').update(normalized.join(',')).digest('hex')
  const runId = buildRunId(parsed.releaseVersion, hexSetHash)

  return {
    release_version: parsed.releaseVersion,
    h3_resolution: H3_RESOLUTION,
    h3_cells: normalized,
    hex_set_hash: hexSetHash,
    datasets: parsed.datasets,
    bbox,
    limits,
    max_rows_by_dataset: maxRowsByDataset,
    max_total_rows: maxTotalRows,
    input_prefix: cleanPrefix(serverEnv('OVERTURE_SILVER_PREFIX') || 's3://worldpulse/overture-silver'),
    output_prefix: cleanPrefix(serverEnv('WORKFLOW_OUTPUT_PREFIX') || 's3://worldpulse/workflows'),
    metrics_prefix: cleanPrefix(serverEnv('WORKFLOW_METRICS_PREFIX') || 's3://worldpulse/workflow-metrics'),
    run_id: runId,
    created_at: new Date().toISOString(),
  }
}

function parseRequest(body: unknown): PlanRequestParsed {
  if (!isRecord(body)) throw new Error('Request body must be an object.')
  if (typeof body.release_version !== 'string') throw new Error('release_version is required.')
  if (!Array.isArray(body.h3_cells)) throw new Error('h3_cells must be an array.')
  const releaseVersion = body.release_version.trim()
  if (!/^[A-Za-z0-9._-]{3,64}$/.test(releaseVersion)) {
    throw new Error('release_version must be 3-64 characters: letters, numbers, dot, underscore, or dash.')
  }

  const rawCells = body.h3_cells.filter((cell): cell is string => typeof cell === 'string').map((cell) => cell.trim())
  if (rawCells.length !== body.h3_cells.length) throw new Error('h3_cells must contain only strings.')
  const cells = [...new Set(rawCells)]
  if (cells.length === 0) throw new Error('Select at least one hex.')
  if (cells.length > HARD_MAX_HEXES) throw new Error(`Select at most ${HARD_MAX_HEXES} hexes per workflow run.`)
  for (const cell of cells) {
    if (!isValidCell(cell)) throw new Error(`Invalid H3 cell: ${cell}`)
    if (getResolution(cell) !== H3_RESOLUTION) throw new Error(`Cell ${cell} is not H3 resolution ${H3_RESOLUTION}.`)
  }
  if (!isConnected(cells)) {
    throw new Error('Selected hexes must form one connected group.')
  }

  const datasets = parseDatasets(body.datasets)
  return { releaseVersion, datasets, cells }
}

function parseDatasets(value: unknown): WorkflowDataset[] {
  if (value == null) return [...WORKFLOW_DATASETS]
  if (!Array.isArray(value)) throw new Error('datasets must be an array.')
  if (!value.every((dataset) => typeof dataset === 'string')) throw new Error('datasets must contain only strings.')
  const unique = [...new Set(value.map((dataset) => dataset.trim()))]
  if (unique.length === 0) throw new Error('datasets must include at least one dataset.')
  for (const dataset of unique) {
    if (!(WORKFLOW_DATASETS as readonly string[]).includes(dataset)) {
      throw new Error(`Unsupported dataset: ${dataset}`)
    }
  }
  return unique as WorkflowDataset[]
}

function isConnected(cells: readonly string[]): boolean {
  if (cells.length <= 1) return true
  const visited = new Set<string>()
  const queue = [cells[0]]
  visited.add(cells[0])
  while (queue.length > 0) {
    const current = queue.shift() as string
    for (const candidate of cells) {
      if (visited.has(candidate)) continue
      if (areNeighborCells(current, candidate)) {
        visited.add(candidate)
        queue.push(candidate)
      }
    }
  }
  return visited.size === cells.length
}

function boundsForCells(cells: readonly string[]): WorkflowBoundingBox {
  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity
  for (const cell of cells) {
    for (const [lng, lat] of cellToBoundary(cell, true)) {
      west = Math.min(west, lng)
      south = Math.min(south, lat)
      east = Math.max(east, lng)
      north = Math.max(north, lat)
    }
  }
  if (!Number.isFinite(west) || !Number.isFinite(east) || !Number.isFinite(south) || !Number.isFinite(north)) {
    throw new Error('Unable to compute bounds for selected hexes.')
  }
  const midLat = (north + south) / 2
  const widthKm = Math.max(0, east - west) * KM_PER_DEGREE_LAT * Math.max(0.2, Math.cos((midLat * Math.PI) / 180))
  const heightKm = Math.max(0, north - south) * KM_PER_DEGREE_LAT
  const areaKm2 = widthKm * heightKm
  return {
    west: round6(west),
    south: round6(south),
    east: round6(east),
    north: round6(north),
    width_km: round2(widthKm),
    height_km: round2(heightKm),
    area_km2: round2(areaKm2),
  }
}

function cleanPrefix(value: string): string {
  return value.replace(/\/+$/, '')
}

function clampInt(name: string, fallback: number, hardMax: number): number {
  const raw = serverEnv(name)
  const value = Number.parseInt(raw, 10)
  if (!Number.isFinite(value) || value <= 0) return fallback
  return Math.max(1, Math.min(hardMax, value))
}

function clampNumber(name: string, fallback: number, hardMax: number): number {
  const raw = serverEnv(name)
  const value = Number.parseFloat(raw)
  if (!Number.isFinite(value) || value <= 0) return fallback
  return Math.max(1, Math.min(hardMax, value))
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function buildRunId(releaseVersion: string, hash: string): string {
  const cleanRelease = releaseVersion.replace(/[^A-Za-z0-9]/g, '')
  return `${cleanRelease}-${hash.slice(0, 12)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function asWorkflowIngestionPlanRequest(body: unknown): WorkflowIngestionPlanRequest | null {
  if (!isRecord(body) || typeof body.release_version !== 'string' || !Array.isArray(body.h3_cells)) return null
  return body as WorkflowIngestionPlanRequest
}
