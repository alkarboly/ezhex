import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getResolution, isValidCell } from 'h3-js'
import { eachDay, hailDateRange } from '../lib/enrichments'
import { earliestSnapshotDate, unprocessedHexError } from '../lib/hex-snapshots'
import { checkHexSnapshots } from './hex-snapshots'
import { boundsForCells } from '../lib/h3'
import { hailObjectKey, mockHailStats, summarizeHail } from '../lib/hail-mesh'
import { MAX_SELECTED_CELLS } from '../lib/limits'
import { readDataMode } from '../lib/server-env'
import { createUserClient } from '../lib/supabase'
import type { HailEnrichResponse, HailHexStat, HailHexSummary } from '../types/enrichments'
import { resolveUser } from './auth'

const MOCK_OWNER = 'mock-guest'
const mockHail = new Map<string, HailHexStat>()

export function resetHailForTests() {
  mockHail.clear()
}

export async function enrichHail(
  body: unknown,
  cookies: Record<string, string>,
): Promise<HailEnrichResponse | { error: string; status: number }> {
  const parsed = parseHailRequest(body)
  if ('error' in parsed) return parsed
  const window = await clampHailToProcess(parsed.cells, parsed.start_date, parsed.end_date)
  if ('error' in window) return window
  parsed.start_date = window.start_date
  const session = await hailOwner(cookies)
  if ('error' in session) return session
  const stats = await ensureHailStats(session.ownerId, session.accessToken, parsed.cells, parsed.start_date, parsed.end_date)
  if ('error' in stats) return stats
  const fallback = stats.some((row) => (row.source_key ?? '').startsWith('fallback:'))
  return {
    cells: summarizeHail(stats).sort((left, right) => left.h3.localeCompare(right.h3)),
    start_date: parsed.start_date,
    end_date: parsed.end_date,
    source: fallback ? 'NOAA MRMS MESH_Max_1440min (fallback demo)' : 'NOAA MRMS MESH_Max_1440min',
    days: eachDay(parsed.start_date, parsed.end_date).length,
  }
}

export async function hailSummariesFor(
  ownerId: string,
  accessToken: string,
  cells: readonly string[],
  start: string,
  end: string,
): Promise<HailHexSummary[] | { error: string; status: number }> {
  const stats = await ensureHailStats(ownerId, accessToken, cells, start, end)
  if ('error' in stats) return stats
  return summarizeHail(stats)
}

async function ensureHailStats(
  ownerId: string,
  accessToken: string,
  cells: readonly string[],
  start: string,
  end: string,
): Promise<HailHexStat[] | { error: string; status: number }> {
  const days = eachDay(start, end)
  const stored = await readStored(ownerId, accessToken, cells, days)
  if ('error' in stored) return stored
  const have = new Set(stored.map((row) => `${row.h3}:${row.day}`))
  const missingCells = cells.filter((h3) => days.some((day) => !have.has(`${h3}:${day}`)))
  if (missingCells.length === 0) return stored
  const extracted = await extractHail(missingCells, days.filter((day) => missingCells.some((h3) => !have.has(`${h3}:${day}`))))
  if ('error' in extracted) return extracted
  const needed = extracted.filter((row) => missingCells.includes(row.h3) && days.includes(row.day))
  const saved = await writeStored(ownerId, accessToken, needed)
  if ('error' in saved) return saved
  return [...stored, ...needed]
}

async function extractHail(cells: readonly string[], days: readonly string[]): Promise<HailHexStat[] | { error: string; status: number }> {
  if (readDataMode().resolved === 'mock') return mockHailStats(cells, days[0] ?? '', days[days.length - 1] ?? days[0] ?? '')
  try {
    return await runPythonExtract(cells, days)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Hail extract failed.'
    if (missingPythonDependency(message)) {
      const fallback = mockHailStats(cells, days[0] ?? '', days[days.length - 1] ?? days[0] ?? '')
      return fallback.map((row) => ({ ...row, source_key: `fallback:${row.source_key}` }))
    }
    return { error: message, status: 400 }
  }
}

async function runPythonExtract(cells: readonly string[], days: readonly string[]): Promise<HailHexStat[]> {
  const hexes = cells.map((h3) => {
    const bounds = boundsForCells([h3])
    if (!bounds) throw new Error(`Could not bound hex ${h3}.`)
    return { h3, west: bounds[0][0], south: bounds[0][1], east: bounds[1][0], north: bounds[1][1] }
  })
  const root = await mkdtemp(join(tmpdir(), 'wp-hail-'))
  const jobPath = join(root, 'job.json')
  const outPath = join(root, 'out.json')
  await writeFile(jobPath, JSON.stringify({ days, hexes }))
  try {
    await spawnPython(['pipelines/hail/extract_mesh.py', '--job', jobPath, '--out', outPath])
    const raw = JSON.parse(await readFile(outPath, 'utf8')) as unknown
    if (!Array.isArray(raw)) throw new Error('Hail extract did not return rows.')
    return raw.map((row) => {
      if (!isRecord(row) || typeof row.h3 !== 'string' || typeof row.day !== 'string') {
        throw new Error('Hail extract row is invalid.')
      }
      return {
        h3: row.h3,
        day: row.day,
        mesh_mm_max: typeof row.mesh_mm_max === 'number' ? row.mesh_mm_max : null,
        source_key: typeof row.source_key === 'string' ? row.source_key : hailObjectKey(row.day),
      }
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

function spawnPython(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.PYTHON ?? 'python', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', () => {
      reject(new Error('Install Python with xarray and cfgrib to process NOAA MESH. See pipelines/hail/README.md.'))
    })
    child.on('close', (code) => {
      if (code === 0) resolve()
      else if (missingPythonDependency(stderr)) {
        reject(
          new Error(
            'Missing hail Python dependencies (xarray/cfgrib/eccodes). Install pipelines/hail/requirements.txt or keep demo fallback enabled.',
          ),
        )
      } else reject(new Error(stderr.trim() || 'Hail extract failed.'))
    })
  })
}

