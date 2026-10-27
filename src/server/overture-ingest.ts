import { DuckDBConnection } from '@duckdb/node-api'
import { asPlaceAddresses, associateFeatures } from '../lib/associate'
import { asGeometry } from '../lib/geojson'
import { getSupabaseClient } from '../lib/supabase'
import {
  addressLevels,
  asNumber,
  asString,
  asStringList,
  cellForPoint,
  overtureParquetGlob,
} from '../lib/overture'
import type { JobLogLevel, WorkflowDataset, WorkflowIngestionPlan } from '../types/workflows'
import { WORKFLOW_DATASETS } from '../types/workflows'

export type JobLogger = (level: JobLogLevel, message: string) => void

const BATCH: Record<WorkflowDataset, number> = {
  places: 400,
  addresses: 400,
  buildings: 100,
}
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
  for (const dataset of WORKFLOW_DATASETS) {
    log('info', `Opening ${dataset} parquet ${overtureParquetGlob(plan.release_version, dataset)}`)
    const mapped = await readTheme(dataset, plan, log)
    loaded[dataset] = mapped.filter((row) => wanted.has(row.h3_res8))
    log(
      loaded[dataset].length === 0 ? 'warn' : 'info',
      `${dataset}: ${mapped.length} bbox rows, ${loaded[dataset].length} in selected hexes`,
    )
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

  const byDataset: Partial<Record<WorkflowDataset, number>> = {}
  let rows = 0
  for (const dataset of WORKFLOW_DATASETS) {
    const written = await writeTheme(dataset, plan.release_version, loaded[dataset], log)
    byDataset[dataset] = written
    rows += written
  }

  log('info', `Ingest finished. ${rows} rows written.`)
  return { rows, by_dataset: byDataset }
}

async function readTheme(
  dataset: WorkflowDataset,
  plan: WorkflowIngestionPlan,
  log: JobLogger,
): Promise<IngestRow[]> {
  log('info', `${dataset}: connecting DuckDB and reading public Overture S3`)
  const started = Date.now()
  const db = await duck()
  const path = overtureParquetGlob(plan.release_version, dataset)
  const limit = plan.max_rows_by_dataset[dataset] ?? plan.limits.max_rows_per_dataset
  const bbox = plan.bbox
  const sql = themeSql(dataset, path)
  const reader = await db.runAndReadAll(sql, {
    west: bbox.west,
    south: bbox.south,
    east: bbox.east,
    north: bbox.north,
    limit,
  })
  const raw = reader.getRowObjectsJson()
  reader.closeSync()
  const mapped = raw.map((row) => mapRow(dataset, row)).filter((row): row is IngestRow => row != null)
  log(
    'info',
    `${dataset}: DuckDB returned ${raw.length} rows, mapped ${mapped.length} in ${Date.now() - started}ms (limit ${limit})`,
  )
  if (raw.length >= limit) {
    log('warn', `${dataset}: hit the per-dataset row cap (${limit}). Extra rows in this bbox were not read.`)
  }
  return mapped
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
      ST_AsGeoJSON(geometry::GEOMETRY) as geometry,
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
      addresses as place_addresses
    from ${source}
    where ${bbox}
    limit $limit`
  }
  if (dataset === 'buildings') {
    return `select
      id,
      ST_Y(ST_Centroid(geometry::GEOMETRY)) as lat,
      ST_X(ST_Centroid(geometry::GEOMETRY)) as lng,
      ST_AsGeoJSON(geometry::GEOMETRY) as geometry,
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
      roof_color
    from ${source}
    where ${bbox}
    limit $limit`
  }
  return `select
    id,
    ST_Y(geometry::GEOMETRY) as lat,
    ST_X(geometry::GEOMETRY) as lng,
    ST_AsGeoJSON(geometry::GEOMETRY) as geometry,
    country,
    number,
    street,
    postcode,
    unit,
    postal_city,
    address_levels
  from ${source}
  where ${bbox}
  limit $limit`
}

function mapRow(dataset: WorkflowDataset, row: Record<string, unknown>): IngestRow | null {
  const id = asString(row.id)
  const lat = asNumber(row.lat)
  const lng = asNumber(row.lng)
  const h3 = lat != null && lng != null ? cellForPoint(lat, lng) : null
  if (!id || !h3 || lat == null || lng == null) return null
  const geometry = asGeometry(row.geometry)

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

async function duck(): Promise<DuckDBConnection> {
  if (!connection) {
    connection = (async () => {
      const db = await DuckDBConnection.create()
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
