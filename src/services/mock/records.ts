import type { PlaceAddressLabel } from '../../lib/associate'
import { asGeometry, type GeoJsonGeometry } from '../../lib/geojson'
import { snapshotDate } from '../../lib/overture-release'
import { formatAttribution, formatSources, type OvertureSource } from '../../lib/overture-sources'
import { parseTaxonomyLabel } from '../../lib/taxonomy'
import type { BuildingSubtype } from '../../types/datasets'
import type { OperatingStatus } from '../../types/place-presets'
import type { DatasetId } from '../../types/datasets'
import type { QueryFilter, ResultRow } from '../../types/queries'

export type PlaceRecord = {
  id: string
  h3: string
  release_version: string
  lat: number
  lng: number
  geometry: GeoJsonGeometry | null
  names: { primary: string }
  basic_category: string
  taxonomy: {
    primary: string
    hierarchy: string[]
    alternates: string[] | null
  }
  confidence: number | null
  operating_status: OperatingStatus
  phones: string[]
  websites: string[]
  socials: string[]
  emails: string[]
  brand_name: string | null
  brand_wikidata: string | null
  place_addresses: PlaceAddressLabel[]
  building_id: string | null
  address_id: string | null
  sources: OvertureSource[]
}

export type BuildingRecord = {
  id: string
  h3: string
  release_version: string
  lat: number
  lng: number
  geometry: GeoJsonGeometry | null
  subtype: BuildingSubtype | null
  class: string | null
  names: { primary: string }
  height: number | null
  num_floors: number | null
  has_parts: boolean | null
  is_underground: boolean | null
  num_floors_underground: number | null
  min_height: number | null
  min_floor: number | null
  level: number | null
  facade_color: string | null
  facade_material: string | null
  roof_material: string | null
  roof_shape: string | null
  roof_direction: number | null
  roof_color: string | null
  address_id: string | null
  sources: OvertureSource[]
}

export type AddressRecord = {
  id: string
  h3: string
  release_version: string
  lat: number
  lng: number
  geometry: GeoJsonGeometry | null
  country: string
  number: string
  street: string
  unit: string
  postal_city: string
  postcode: string
  address_levels: [{ value: string }, { value: string }]
  building_id: string | null
  sources: OvertureSource[]
}

export type AnyRecord = PlaceRecord | BuildingRecord | AddressRecord

export function readField(dataset: DatasetId, record: AnyRecord, field: string): string | number | null {
  if (dataset === 'places') return readPlace(record as PlaceRecord, field)
  if (dataset === 'buildings') return readBuilding(record as BuildingRecord, field)
  return readAddress(record as AddressRecord, field)
}

function readPlace(record: PlaceRecord, field: string): string | number | null {
  switch (field) {
    case 'names.primary':
      return record.names.primary
    case 'basic_category':
      return record.basic_category
    case 'taxonomy.primary':
      return record.taxonomy.primary
    case 'confidence':
      return record.confidence
    case 'operating_status':
      return record.operating_status
    case 'phones':
      return record.phones.join(', ')
    case 'websites':
      return record.websites.join(', ')
    case 'socials':
      return record.socials.join(', ')
    case 'emails':
      return record.emails.join(', ')
    case 'brand_name':
      return record.brand_name
    case 'brand_wikidata':
      return record.brand_wikidata
    case 'taxonomy.hierarchy':
      return record.taxonomy.hierarchy.join(' > ')
    case 'main_category':
      return parseTaxonomyLabel(record.taxonomy.primary || record.taxonomy.hierarchy.join(' < ')).main
    case 'place_addresses':
      return formatPlaceAddresses(record.place_addresses)
    case 'building_id':
      return record.building_id
    case 'address_id':
      return record.address_id
    case 'release_version':
      return record.release_version
    case 'snapshot_date':
      return snapshotDate(record.release_version)
    case 'sources':
      return formatSources(record.sources)
    case 'attribution':
      return formatAttribution(record.sources)
    case 'geometry':
      return record.geometry?.type ?? null
    default:
      throw new Error(`Unsupported places field: ${field}`)
  }
}

