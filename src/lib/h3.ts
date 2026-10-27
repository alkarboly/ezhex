import { cellToBoundary, cellToLatLng, getHexagonEdgeLengthAvg, polygonToCells, UNITS } from 'h3-js'
import type { Feature, FeatureCollection, Polygon } from 'geojson'
import { H3_RESOLUTION, MAX_VIEWPORT_CELLS, MIN_VIEWPORT_ZOOM } from './limits'
import { densityColor } from './color-scale'

const KM_PER_DEGREE_LAT = 110.574
/** A cell can poke into the view while its center sits up to one edge length outside it. */
const VIEW_PAD_KM = getHexagonEdgeLengthAvg(H3_RESOLUTION, UNITS.km) * 1.25

export const AUSTIN_CENTER = { lng: -97.7431, lat: 30.2672 }
export const AUSTIN_ZOOM = 12.4
/** Opening frame: Africa and Europe, with the Americas still on the limb. */
export const GLOBE_START = { lng: 18, lat: 12 }
export const GLOBE_ZOOM = 1.35

export const MOCK_COVERAGE = {
  west: -97.9,
  south: 30.15,
  east: -97.6,
  north: 30.45,
} as const

export type ViewportStatus = 'idle' | 'ready' | 'zoom-in' | 'too-many'

export type ViewBounds = {
  west: number
  south: number
  east: number
  north: number
}

export function mockCoverageCells(): string[] {
  const ring = [
    [MOCK_COVERAGE.west, MOCK_COVERAGE.south],
    [MOCK_COVERAGE.east, MOCK_COVERAGE.south],
    [MOCK_COVERAGE.east, MOCK_COVERAGE.north],
    [MOCK_COVERAGE.west, MOCK_COVERAGE.north],
    [MOCK_COVERAGE.west, MOCK_COVERAGE.south],
  ]
  return polygonToCells(ring, H3_RESOLUTION, true)
}

export function cellsInView(
  bounds: ViewBounds,
  zoom: number,
): { ids: string[]; status: Exclude<ViewportStatus, 'idle'> } {
  if (!Number.isFinite(zoom) || zoom < MIN_VIEWPORT_ZOOM) {
    return { ids: [], status: 'zoom-in' }
  }
  if (bounds.east <= bounds.west || bounds.north <= bounds.south) {
    return { ids: [], status: 'zoom-in' }
  }
  const latPad = VIEW_PAD_KM / KM_PER_DEGREE_LAT
  const midLat = (bounds.north + bounds.south) / 2
  const lngPad = latPad / Math.max(0.2, Math.cos((midLat * Math.PI) / 180))
  const west = bounds.west - lngPad
  const east = bounds.east + lngPad
  const south = bounds.south - latPad
  const north = bounds.north + latPad
  const ring = [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ]
  try {
    const ids = [...new Set(polygonToCells(ring, H3_RESOLUTION, true))]
    if (ids.length > MAX_VIEWPORT_CELLS) return { ids: [], status: 'too-many' }
    return { ids, status: 'ready' }
  } catch {
    return { ids: [], status: 'too-many' }
  }
}

/** GeoJSON polygon ring in [lng, lat] order. h3-js already closes GeoJSON loops. */
export function cellPolygon(cell: string): Polygon {
  const boundary = cellToBoundary(cell, true)
  const ring = boundary.map((pair) => [pair[0], pair[1]] as [number, number])
  if (ring.length === 0) {
    return { type: 'Polygon', coordinates: [[]] }
  }
  const first = ring[0]
  const last = ring[ring.length - 1]
  const closed =
    first[0] === last[0] && first[1] === last[1] ? ring : [...ring, [first[0], first[1]]]
  return { type: 'Polygon', coordinates: [closed] }
}

export function boundsForCells(cells: string[]): [[number, number], [number, number]] | null {
  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity
  for (const cell of cells) {
    const boundary = cellToBoundary(cell, true)
    for (const pair of boundary) {
      const lng = pair[0]
      const lat = pair[1]
      west = Math.min(west, lng)
      east = Math.max(east, lng)
      south = Math.min(south, lat)
      north = Math.max(north, lat)
    }
  }
  if (!Number.isFinite(west)) return null
  return [
    [west, south],
    [east, north],
  ]
}

export function cellCenter(cell: string): { lng: number; lat: number } {
  const [lat, lng] = cellToLatLng(cell)
  return { lng, lat }
}

export type H3FeatureProps = {
  h3: string
  count: number
  selected: number
  focused: number
  color: string
}

/** Color scales to the busiest cell in `cells`, so it always spans what is on screen. */
export function buildH3Collection(input: {
  cells: readonly string[]
  counts: ReadonlyMap<string, number>
  selected: ReadonlySet<string>
  focusedH3: string | null
}): FeatureCollection<Polygon, H3FeatureProps> {
  let max = 0
  for (const cell of input.cells) {
    max = Math.max(max, input.counts.get(cell) ?? 0)
  }
  const features: Feature<Polygon, H3FeatureProps>[] = input.cells.map((cell) => {
    const count = input.counts.get(cell) ?? 0
    return {
      type: 'Feature',
      properties: {
        h3: cell,
        count,
        selected: input.selected.has(cell) ? 1 : 0,
        focused: input.focusedH3 === cell ? 1 : 0,
        color: densityColor(count, max),
      },
      geometry: cellPolygon(cell),
    }
  })
  return { type: 'FeatureCollection', features }
}
