export type GeoJsonPosition = [number, number]

export type GeoJsonGeometry =
  | { type: 'Point'; coordinates: GeoJsonPosition }
  | { type: 'Polygon'; coordinates: GeoJsonPosition[][] }
  | { type: 'MultiPolygon'; coordinates: GeoJsonPosition[][][] }

export function asGeometry(value: unknown): GeoJsonGeometry | null {
  if (typeof value === 'string') {
    try {
      return asGeometry(JSON.parse(value))
    } catch {
      return null
    }
  }
  if (!value || typeof value !== 'object') return null
  const row = value as { type?: unknown; coordinates?: unknown }
  if (row.type === 'Point' && isPosition(row.coordinates)) {
    return { type: 'Point', coordinates: row.coordinates }
  }
  if (row.type === 'Polygon' && isRingList(row.coordinates)) {
    return { type: 'Polygon', coordinates: row.coordinates }
  }
  if (row.type === 'MultiPolygon' && Array.isArray(row.coordinates) && row.coordinates.every(isRingList)) {
    return { type: 'MultiPolygon', coordinates: row.coordinates }
  }
  return null
}

export function pointGeometry(lng: number, lat: number): GeoJsonGeometry {
  return { type: 'Point', coordinates: [lng, lat] }
}

export function squarePolygon(lng: number, lat: number, half = 0.00012): GeoJsonGeometry {
  const ring: GeoJsonPosition[] = [
    [lng - half, lat - half],
    [lng + half, lat - half],
    [lng + half, lat + half],
    [lng - half, lat + half],
    [lng - half, lat - half],
  ]
  return { type: 'Polygon', coordinates: [ring] }
}

export function pointInGeometry(lng: number, lat: number, geometry: GeoJsonGeometry | null | undefined): boolean {
  if (!geometry) return false
  if (geometry.type === 'Polygon') return pointInPolygon(lng, lat, geometry.coordinates)
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.some((polygon) => pointInPolygon(lng, lat, polygon))
  }
  return false
}

export function metersBetween(
  left: { lat: number; lng: number },
  right: { lat: number; lng: number },
): number {
  const earth = 6_371_000
  const dLat = toRad(right.lat - left.lat)
  const dLng = toRad(right.lng - left.lng)
  const seed =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(left.lat)) * Math.cos(toRad(right.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * earth * Math.asin(Math.min(1, Math.sqrt(seed)))
}

function pointInPolygon(lng: number, lat: number, rings: GeoJsonPosition[][]): boolean {
  if (rings.length === 0) return false
  if (!pointInRing(lng, lat, rings[0])) return false
  return !rings.slice(1).some((hole) => pointInRing(lng, lat, hole))
}

function pointInRing(lng: number, lat: number, ring: GeoJsonPosition[]): boolean {
  let inside = false
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const [xi, yi] = ring[index]
    const [xj, yj] = ring[previous]
    if (yi === yj) continue
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function isPosition(value: unknown): value is GeoJsonPosition {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number' &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1])
  )
}

function isRingList(value: unknown): value is GeoJsonPosition[][] {
  return Array.isArray(value) && value.length > 0 && value.every((ring) => Array.isArray(ring) && ring.every(isPosition))
}

function toRad(value: number): number {
  return (value * Math.PI) / 180
}