function readBuilding(record: BuildingRecord, field: string): string | number | null {
  switch (field) {
    case 'subtype':
      return record.subtype
    case 'height':
      return record.height
    case 'num_floors':
      return record.num_floors
    case 'names.primary':
      return record.names.primary
    case 'class':
      return record.class
    case 'has_parts':
      return flag(record.has_parts)
    case 'is_underground':
      return flag(record.is_underground)
    case 'num_floors_underground':
      return record.num_floors_underground
    case 'min_height':
      return record.min_height
    case 'min_floor':
      return record.min_floor
    case 'level':
      return record.level
    case 'facade_color':
      return record.facade_color
    case 'facade_material':
      return record.facade_material
    case 'roof_material':
      return record.roof_material
    case 'roof_shape':
      return record.roof_shape
    case 'roof_direction':
      return record.roof_direction
    case 'roof_color':
      return record.roof_color
    case 'address_id':
      return record.address_id
    case 'release_version':
      return record.release_version
    case 'snapshot_date':
      return snapshotDate(record.release_version)
    case 'sources':
      return formatSources(record.sources)
    case 'attribution':
      return formatAttribution(record.sources)
    case 'geometry':
      return record.geometry?.type ?? null
    default:
      throw new Error(`Unsupported buildings field: ${field}`)
  }
}

function readAddress(record: AddressRecord, field: string): string | number | null {
  switch (field) {
    case 'number':
      return record.number
    case 'street':
      return record.street
    case 'postcode':
      return record.postcode
    case 'region':
      return record.address_levels[0].value
    case 'locality':
      return record.address_levels[1].value
    case 'address':
      return formatAddress(record)
    case 'unit':
      return record.unit
    case 'postal_city':
      return record.postal_city
    case 'country':
      return record.country
    case 'building_id':
      return record.building_id
    case 'release_version':
      return record.release_version
    case 'snapshot_date':
      return snapshotDate(record.release_version)
    case 'sources':
      return formatSources(record.sources)
    case 'attribution':
      return formatAttribution(record.sources)
    case 'geometry':
      return record.geometry?.type ?? null
    default:
      throw new Error(`Unsupported addresses field: ${field}`)
  }
}

function formatPlaceAddresses(labels: readonly PlaceAddressLabel[]): string | null {
  const parts = labels
    .map((label) => label.freeform || `${label.number ?? ''} ${label.street ?? ''}`.trim())
    .filter((part) => part.length > 0)
  return parts.length > 0 ? parts.join('; ') : null
}

function flag(value: boolean | null): string | null {
  if (value == null) return null
  return value ? 'true' : 'false'
}

export function formatAddress(record: AddressRecord): string {
  const region = record.address_levels[0].value
  const locality = record.address_levels[1].value
  const unit = record.unit ? ` ${record.unit}` : ''
  return `${record.number} ${record.street}${unit}, ${locality}, ${region} ${record.postcode}`
}

export function matchesFilters(dataset: DatasetId, record: AnyRecord, filters: readonly QueryFilter[]): boolean {
  return filters.every((filter) => matchesFilter(dataset, record, filter))
}

function matchesFilter(dataset: DatasetId, record: AnyRecord, filter: QueryFilter): boolean {
  const value = readField(dataset, record, filter.field)
  switch (filter.operator) {
    case 'eq':
      return value === filter.value
    case 'in':
      return Array.isArray(filter.value) && value != null && filter.value.includes(String(value))
    case 'contains':
      return (
        typeof value === 'string' &&
        typeof filter.value === 'string' &&
        value.toLowerCase().includes(filter.value.toLowerCase())
      )
    case 'gte':
      return typeof value === 'number' && typeof filter.value === 'number' && value >= filter.value
    case 'lte':
      return typeof value === 'number' && typeof filter.value === 'number' && value <= filter.value
    case 'is_null':
      return value == null
    case 'is_not_null':
      return value != null
    default:
      throw new Error(`Unsupported operator: ${filter.operator as string}`)
  }
}

export function compareField(
  dataset: DatasetId,
  left: AnyRecord,
  right: AnyRecord,
  field: string,
  direction: 'asc' | 'desc',
): number {
  const a = readField(dataset, left, field)
  const b = readField(dataset, right, field)
  if (a == null && b == null) return left.id.localeCompare(right.id)
  if (a == null) return 1
  if (b == null) return -1
  const base =
    typeof a === 'number' && typeof b === 'number'
      ? a - b
      : String(a).localeCompare(String(b), undefined, { sensitivity: 'base', numeric: true })
  if (base === 0) return left.id.localeCompare(right.id)
  return direction === 'asc' ? base : -base
}

