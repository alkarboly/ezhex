import { readDataMode, supabasePublicConfig } from '../lib/server-env'
import { getSupabaseClient } from '../lib/supabase'
import type { DataProvider } from './data-provider'

export const SUPABASE_NOT_CONNECTED =
  'Supabase query routing is not connected yet. Keep DATA_MODE=mock until the dataset RPC and saved-query tables are added.'

export const supabaseProvider: DataProvider = {
  id: 'supabase',
  label: 'Supabase',
  async describeSource() {
    const mode = readDataMode()
    const configured = getSupabaseClient() != null
    return {
      mode: 'supabase',
      rawMode: mode.raw,
      unrecognized: mode.unrecognized,
      label: 'Supabase',
      note: configured
        ? 'The anon client is configured, but WorldPulse does not query Overture tables in this slice.'
        : 'Set SUPABASE_URL and SUPABASE_ANON_KEY on the server. Do not put the service-role key in the environment.',
      supabase: supabasePublicConfig(),
      resolution: 8,
      cells: null,
      counts: { places: null, buildings: null, addresses: null },
      coverage: null,
    }
  },
  async getCellCounts() {
    throw new Error(SUPABASE_NOT_CONNECTED)
  },
  async runQuery() {
    throw new Error(SUPABASE_NOT_CONNECTED)
  },
}
