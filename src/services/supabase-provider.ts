import { compareOvertureRelease, defaultOvertureRelease } from '../lib/overture'
import { H3_RESOLUTION, MAX_VIEWPORT_CELLS } from '../lib/limits'
import { recordsForRelease } from '../lib/release-query'
import { readDataMode, supabasePublicConfig } from '../lib/server-env'
import { getSupabaseClient } from '../lib/supabase'
import { validateCellList, validateFilters, validateQuery, validateReleaseVersion } from '../lib/validate-query'
import type { DatasetId } from '../types/datasets'
import { asPlaceAddresses } from '../lib/associate'
import { asSources } from '../lib/overture-sources'
import type { CellCount, QueryResult } from '../types/queries'
import type { ReleaseCatalog, ReleaseSnapshot } from '../types/releases'
import type { DataProvider } from './data-provider'
import {
  asStringList,
  compareField,
  matchesFilters,
  parseGeometry,
  toResultRow,
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
        current_release_version: defaultOvertureRelease(),
        snapshots: [],
      }
    }
    let places: number | null = null
    let buildings: number | null = null
    let addresses: number | null = null
    let snapshots: ReleaseSnapshot[] = []
    let note = 'Hex-scoped rows from the public Overture Maps release, stored in Supabase.'
    try {
      ;[places, buildings, addresses, snapshots] = await Promise.all([
        countTable(client, 'overture_places'),
        countTable(client, 'overture_buildings'),
        countTable(client, 'overture_addresses'),
        listStoredSnapshots(client),
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
      current_release_version: defaultOvertureRelease(),
      snapshots,
    }
  },
  async getCellCounts(request) {
    const errors = [
      ...validateCellList(request.h3_cells, MAX_VIEWPORT_CELLS),
      ...validateFilters(request.dataset, request.filters),
      ...validateReleaseVersion(request.release_version),
    ]
    if (errors.length > 0) throw new Error(errors.join(' '))
    if (request.filters.length === 0) {
      const counts = await countByHex(request.dataset, request.h3_cells, request.release_version)
      return request.h3_cells.map((h3) => ({ h3, count: counts.get(h3) ?? 0 }))
    }
    const grouped = await loadRecords(request.dataset, request.h3_cells, false, request.release_version)
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
    const grouped = await loadRecords(spec.dataset, spec.h3_cells, true, spec.release_version)
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

export async function supabaseReleaseCatalog(): Promise<ReleaseCatalog> {
  const client = getSupabaseClient()
  return {
    current_release_version: defaultOvertureRelease(),
    snapshots: client ? await listStoredSnapshots(client) : [],
  }
}

/** Newest `release_version` stored for each hex. Snapshot table first, then feature rows. */
export async function supabaseHexReleases(cells: readonly string[]): Promise<Map<string, string>> {
  const client = requireClient()
  const newest = new Map<string, string>()
  if (cells.length === 0) return newest
  for (const part of chunk(cells, 80)) {
    const { data, error } = await client
      .from('overture_hex_snapshots')
      .select('h3_res8, release_version')
      .in('h3_res8', part)
    if (error) {
      if (/does not exist|schema cache/i.test(error.message)) break
      throw new Error(error.message)
    }
    for (const row of data ?? []) {
      if (!row || typeof row.h3_res8 !== 'string' || typeof row.release_version !== 'string') continue
      const previous = newest.get(row.h3_res8)
      if (!previous || compareOvertureRelease(row.release_version, previous) > 0) {
        newest.set(row.h3_res8, row.release_version)
      }
    }
  }
  if (newest.size === cells.length) return newest
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

async function countByHex(
  dataset: DatasetId,
  cells: readonly string[],
  release?: string,
): Promise<Map<string, number>> {
  const client = requireClient()
  const counts = new Map<string, number>()
  const newest = new Map<string, string>()
  for (const cell of cells) counts.set(cell, 0)
  for (const part of chunk(cells, 80)) {
    const { data, error } = await client.from(TABLES[dataset]).select('h3_res8, release_version').in('h3_res8', part)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as { h3_res8?: string; release_version?: string }[]
    if (release) {
      for (const row of rows) {
        if (row.h3_res8 && row.release_version === release) {
          counts.set(row.h3_res8, (counts.get(row.h3_res8) ?? 0) + 1)
        }
      }
      continue
    }
    for (const row of rows) {
      if (!row.h3_res8 || !row.release_version) continue
      const previous = newest.get(row.h3_res8)
      if (!previous || compareOvertureRelease(row.release_version, previous) > 0) {
        newest.set(row.h3_res8, row.release_version)
      }
    }
    for (const row of rows) {
      if (!row.h3_res8 || !row.release_version) continue
      if (newest.get(row.h3_res8) !== row.release_version) continue
      counts.set(row.h3_res8, (counts.get(row.h3_res8) ?? 0) + 1)
    }
  }
  return counts
}

async function loadRecords(
  dataset: DatasetId,
  cells: readonly string[],
  withGeometry: boolean,
  release?: string,
): Promise<Map<string, AnyRecord[]>> {
  const client = requireClient()
  const grouped = new Map<string, AnyRecord[]>()
  for (const cell of cells) grouped.set(cell, [])
  for (const part of chunk(cells, 80)) {
    const { data, error } = await selectRows(client, dataset, part, withGeometry, release)
    if (error) throw new Error(schemaError(error.message))
    for (const row of (data ?? []) as Record<string, unknown>[]) {
      const record = asRecord(dataset, row)
      if (!record) continue
      const bucket = grouped.get(record.h3)
      if (bucket) bucket.push(record)
      else grouped.set(record.h3, [record])
    }
  }
  if (!release) {
    for (const [cell, rows] of grouped) grouped.set(cell, recordsForRelease(rows))
  }
  return grouped
}

function asRecord(dataset: DatasetId, row: Record<string, unknown>): AnyRecord | null {
  if (typeof row.id !== 'string' || typeof row.h3_res8 !== 'string') return null
  const lat = typeof row.lat === 'number' ? row.lat : Number(row.lat)
  const lng = typeof row.lng === 'number' ? row.lng : Number(row.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  const geometry = parseGeometry(row.geometry)
  if (dataset === 'places') {
    const place: PlaceRecord = {
      id: row.id,
      h3: row.h3_res8,
      release_version: typeof row.release_version === 'string' ? row.release_version : defaultOvertureRelease(),
      lat,
      lng,
      geometry,
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
      phones: asStringList(row.phones),
      websites: asStringList(row.websites),
      socials: asStringList(row.socials),
      emails: asStringList(row.emails),
      brand_name: typeof row.brand_name === 'string' ? row.brand_name : null,
      brand_wikidata: typeof row.brand_wikidata === 'string' ? row.brand_wikidata : null,
      place_addresses: asPlaceAddresses(row.place_addresses),
      building_id: typeof row.building_id === 'string' ? row.building_id : null,
      address_id: typeof row.address_id === 'string' ? row.address_id : null,
      sources: asSources(row.sources),
    }
    return place
  }
  if (dataset === 'buildings') {
    const building: BuildingRecord = {
      id: row.id,
      h3: row.h3_res8,
      release_version: typeof row.release_version === 'string' ? row.release_version : defaultOvertureRelease(),
      lat,
      lng,
      geometry,
      subtype: typeof row.subtype === 'string' ? (row.subtype as BuildingRecord['subtype']) : null,
      class: typeof row.class === 'string' ? row.class : null,
      names: { primary: typeof row.names_primary === 'string' ? row.names_primary : '' },
      height: typeof row.height === 'number' ? row.height : null,
      num_floors: typeof row.num_floors === 'number' ? row.num_floors : null,
      has_parts: typeof row.has_parts === 'boolean' ? row.has_parts : null,
      is_underground: typeof row.is_underground === 'boolean' ? row.is_underground : null,
      num_floors_underground: typeof row.num_floors_underground === 'number' ? row.num_floors_underground : null,
      min_height: typeof row.min_height === 'number' ? row.min_height : null,
      min_floor: typeof row.min_floor === 'number' ? row.min_floor : null,
      level: typeof row.level === 'number' ? row.level : null,
      facade_color: typeof row.facade_color === 'string' ? row.facade_color : null,
      facade_material: typeof row.facade_material === 'string' ? row.facade_material : null,
      roof_material: typeof row.roof_material === 'string' ? row.roof_material : null,
      roof_shape: typeof row.roof_shape === 'string' ? row.roof_shape : null,
      roof_direction: typeof row.roof_direction === 'number' ? row.roof_direction : null,
      roof_color: typeof row.roof_color === 'string' ? row.roof_color : null,
      address_id: typeof row.address_id === 'string' ? row.address_id : null,
      sources: asSources(row.sources),
    }
    return building
  }
  const address: AddressRecord = {
    id: row.id,
    h3: row.h3_res8,
    release_version: typeof row.release_version === 'string' ? row.release_version : defaultOvertureRelease(),
    lat,
    lng,
    geometry,
    country: typeof row.country === 'string' ? row.country : '',
    number: typeof row.number === 'string' ? row.number : '',
    street: typeof row.street === 'string' ? row.street : '',
    unit: typeof row.unit === 'string' ? row.unit : '',
    postal_city: typeof row.postal_city === 'string' ? row.postal_city : '',
    postcode: typeof row.postcode === 'string' ? row.postcode : '',
    address_levels: [
      { value: typeof row.region === 'string' ? row.region : '' },
      { value: typeof row.locality === 'string' ? row.locality : '' },
    ],
    building_id: typeof row.building_id === 'string' ? row.building_id : null,
    sources: asSources(row.sources),
  }
  return address
}

async function selectRows(
  client: NonNullable<ReturnType<typeof getSupabaseClient>>,
  dataset: DatasetId,
  cells: readonly string[],
  withGeometry: boolean,
  release?: string,
) {
  let query = client.from(TABLES[dataset]).select(columnsFor(dataset, withGeometry) as '*').in('h3_res8', cells)
  if (release) query = query.eq('release_version', release)
  const full = await query
  if (!full.error || !missingColumn(full.error.message)) return full
  let fallback = client.from(TABLES[dataset]).select(baseColumnsFor(dataset) as '*').in('h3_res8', cells)
  if (release) fallback = fallback.eq('release_version', release)
  return fallback
}

function missingColumn(message: string) {
  return /does not exist/i.test(message)
}

function schemaError(message: string) {
  if (!missingColumn(message)) return message
  return `${message} Run supabase/migrations/20261027_overture_features.sql and supabase/migrations/20261027_overture_snapshots.sql in the Supabase SQL editor, then Reprocess the hex.`
}

function baseColumnsFor(dataset: DatasetId): string {
  if (dataset === 'places') {
    return 'id,release_version,h3_res8,lat,lng,names_primary,basic_category,taxonomy_primary,taxonomy_hierarchy,confidence,operating_status'
  }
  if (dataset === 'buildings') {
    return 'id,release_version,h3_res8,lat,lng,subtype,height,num_floors'
  }
  return 'id,release_version,h3_res8,lat,lng,country,number,street,postcode,region,locality'
}

function columnsFor(dataset: DatasetId, withGeometry: boolean): string {
  if (dataset === 'places') {
    return withGeometry
      ? 'id,release_version,h3_res8,lat,lng,names_primary,basic_category,taxonomy_primary,taxonomy_hierarchy,confidence,operating_status,phones,websites,socials,emails,brand_name,brand_wikidata,place_addresses,building_id,address_id,sources,geometry'
      : 'id,release_version,h3_res8,lat,lng,names_primary,basic_category,taxonomy_primary,confidence,operating_status,phones,websites,brand_name,building_id,address_id'
  }
  if (dataset === 'buildings') {
    return withGeometry
      ? 'id,release_version,h3_res8,lat,lng,subtype,class,names_primary,height,num_floors,has_parts,is_underground,num_floors_underground,min_height,min_floor,level,facade_color,facade_material,roof_material,roof_shape,roof_direction,roof_color,address_id,sources,geometry'
      : 'id,release_version,h3_res8,lat,lng,subtype,class,names_primary,height,num_floors,address_id'
  }
  return withGeometry
    ? 'id,release_version,h3_res8,lat,lng,country,number,street,postcode,region,locality,unit,postal_city,building_id,sources,geometry'
    : 'id,release_version,h3_res8,lat,lng,country,number,street,postcode,region,locality,unit,postal_city,building_id'
}

async function listStoredSnapshots(
  client: NonNullable<ReturnType<typeof getSupabaseClient>>,
): Promise<ReleaseSnapshot[]> {
  const current = defaultOvertureRelease()
  const { data, error } = await client
    .from('overture_release_snapshots')
    .select(
      'release_version, accessed_on, source_uri, themes, hex_count, place_count, building_count, address_count, source_datasets, ingested_at',
    )
    .order('release_version', { ascending: false })
  if (error) {
    if (missingColumn(error.message) || /does not exist|schema cache/i.test(error.message)) return []
    throw new Error(error.message)
  }
  return (data ?? []).flatMap((row) => {
    if (!row || typeof row.release_version !== 'string') return []
    return [
      {
        release_version: row.release_version,
        accessed_on: typeof row.accessed_on === 'string' ? row.accessed_on : '',
        source_uri: typeof row.source_uri === 'string' ? row.source_uri : '',
        themes: Array.isArray(row.themes) ? row.themes.filter((entry): entry is string => typeof entry === 'string') : [],
        hex_count: typeof row.hex_count === 'number' ? row.hex_count : 0,
        place_count: typeof row.place_count === 'number' ? row.place_count : 0,
        building_count: typeof row.building_count === 'number' ? row.building_count : 0,
        address_count: typeof row.address_count === 'number' ? row.address_count : 0,
        source_datasets: Array.isArray(row.source_datasets)
          ? row.source_datasets.filter((entry): entry is string => typeof entry === 'string')
          : [],
        ingested_at: typeof row.ingested_at === 'string' ? row.ingested_at : '',
        current: compareOvertureRelease(row.release_version, current) >= 0,
      } satisfies ReleaseSnapshot,
    ]
  })
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const next: T[][] = []
  for (let index = 0; index < items.length; index += size) next.push(items.slice(index, index + size))
  return next
}
