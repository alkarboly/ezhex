import { MOCK_COVERAGE } from '../lib/h3'
import { H3_RESOLUTION, MAX_VIEWPORT_CELLS } from '../lib/limits'
import { readDataMode, supabasePublicConfig } from '../lib/server-env'
import { validateCellList, validateFilters, validateQuery } from '../lib/validate-query'
import type { DatasetId } from '../types/datasets'
import type { CellCount, QueryResult, QuerySpec } from '../types/queries'
import type { DataProvider } from './data-provider'
import { buildMockDatabase, ingestMockCells, type MockDatabase } from './mock/database'
import { compareField, matchesFilters, toResultRow, type AnyRecord } from './mock/records'

let database: MockDatabase | null = null
let pending: Promise<MockDatabase> | null = null
let buildError: Error | null = null

function loadDatabase(): Promise<MockDatabase> {
  if (database) return Promise.resolve(database)
  if (buildError) return Promise.reject(buildError)
  if (!pending) {
    pending = Promise.resolve()
      .then(() => {
        const built = buildMockDatabase()
        database = built
        return built
      })
      .catch((error: unknown) => {
        buildError = error instanceof Error ? error : new Error(String(error))
        pending = null
        throw buildError
      })
  }
  return pending
}

function indexFor(db: MockDatabase, dataset: DatasetId): Map<string, AnyRecord[]> {
  if (dataset === 'places') return db.places
  if (dataset === 'buildings') return db.buildings
  return db.addresses
}

function emptyResult(spec: QuerySpec): QueryResult {
  return {
    total: 0,
    byCell: spec.h3_cells.map((h3) => ({ h3, count: 0 })),
    rows: [],
    limit: spec.limit,
    offset: spec.offset,
    source: 'mock',
  }
}

function assertQuery(spec: QuerySpec) {
  const errors = validateQuery(spec)
  if (errors.length > 0) throw new Error(errors.join(' '))
}

export const mockProvider: DataProvider = {
  id: 'mock',
  label: 'Mock data',
  async describeSource() {
    const db = await loadDatabase()
    const mode = readDataMode()
    return {
      mode: 'mock',
      rawMode: mode.raw,
      unrecognized: mode.unrecognized,
      label: 'Mock data',
      note: 'Synthetic Austin records shaped like Overture features. Filters change these counts. This is not a live Overture release.',
      supabase: supabasePublicConfig(),
      resolution: H3_RESOLUTION,
      cells: db.cells.length,
      counts: { ...db.totals },
      coverage: { ...MOCK_COVERAGE },
    }
  },
  async getCellCounts(request) {
    const errors = [
      ...validateCellList(request.h3_cells, MAX_VIEWPORT_CELLS),
      ...validateFilters(request.dataset, request.filters),
    ]
    if (errors.length > 0) throw new Error(errors.join(' '))
    const db = await loadDatabase()
    return countCells(db, request.dataset, request.h3_cells, request.filters)
  },
  async runQuery(spec) {
    assertQuery(spec)
    if (spec.h3_cells.length === 0) return emptyResult(spec)
    const db = await loadDatabase()
    const index = indexFor(db, spec.dataset)
    const grouped = new Map<string, AnyRecord[]>()
    const matches: AnyRecord[] = []
    for (const cell of spec.h3_cells) {
      const bucket: AnyRecord[] = []
      grouped.set(cell, bucket)
      for (const record of index.get(cell) ?? []) {
        if (matchesFilters(spec.dataset, record, spec.filters)) {
          bucket.push(record)
          matches.push(record)
        }
      }
    }
    matches.sort((left, right) =>
      compareField(spec.dataset, left, right, spec.sort.field, spec.sort.direction),
    )
    const byCell: CellCount[] = spec.h3_cells.map((h3) => ({
      h3,
      count: grouped.get(h3)?.length ?? 0,
    }))
    return {
      total: matches.length,
      byCell,
      rows: matches.slice(spec.offset, spec.offset + spec.limit).map((record) => toResultRow(spec.dataset, record)),
      limit: spec.limit,
      offset: spec.offset,
      source: 'mock',
    }
  },
}

function countCells(
  db: MockDatabase,
  dataset: DatasetId,
  cells: readonly string[],
  filters: QuerySpec['filters'],
): CellCount[] {
  const index = indexFor(db, dataset)
  return cells.map((h3) => {
    const records = index.get(h3) ?? []
    const count =
      filters.length === 0
        ? records.length
        : records.filter((record) => matchesFilters(dataset, record, filters)).length
    return { h3, count }
  })
}

export function resetMockDatabaseForTests() {
  database = null
  pending = null
  buildError = null
}

export function ingestMockCellsNow(cells: readonly string[]) {
  if (!database) database = buildMockDatabase()
  return ingestMockCells(database, cells)
}
