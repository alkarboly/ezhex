import { compareOvertureRelease } from '../lib/overture'
import { H3_RESOLUTION, MAX_VIEWPORT_CELLS } from '../lib/limits'
import { readDataMode, supabasePublicConfig } from '../lib/server-env'
import { getSupabaseClient } from '../lib/supabase'
import { validateCellList, validateFilters, validateQuery } from '../lib/validate-query'
import type { DatasetId } from '../types/datasets'
import type { CellCount, QueryResult, ResultRow } from '../types/queries'
import type { DataProvider } from './data-provider'
import {
  compareField,
  matchesFilters,
  readField,
  type AddressRecord,
  type AnyRecord,
  type BuildingRecord,
  type PlaceRecord,
} from './mock/records'

export const SUPABASE_NOT_CONFIGURED =
  'Set SUPABASE_URL and SUPABASE_ANON_KEY on the server. Do not put the service-role key in the environment.'

const TABLES: Record<DatasetId, string> = {
  places: 'overture_places',
  buildings: 'overture_buildings',
  addresses: 'overture_addresses',
}

export const supabaseProvider: DataProvider = {
  id: 'supabase',
  label: 'Overture / Supabase',
  async describeSource() {
    const mode = readDataMode()
    const client = getSupabaseClient()
    if (!client) {
      return {
        mode: 'supabase',
        rawMode: mode.raw,
        unrecognized: mode.unrecognized,
        label: 'Overture',
        note: SUPABASE_NOT_CONFIGURED,
        supabase: supabasePublicConfig(),
        resolution: H3_RESOLUTION,
        cells: null,
        counts: { places: null, buildings: null, addresses: null },
        coverage: null,
      }
    }
    let places: number | null = null
    let buildings: number | null = null
    let addresses: number | null = null
    let note = 'Hex-scoped rows from the public Overture Maps release, stored in Supabase.'
    try {
      ;[places, buildings, addresses] = await Promise.all([
        countTable(client, 'overture_places'),
        countTable(client, 'overture_buildings'),
        countTable(client, 'overture_addresses'),
      ])
    } catch (error) {
      note =
        error instanceof Error
          ? error.message
          : 'Run supabase/migrations/20261027_overture.sql in the Supabase SQL editor.'
    }
    return {
      mode: 'supabase',
      rawMode: mode.raw,
      unrecognized: mode.unrecognized,
      label: 'Overture',
      note,
      supabase: supabasePublicConfig(),
      resolution: H3_RESOLUTION,
      cells: null,
      counts: { places, buildings, addresses },
      coverage: null,
    }
  },
  async getCellCounts(request) {
    const errors = [
      ...validateCellList(request.h3_cells, MAX_VIEWPORT_CELLS),
      ...validateFilters(request.dataset, request.filters),
    ]
    if (errors.length > 0) throw new Error(errors.join(' '))
    const grouped = await loadRecords(request.dataset, request.h3_cells)
    return request.h3_cells.map((h3) => ({
      h3,
      count: (grouped.get(h3) ?? []).filter((record) =>
        matchesFilters(request.dataset, record, request.filters),
      ).length,
    }))
  },
  async runQuery(spec) {
    const errors = validateQuery(spec)
    if (errors.length > 0) throw new Error(errors.join(' '))
    if (spec.h3_cells.length === 0) {
      return {
        total: 0,
        byCell: [],
        rows: [],
        limit: spec.limit,
        offset: spec.offset,
        source: 'supabase',
      }
    }
    const grouped = await loadRecords(spec.dataset, spec.h3_cells)
    const matches: AnyRecord[] = []
    const byCell: CellCount[] = spec.h3_cells.map((h3) => {
      const bucket = (grouped.get(h3) ?? []).filter((record) => matchesFilters(spec.dataset, record, spec.filters))
      matches.push(...bucket)
      return { h3, count: bucket.length }
    })
    matches.sort((left, right) =>
      compareField(spec.dataset, left, right, spec.sort.field, spec.sort.direction),
    )
    return {
      total: matches.length,
      byCell,
      rows: matches.slice(spec.offset, spec.offset + spec.limit).map((record) => toResultRow(spec.dataset, record)),
      limit: spec.limit,
      offset: spec.offset,
      source: 'supabase',
    } satisfies QueryResult
  },
}

export async function supabaseReadyHexes(cells: readonly string[]): Promise<Set<string>> {
  return new Set((await supabaseHexReleases(cells)).keys())
}

/** Newest `release_version` stored for each hex across the Overture feature tables. */
export async function supabaseHexReleases(cells: readonly string[]): Promise<Map<string, string>> {
  const client = requireClient()
  const newest = new Map<string, string>()
  if (cells.length === 0) return newest
  for (const table of Object.values(TABLES)) {
    for (const part of chunk(cells, 80)) {
      const { data, error } = await client.from(table).select('h3_res8, release_version').in('h3_res8', part)
      if (error) throw new Error(error.message)
      for (const row of data ?? []) {
        if (!row || typeof row.h3_res8 !== 'string' || typeof row.release_version !== 'string') continue
        const previous = newest.get(row.h3_res8)
        if (!previous || compareOvertureRelease(row.release_version, previous) > 0) {
          newest.set(row.h3_res8, row.release_version)
        }
      }
    }
  }
  return newest
}

