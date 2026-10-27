import type { GeoJsonGeometry } from './geojson'
import type { DatasetId } from '../types/datasets'
import type { ResultRow } from '../types/queries'

export type FeatureRow = {
  key: string
  kind: DatasetId
  id: string
  h3: string
  name: string | null
  category: string | null
  address: string | null
  building: string | null
  extra: string | null
  lat: number
  lng: number
  geometry: GeoJsonGeometry | null
}

/** Place rows left-join address and building. Unmatched rows stay, with nulls. Orphans are appended. */
export function mergeFeatureRows(
  places: readonly ResultRow[],
  buildings: readonly ResultRow[],
  addresses: readonly ResultRow[],
): FeatureRow[] {
  const addressById = new Map(addresses.map((row) => [row.id, row]))
  const buildingById = new Map(buildings.map((row) => [row.id, row]))
  const usedAddresses = new Set<string>()
  const usedBuildings = new Set<string>()
  const rows: FeatureRow[] = []

  for (const row of places) {
    const linkedAddress = row.address_id ? addressById.get(row.address_id) : undefined
    const linkedBuilding = row.building_id ? buildingById.get(row.building_id) : undefined
    if (linkedAddress) usedAddresses.add(linkedAddress.id)
    if (linkedBuilding) usedBuildings.add(linkedBuilding.id)
    rows.push({
      key: `places:${row.id}`,
      kind: 'places',
      id: row.id,
      h3: row.h3,
      name: nonempty(text(row.values['names.primary'])),
      category: nonempty(text(row.values.basic_category) || text(row.values['taxonomy.primary'])),
      address: linkedAddress ? formatLinkedAddress(linkedAddress) : nonempty(text(row.values.address)),
      building: linkedBuilding ? buildingName(linkedBuilding) : null,
      extra: nonempty(text(row.values.phones) || text(row.values.brand_name)),
      lat: row.lat,
      lng: row.lng,
      geometry: row.geometry,
    })
  }

  for (const row of addresses) {
    if (usedAddresses.has(row.id)) continue
    rows.push({
      key: `addresses:${row.id}`,
      kind: 'addresses',
      id: row.id,
      h3: row.h3,
      name: null,
      category: null,
      address: formatLinkedAddress(row),
      building: row.building_id && buildingById.has(row.building_id) ? buildingName(buildingById.get(row.building_id)!) : null,
      extra: nonempty([text(row.values.unit), text(row.values.postcode)].filter(Boolean).join(' · ')),
      lat: row.lat,
      lng: row.lng,
      geometry: row.geometry,
    })
    if (row.building_id) usedBuildings.add(row.building_id)
  }

  for (const row of buildings) {
    if (usedBuildings.has(row.id)) continue
    const linked = row.address_id ? addressById.get(row.address_id) : undefined
    rows.push({
      key: `buildings:${row.id}`,
      kind: 'buildings',
      id: row.id,
      h3: row.h3,
      name: null,
      category: nonempty(text(row.values.subtype) || text(row.values.class)),
      address: linked ? formatLinkedAddress(linked) : null,
      building: buildingName(row),
      extra: nonempty(buildingExtra(row)),
      lat: row.lat,
      lng: row.lng,
      geometry: row.geometry,
    })
  }

  return rows
}

export function filterFeatureRows(
  rows: readonly FeatureRow[],
  kind: DatasetId | 'all',
  search: string,
  category?: string,
  building?: string,
): FeatureRow[] {
  const query = search.trim().toLowerCase()
  return rows.filter((row) => {
    if (kind !== 'all' && row.kind !== kind) return false
    if (category && row.category !== category) return false
    if (building && row.building !== building) return false
    if (!query) return true
    return `${row.name ?? ''} ${row.category ?? ''} ${row.address ?? ''} ${row.building ?? ''} ${row.extra ?? ''}`
      .toLowerCase()
      .includes(query)
  })
}

/** Distinct non-empty values seen in the loaded rows. Not a preset list. */
export function observedValues(rows: readonly FeatureRow[], field: 'category' | 'building'): string[] {
  return sortUnique(rows.map((row) => row[field]))
}

/** Distinct non-empty field values from raw theme rows. Not a preset list. */
export function observedResultValues(rows: readonly ResultRow[], field: string): string[] {
  return sortUnique(rows.map((row) => (typeof row.values[field] === 'string' ? row.values[field] : null)))
}

export function withCurrentOption(options: readonly string[], current: string | undefined): string[] {
  if (!current || options.includes(current)) return [...options]
  return [current, ...options]
}

function sortUnique(values: readonly (string | null | undefined)[]): string[] {
  const next = new Set<string>()
  for (const value of values) {
    if (value) next.add(value)
  }
  return [...next].sort((left, right) => left.localeCompare(right))
}

function buildingName(row: ResultRow): string | null {
  return nonempty(text(row.values['names.primary']) || text(row.values.subtype) || text(row.values.class))
}

function formatLinkedAddress(row: ResultRow): string | null {
  return nonempty(text(row.values.address) || `${text(row.values.number)} ${text(row.values.street)}`.trim())
}

function buildingExtra(row: ResultRow): string {
  const parts: string[] = []
  if (typeof row.values.height === 'number') parts.push(`${row.values.height} m`)
  if (typeof row.values.num_floors === 'number') parts.push(`${row.values.num_floors} fl`)
  return parts.join(' · ')
}

function text(value: string | number | null | undefined): string {
  if (value == null) return ''
  return String(value)
}

function nonempty(value: string): string | null {
  const next = value.trim()
  return next ? next : null
}
