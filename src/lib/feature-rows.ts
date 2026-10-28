import type { GeoJsonGeometry } from './geojson'
import type { DatasetId } from '../types/datasets'
import type { ResultRow } from '../types/queries'

export type FeatureRow = {
  key: string
  kind: DatasetId
  id: string
  h3: string
  snapshot: string
  sources: string | null
  attribution: string | null
  name: string | null
  category: string | null
  taxonomy: string | null
  confidence: number | null
  operating_status: string | null
  phones: string | null
  websites: string | null
  socials: string | null
  emails: string | null
  brand: string | null
  brand_wikidata: string | null
  place_addresses: string | null
  address: string | null
  unit: string | null
  postal_city: string | null
  locality: string | null
  region: string | null
  postcode: string | null
  country: string | null
  building: string | null
  building_class: string | null
  extra: string | null
  height: number | null
  floors: number | null
  min_height: number | null
  min_floor: number | null
  level: number | null
  underground_floors: number | null
  has_parts: string | null
  is_underground: string | null
  facade_color: string | null
  facade_material: string | null
  roof_material: string | null
  roof_shape: string | null
  roof_direction: number | null
  roof_color: string | null
  building_id: string | null
  address_id: string | null
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
    rows.push(
      withLinks(
        {
          key: `places:${row.id}`,
          kind: 'places',
          id: row.id,
          h3: row.h3,
          snapshot: row.release_version,
          sources: nonempty(text(row.values.sources)),
          attribution: nonempty(text(row.values.attribution)),
          name: nonempty(text(row.values['names.primary'])),
          category: nonempty(text(row.values.basic_category) || text(row.values['taxonomy.primary'])),
          taxonomy: nonempty(text(row.values['taxonomy.hierarchy']) || text(row.values['taxonomy.primary'])),
          confidence: numberValue(row.values.confidence),
          operating_status: nonempty(text(row.values.operating_status)),
          phones: nonempty(text(row.values.phones)),
          websites: nonempty(text(row.values.websites)),
          socials: nonempty(text(row.values.socials)),
          emails: nonempty(text(row.values.emails)),
          brand: nonempty(text(row.values.brand_name)),
          brand_wikidata: nonempty(text(row.values.brand_wikidata)),
          place_addresses: nonempty(text(row.values.place_addresses)),
          extra: nonempty(text(row.values.phones) || text(row.values.brand_name)),
          building_id: row.building_id ?? nonempty(text(row.values.building_id)),
          address_id: row.address_id ?? nonempty(text(row.values.address_id)),
          lat: row.lat,
          lng: row.lng,
          geometry: row.geometry,
        },
        linkedAddress,
        linkedBuilding,
        nonempty(text(row.values.address)),
      ),
    )
  }

  for (const row of addresses) {
    if (usedAddresses.has(row.id)) continue
    const linkedBuilding = row.building_id ? buildingById.get(row.building_id) : undefined
    rows.push(
      withLinks(
        {
          key: `addresses:${row.id}`,
          kind: 'addresses',
          id: row.id,
          h3: row.h3,
          snapshot: row.release_version,
          sources: nonempty(text(row.values.sources)),
          attribution: nonempty(text(row.values.attribution)),
          name: null,
          category: null,
          taxonomy: null,
          confidence: null,
          operating_status: null,
          phones: null,
          websites: null,
          socials: null,
          emails: null,
          brand: null,
          brand_wikidata: null,
          place_addresses: null,
          extra: nonempty([text(row.values.unit), text(row.values.postcode)].filter(Boolean).join(' · ')),
          building_id: row.building_id ?? nonempty(text(row.values.building_id)),
          address_id: row.id,
          lat: row.lat,
          lng: row.lng,
          geometry: row.geometry,
        },
        row,
        linkedBuilding,
        null,
      ),
    )
    if (linkedBuilding) usedBuildings.add(linkedBuilding.id)
  }

  for (const row of buildings) {
    if (usedBuildings.has(row.id)) continue
    const linked = row.address_id ? addressById.get(row.address_id) : undefined
    rows.push(
      withLinks(
        {
          key: `buildings:${row.id}`,
          kind: 'buildings',
          id: row.id,
          h3: row.h3,
          snapshot: row.release_version,
          sources: nonempty(text(row.values.sources)),
          attribution: nonempty(text(row.values.attribution)),
          name: null,
          category: nonempty(text(row.values.subtype) || text(row.values.class)),
          taxonomy: nonempty(text(row.values.subtype)),
          confidence: null,
          operating_status: null,
          phones: null,
          websites: null,
          socials: null,
          emails: null,
          brand: null,
          brand_wikidata: null,
          place_addresses: null,
          extra: nonempty(text(row.values.class) && text(row.values.class) !== text(row.values.subtype) ? text(row.values.class) : ''),
          building_id: row.id,
          address_id: row.address_id ?? nonempty(text(row.values.address_id)),
          lat: row.lat,
          lng: row.lng,
          geometry: row.geometry,
        },
        linked,
        row,
        null,
      ),
    )
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
    return searchText(row).includes(query)
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

function withLinks(
  base: Omit<
    FeatureRow,
    | 'address'
    | 'unit'
    | 'postal_city'
    | 'locality'
    | 'region'
    | 'postcode'
    | 'country'
    | 'building'
    | 'building_class'
    | 'height'
    | 'floors'
    | 'min_height'
    | 'min_floor'
    | 'level'
    | 'underground_floors'
    | 'has_parts'
    | 'is_underground'
    | 'facade_color'
    | 'facade_material'
    | 'roof_material'
    | 'roof_shape'
    | 'roof_direction'
    | 'roof_color'
  >,
  address: ResultRow | undefined,
  building: ResultRow | undefined,
  fallbackAddress: string | null,
): FeatureRow {
  return {
    ...base,
    address: address ? formatLinkedAddress(address) : fallbackAddress,
    unit: address ? nonempty(text(address.values.unit)) : null,
    postal_city: address ? nonempty(text(address.values.postal_city)) : null,
    locality: address ? nonempty(text(address.values.locality)) : null,
    region: address ? nonempty(text(address.values.region)) : null,
    postcode: address ? nonempty(text(address.values.postcode)) : null,
    country: address ? nonempty(text(address.values.country)) : null,
    building: building ? buildingName(building) : null,
    building_class: building ? nonempty(text(building.values.class)) : null,
    height: building ? numberValue(building.values.height) : null,
    floors: building ? numberValue(building.values.num_floors) : null,
    min_height: building ? numberValue(building.values.min_height) : null,
    min_floor: building ? numberValue(building.values.min_floor) : null,
    level: building ? numberValue(building.values.level) : null,
    underground_floors: building ? numberValue(building.values.num_floors_underground) : null,
    has_parts: building ? nonempty(text(building.values.has_parts)) : null,
    is_underground: building ? nonempty(text(building.values.is_underground)) : null,
    facade_color: building ? nonempty(text(building.values.facade_color)) : null,
    facade_material: building ? nonempty(text(building.values.facade_material)) : null,
    roof_material: building ? nonempty(text(building.values.roof_material)) : null,
    roof_shape: building ? nonempty(text(building.values.roof_shape)) : null,
    roof_direction: building ? numberValue(building.values.roof_direction) : null,
    roof_color: building ? nonempty(text(building.values.roof_color)) : null,
  }
}

function searchText(row: FeatureRow): string {
  return [
    row.name,
    row.category,
    row.taxonomy,
    row.address,
    row.building,
    row.extra,
    row.snapshot,
    row.sources,
    row.attribution,
    row.phones,
    row.websites,
    row.socials,
    row.emails,
    row.brand,
    row.operating_status,
    row.unit,
    row.postal_city,
    row.locality,
    row.region,
    row.postcode,
    row.country,
    row.building_class,
    row.id,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
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

function numberValue(value: string | number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function text(value: string | number | null | undefined): string {
  if (value == null) return ''
  return String(value)
}

function nonempty(value: string): string | null {
  const next = value.trim()
  return next ? next : null
}
