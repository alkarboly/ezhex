import { MOCK_COVERAGE } from '../lib/h3'
import { H3_RESOLUTION, MAX_VIEWPORT_CELLS } from '../lib/limits'
import { compareOvertureRelease, defaultOvertureRelease } from '../lib/overture'
import { recordsForRelease } from '../lib/release-query'
import { readDataMode, supabasePublicConfig } from '../lib/server-env'
import { validateCellList, validateFilters, validateQuery, validateReleaseVersion } from '../lib/validate-query'
import type { DatasetId } from '../types/datasets'
import type { CellCount, QueryResult, QuerySpec } from '../types/queries'
import type { ReleaseCatalog, ReleaseSnapshot } from '../types/releases'
import type { DataProvider } from './data-provider'
import { buildMockDatabase, historizeMockCells, ingestMockCells, type MockDatabase } from './mock/database'
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
      current_release_version: defaultOvertureRelease(),
      snapshots: mockSnapshots(db),
    }
  },
  async getCellCounts(request) {
    const errors = [
      ...validateCellList(request.h3_cells, MAX_VIEWPORT_CELLS),
      ...validateFilters(request.dataset, request.filters),
      ...validateReleaseVersion(request.release_version),
    ]
    if (errors.length > 0) throw new Error(errors.join(' '))
    const db = await loadDatabase()
    return countCells(db, request.dataset, request.h3_cells, request.filters, request.release_version)
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
      for (const record of recordsForRelease(index.get(cell) ?? [], spec.release_version)) {
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
  release?: string,
): CellCount[] {
  const index = indexFor(db, dataset)
  return cells.map((h3) => {
    const records = recordsForRelease(index.get(h3) ?? [], release)
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

export function ingestMockCellsNow(cells: readonly string[], release?: string) {
  if (!database) database = buildMockDatabase()
  return ingestMockCells(database, cells, release)
}

export async function peekMockDatabase() {
  return loadDatabase()
}

export function historizeMockCellsNow(cells: readonly string[], release: string) {
  if (!database) database = buildMockDatabase()
  return historizeMockCells(database, cells, release)
}

export async function mockReleaseCatalog(): Promise<ReleaseCatalog> {
  const db = await loadDatabase()
  return {
    current_release_version: defaultOvertureRelease(),
    snapshots: mockSnapshots(db),
  }
}

function mockSnapshots(db: MockDatabase): ReleaseSnapshot[] {
  const current = defaultOvertureRelease()
  const buckets = new Map<
    string,
    { hexes: Set<string>; places: number; buildings: number; addresses: number }
  >()
  const add = (release: string, cell: string, theme: 'places' | 'buildings' | 'addresses', count: number) => {
    const bucket = buckets.get(release) ?? { hexes: new Set<string>(), places: 0, buildings: 0, addresses: 0 }
    bucket.hexes.add(cell)
    bucket[theme] += count
    buckets.set(release, bucket)
  }
  const addRows = (
    rows: Iterable<{ release_version: string }>,
    cell: string,
    theme: 'places' | 'buildings' | 'addresses',
  ) => {
    const byRelease = new Map<string, number>()
    for (const row of rows) {
      byRelease.set(row.release_version, (byRelease.get(row.release_version) ?? 0) + 1)
    }
    for (const [release, count] of byRelease) add(release, cell, theme, count)
  }
  for (const [cell, rows] of db.places) addRows(rows, cell, 'places')
  for (const [cell, rows] of db.buildings) addRows(rows, cell, 'buildings')
  for (const [cell, rows] of db.addresses) addRows(rows, cell, 'addresses')
  return [...buckets.entries()]
    .sort(([left], [right]) => compareOvertureRelease(right, left))
    .map(([release, bucket]) => ({
      release_version: release,
      accessed_on: '2026-10-27',
      source_uri: `mock://overture/${release}`,
      themes: ['places', 'buildings', 'addresses'],
      hex_count: bucket.hexes.size,
      place_count: bucket.places,
      building_count: bucket.buildings,
      address_count: bucket.addresses,
      source_datasets: ['mock'],
      ingested_at: '2026-10-27T00:00:00.000Z',
      current: compareOvertureRelease(release, current) >= 0,
    }))
}
