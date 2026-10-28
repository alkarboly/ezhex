import type { PlaceAddressLabel } from '../../lib/associate'
import { asGeometry, type GeoJsonGeometry } from '../../lib/geojson'
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
    case 'brand_name':
      return record.brand_name
    case 'building_id':
      return record.building_id
    case 'address_id':
      return record.address_id
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
    case 'address_id':
      return record.address_id
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
    case 'building_id':
      return record.building_id
    case 'geometry':
      return record.geometry?.type ?? null
    default:
      throw new Error(`Unsupported addresses field: ${field}`)
  }
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
        confidence: readField(dataset, place, 'confidence'),
        operating_status: readField(dataset, place, 'operating_status'),
        phones: readField(dataset, place, 'phones'),
        websites: readField(dataset, place, 'websites'),
        brand_name: readField(dataset, place, 'brand_name'),
        building_id: place.building_id,
        address_id: place.address_id,
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
        address_id: building.address_id,
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
      building_id: address.building_id,
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
