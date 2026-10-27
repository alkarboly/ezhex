import { DuckDBConnection } from '@duckdb/node-api'
import { getSupabaseClient } from '../lib/supabase'
import {
  addressLevels,
  asNumber,
  asString,
  asStringList,
  bboxCenter,
  cellForPoint,
  overtureParquetGlob,
} from '../lib/overture'
import type { JobLogLevel, WorkflowDataset, WorkflowIngestionPlan } from '../types/workflows'

export type JobLogger = (level: JobLogLevel, message: string) => void

const BATCH = 400
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
    `Plan ${plan.run_id}: ${plan.h3_cells.length} hexes · ${plan.datasets.join(', ')} · bbox ${plan.bbox.west.toFixed(4)},${plan.bbox.south.toFixed(4)} to ${plan.bbox.east.toFixed(4)},${plan.bbox.north.toFixed(4)} · ${plan.bbox.area_km2} km2`,
  )
  log('info', `Caps ${plan.max_rows_by_dataset.places ?? 0} rows / dataset, ${plan.max_total_rows} total.`)

  const wanted = new Set(plan.h3_cells)
  const byDataset: Partial<Record<WorkflowDataset, number>> = {}
  let rows = 0

  for (const dataset of plan.datasets) {
    log('info', `Opening ${dataset} parquet ${overtureParquetGlob(plan.release_version, dataset)}`)
    const mapped = await readTheme(dataset, plan, log)
    const kept = mapped.filter((row) => wanted.has(row.h3_res8))
    log(
      kept.length === 0 ? 'warn' : 'info',
      `${dataset}: ${mapped.length} bbox rows, ${kept.length} in selected hexes`,
    )
    const written = await writeTheme(dataset, plan.release_version, kept, log)
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
  const limit = plan.max_rows_by_dataset[dataset]
  const bbox = plan.bbox
  const sql =
    dataset === 'buildings'
      ? `select * from read_parquet('${path}', hive_partitioning=1)
         where bbox.xmin <= $east and bbox.xmax >= $west
           and bbox.ymin <= $north and bbox.ymax >= $south
         limit $limit`
      : `select * from read_parquet('${path}', hive_partitioning=1)
         where bbox.xmin between $west and $east
           and bbox.ymin between $south and $north
         limit $limit`
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
  const batches = Math.ceil(rows.length / BATCH)
  log('info', `${dataset}: writing ${rows.length} rows through ${rpc} in ${batches} batches`)
  let written = 0
  for (let index = 0; index < rows.length; index += BATCH) {
    const batch = rows.slice(index, index + BATCH)
    const batchNo = Math.floor(index / BATCH) + 1
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

type IngestRow = Record<string, unknown> & { h3_res8: string; id: string }

function mapRow(dataset: WorkflowDataset, row: Record<string, unknown>): IngestRow | null {
  const id = asString(row.id)
  const box = {
    west: asNumber(nested(row, ['bbox', 'xmin']) ?? row.west) ?? NaN,
    south: asNumber(nested(row, ['bbox', 'ymin']) ?? row.south) ?? NaN,
    east: asNumber(nested(row, ['bbox', 'xmax']) ?? row.east) ?? NaN,
    north: asNumber(nested(row, ['bbox', 'ymax']) ?? row.north) ?? NaN,
  }
  const center = bboxCenter(box)
  const h3 = cellForPoint(center.lat, center.lng)
  if (!id || !h3) return null

  if (dataset === 'places') {
    return {
      id,
      h3_res8: h3,
      lat: center.lat,
      lng: center.lng,
      names_primary: asString(nested(row, ['names', 'primary']) ?? row.names_primary),
      basic_category: asString(row.basic_category),
      taxonomy_primary: asString(nested(row, ['taxonomy', 'primary']) ?? row.taxonomy_primary),
      taxonomy_hierarchy: asStringList(nested(row, ['taxonomy', 'hierarchy']) ?? row.taxonomy_hierarchy),
      confidence: asNumber(row.confidence),
      operating_status: asString(row.operating_status),
    }
  }
  if (dataset === 'buildings') {
    return {
      id,
      h3_res8: h3,
      lat: center.lat,
      lng: center.lng,
      subtype: asString(row.subtype) || null,
      height: asNumber(row.height),
      num_floors: asNumber(row.num_floors),
    }
  }
  const levels = addressLevels(row.address_levels)
  return {
    id,
    h3_res8: h3,
    lat: center.lat,
    lng: center.lng,
    country: asString(row.country),
    number: asString(row.number),
    street: asString(row.street),
    postcode: asString(row.postcode),
    region: levels.region,
    locality: levels.locality,
  }
}

function nested(row: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = row
  for (const key of path) {
    if (!current || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

async function duck(): Promise<DuckDBConnection> {
  if (!connection) {
    connection = (async () => {
      const db = await DuckDBConnection.create()
      await db.run('install httpfs')
      await db.run('load httpfs')
      await db.run("set s3_region='us-west-2'")
      return db
    })()
  }
  return connection
}
