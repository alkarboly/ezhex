import type { GeoJsonGeometry } from './geojson'
import type { DatasetId } from '../types/datasets'
import type { ResultRow } from '../types/queries'

export type FeatureRow = {
  key: string
  kind: DatasetId
  id: string
  h3: string
  name: string
  category: string
  address: string
  extra: string
  lat: number
  lng: number
  geometry: GeoJsonGeometry | null
}

export function mergeFeatureRows(
  places: readonly ResultRow[],
  buildings: readonly ResultRow[],
  addresses: readonly ResultRow[],
): FeatureRow[] {
  const addressById = new Map(addresses.map((row) => [row.id, row]))
  const rows: FeatureRow[] = []
  for (const row of places) {
    const linked = row.address_id ? addressById.get(row.address_id) : undefined
    rows.push({
      key: `places:${row.id}`,
      kind: 'places',
      id: row.id,
      h3: row.h3,
      name: text(row.values['names.primary']),
      category: text(row.values.basic_category) || text(row.values['taxonomy.primary']),
      address: placeAddress(row, linked),
      extra: text(row.values.phones) || text(row.values.brand_name),
      lat: row.lat,
      lng: row.lng,
      geometry: row.geometry,
    })
  }
  for (const row of buildings) {
    const linked = row.address_id ? addressById.get(row.address_id) : undefined
    rows.push({
      key: `buildings:${row.id}`,
      kind: 'buildings',
      id: row.id,
      h3: row.h3,
      name: text(row.values['names.primary']) || text(row.values.subtype),
      category: [text(row.values.subtype), text(row.values.class)].filter(Boolean).join(' / '),
      address: linked ? formatLinkedAddress(linked) : '',
      extra: buildingExtra(row),
      lat: row.lat,
      lng: row.lng,
      geometry: row.geometry,
    })
  }
  for (const row of addresses) {
    rows.push({
      key: `addresses:${row.id}`,
      kind: 'addresses',
      id: row.id,
      h3: row.h3,
      name: `${text(row.values.number)} ${text(row.values.street)}`.trim(),
      category: 'address',
      address: text(row.values.address) || `${text(row.values.number)} ${text(row.values.street)}`.trim(),
      extra: [text(row.values.unit), text(row.values.postcode)].filter(Boolean).join(' · '),
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
): FeatureRow[] {
  const query = search.trim().toLowerCase()
  return rows.filter((row) => {
    if (kind !== 'all' && row.kind !== kind) return false
    if (!query) return true
    return `${row.name} ${row.category} ${row.address} ${row.extra}`.toLowerCase().includes(query)
  })
}

function placeAddress(row: ResultRow, linked?: ResultRow): string {
  if (linked) return formatLinkedAddress(linked)
  return text(row.values.address)
}

function formatLinkedAddress(row: ResultRow): string {
  return text(row.values.address) || `${text(row.values.number)} ${text(row.values.street)}`.trim()
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
