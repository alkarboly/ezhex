import { isValidCell } from 'h3-js'
import { DATASET_IDS, fieldByName, type DatasetId } from '../types/datasets'
import type { QueryFilter, QuerySpec } from '../types/queries'
import { MAX_QUERY_LIMIT, MAX_SELECTED_CELLS } from './limits'

function isDatasetId(value: string): value is DatasetId {
  return (DATASET_IDS as readonly string[]).includes(value)
}

export function validateCellList(cells: readonly string[], max: number): string[] {
  if (cells.length > max) return [`Use at most ${max} H3 cells.`]
  const seen = new Set<string>()
  for (const cell of cells) {
    if (!isValidCell(cell)) return [`Invalid H3 index: ${cell}`]
    if (seen.has(cell)) return ['h3_cells contains a duplicate index.']
    seen.add(cell)
  }
  return []
}

export function validateFilters(dataset: DatasetId, filters: readonly QueryFilter[]): string[] {
  const errors: string[] = []
  for (const filter of filters) errors.push(...validateFilter(dataset, filter))
  return errors
}

export function validateQuery(spec: QuerySpec): string[] {
  const errors: string[] = []
  if (!isDatasetId(spec.dataset)) {
    errors.push('Dataset must be buildings, addresses, or places.')
    return errors
  }

  errors.push(...validateCellList(spec.h3_cells, MAX_SELECTED_CELLS))

  if (!Number.isInteger(spec.limit) || spec.limit < 1 || spec.limit > MAX_QUERY_LIMIT) {
    errors.push(`Limit must be an integer from 1 to ${MAX_QUERY_LIMIT}.`)
  }
  if (!Number.isInteger(spec.offset) || spec.offset < 0) {
    errors.push('Offset must be an integer of 0 or more.')
  }

  const sortField = fieldByName(spec.dataset, spec.sort?.field ?? '')
  if (!sortField?.sortable || (spec.sort.direction !== 'asc' && spec.sort.direction !== 'desc')) {
    errors.push('Sort field is not sortable for this dataset.')
  }

  if (!Array.isArray(spec.filters)) {
    errors.push('Filters must be a list.')
    return errors
  }

  errors.push(...validateFilters(spec.dataset, spec.filters))
  return errors
}

function validateFilter(dataset: DatasetId, filter: QueryFilter): string[] {
  const definition = fieldByName(dataset, filter.field)
  if (!definition) return [`Unsupported field: ${filter.field}`]
  if (!definition.operators.includes(filter.operator)) {
    return [`${definition.label} does not allow the ${filter.operator} operator.`]
  }

  if (filter.operator === 'is_null' || filter.operator === 'is_not_null') {
    return filter.value === undefined ? [] : [`${definition.label} presence filters do not take a value.`]
  }

  if (filter.operator === 'in') {
    if (!Array.isArray(filter.value) || filter.value.length === 0 || filter.value.length > 50) {
      return [`${definition.label} needs a list of 1 to 50 values.`]
    }
    if (filter.value.some((entry) => typeof entry !== 'string' || entry.length === 0 || entry.length > 200)) {
      return [`${definition.label} values must be text.`]
    }
    return []
  }

  if (filter.operator === 'contains' || filter.operator === 'eq') {
    if (typeof filter.value !== 'string' || filter.value.trim().length === 0 || filter.value.length > 200) {
      return [`${definition.label} needs a text value.`]
    }
    return []
  }

  if (typeof filter.value !== 'number' || !Number.isFinite(filter.value)) {
    return [`${definition.label} needs a numeric value.`]
  }
  return []
}
