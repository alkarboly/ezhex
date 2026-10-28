import { DuckDBConnection } from '@duckdb/node-api'
import { asPlaceAddresses, associateFeatures } from '../lib/associate'
import { asGeometry, pointGeometry, simplifyGeometry } from '../lib/geojson'
import { getSupabaseClient } from '../lib/supabase'
import {
  addressLevels,
  asNumber,
  asString,
  asStringList,
  cellForPoint,
  overtureParquetGlob,
} from '../lib/overture'
import { asSources, mergeSourceDatasets, sourceDatasets } from '../lib/overture-sources'
import type { JobLogLevel, WorkflowDataset, WorkflowIngestionPlan } from '../types/workflows'
import { WORKFLOW_DATASETS } from '../types/workflows'

export type JobLogger = (level: JobLogLevel, message: string) => void

const BATCH: Record<WorkflowDataset, number> = {
  places: 200,
  addresses: 200,
  buildings: 50,
}
const READ_PAGE = 200
let connection: Promise<DuckDBConnection> | null = null

export type OvertureIngestResult = {
  rows: number
  by_dataset: Partial<Record<WorkflowDataset, number>>
}

export async function ingestOverturePlan(
  plan: WorkflowIngestionPlan,
  log: JobLogger = () => {},
): Promise<OvertureIngestResult> {
  const client = getSupabaseClient()
  if (!client) throw new Error('Set SUPABASE_URL and SUPABASE_ANON_KEY on the server.')
  log('info', `Supabase client ready. Release ${plan.release_version}.`)
  log(
    'info',
    `Plan ${plan.run_id}: ${plan.h3_cells.length} hexes · ${WORKFLOW_DATASETS.join(', ')} · bbox ${plan.bbox.west.toFixed(4)},${plan.bbox.south.toFixed(4)} to ${plan.bbox.east.toFixed(4)},${plan.bbox.north.toFixed(4)} · ${plan.bbox.area_km2} km2`,
  )
  log('info', `Caps ${plan.max_rows_by_dataset.places ?? 0} rows / dataset, ${plan.max_total_rows} total.`)

  const wanted = new Set(plan.h3_cells)
  const loaded: Record<WorkflowDataset, IngestRow[]> = { places: [], addresses: [], buildings: [] }
  try {
    for (const dataset of WORKFLOW_DATASETS) {
      log('info', `Opening ${dataset} parquet ${overtureParquetGlob(plan.release_version, dataset)}`)
      loaded[dataset] = await readTheme(dataset, plan, wanted, log)
    }

    const links = associateFeatures({
      places: loaded.places.map(asAssociatePlace),
      buildings: loaded.buildings.map(asAssociateBuilding),
      addresses: loaded.addresses.map(asAssociateAddress),
    })
    for (const row of loaded.places) {
      const link = links.places.get(row.id)
      row.building_id = link?.building_id ?? null
      row.address_id = link?.address_id ?? null
    }
    for (const row of loaded.buildings) {
      row.address_id = links.buildings.get(row.id)?.address_id ?? null
    }
    for (const row of loaded.addresses) {
      row.building_id = links.addresses.get(row.id)?.building_id ?? null
    }
    log(
      'info',
      `Associated ${links.place_building_matches} places→buildings, ${links.place_address_matches} places→addresses, ${links.building_address_matches} buildings→addresses`,
    )

    const snapshot = snapshotMeta(plan, loaded)
    const byDataset: Partial<Record<WorkflowDataset, number>> = {}
    let rows = 0
    for (const dataset of WORKFLOW_DATASETS) {
      const written = await writeTheme(dataset, plan.release_version, loaded[dataset], log)
      byDataset[dataset] = written
      rows += written
      loaded[dataset] = []
    }
    await writeSnapshot(plan.release_version, snapshot, log)

    log('info', `Ingest finished. ${rows} rows written.`)
    return { rows, by_dataset: byDataset }
  } finally {
    await releaseDuck()
  }
}

