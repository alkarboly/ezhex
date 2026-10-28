import type { GeoJsonGeometry } from './geojson'
import { snapshotDate } from './overture-release'
import { parseTaxonomyLabel } from './taxonomy'
import type { DatasetId } from '../types/datasets'
import type { ResultRow } from '../types/queries'

export type FeatureRow = {
  key: string
  kind: DatasetId
  id: string
  h3: string
  snapshot: string
  snapshot_date: string | null
  sources: string | null
  attribution: string | null
  name: string | null
  category: string | null
  main_category: string | null
  taxonomy: string | null
  official_id: string | null
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
          snapshot_date: snapshotDate(row.release_version),
          sources: nonempty(text(row.values.sources)),
          attribution: nonempty(text(row.values.attribution)),
          name: nonempty(text(row.values['names.primary'])),
          ...placeCategories(row),
          confidence: numberValue(row.values.confidence),
          operating_status: nonempty(text(row.values.operating_status)),
          phones: nonempty(text(row.values.phones)),
          websites: nonempty(text(row.values.websites)),
          socials: nonempty(text(row.values.socials)),
          emails: nonempty(text(row.values.emails)),
          brand: nonempty(text(row.values.brand_name)),
          brand_wikidata: nonempty(text(row.values.brand_wikidata)),
          official_id: nonempty(text(row.values.brand_wikidata)),
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
          snapshot_date: snapshotDate(row.release_version),
          sources: nonempty(text(row.values.sources)),
          attribution: nonempty(text(row.values.attribution)),
          name: null,
          category: null,
          main_category: null,
          taxonomy: null,
          official_id: null,
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
          snapshot_date: snapshotDate(row.release_version),
          sources: nonempty(text(row.values.sources)),
          attribution: nonempty(text(row.values.attribution)),
          name: null,
          category: nonempty(text(row.values.subtype) || text(row.values.class)),
          main_category: nonempty(text(row.values.subtype)),
          taxonomy: nonempty(text(row.values.subtype)),
          official_id: null,
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

export type PresenceFilter = 'any' | 'yes' | 'no'

export type InspectFilters = {
  kind: DatasetId | 'all'
  search: string
  categories: readonly string[]
  mainCategories: readonly string[]
  snapshotDates: readonly string[]
  statuses: readonly string[]
  buildingClasses: readonly string[]
  confidenceMin: number | null
  confidenceMax: number | null
  underground: PresenceFilter
  hasPhone: PresenceFilter
  hasEmail: PresenceFilter
  hasSocials: PresenceFilter
  hasOfficialId: PresenceFilter
}

export function filterFeatureRows(rows: readonly FeatureRow[], filters: InspectFilters): FeatureRow[] {
  const query = filters.search.trim().toLowerCase()
  return rows.filter((row) => {
    if (filters.kind !== 'all' && row.kind !== filters.kind) return false
    if (filters.categories.length > 0 && !includes(filters.categories, row.category)) return false
    if (filters.mainCategories.length > 0 && !includes(filters.mainCategories, row.main_category)) return false
    if (filters.snapshotDates.length > 0 && !includes(filters.snapshotDates, row.snapshot_date)) return false
    if (filters.statuses.length > 0 && !includes(filters.statuses, row.operating_status)) return false
    if (filters.buildingClasses.length > 0 && !includes(filters.buildingClasses, row.building_class)) return false
    if (filters.confidenceMin != null && (row.confidence == null || row.confidence < filters.confidenceMin)) return false
    if (filters.confidenceMax != null && (row.confidence == null || row.confidence > filters.confidenceMax)) return false
    if (!matchesPresence(filters.underground, row.is_underground === 'true')) return false
    if (!matchesPresence(filters.hasPhone, Boolean(row.phones))) return false
    if (!matchesPresence(filters.hasEmail, Boolean(row.emails))) return false
    if (!matchesPresence(filters.hasSocials, Boolean(row.socials))) return false
    if (!matchesPresence(filters.hasOfficialId, Boolean(row.official_id))) return false
    if (!query) return true
    return searchText(row).includes(query)
  })
}

/** Distinct non-empty values seen in the loaded rows. Not a preset list. */
export function observedValues(
  rows: readonly FeatureRow[],
  field: 'category' | 'main_category' | 'building' | 'building_class' | 'operating_status' | 'snapshot_date',
): string[] {
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
    row.main_category,
    row.taxonomy,
    row.snapshot_date,
    row.official_id,
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

function placeCategories(row: ResultRow): { category: string | null; main_category: string | null; taxonomy: string | null } {
  const tax = parseTaxonomyLabel(text(row.values['taxonomy.primary']) || text(row.values['taxonomy.hierarchy']))
  const basic = nonempty(text(row.values.basic_category))
  return {
    taxonomy: tax.raw,
    main_category: tax.main,
    category: tax.category || basic,
  }
}

function includes(values: readonly string[], value: string | null): boolean {
  return value != null && values.includes(value)
}

function matchesPresence(filter: PresenceFilter, present: boolean): boolean {
  if (filter === 'any') return true
  return filter === 'yes' ? present : !present
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