function requireClient() {
  const client = getSupabaseClient()
  if (!client) throw new Error(SUPABASE_NOT_CONFIGURED)
  return client
}

async function countTable(client: NonNullable<ReturnType<typeof getSupabaseClient>>, table: string) {
  const { count, error } = await client.from(table).select('id', { count: 'exact', head: true })
  if (error) throw new Error(error.message)
  return count ?? 0
}

async function loadRecords(dataset: DatasetId, cells: readonly string[]): Promise<Map<string, AnyRecord[]>> {
  const client = requireClient()
  const grouped = new Map<string, AnyRecord[]>()
  for (const cell of cells) grouped.set(cell, [])
  for (const part of chunk(cells, 80)) {
    const { data, error } = await client.from(TABLES[dataset]).select('*').in('h3_res8', part)
    if (error) throw new Error(error.message)
    for (const row of data ?? []) {
      const record = asRecord(dataset, row)
      if (!record) continue
      const bucket = grouped.get(record.h3)
      if (bucket) bucket.push(record)
      else grouped.set(record.h3, [record])
    }
  }
  return grouped
}

function asRecord(dataset: DatasetId, row: Record<string, unknown>): AnyRecord | null {
  if (typeof row.id !== 'string' || typeof row.h3_res8 !== 'string') return null
  const lat = typeof row.lat === 'number' ? row.lat : Number(row.lat)
  const lng = typeof row.lng === 'number' ? row.lng : Number(row.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (dataset === 'places') {
    const place: PlaceRecord = {
      id: row.id,
      h3: row.h3_res8,
      lat,
      lng,
      names: { primary: typeof row.names_primary === 'string' ? row.names_primary : '' },
      basic_category: typeof row.basic_category === 'string' ? row.basic_category : '',
      taxonomy: {
        primary: typeof row.taxonomy_primary === 'string' ? row.taxonomy_primary : '',
        hierarchy: Array.isArray(row.taxonomy_hierarchy)
          ? row.taxonomy_hierarchy.filter((entry): entry is string => typeof entry === 'string')
          : [],
        alternates: null,
      },
      confidence: typeof row.confidence === 'number' ? row.confidence : null,
      operating_status: typeof row.operating_status === 'string' ? (row.operating_status as PlaceRecord['operating_status']) : 'open',
    }
    return place
  }
  if (dataset === 'buildings') {
    const building: BuildingRecord = {
      id: row.id,
      h3: row.h3_res8,
      lat,
      lng,
      subtype: typeof row.subtype === 'string' ? (row.subtype as BuildingRecord['subtype']) : null,
      height: typeof row.height === 'number' ? row.height : null,
      num_floors: typeof row.num_floors === 'number' ? row.num_floors : null,
    }
    return building
  }
  const address: AddressRecord = {
    id: row.id,
    h3: row.h3_res8,
    lat,
    lng,
    country: typeof row.country === 'string' ? row.country : '',
    number: typeof row.number === 'string' ? row.number : '',
    street: typeof row.street === 'string' ? row.street : '',
    postcode: typeof row.postcode === 'string' ? row.postcode : '',
    address_levels: [
      { value: typeof row.region === 'string' ? row.region : '' },
      { value: typeof row.locality === 'string' ? row.locality : '' },
    ],
  }
  return address
}

function toResultRow(dataset: DatasetId, record: AnyRecord): ResultRow {
  if (dataset === 'places') {
    const place = record as PlaceRecord
    return {
      id: place.id,
      h3: place.h3,
      lat: place.lat,
      lng: place.lng,
      values: {
        'names.primary': readField(dataset, place, 'names.primary'),
        basic_category: readField(dataset, place, 'basic_category'),
        'taxonomy.primary': readField(dataset, place, 'taxonomy.primary'),
        confidence: readField(dataset, place, 'confidence'),
        operating_status: readField(dataset, place, 'operating_status'),
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
      values: {
        subtype: readField(dataset, building, 'subtype'),
        height: readField(dataset, building, 'height'),
        num_floors: readField(dataset, building, 'num_floors'),
      },
    }
  }
  const address = record as AddressRecord
  return {
    id: address.id,
    h3: address.h3,
    lat: address.lat,
    lng: address.lng,
    values: {
      number: readField(dataset, address, 'number'),
      street: readField(dataset, address, 'street'),
      locality: readField(dataset, address, 'locality'),
      region: readField(dataset, address, 'region'),
      postcode: readField(dataset, address, 'postcode'),
      address: readField(dataset, address, 'address'),
    },
  }
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const next: T[][] = []
  for (let index = 0; index < items.length; index += size) next.push(items.slice(index, index + size))
  return next
}
