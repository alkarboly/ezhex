import type { DataProvider } from './data-provider'
import { mockProvider } from './mock-provider'
import { supabaseProvider } from './supabase-provider'

export type DataMode = 'mock' | 'supabase'

export function configuredDataMode(): { raw: string; resolved: DataMode; unrecognized: boolean } {
  const raw = import.meta.env.VITE_DATA_MODE?.trim() ?? ''
  if (raw === 'supabase') return { raw, resolved: 'supabase', unrecognized: false }
  if (raw === '' || raw === 'mock') {
    return { raw: raw || 'mock', resolved: 'mock', unrecognized: false }
  }
  return { raw, resolved: 'mock', unrecognized: true }
}

let provider: DataProvider | null = null

export function getDataProvider(): DataProvider {
  if (!provider) {
    provider = configuredDataMode().resolved === 'supabase' ? supabaseProvider : mockProvider
  }
  return provider
}
