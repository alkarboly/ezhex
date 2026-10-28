import {
  DATASET_META,
  RESULT_SEARCH_FIELD,
  defaultSort,
  fieldByName,
  type DatasetId,
} from '../types/datasets'
import type {
  AddressesForm,
  BuildingsForm,
  PlacesForm,
  QueryFilter,
  QuerySpec,
} from '../types/queries'
import { validateQuery } from './validate-query'

export type QueryFormState = {
  dataset: DatasetId
  selectedCells: readonly string[]
  places: PlacesForm
  buildings: BuildingsForm
  addresses: AddressesForm
  sortField: string
  sortDirection: 'asc' | 'desc'
  limit: number
  page: number
  resultsSearch: string
  releaseVersion?: string
}

export type CompiledQuery = {
  spec: QuerySpec
  errors: string[]
}

export function buildQuerySpec(input: QueryFormState): CompiledQuery {
  const errors: string[] = []
  const filters = filtersForDataset(input, errors)
  const searchField = RESULT_SEARCH_FIELD[input.dataset]
  const search = input.resultsSearch.trim()
  if (search && searchField) {
    filters.push({ field: searchField, operator: 'contains', value: search })
  }

  const fallback = defaultSort(input.dataset)
  const sortField = fieldByName(input.dataset, input.sortField)?.sortable
    ? input.sortField
    : fallback.field
  const spec: QuerySpec = {
    dataset: input.dataset,
    h3_cells: [...input.selectedCells],
    filters,
    sort: {
      field: sortField,
      direction: input.sortDirection === 'desc' ? 'desc' : 'asc',
    },
    limit: input.limit,
    offset: Math.max(0, input.page) * input.limit,
    ...(input.releaseVersion ? { release_version: input.releaseVersion } : {}),
  }
  return { spec, errors: [...errors, ...validateQuery(spec)] }
}

function filtersForDataset(input: QueryFormState, errors: string[]): QueryFilter[] {
  if (input.dataset === 'places') return placeFilters(input.places, errors)
  if (input.dataset === 'buildings') return buildingFilters(input.buildings, errors)
  return addressFilters(input.addresses)
}

function placeFilters(form: PlacesForm, errors: string[]): QueryFilter[] {
  const filters: QueryFilter[] = []
  const name = form.name.trim()
  if (name) filters.push({ field: 'names.primary', operator: 'contains', value: name })
  if (form.basicCategories.length > 0) {
    filters.push({ field: 'basic_category', operator: 'in', value: [...form.basicCategories] })
  }
  if (form.primaryCategory) {
    filters.push({ field: 'taxonomy.primary', operator: 'eq', value: form.primaryCategory })
  }
  const min = readUnitInterval(form.confidenceMin, 'Minimum confidence', errors)
  const max = readUnitInterval(form.confidenceMax, 'Maximum confidence', errors)
  if (min != null && max != null && min > max) {
    errors.push('Minimum confidence cannot be greater than maximum confidence.')
  }
  if (min != null) filters.push({ field: 'confidence', operator: 'gte', value: min })
  if (max != null) filters.push({ field: 'confidence', operator: 'lte', value: max })
  return filters
}

function buildingFilters(form: BuildingsForm, errors: string[]): QueryFilter[] {
  const filters: QueryFilter[] = []
  if (form.subtypes.length > 0) {
    filters.push({ field: 'subtype', operator: 'in', value: [...form.subtypes] })
  }
  if (form.hasSubtype === 'present') filters.push({ field: 'subtype', operator: 'is_not_null' })
  if (form.hasSubtype === 'missing') filters.push({ field: 'subtype', operator: 'is_null' })
  if (form.subtypes.length > 0 && form.hasSubtype === 'missing') {
    errors.push('Subtype cannot be both listed and missing.')
  }

  const heightMin = readPositive(form.heightMin, 'Minimum height', errors)
  const heightMax = readPositive(form.heightMax, 'Maximum height', errors)
  if (heightMin != null && heightMax != null && heightMin > heightMax) {
    errors.push('Minimum height cannot be greater than maximum height.')
  }
  if ((heightMin != null || heightMax != null) && form.hasHeight === 'missing') {
    errors.push('Height cannot be missing and compared to a range at the same time.')
  }
  if (form.hasHeight === 'present') filters.push({ field: 'height', operator: 'is_not_null' })
  if (form.hasHeight === 'missing') filters.push({ field: 'height', operator: 'is_null' })
  if (heightMin != null) filters.push({ field: 'height', operator: 'gte', value: heightMin })
  if (heightMax != null) filters.push({ field: 'height', operator: 'lte', value: heightMax })

  const floorsMin = readWholeNumber(form.floorsMin, 'Minimum floors', errors)
  const floorsMax = readWholeNumber(form.floorsMax, 'Maximum floors', errors)
  if (floorsMin != null && floorsMax != null && floorsMin > floorsMax) {
    errors.push('Minimum floors cannot be greater than maximum floors.')
  }
  if (floorsMin != null) filters.push({ field: 'num_floors', operator: 'gte', value: floorsMin })
  if (floorsMax != null) filters.push({ field: 'num_floors', operator: 'lte', value: floorsMax })
  return filters
}

