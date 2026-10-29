import { closedRing } from './enrichments'
import { asGeometry, simplifyGeometry, type GeoJsonPosition } from './geojson'
import { MAX_GEOFENCE_VERTICES } from './limits'
import type { GeofencePolygon } from '../types/enrichments'

/** Polygon GeoJSON, Feature, FeatureCollection, WKT POLYGON, or a bare list of [lng, lat] points. */
export function parsePolygonText(raw: string): GeofencePolygon | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const asJson = parsePolygonJson(trimmed)
  if (asJson) return asJson
  return parsePolygonWkt(trimmed)
}

/** Decimate every ring so the polygon fits the geofence vertex cap. */
export function fitGeofencePolygon(polygon: GeofencePolygon): { polygon: GeofencePolygon; simplified: boolean } {
  const simplified = polygon.coordinates.some((ring) => ring.length > MAX_GEOFENCE_VERTICES + 1)
  if (!simplified) return { polygon, simplified: false }
  const next = simplifyGeometry(polygon, MAX_GEOFENCE_VERTICES + 1)
  if (!next || next.type !== 'Polygon') return { polygon, simplified: false }
  return { polygon: { type: 'Polygon', coordinates: next.coordinates }, simplified: true }
}

export function polygonVertexCount(polygon: GeofencePolygon): number {
  return Math.max(0, (polygon.coordinates[0]?.length ?? 0) - 1)
}

function parsePolygonJson(raw: string): GeofencePolygon | null {
  try {
    return polygonFromValue(JSON.parse(raw) as unknown)
  } catch {
    return null
  }
}

function polygonFromValue(value: unknown): GeofencePolygon | null {
  const geometry = asGeometry(value)
  if (geometry?.type === 'Polygon') return normalizePolygon(geometry.coordinates)
  if (geometry?.type === 'MultiPolygon') return normalizePolygon(geometry.coordinates[0] ?? [])
  if (isRecord(value)) {
    if (value.type === 'Feature' && value.geometry) return polygonFromValue(value.geometry)
    if (value.type === 'FeatureCollection' && Array.isArray(value.features)) {
      for (const feature of value.features) {
        const polygon = polygonFromValue(feature)
        if (polygon) return polygon
      }
    }
    return null
  }
  if (Array.isArray(value) && value.every(isPosition)) return normalizePolygon([value])
  if (Array.isArray(value) && value.every((item) => Array.isArray(item) && item.every(isPosition))) {
    return normalizePolygon(value as GeoJsonPosition[][])
  }
  return null
}

function parsePolygonWkt(raw: string): GeofencePolygon | null {
  const normalized = raw.replace(/\s+/g, ' ').trim()
  if (!/^polygon\s*\(\(/i.test(normalized) || !/\)\)$/.test(normalized)) return null
  const body = normalized.replace(/^polygon\s*\(\(/i, '').replace(/\)\)\s*$/i, '')
  const rings: GeoJsonPosition[][] = []
  for (const ringText of body.split(/\)\s*,\s*\(/)) {
    const ring: GeoJsonPosition[] = []
    for (const pair of ringText.split(',')) {
      const parts = pair.trim().split(/\s+/)
      if (parts.length < 2) return null
      const lng = Number(parts[0])
      const lat = Number(parts[1])
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null
      ring.push([lng, lat])
    }
    rings.push(ring)
  }
  return normalizePolygon(rings)
}

function normalizePolygon(rings: GeoJsonPosition[][]): GeofencePolygon | null {
  if (rings.length === 0) return null
  const closed = rings.map((ring) => closedRing(ring.map((point) => [point[0], point[1]] as GeoJsonPosition)))
  if (closed.some((ring) => !ring)) return null
  return { type: 'Polygon', coordinates: closed as GeoJsonPosition[][] }
}

function isPosition(value: unknown): value is GeoJsonPosition {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === 'number' &&
    Number.isFinite(value[0]) &&
    typeof value[1] === 'number' &&
    Number.isFinite(value[1])
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
