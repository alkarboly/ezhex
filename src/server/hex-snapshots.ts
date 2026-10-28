import { getResolution, isValidCell } from 'h3-js'
import { buildHexSnapshotCheck, historicalPinError, unprocessedHexError } from '../lib/hex-snapshots'
import { compareOvertureRelease, defaultOvertureRelease } from '../lib/overture'
import { MAX_SELECTED_CELLS } from '../lib/limits'
import { readDataMode } from '../lib/server-env'
import { getSupabaseClient } from '../lib/supabase'
import { type MockDatabase } from '../services/mock/database'
import { historizeMockCellsNow, peekMockDatabase } from '../services/mock-provider'
import type { HexReleaseSnapshot, HexSnapshotCheck, QuerySnapshotStatus } from '../types/releases'
import { ingestOverturePlan } from './overture-ingest'
import { planWorkflowIngestion } from './workflow-ingestion'

const mockStore = new Map<string, HexReleaseSnapshot>()
let mockSeeded = false

export function resetHexSnapshotsForTests() {
  mockStore.clear()
  mockSeeded = false
}

export async function checkHexSnapshots(cells: readonly string[]): Promise<HexSnapshotCheck> {
  const unique = parseCells(cells)
  const current = defaultOvertureRelease()
  const stored = await readHexSnapshots(unique)
  return buildHexSnapshotCheck(unique, stored, current)
}

export async function checkHexSnapshotsRequest(
  body: unknown,
): Promise<HexSnapshotCheck | { error: string; status: number }> {
  if (!isRecord(body) || !Array.isArray(body.h3_cells)) {
    return { error: 'Request body must include h3_cells.', status: 400 }
  }
  const cells = body.h3_cells.filter((cell): cell is string => typeof cell === 'string')
  if (cells.length === 0) return { error: 'Choose at least one hex.', status: 400 }
  if (cells.length > MAX_SELECTED_CELLS) {
    return { error: `Selection is limited to ${MAX_SELECTED_CELLS} cells.`, status: 400 }
  }
  for (const cell of cells) {
    if (!isValidCell(cell) || getResolution(cell) !== 8) {
      return { error: 'Every hex must be a resolution-8 cell.', status: 400 }
    }
  }
  return checkHexSnapshots(cells)
}

export async function newestHexReleases(cells: readonly string[]): Promise<Map<string, string>> {
  const check = await checkHexSnapshots(cells)
  const newest = new Map<string, string>()
  for (const cell of check.cells) {
    if (cell.latest_release_version) newest.set(cell.h3, cell.latest_release_version)
  }
  return newest
}

export function recordHexSnapshot(row: HexReleaseSnapshot): boolean {
  const existing = [...mockStore.values()].filter((item) => item.h3_res8 === row.h3_res8)
  const first = existing.map((item) => item.release_version).sort(compareOvertureRelease)[0]
  if (first && compareOvertureRelease(row.release_version, first) < 0) return false
  mockStore.set(`${row.h3_res8}:${row.release_version}`, row)
  return true
}

export function recordProcessedSnapshots(
  cells: readonly string[],
  release: string,
  counts: { places: number; buildings: number; addresses: number } = { places: 0, buildings: 0, addresses: 0 },
) {
  const ingestedAt = new Date().toISOString()
  for (const h3 of cells) {
    recordHexSnapshot({
      release_version: release,
      h3_res8: h3,
      place_count: counts.places,
      building_count: counts.buildings,
      address_count: counts.addresses,
      source_datasets: readDataMode().resolved === 'mock' ? ['mock'] : ['overture'],
      ingested_at: ingestedAt,
    })
  }
}

export type SnapshotRunPlan = {
  release_version: string | null
  snapshot_status: QuerySnapshotStatus
  historized_hexes: string[]
}