async function readStored(
  ownerId: string,
  accessToken: string,
  cells: readonly string[],
  days: readonly string[],
): Promise<HailHexStat[] | { error: string; status: number }> {
  if (readDataMode().resolved === 'mock') {
    return cells.flatMap((h3) =>
      days
        .map((day) => mockHail.get(`${ownerId}:${h3}:${day}`))
        .filter((row): row is HailHexStat => row != null),
    )
  }
  const client = createUserClient(accessToken)
  if (!client) return { error: 'Set SUPABASE_URL and SUPABASE_ANON_KEY on the server to save hail extracts.', status: 503 }
  const { data, error } = await client
    .from('hail_hex_stats')
    .select('h3_res8, day, mesh_mm_max, source_key')
    .in('h3_res8', [...cells])
    .in('day', [...days])
  if (error) {
    if (/does not exist|schema cache/i.test(error.message)) {
      return { error: 'Run supabase/migrations/20261027_workflow_enrichments.sql in the Supabase SQL editor.', status: 400 }
    }
    return { error: error.message, status: 400 }
  }
  return (data ?? []).map((row) => ({
    h3: String(row.h3_res8),
    day: String(row.day),
    mesh_mm_max: typeof row.mesh_mm_max === 'number' ? row.mesh_mm_max : null,
    source_key: typeof row.source_key === 'string' ? row.source_key : null,
  }))
}

async function writeStored(
  ownerId: string,
  accessToken: string,
  rows: readonly HailHexStat[],
): Promise<{ ok: true } | { error: string; status: number }> {
  if (readDataMode().resolved === 'mock') {
    for (const row of rows) mockHail.set(`${ownerId}:${row.h3}:${row.day}`, row)
    return { ok: true }
  }
  if (rows.length === 0) return { ok: true }
  const client = createUserClient(accessToken)
  if (!client) return { error: 'Set SUPABASE_URL and SUPABASE_ANON_KEY on the server to save hail extracts.', status: 503 }
  const { error } = await client.from('hail_hex_stats').upsert(
    rows.map((row) => ({
      owner_user_id: ownerId,
      h3_res8: row.h3,
      day: row.day,
      mesh_mm_max: row.mesh_mm_max,
      source_key: row.source_key,
    })),
    { onConflict: 'owner_user_id,h3_res8,day' },
  )
  if (error) {
    if (/does not exist|schema cache/i.test(error.message)) {
      return { error: 'Run supabase/migrations/20261027_workflow_enrichments.sql in the Supabase SQL editor.', status: 400 }
    }
    return { error: error.message, status: 400 }
  }
  return { ok: true }
}

async function hailOwner(cookies: Record<string, string>): Promise<{ ownerId: string; accessToken: string } | { error: string; status: number }> {
  if (readDataMode().resolved === 'mock') return { ownerId: MOCK_OWNER, accessToken: '' }
  const resolved = await resolveUser(cookies)
  if (!resolved.user) return { error: 'Sign in to run a private enrichment.', status: 401 }
  const accessToken = resolved.accessToken
  if (!accessToken) return { error: 'Sign in to run a private enrichment.', status: 401 }
  return { ownerId: resolved.user.id, accessToken }
}

function parseHailRequest(body: unknown): { cells: string[]; start_date: string; end_date: string } | { error: string; status: number } {
  if (!isRecord(body) || !Array.isArray(body.h3_cells)) return { error: 'Request body must include h3_cells and hail dates.', status: 400 }
  if (typeof body.start_date !== 'string' || typeof body.end_date !== 'string') {
    return { error: 'start_date and end_date are required.', status: 400 }
  }
  const range = hailDateRange(body.start_date, body.end_date)
  if ('error' in range) return { error: range.error, status: 400 }
  const cells = [...new Set(body.h3_cells.filter((cell): cell is string => typeof cell === 'string'))]
  if (cells.length === 0) return { error: 'Choose at least one hex.', status: 400 }
  if (cells.length > MAX_SELECTED_CELLS) return { error: `Selection is limited to ${MAX_SELECTED_CELLS} cells.`, status: 400 }
  for (const cell of cells) {
    if (!isValidCell(cell) || getResolution(cell) !== 8) return { error: 'Every hex must be a resolution-8 cell.', status: 400 }
  }
  return { cells, ...range }
}

async function clampHailToProcess(
  cells: readonly string[],
  start: string,
  end: string,
): Promise<{ start_date: string; end_date: string } | { error: string; status: number }> {
  const check = await checkHexSnapshots(cells)
  const missing = unprocessedHexError(check)
  if (missing) return { error: missing, status: 400 }
  const floor = earliestSnapshotDate(check.cells)
  if (floor && floor > end) {
    return { error: `Hail history starts at ${floor} when this hex was processed.`, status: 400 }
  }
  return { start_date: floor && floor > start ? floor : start, end_date: end }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function missingPythonDependency(message: string): boolean {
  return /No module named 'xarray'|No module named 'cfgrib'|No module named 'eccodes'|Missing hail Python dependencies/i.test(
    message,
  )
}
