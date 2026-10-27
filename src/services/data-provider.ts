import type { DatasetId } from '../types/datasets'
import type { CellCount, CellCountRequest, QueryResult, QuerySpec } from '../types/queries'

export type SourceDescription = {
  mode: 'mock' | 'supabase'
  /** The DATA_MODE value the server actually read. */
  rawMode: string
  unrecognized: boolean
  label: string
  note: string
  resolution: number
  cells: number | null
  counts: Record<DatasetId, number | null>
  coverage: { west: number; south: number; east: number; north: number } | null
  /** Whether the server has a URL and anon key. The key itself is never included. */
  supabase: { urlConfigured: boolean; anonKeyConfigured: boolean }
}

export type DataProvider = {
  id: 'mock' | 'supabase'
  label: string
  describeSource(): Promise<SourceDescription>
  getCellCounts(request: CellCountRequest): Promise<CellCount[]>
  runQuery(spec: QuerySpec): Promise<QueryResult>
}
