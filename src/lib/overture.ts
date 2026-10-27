import { latLngToCell } from 'h3-js'
import { H3_RESOLUTION } from './limits'
import { DEFAULT_OVERTURE_RELEASE } from './overture-release'
import { serverEnv } from './server-env'
import type { WorkflowDataset } from '../types/workflows'

export { DEFAULT_OVERTURE_RELEASE }

const RELEASE_RE = /^[A-Za-z0-9._-]{3,64}$/

const THEME_PATH: Record<WorkflowDataset, string> = {
  places: 'theme=places/type=place',
  buildings: 'theme=buildings/type=building',
  addresses: 'theme=addresses/type=address',
}

export function defaultOvertureRelease(): string {
  const raw = serverEnv('OVERTURE_RELEASE') || DEFAULT_OVERTURE_RELEASE
  return RELEASE_RE.test(raw) ? raw : DEFAULT_OVERTURE_RELEASE
}

/** Overture ids are `YYYY-MM-DD.N`, so lexical order matches recency. */
export function compareOvertureRelease(left: string, right: string): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}

export function assertOvertureRelease(release: string): string {
  const value = release.trim()
  if (!RELEASE_RE.test(value)) throw new Error('release_version is not a valid Overture release id.')
  return value
}

export function overtureParquetGlob(release: string, dataset: WorkflowDataset): string {
  return `s3://overturemaps-us-west-2/release/${assertOvertureRelease(release)}/${THEME_PATH[dataset]}/*`
}

export type OvertureBbox = {
  west: number
  south: number
  east: number
  north: number
}

export function cellForPoint(lat: number, lng: number): string | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null
  return latLngToCell(lat, lng, H3_RESOLUTION)
}

export function bboxCenter(row: { west: number; south: number; east: number; north: number }): {
  lat: number
  lng: number
} {
  return {
    lng: (row.west + row.east) / 2,
    lat: (row.south + row.north) / 2,
  }
}

export function addressLevels(value: unknown): { region: string; locality: string } {
  const items = Array.isArray(value) ? value : []
  const names = items
    .map((entry) => {
      if (typeof entry === 'string') return entry
      if (entry && typeof entry === 'object' && 'value' in entry && typeof entry.value === 'string') {
        return entry.value
      }
      return ''
    })
    .filter((name) => name.length > 0)
  if (names.length === 0) return { region: '', locality: '' }
  if (names.length === 1) return { region: names[0], locality: names[0] }
  return { region: names[0], locality: names[names.length - 1] }
}

export function asString(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value)
}

export function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const next = Number(value)
    return Number.isFinite(next) ? next : null
  }
  return null
}

export function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((entry) => asString(entry)).filter((entry) => entry.length > 0)
}