async function readTheme(
  dataset: WorkflowDataset,
  plan: WorkflowIngestionPlan,
  wanted: ReadonlySet<string>,
  log: JobLogger,
): Promise<IngestRow[]> {
  log('info', `${dataset}: connecting DuckDB and reading public Overture S3`)
  const started = Date.now()
  const db = await duck()
  const path = overtureParquetGlob(plan.release_version, dataset)
  const cap = plan.max_rows_by_dataset[dataset] ?? plan.limits.max_rows_per_dataset
  const bbox = plan.bbox
  const sql = themeSql(dataset, path)
  const kept: IngestRow[] = []
  let rawTotal = 0
  let offset = 0
  while (offset < cap) {
    const page = Math.min(READ_PAGE, cap - offset)
    const reader = await db.runAndReadAll(sql, {
      west: bbox.west,
      south: bbox.south,
      east: bbox.east,
      north: bbox.north,
      limit: page,
      offset,
    })
    const raw = reader.getRowObjectsJson()
    reader.closeSync()
    rawTotal += raw.length
    for (const row of raw) {
      const mapped = mapRow(dataset, row)
      if (mapped && wanted.has(mapped.h3_res8)) kept.push(mapped)
    }
    if (raw.length < page) break
    offset += raw.length
  }
  log(
    kept.length === 0 ? 'warn' : 'info',
    `${dataset}: DuckDB scanned ${rawTotal} bbox rows, kept ${kept.length} in selected hexes in ${Date.now() - started}ms (cap ${cap})`,
  )
  if (rawTotal >= cap) {
    log('warn', `${dataset}: hit the per-dataset row cap (${cap}). Extra rows in this bbox were not read.`)
  }
  return kept
}

async function writeTheme(
  dataset: WorkflowDataset,
  release: string,
  rows: IngestRow[],
  log: JobLogger,
): Promise<number> {
  const rpc =
    dataset === 'places'
      ? 'ingest_overture_places'
      : dataset === 'buildings'
        ? 'ingest_overture_buildings'
        : 'ingest_overture_addresses'
  const client = getSupabaseClient()
  if (!client) throw new Error('Supabase is not configured.')
  if (rows.length === 0) {
    log('warn', `${dataset}: nothing to write`)
    return 0
  }
  const size = BATCH[dataset]
  const batches = Math.ceil(rows.length / size)
  log('info', `${dataset}: writing ${rows.length} rows through ${rpc} in ${batches} batches`)
  let written = 0
  for (let index = 0; index < rows.length; index += size) {
    const batch = rows.slice(index, index + size)
    const batchNo = Math.floor(index / size) + 1
    const { data, error } = await client.rpc(rpc, { p_release: release, p_rows: batch })
    if (error) {
      log('error', `${dataset}: batch ${batchNo}/${batches} failed: ${error.message}`)
      throw new Error(error.message)
    }
    const count = typeof data === 'number' ? data : batch.length
    written += count
    log('info', `${dataset}: batch ${batchNo}/${batches} upserted ${count} rows`)
  }
  return written
}

type IngestRow = Record<string, unknown> & { h3_res8: string; id: string; lat: number; lng: number }

