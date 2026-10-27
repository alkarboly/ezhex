import type { BuildingSubtype } from '../../types/datasets'
import type { OperatingStatus } from '../../types/place-presets'
import type { DatasetId } from '../../types/datasets'
import type { QueryFilter } from '../../types/queries'

export type PlaceRecord = {
  id: string
  h3: string
  lat: number
  lng: number
  names: { primary: string }
  basic_category: string
  taxonomy: {
    primary: string
    hierarchy: string[]
    alternates: string[] | null
  }
  confidence: number | null
  operating_status: OperatingStatus
}

export type BuildingRecord = {
  id: string
  h3: string
  lat: number
  lng: number
  subtype: BuildingSubtype | null
  height: number | null
  num_floors: number | null
}

export type AddressRecord = {
  id: string
  h3: string
  lat: number
  lng: number
  country: string
  number: string
  street: string
  postcode: string
  address_levels: [{ value: string }, { value: string }]
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
    default:
      throw new Error(`Unsupported addresses field: ${field}`)
  }
}

export function formatAddress(record: AddressRecord): string {
  const region = record.address_levels[0].value
  const locality = record.address_levels[1].value
  return `${record.number} ${record.street}, ${locality}, ${region} ${record.postcode}`
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
