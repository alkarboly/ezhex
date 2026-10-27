import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let client: SupabaseClient | null | undefined

/**
 * Browser client using the publishable anon key only.
 * The service-role key must never be placed in a VITE_ variable.
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (client !== undefined) return client
  const url = import.meta.env.VITE_SUPABASE_URL?.trim()
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()
  if (!url || !anonKey) {
    client = null
    return null
  }
  client = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  })
  return client
}

export function supabasePublicConfig(): { urlConfigured: boolean; anonKeyConfigured: boolean } {
  return {
    urlConfigured: Boolean(import.meta.env.VITE_SUPABASE_URL?.trim()),
    anonKeyConfigured: Boolean(import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()),
  }
}
