import {
  cellToBoundary,
  cellToLatLng,
  cellToParent,
  getHexagonEdgeLengthAvg,
  getResolution,
  polygonToCells,
  UNITS,
} from 'h3-js'
import type { Feature, FeatureCollection, Polygon } from 'geojson'
import { H3_RESOLUTION, MAX_VIEWPORT_CELLS, MIN_DISPLAY_RESOLUTION, MIN_VIEWPORT_ZOOM } from './limits'
import { snapshotColor } from './color-scale'
import type { HexCoverage, HexSnapshot } from '../types/workflows'

const KM_PER_DEGREE_LAT = 110.574
const ZOOM_HYSTERESIS = 0.35

/** Zoom floor at which each display resolution becomes the target. */
const RESOLUTION_ZOOM = [
  { minZoom: 11.2, resolution: 8 },
  { minZoom: 9.6, resolution: 7 },
  { minZoom: 8.2, resolution: 6 },
  { minZoom: 6.8, resolution: 5 },
  { minZoom: MIN_VIEWPORT_ZOOM, resolution: 4 },
] as const

export const AUSTIN_CENTER = { lng: -97.7431, lat: 30.2672 }
export const AUSTIN_ZOOM = 12.4
/** Opening frame: Africa and Europe, with the Americas still on the limb. */
export const GLOBE_START = { lng: 18, lat: 12 }
export const GLOBE_ZOOM = 1.35
/** Earth-scroll camera after leaving the hex floor. */
export const EARTH_ZOOM = 1.7
export const EARTH_MAX_ZOOM = 2.55
/** First hex camera when coming in from the globe. */
export const HEX_ENTRY_ZOOM = 6.8
const MAX_HEX_VIEW_SPAN_DEG = 22

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

export function displayResolutionForZoom(zoom: number): number {
  for (const band of RESOLUTION_ZOOM) {
    if (zoom >= band.minZoom) return band.resolution
  }
  return MIN_DISPLAY_RESOLUTION
}

/** Keep the current resolution across the band edge so the grid does not flicker. */
export function resolveDisplayResolution(zoom: number, previous?: number): number {
  const target = displayResolutionForZoom(zoom)
  if (previous == null || previous === target) return target
  const looking = previous > target ? zoom + ZOOM_HYSTERESIS : zoom - ZOOM_HYSTERESIS
  return displayResolutionForZoom(looking)
}

export function cellsInView(
  bounds: ViewBounds,
  zoom: number,
  previousResolution?: number,
): { ids: string[]; status: Exclude<ViewportStatus, 'idle'>; resolution: number } {
  if (!Number.isFinite(zoom) || zoom < MIN_VIEWPORT_ZOOM) {
    return { ids: [], status: 'zoom-in', resolution: MIN_DISPLAY_RESOLUTION }
  }
  if (bounds.east <= bounds.west || bounds.north <= bounds.south) {
    return { ids: [], status: 'zoom-in', resolution: previousResolution ?? MIN_DISPLAY_RESOLUTION }
  }
  if (bounds.east - bounds.west > MAX_HEX_VIEW_SPAN_DEG || bounds.north - bounds.south > MAX_HEX_VIEW_SPAN_DEG) {
    return { ids: [], status: 'zoom-in', resolution: previousResolution ?? MIN_DISPLAY_RESOLUTION }
  }
  let resolution = resolveDisplayResolution(zoom, previousResolution)
  while (resolution >= MIN_DISPLAY_RESOLUTION) {
    const ids = cellsAtResolution(bounds, resolution)
    if (ids != null && ids.length <= MAX_VIEWPORT_CELLS) {
      return { ids, status: 'ready', resolution }
    }
    resolution -= 1
  }
  return { ids: [], status: 'too-many', resolution: MIN_DISPLAY_RESOLUTION }
}

function cellsAtResolution(bounds: ViewBounds, resolution: number): string[] | null {
  const padKm = getHexagonEdgeLengthAvg(resolution, UNITS.km) * 1.25
  const latPad = padKm / KM_PER_DEGREE_LAT
  const midLat = (bounds.north + bounds.south) / 2
  const lngPad = latPad / Math.max(0.2, Math.cos((midLat * Math.PI) / 180))
  const ring = [
    [bounds.west - lngPad, bounds.south - latPad],
    [bounds.east + lngPad, bounds.south - latPad],
    [bounds.east + lngPad, bounds.north + latPad],
    [bounds.west - lngPad, bounds.north + latPad],
    [bounds.west - lngPad, bounds.south - latPad],
  ]
  try {
    return [...new Set(polygonToCells(ring, resolution, true))]
  } catch {
    return null
  }
}

export function snapshotForDisplayCell(
  cell: string,
  coverage: ReadonlyMap<string, HexCoverage>,
): HexSnapshot | null {
  if (getResolution(cell) !== H3_RESOLUTION) return null
  return coverage.get(cell)?.snapshot ?? null
}

/** Ready resolution-8 cells that sit under the current parent grid. */
export function readyCellsInParents(
  parents: readonly string[],
  coverage: ReadonlyMap<string, HexCoverage>,
): string[] {
  if (parents.length === 0) return []
  const byRes = new Map<number, Set<string>>()
  for (const parent of parents) {
    const resolution = getResolution(parent)
    const bucket = byRes.get(resolution) ?? new Set<string>()
    bucket.add(parent)
    byRes.set(resolution, bucket)
  }
  const extra: string[] = []
  for (const [h3, info] of coverage) {
    if (!info.snapshot || getResolution(h3) !== H3_RESOLUTION) continue
    let hit = false
    for (const [resolution, set] of byRes) {
      if (resolution === H3_RESOLUTION) {
        if (set.has(h3)) {
          hit = true
          break
        }
        continue
      }
      if (set.has(cellToParent(h3, resolution))) {
        hit = true
        break
      }
    }
    if (hit && !byRes.get(H3_RESOLUTION)?.has(h3) && !parents.includes(h3)) extra.push(h3)
  }
  return extra
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
  snapshot: HexSnapshot | 'none'
  color: string
}

/** Fills follow snapshot freshness. Empty cells stay unfilled. */
export function buildH3Collection(input: {
  cells: readonly string[]
  counts: ReadonlyMap<string, number>
  snapshots: ReadonlyMap<string, HexSnapshot | null>
  selected: ReadonlySet<string>
  focusedH3: string | null
}): FeatureCollection<Polygon, H3FeatureProps> {
  const features: Feature<Polygon, H3FeatureProps>[] = input.cells.map((cell) => {
    const snapshot = input.snapshots.get(cell) ?? null
    return {
      type: 'Feature',
      properties: {
        h3: cell,
        count: input.counts.get(cell) ?? 0,
        selected: input.selected.has(cell) ? 1 : 0,
        focused: input.focusedH3 === cell ? 1 : 0,
        snapshot: snapshot ?? 'none',
        color: snapshotColor(snapshot),
      },
      geometry: cellPolygon(cell),
    }
  })
  return { type: 'FeatureCollection', features }
}