function themeSql(dataset: WorkflowDataset, path: string): string {
  const source = `read_parquet('${path}', hive_partitioning=1)`
  const bbox =
    dataset === 'buildings'
      ? `bbox.xmin <= $east and bbox.xmax >= $west and bbox.ymin <= $north and bbox.ymax >= $south`
      : `bbox.xmin between $west and $east and bbox.ymin between $south and $north`
  if (dataset === 'places') {
    return `select
      id,
      ST_Y(geometry::GEOMETRY) as lat,
      ST_X(geometry::GEOMETRY) as lng,
      names.primary as names_primary,
      basic_category,
      taxonomy.primary as taxonomy_primary,
      taxonomy.hierarchy as taxonomy_hierarchy,
      confidence,
      operating_status,
      websites,
      socials,
      emails,
      phones,
      brand.names.primary as brand_name,
      brand.wikidata as brand_wikidata,
      addresses as place_addresses,
      to_json(sources) as sources
    from ${source}
    where ${bbox}
    limit $limit
    offset $offset`
  }
  if (dataset === 'buildings') {
    return `select
      id,
      ST_Y(ST_Centroid(geometry::GEOMETRY)) as lat,
      ST_X(ST_Centroid(geometry::GEOMETRY)) as lng,
      ST_AsGeoJSON(ST_SimplifyPreserveTopology(geometry::GEOMETRY, 0.0001)) as geometry,
      subtype,
      class,
      names.primary as names_primary,
      height,
      num_floors,
      num_floors_underground,
      has_parts,
      is_underground,
      min_height,
      min_floor,
      level,
      facade_color,
      facade_material,
      roof_material,
      roof_shape,
      roof_direction,
      roof_color,
      to_json(sources) as sources
    from ${source}
    where ${bbox}
    limit $limit
    offset $offset`
  }
  return `select
    id,
    ST_Y(geometry::GEOMETRY) as lat,
    ST_X(geometry::GEOMETRY) as lng,
    country,
    number,
    street,
    postcode,
    unit,
    postal_city,
    address_levels,
    to_json(sources) as sources
  from ${source}
  where ${bbox}
  limit $limit
  offset $offset`
}

function mapRow(dataset: WorkflowDataset, row: Record<string, unknown>): IngestRow | null {
  const id = asString(row.id)
  const lat = asNumber(row.lat)
  const lng = asNumber(row.lng)
  const h3 = lat != null && lng != null ? cellForPoint(lat, lng) : null
  if (!id || !h3 || lat == null || lng == null) return null
  const geometry =
    dataset === 'buildings' ? simplifyGeometry(asGeometry(row.geometry), 24) : pointGeometry(lng, lat)

  if (dataset === 'places') {
    return {
      id,
      h3_res8: h3,
      lat,
      lng,
      geometry,
      names_primary: asString(row.names_primary),
      basic_category: asString(row.basic_category),
      taxonomy_primary: asString(row.taxonomy_primary),
      taxonomy_hierarchy: asStringList(row.taxonomy_hierarchy),
      confidence: asNumber(row.confidence),
      operating_status: asString(row.operating_status),
      websites: asStringList(row.websites),
      socials: asStringList(row.socials),
      emails: asStringList(row.emails),
      phones: asStringList(row.phones),
      brand_name: asString(row.brand_name) || null,
      brand_wikidata: asString(row.brand_wikidata) || null,
      place_addresses: asPlaceAddresses(row.place_addresses),
      building_id: null,
      address_id: null,
      sources: asSources(row.sources),
    }
  }
  if (dataset === 'buildings') {
    return {
      id,
      h3_res8: h3,
      lat,
      lng,
      geometry,
      subtype: asString(row.subtype) || null,
      class: asString(row.class) || null,
      names_primary: asString(row.names_primary) || null,
      height: asNumber(row.height),
      num_floors: asNumber(row.num_floors),
      has_parts: asBoolean(row.has_parts),
      is_underground: asBoolean(row.is_underground),
      num_floors_underground: asNumber(row.num_floors_underground),
      min_height: asNumber(row.min_height),
      min_floor: asNumber(row.min_floor),
      level: asNumber(row.level),
      facade_color: asString(row.facade_color) || null,
      facade_material: asString(row.facade_material) || null,
      roof_material: asString(row.roof_material) || null,
      roof_shape: asString(row.roof_shape) || null,
      roof_direction: asNumber(row.roof_direction),
      roof_color: asString(row.roof_color) || null,
      address_id: null,
      sources: asSources(row.sources),
    }
  }
  const levels = addressLevels(row.address_levels)
  return {
    id,
    h3_res8: h3,
    lat,
    lng,
    geometry,
    country: asString(row.country),
    number: asString(row.number),
    street: asString(row.street),
    postcode: asString(row.postcode),
    unit: asString(row.unit) || null,
    postal_city: asString(row.postal_city) || null,
    region: levels.region,
    locality: levels.locality,
    building_id: null,
    sources: asSources(row.sources),
  }
}