function addressFilters(form: AddressesForm): QueryFilter[] {
  const filters: QueryFilter[] = []
  pushContains(filters, 'street', form.street)
  pushContains(filters, 'locality', form.locality)
  pushContains(filters, 'region', form.region)
  pushContains(filters, 'address', form.address)
  const postcode = form.postcode.trim()
  if (postcode) filters.push({ field: 'postcode', operator: 'eq', value: postcode })
  return filters
}

function pushContains(filters: QueryFilter[], field: string, raw: string) {
  const value = raw.trim()
  if (value) filters.push({ field, operator: 'contains', value })
}

function readUnitInterval(raw: string, label: string, errors: string[]): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const value = Number(trimmed)
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    errors.push(`${label} must be a number from 0 to 1.`)
    return null
  }
  return value
}

function readPositive(raw: string, label: string, errors: string[]): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const value = Number(trimmed)
  if (!Number.isFinite(value) || value <= 0) {
    errors.push(`${label} must be a number greater than 0.`)
    return null
  }
  return value
}

function readWholeNumber(raw: string, label: string, errors: string[]): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const value = Number(trimmed)
  if (!Number.isInteger(value) || value < 1) {
    errors.push(`${label} must be a whole number of 1 or more.`)
    return null
  }
  return value
}

export function summarizeQuery(spec: QuerySpec): string {
  const meta = DATASET_META[spec.dataset]
  const conditions =
    spec.filters.length === 0
      ? 'with no attribute filters'
      : `where ${spec.filters.map((filter) => describeFilter(spec.dataset, filter)).join(' and ')}`
  const sortLabel = fieldByName(spec.dataset, spec.sort.field)?.label ?? spec.sort.field
  const direction = spec.sort.direction === 'asc' ? 'ascending' : 'descending'
  const window =
    spec.offset > 0
      ? `${spec.limit} per page, starting at result ${spec.offset + 1}`
      : `${spec.limit} per page`
  const release = spec.release_version ? ` from release ${spec.release_version}` : ''
  if (spec.h3_cells.length === 0) {
    return `Select H3 cells to query ${meta.plural}${release}. Current filters are ${conditions}.`
  }
  const cells =
    spec.h3_cells.length === 1 ? '1 selected H3 cell' : `${spec.h3_cells.length} selected H3 cells`
  return `Find ${meta.plural} in ${cells}${release} ${conditions}, sorted by ${sortLabel.toLowerCase()} ${direction}, ${window}.`
}

function describeFilter(dataset: DatasetId, filter: QueryFilter): string {
  const definition = fieldByName(dataset, filter.field)
  const label = (definition?.label ?? filter.field).toLowerCase()
  const unit = definition?.unit ? ` ${definition.unit}` : ''
  switch (filter.operator) {
    case 'eq':
      return `${label} is ${prose(filter.value)}`
    case 'in':
      return `${label} is ${proseList(filter.value)}`
    case 'contains':
      return `${label} contains “${prose(filter.value)}”`
    case 'gte':
      return `${label} is at least ${prose(filter.value)}${unit}`
    case 'lte':
      return `${label} is at most ${prose(filter.value)}${unit}`
    case 'is_null':
      return `${label} is missing`
    case 'is_not_null':
      return `${label} is present`
    default:
      return label
  }
}

function prose(value: QueryFilter['value']): string {
  if (typeof value === 'string') return value.replaceAll('_', ' ')
  if (typeof value === 'number') return String(value)
  return ''
}

function proseList(value: QueryFilter['value']): string {
  if (!Array.isArray(value) || value.length === 0) return 'nothing'
  const labels = value.map((entry) => entry.replaceAll('_', ' '))
  if (labels.length === 1) return labels[0]
  if (labels.length === 2) return `${labels[0]} or ${labels[1]}`
  return `${labels.slice(0, -1).join(', ')}, or ${labels[labels.length - 1]}`
}