export function toResultRow(dataset: DatasetId, record: AnyRecord): ResultRow {
  if (dataset === 'places') {
    const place = record as PlaceRecord
    return {
      id: place.id,
      h3: place.h3,
      lat: place.lat,
      lng: place.lng,
      geometry: place.geometry,
      building_id: place.building_id,
      address_id: place.address_id,
      release_version: place.release_version,
      values: {
        'names.primary': readField(dataset, place, 'names.primary'),
        basic_category: readField(dataset, place, 'basic_category'),
        'taxonomy.primary': readField(dataset, place, 'taxonomy.primary'),
        'taxonomy.hierarchy': readField(dataset, place, 'taxonomy.hierarchy'),
        main_category: readField(dataset, place, 'main_category'),
        confidence: readField(dataset, place, 'confidence'),
        operating_status: readField(dataset, place, 'operating_status'),
        phones: readField(dataset, place, 'phones'),
        websites: readField(dataset, place, 'websites'),
        socials: readField(dataset, place, 'socials'),
        emails: readField(dataset, place, 'emails'),
        brand_name: readField(dataset, place, 'brand_name'),
        brand_wikidata: readField(dataset, place, 'brand_wikidata'),
        place_addresses: readField(dataset, place, 'place_addresses'),
        building_id: place.building_id,
        address_id: place.address_id,
        release_version: place.release_version,
        snapshot_date: readField(dataset, place, 'snapshot_date'),
        sources: readField(dataset, place, 'sources'),
        attribution: readField(dataset, place, 'attribution'),
      },
    }
  }
  if (dataset === 'buildings') {
    const building = record as BuildingRecord
    return {
      id: building.id,
      h3: building.h3,
      lat: building.lat,
      lng: building.lng,
      geometry: building.geometry,
      address_id: building.address_id,
      release_version: building.release_version,
      values: {
        subtype: readField(dataset, building, 'subtype'),
        height: readField(dataset, building, 'height'),
        num_floors: readField(dataset, building, 'num_floors'),
        'names.primary': readField(dataset, building, 'names.primary'),
        class: readField(dataset, building, 'class'),
        has_parts: readField(dataset, building, 'has_parts'),
        is_underground: readField(dataset, building, 'is_underground'),
        num_floors_underground: readField(dataset, building, 'num_floors_underground'),
        min_height: readField(dataset, building, 'min_height'),
        min_floor: readField(dataset, building, 'min_floor'),
        level: readField(dataset, building, 'level'),
        facade_color: readField(dataset, building, 'facade_color'),
        facade_material: readField(dataset, building, 'facade_material'),
        roof_material: readField(dataset, building, 'roof_material'),
        roof_shape: readField(dataset, building, 'roof_shape'),
        roof_direction: readField(dataset, building, 'roof_direction'),
        roof_color: readField(dataset, building, 'roof_color'),
        address_id: building.address_id,
        release_version: building.release_version,
        snapshot_date: readField(dataset, building, 'snapshot_date'),
        sources: readField(dataset, building, 'sources'),
        attribution: readField(dataset, building, 'attribution'),
      },
    }
  }
  const address = record as AddressRecord
  return {
    id: address.id,
    h3: address.h3,
    lat: address.lat,
    lng: address.lng,
    geometry: address.geometry,
    building_id: address.building_id,
    release_version: address.release_version,
    values: {
      number: readField(dataset, address, 'number'),
      street: readField(dataset, address, 'street'),
      locality: readField(dataset, address, 'locality'),
      region: readField(dataset, address, 'region'),
      postcode: readField(dataset, address, 'postcode'),
      address: readField(dataset, address, 'address'),
      unit: readField(dataset, address, 'unit'),
      postal_city: readField(dataset, address, 'postal_city'),
      country: readField(dataset, address, 'country'),
      building_id: address.building_id,
      release_version: address.release_version,
      snapshot_date: readField(dataset, address, 'snapshot_date'),
      sources: readField(dataset, address, 'sources'),
      attribution: readField(dataset, address, 'attribution'),
    },
  }
}

export function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
}

export function parseGeometry(value: unknown): GeoJsonGeometry | null {
  return asGeometry(value)
}
