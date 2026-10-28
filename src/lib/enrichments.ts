import { asGeometry, pointInGeometry, type GeoJsonPosition } from './geojson'
import type { FeatureRow } from './feature-rows'
import { HAIL_MESH_START, MAX_ENRICHMENTS, MAX_GEOFENCE_VERTICES, MAX_HAIL_DAYS } from './limits'
import type {
  GeofenceEnrichment,
  GeofenceKeep,
  HailHexSummary,
  HailHistoryEnrichment,
  WorkflowEnrichment,
} from '../types/enrichments'

export function asEnrichments(value: unknown): WorkflowEnrichment[] | null {
  if (value == null) return []
  if (!Array.isArray(value)) return null
  if (value.length > MAX_ENRICHMENTS) return null
  const next: WorkflowEnrichment[] = []
  let hailCount = 0
  for (const entry of value) {
    const parsed = asEnrichment(entry)
    if (!parsed) return null
    if (parsed.kind === 'hail_history') hailCount += 1
    if (hailCount > 1) return null
    next.push(parsed)
  }
  return next
}

export function asEnrichment(value: unknown): WorkflowEnrichment | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.kind !== 'string') return null
  if (value.kind === 'geofence') return asGeofence(value)
  if (value.kind === 'hail_history') return asHail(value)
  return null
}

export function applyEnrichments(
  rows: readonly FeatureRow[],
  enrichments: readonly WorkflowEnrichment[],
  hailByHex: ReadonlyMap<string, HailHexSummary>,
): FeatureRow[] {
  let next = [...rows]
  for (const step of enrichments) {
    if (step.kind === 'geofence') next = applyGeofence(next, step)
    if (step.kind === 'hail_history') next = attachHail(next, hailByHex)
  }
  return next
}

export function applyGeofence(rows: readonly FeatureRow[], step: GeofenceEnrichment): FeatureRow[] {
  return rows.filter((row) => {
    const inside = pointInGeometry(row.lng, row.lat, step.polygon)
    return step.keep === 'inside' ? inside : !inside
  })
}

export function attachHail(rows: readonly FeatureRow[], hailByHex: ReadonlyMap<string, HailHexSummary>): FeatureRow[] {
  return rows.map((row) => {
    const hail = hailByHex.get(row.h3)
    return {
      ...row,
      hail_mm_max: hail?.hail_mm_max ?? null,
      hail_days: hail?.hail_days ?? 0,
      hail_last_date: hail?.hail_last_date ?? null,
    }
  })
}

export function closedRing(vertices: readonly GeoJsonPosition[]): GeoJsonPosition[] | null {
  if (vertices.length < 3) return null
  const first = vertices[0]
  const last = vertices[vertices.length - 1]
  const ring = first[0] === last[0] && first[1] === last[1] ? [...vertices] : [...vertices, first]
  return ring
}

function asGeofence(value: Record<string, unknown>): GeofenceEnrichment | null {
  const keep = value.keep
  if (keep !== 'inside' && keep !== 'outside') return null
  const geometry = asGeometry(value.polygon)
  if (!geometry || geometry.type !== 'Polygon') return null
  const ring = geometry.coordinates[0]
  if (!ring || ring.length < 4 || ring.length > MAX_GEOFENCE_VERTICES + 1) return null
  return {
    id: String(value.id),
    kind: 'geofence',
    keep: keep as GeofenceKeep,
    polygon: { type: 'Polygon', coordinates: geometry.coordinates },
  }
}

function asHail(value: Record<string, unknown>): HailHistoryEnrichment | null {
  if (typeof value.start_date !== 'string' || typeof value.end_date !== 'string') return null
  const range = hailDateRange(value.start_date, value.end_date)
  if ('error' in range) return null
  return {
    id: String(value.id),
    kind: 'hail_history',
    start_date: range.start_date,
    end_date: range.end_date,
  }
}

export function hailDateRange(start: string, end: string): { start_date: string; end_date: string } | { error: string } {
  if (!isDay(start) || !isDay(end)) return { error: 'Hail dates must be YYYY-MM-DD.' }
  if (start < HAIL_MESH_START) return { error: `Hail history starts on ${HAIL_MESH_START}.` }
  if (end < start) return { error: 'Hail end date must be on or after the start date.' }
  const today = new Date().toISOString().slice(0, 10)
  if (end > today) return { error: 'Hail end date cannot be in the future.' }
  const days = dayCount(start, end)
  if (days > MAX_HAIL_DAYS) return { error: `Hail range is limited to ${MAX_HAIL_DAYS} days.` }
  return { start_date: start, end_date: end }
}

export function eachDay(start: string, end: string): string[] {
  const days: string[] = []
  let cursor = start
  while (cursor <= end) {
    days.push(cursor)
    cursor = addDay(cursor, 1)
  }
  return days
}

export function dayCount(start: string, end: string): number {
  return eachDay(start, end).length
}

export function addDay(day: string, delta: number): string {
  const date = new Date(`${day}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + delta)
  return date.toISOString().slice(0, 10)
}

export function compactDay(day: string): string {
  return day.replaceAll('-', '')
}

function isDay(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00.000Z`).getTime())
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