/** Fail unprocessed hexes. Historize latest only on a workflow run. Historical pins never backfill. */
export async function prepareWorkflowSnapshots(
  cells: readonly string[],
  pin: string | null,
): Promise<SnapshotRunPlan | { error: string; status: number }> {
  const check = await checkHexSnapshots(cells)
  const missing = unprocessedHexError(check)
  if (missing) return { error: missing, status: 400 }
  if (pin) {
    const pinError = historicalPinError(check, pin)
    if (pinError) return { error: pinError, status: 400 }
    return { release_version: pin, snapshot_status: 'historical', historized_hexes: [] }
  }
  const stale = check.cells.filter((cell) => !cell.has_current).map((cell) => cell.h3)
  const historized = stale.length > 0 ? await historizeProcessedHexes(stale, check.current_release_version) : []
  const after = await checkHexSnapshots(cells)
  const stillStale = after.cells.some((cell) => !cell.has_current)
  return {
    release_version: after.current_release_version,
    snapshot_status: stillStale ? 'stale' : 'current',
    historized_hexes: historized,
  }
}

async function historizeProcessedHexes(cells: readonly string[], release: string): Promise<string[]> {
  if (cells.length === 0) return []
  if (readDataMode().resolved === 'mock') {
    const extra = historizeMockCellsNow(cells, release)
    recordProcessedSnapshots(extra.hexes, release, { places: extra.rows, buildings: 0, addresses: 0 })
    return extra.hexes
  }
  try {
    const plan = planWorkflowIngestion({
      release_version: release,
      h3_cells: [...cells],
      datasets: ['places', 'buildings', 'addresses'],
    })
    await ingestOverturePlan(plan)
    return [...cells]
  } catch {
    return []
  }
}

async function readHexSnapshots(cells: readonly string[]): Promise<HexReleaseSnapshot[]> {
  if (readDataMode().resolved === 'mock') {
    await seedMockSnapshots()
    return cells.flatMap((h3) => [...mockStore.values()].filter((row) => row.h3_res8 === h3))
  }
  const client = getSupabaseClient()
  if (!client) return []
  const rows: HexReleaseSnapshot[] = []
  for (const part of chunk(cells, 80)) {
    const { data, error } = await client
      .from('overture_hex_snapshots')
      .select('release_version, h3_res8, place_count, building_count, address_count, source_datasets, ingested_at')
      .in('h3_res8', part)
    if (error) {
      if (/does not exist|schema cache/i.test(error.message)) return []
      throw new Error(error.message)
    }
    for (const row of data ?? []) {
      if (!row || typeof row.h3_res8 !== 'string' || typeof row.release_version !== 'string') continue
      rows.push({
        release_version: row.release_version,
        h3_res8: row.h3_res8,
        place_count: Number(row.place_count) || 0,
        building_count: Number(row.building_count) || 0,
        address_count: Number(row.address_count) || 0,
        source_datasets: Array.isArray(row.source_datasets)
          ? row.source_datasets.filter((item): item is string => typeof item === 'string')
          : [],
        ingested_at: typeof row.ingested_at === 'string' ? row.ingested_at : new Date().toISOString(),
      })
    }
  }
  return rows
}

async function seedMockSnapshots() {
  if (mockSeeded) return
  mockSeeded = true
  const db = await peekMockDatabase()
  seedFromDatabase(db)
}

function seedFromDatabase(db: MockDatabase) {
  const ingestedAt = '2026-10-21T00:00:00.000Z'
  for (const cell of db.cells) {
    const releases = new Set<string>()
    for (const row of db.places.get(cell) ?? []) releases.add(row.release_version)
    for (const row of db.buildings.get(cell) ?? []) releases.add(row.release_version)
    for (const row of db.addresses.get(cell) ?? []) releases.add(row.release_version)
    for (const release of releases) {
      recordHexSnapshot({
        release_version: release,
        h3_res8: cell,
        place_count: (db.places.get(cell) ?? []).filter((row) => row.release_version === release).length,
        building_count: (db.buildings.get(cell) ?? []).filter((row) => row.release_version === release).length,
        address_count: (db.addresses.get(cell) ?? []).filter((row) => row.release_version === release).length,
        source_datasets: ['mock'],
        ingested_at: ingestedAt,
      })
    }
  }
}

function parseCells(cells: readonly string[]): string[] {
  return [...new Set(cells.filter((cell) => isValidCell(cell) && getResolution(cell) === 8))]
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const parts: T[][] = []
  for (let index = 0; index < items.length; index += size) parts.push(items.slice(index, index + size))
  return parts
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
