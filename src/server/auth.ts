import { ACCESS_COOKIE, REFRESH_COOKIE, clearedSessionCookies, cookieSecure, sessionCookies } from '../lib/auth-cookies'
import { getSupabaseClient, createUserClient } from '../lib/supabase'
import { supabasePublicConfig } from '../lib/server-env'
import type { AuthSession, AuthUser } from '../types/auth'

type AuthResult = { status: number; body: unknown; cookies?: string[] }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function routeAuth(
  method: string,
  pathname: string,
  body: unknown,
  cookies: Record<string, string>,
): Promise<AuthResult | null> {
  if (!pathname.startsWith('/api/auth')) return null

  if (method === 'GET' && pathname === '/api/auth/session') {
    return readSession(cookies)
  }
  if (method === 'POST' && pathname === '/api/auth/signup') {
    return signUp(body)
  }
  if (method === 'POST' && pathname === '/api/auth/signin') {
    return signIn(body)
  }
  if (method === 'POST' && pathname === '/api/auth/signout') {
    return signOut()
  }
  if (method === 'POST' && pathname === '/api/auth/delete') {
    return deleteAccount(body, cookies)
  }
  return { status: 404, body: { error: 'No such API route.' } }
}

async function readSession(cookies: Record<string, string>): Promise<AuthResult> {
  const configured = supabasePublicConfig()
  const ready = configured.urlConfigured && configured.anonKeyConfigured
  if (!ready) {
    return { status: 200, body: { user: null, configured: false } satisfies AuthSession }
  }
  const resolved = await resolveUser(cookies)
  return {
    status: 200,
    body: { user: resolved.user, configured: true } satisfies AuthSession,
    cookies: resolved.cookies,
  }
}

async function signUp(body: unknown): Promise<AuthResult> {
  const credentials = asCredentials(body)
  if (!credentials) return { status: 400, body: { error: 'Email and a password of 8 or more characters are required.' } }
  const client = requireAuthClient()
  if (!client) return authNotConfigured()
  const { data, error } = await client.auth.signUp({
    email: credentials.email,
    password: credentials.password,
  })
  if (error) return { status: 400, body: { error: publicAuthError(error.message) } }
  if (!data.session) {
    return {
      status: 200,
      body: {
        user: data.user ? asUser(data.user.id, data.user.email) : null,
        configured: true,
        needs_confirmation: true,
      },
    }
  }
  return {
    status: 200,
    body: { user: asUser(data.session.user.id, data.session.user.email), configured: true },
    cookies: sessionCookies(data.session.access_token, data.session.refresh_token, cookieSecure()),
  }
}

async function signIn(body: unknown): Promise<AuthResult> {
  const credentials = asCredentials(body)
  if (!credentials) return { status: 400, body: { error: 'Email and a password of 8 or more characters are required.' } }
  const client = requireAuthClient()
  if (!client) return authNotConfigured()
  const { data, error } = await client.auth.signInWithPassword({
    email: credentials.email,
    password: credentials.password,
  })
  if (error || !data.session) {
    return { status: 401, body: { error: 'Email or password is wrong.' } }
  }
  return {
    status: 200,
    body: { user: asUser(data.session.user.id, data.session.user.email), configured: true },
    cookies: sessionCookies(data.session.access_token, data.session.refresh_token, cookieSecure()),
  }
}

async function signOut(): Promise<AuthResult> {
  return {
    status: 200,
    body: { user: null, configured: supabasePublicConfig().urlConfigured && supabasePublicConfig().anonKeyConfigured },
    cookies: clearedSessionCookies(cookieSecure()),
  }
}

async function deleteAccount(body: unknown, cookies: Record<string, string>): Promise<AuthResult> {
  if (!isRecord(body) || typeof body.password !== 'string' || body.confirm !== 'DELETE') {
    return { status: 400, body: { error: 'Type your password and DELETE to remove this account.' } }
  }
  const resolved = await resolveUser(cookies)
  if (!resolved.user?.email) {
    return { status: 401, body: { error: 'Sign in first.' }, cookies: resolved.cookies ?? clearedSessionCookies(cookieSecure()) }
  }
  const client = requireAuthClient()
  if (!client) return authNotConfigured()
  const { data, error } = await client.auth.signInWithPassword({
    email: resolved.user.email,
    password: body.password,
  })
  if (error || !data.session) {
    return { status: 401, body: { error: 'Password is wrong.' } }
  }
  const userClient = createUserClient(data.session.access_token)
  if (!userClient) return authNotConfigured()
  const deleted = await userClient.rpc('delete_own_account')
  if (deleted.error) {
    return {
      status: 400,
      body: {
        error: deleted.error.message.includes('does not exist')
          ? 'Run supabase/migrations/20261027_auth.sql in the Supabase SQL editor.'
          : publicAuthError(deleted.error.message),
      },
    }
  }
  return {
    status: 200,
    body: { user: null, configured: true },
    cookies: clearedSessionCookies(cookieSecure()),
  }
}

async function resolveUser(cookies: Record<string, string>): Promise<{ user: AuthUser | null; cookies?: string[] }> {
  const client = requireAuthClient()
  if (!client) return { user: null }
  const access = cookies[ACCESS_COOKIE]
  const refresh = cookies[REFRESH_COOKIE]
  if (access) {
    const { data, error } = await client.auth.getUser(access)
    if (!error && data.user) return { user: asUser(data.user.id, data.user.email) }
  }
  if (!refresh) return { user: null, cookies: access || refresh ? clearedSessionCookies(cookieSecure()) : undefined }
  const refreshed = await client.auth.refreshSession({ refresh_token: refresh })
  if (refreshed.error || !refreshed.data.session) {
    return { user: null, cookies: clearedSessionCookies(cookieSecure()) }
  }
  const session = refreshed.data.session
  return {
    user: asUser(session.user.id, session.user.email),
    cookies: sessionCookies(session.access_token, session.refresh_token, cookieSecure()),
  }
}

function requireAuthClient() {
  return getSupabaseClient()
}

function authNotConfigured(): AuthResult {
  return {
    status: 503,
    body: { error: 'Set SUPABASE_URL and SUPABASE_ANON_KEY on the server to use accounts.' },
  }
}

function asCredentials(body: unknown): { email: string; password: string } | null {
  if (!isRecord(body) || typeof body.email !== 'string' || typeof body.password !== 'string') return null
  const email = body.email.trim().toLowerCase()
  const password = body.password
  if (!EMAIL_RE.test(email) || password.length < 8 || password.length > 72) return null
  return { email, password }
}

function asUser(id: string, email: string | undefined): AuthUser {
  return { id, email: email ?? null }
}

function publicAuthError(message: string): string {
  const text = message.trim()
  if (/already registered|already been registered/i.test(text)) return 'An account with that email already exists.'
  if (/invalid login|invalid credentials/i.test(text)) return 'Email or password is wrong.'
  if (/password/i.test(text) && /least|character/i.test(text)) return 'Password must be 8 or more characters.'
  if (text.length > 0 && text.length < 180) return text
  return 'The account request failed.'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
