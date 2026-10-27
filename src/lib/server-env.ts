import { existsSync, readFileSync } from 'node:fs'

export type ResolvedDataMode = {
  raw: string
  resolved: 'mock' | 'supabase'
  unrecognized: boolean
}

/** Reads one server variable. Bracket access so a bundler cannot inline it at build time. */
export function serverEnv(name: string): string {
  const value = process.env[name]
  return typeof value === 'string' ? value.trim() : ''
}

export function readDataMode(): ResolvedDataMode {
  const raw = serverEnv('DATA_MODE') || serverEnv('VITE_DATA_MODE')
  if (raw === 'supabase') return { raw, resolved: 'supabase', unrecognized: false }
  if (raw === '' || raw === 'mock') return { raw: raw || 'mock', resolved: 'mock', unrecognized: false }
  return { raw, resolved: 'mock', unrecognized: true }
}

export function supabasePublicConfig(): { urlConfigured: boolean; anonKeyConfigured: boolean } {
  const url = serverEnv('SUPABASE_URL') || serverEnv('VITE_SUPABASE_URL')
  const anonKey = serverEnv('SUPABASE_ANON_KEY') || serverEnv('VITE_SUPABASE_ANON_KEY')
  return { urlConfigured: url.length > 0, anonKeyConfigured: anonKey.length > 0 }
}

/**
 * Loads `.env` without overriding variables already set in the process.
 * Called when this module loads, which is before request handlers read the mode.
 */
function loadEnvFile() {
  if (!existsSync('.env')) return
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue
    const separator = trimmed.indexOf('=')
    if (separator < 1) continue
    const key = trimmed.slice(0, separator).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key] !== undefined) continue
    let value = trimmed.slice(separator + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    process.env[key] = value
  }
}

loadEnvFile()
