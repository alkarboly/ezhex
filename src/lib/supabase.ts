import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { serverEnv } from './server-env'

let client: SupabaseClient | null | undefined

/**
 * Server client using the publishable anon key only.
 * The service-role key is never read. This module stays off the browser bundle.
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (client !== undefined) return client
  const url = serverEnv('SUPABASE_URL') || serverEnv('VITE_SUPABASE_URL')
  const anonKey = serverEnv('SUPABASE_ANON_KEY') || serverEnv('VITE_SUPABASE_ANON_KEY')
  if (!url || !anonKey) {
    client = null
    return null
  }
  client = createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
  return client
}

/** Per-request client that sends the signed-in user's JWT. Browser never sees this. */
export function createUserClient(accessToken: string): SupabaseClient | null {
  const url = serverEnv('SUPABASE_URL') || serverEnv('VITE_SUPABASE_URL')
  const anonKey = serverEnv('SUPABASE_ANON_KEY') || serverEnv('VITE_SUPABASE_ANON_KEY')
  if (!url || !anonKey || !accessToken) return null
  return createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  })
}
