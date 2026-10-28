import { createHash } from 'node:crypto'
import { compactDay, eachDay } from './enrichments'
import type { HailHexStat, HailHexSummary } from '../types/enrichments'

export const HAIL_SOURCE = 'NOAA MRMS MESH_Max_1440min'
export const HAIL_S3_BUCKET = 'noaa-mrms-pds'
export const HAIL_S3_PREFIX = 'CONUS/MESH_Max_1440min_00.50'
/** 12Z daily max. Never sum overlapping intra-day files. */
export const HAIL_CYCLE = '120000'

export function hailObjectKey(day: string): string {
  const ymd = compactDay(day)
  return `${HAIL_S3_PREFIX}/${ymd}/MRMS_MESH_Max_1440min_00.50_${ymd}-${HAIL_CYCLE}.grib2.gz`
}

export function hailHttpsUrl(day: string): string {
  return `https://${HAIL_S3_BUCKET}.s3.amazonaws.com/${hailObjectKey(day)}`
}

export function summarizeHail(stats: readonly HailHexStat[]): HailHexSummary[] {
  const byHex = new Map<string, HailHexStat[]>()
  for (const row of stats) {
    const list = byHex.get(row.h3) ?? []
    list.push(row)
    byHex.set(row.h3, list)
  }
  return [...byHex.entries()].map(([h3, rows]) => {
    let hailMmMax: number | null = null
    let hailDays = 0
    let last: string | null = null
    for (const row of rows) {
      if (row.mesh_mm_max == null || row.mesh_mm_max <= 0) continue
      hailDays += 1
      if (hailMmMax == null || row.mesh_mm_max > hailMmMax) hailMmMax = row.mesh_mm_max
      if (!last || row.day > last) last = row.day
    }
    return { h3, hail_mm_max: hailMmMax, hail_days: hailDays, hail_last_date: last }
  })
}

export function hailSummariesByHex(summaries: readonly HailHexSummary[]): Map<string, HailHexSummary> {
  return new Map(summaries.map((row) => [row.h3, row]))
}

/** Deterministic mock MESH for verify. Not NOAA. */
export function mockHailStats(cells: readonly string[], start: string, end: string): HailHexStat[] {
  const days = eachDay(start, end)
  const rows: HailHexStat[] = []
  for (const h3 of cells) {
    for (const day of days) {
      rows.push({
        h3,
        day,
        mesh_mm_max: mockMeshMm(h3, day),
        source_key: `mock:${hailObjectKey(day)}`,
      })
    }
  }
  return rows
}

function mockMeshMm(h3: string, day: string): number | null {
  const digest = createHash('sha256').update(`${h3}:${day}`).digest()
  const lane = digest[0] % 20
  if (lane === 0) return null
  if (lane < 14) return 0
  return Math.round((8 + (digest[1] / 255) * 62) * 10) / 10
}
