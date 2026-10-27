import { getSupabaseClient } from '../lib/supabase'
import type { DataProvider } from './data-provider'

const NOT_CONNECTED =
  'Supabase query routing is not connected yet. Keep VITE_DATA_MODE=mock until the dataset RPC and saved-query tables are added.'

export const supabaseProvider: DataProvider = {
  id: 'supabase',
  label: 'Supabase',
  async describeSource() {
    const configured = getSupabaseClient() != null
    return {
      mode: 'supabase',
      label: 'Supabase',
      note: configured
        ? 'The anon client is configured, but WorldPulse does not query Overture tables in this slice.'
        : 'Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY. Do not put the service-role key in frontend env.',
      resolution: 8,
      cells: null,
      counts: { places: null, buildings: null, addresses: null },
      coverage: null,
    }
  },
  async getCellCounts() {
    throw new Error(NOT_CONNECTED)
  },
  async runQuery() {
    throw new Error(NOT_CONNECTED)
  },
}