function asAssociatePlace(row: IngestRow) {
  return {
    id: row.id,
    lat: row.lat,
    lng: row.lng,
    geometry: asGeometry(row.geometry),
    place_addresses: asPlaceAddresses(row.place_addresses),
    country: asString(row.country),
  }
}

function asAssociateBuilding(row: IngestRow) {
  return { id: row.id, lat: row.lat, lng: row.lng, geometry: asGeometry(row.geometry) }
}

function asAssociateAddress(row: IngestRow) {
  return {
    id: row.id,
    lat: row.lat,
    lng: row.lng,
    number: asString(row.number),
    street: asString(row.street),
    postcode: asString(row.postcode),
    country: asString(row.country),
  }
}

function asBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (value === 1 || value === '1' || value === 'true') return true
  if (value === 0 || value === '0' || value === 'false') return false
  return null
}

function snapshotMeta(plan: WorkflowIngestionPlan, loaded: Record<WorkflowDataset, IngestRow[]>) {
  const hexes = plan.h3_cells.map((h3) => {
    const places = loaded.places.filter((row) => row.h3_res8 === h3)
    const buildings = loaded.buildings.filter((row) => row.h3_res8 === h3)
    const addresses = loaded.addresses.filter((row) => row.h3_res8 === h3)
    return {
      h3_res8: h3,
      place_count: places.length,
      building_count: buildings.length,
      address_count: addresses.length,
      source_datasets: mergeSourceDatasets(
        ...places.map((row) => sourceDatasets(asSources(row.sources))),
        ...buildings.map((row) => sourceDatasets(asSources(row.sources))),
        ...addresses.map((row) => sourceDatasets(asSources(row.sources))),
      ),
    }
  })
  return {
    source_uri: `s3://overturemaps-us-west-2/release/${plan.release_version}/`,
    accessed_on: new Date().toISOString().slice(0, 10),
    themes: [...WORKFLOW_DATASETS],
    hexes,
  }
}

async function writeSnapshot(
  release: string,
  meta: ReturnType<typeof snapshotMeta>,
  log: JobLogger,
) {
  const client = getSupabaseClient()
  if (!client) throw new Error('Supabase is not configured.')
  const { data, error } = await client.rpc('ingest_overture_snapshot', { p_release: release, p_meta: meta })
  if (error) {
    log('warn', `Snapshot metadata was not written: ${error.message}. Run supabase/migrations/20261027_overture_snapshots.sql.`)
    return
  }
  const hexes = typeof data === 'number' ? data : meta.hexes.length
  log('info', `Snapshot ${release}: ${hexes} hexes recorded`)
}

async function duck(): Promise<DuckDBConnection> {
  if (!connection) {
    connection = (async () => {
      const db = await DuckDBConnection.create()
      await db.run("set memory_limit='160MB'")
      await db.run('set threads=1')
      await db.run('install httpfs')
      await db.run('load httpfs')
      await db.run('install spatial')
      await db.run('load spatial')
      await db.run("set s3_region='us-west-2'")
      return db
    })()
  }
  return connection
}

async function releaseDuck() {
  const pending = connection
  connection = null
  if (!pending) return
  try {
    const db = await pending
    const closer = db as unknown as { closeSync?: () => void; disconnectSync?: () => void }
    if (typeof closer.closeSync === 'function') closer.closeSync()
    else if (typeof closer.disconnectSync === 'function') closer.disconnectSync()
  } catch {
    // Native buffers still drop when the connection is unreferenced.
  }
}
