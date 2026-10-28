import { randomUUID } from 'node:crypto'
import { getResolution, isValidCell } from 'h3-js'
import { defaultInspectFilters } from '../lib/feature-rows'
import { MAX_QUERY_WORKFLOWS, MAX_SELECTED_CELLS } from '../lib/limits'
import { asInspectFilters, validateInspectSql } from '../lib/inspect-sql'
import { readDataMode } from '../lib/server-env'
import { ACCESS_COOKIE } from '../lib/auth-cookies'
import { createUserClient } from '../lib/supabase'
import type { QueryWorkflow, QueryWorkflowList } from '../types/query-workflows'
import { resolveUser } from './auth'

type RouteResult = { status: number; body: unknown }

const MOCK_OWNER = 'mock-guest'
const mockStore = new Map<string, QueryWorkflow>()

export function resetQueryWorkflowsForTests() {
  mockStore.clear()
}

export async function routeQueryWorkflows(
  method: string,
  pathname: string,
  body: unknown,
  cookies: Record<string, string>,
): Promise<RouteResult | null> {
  if (!pathname.startsWith('/api/query-workflows')) return null

  if (method === 'GET' && pathname === '/api/query-workflows') {
    return respond(await listQueryWorkflows(cookies))
  }

  if (method === 'POST' && pathname === '/api/query-workflows') {
    return respond(await createQueryWorkflow(body, cookies))
  }

  const rest = pathname.slice('/api/query-workflows/'.length)
  const [id, action] = rest.split('/')
  if (!id) return { status: 400, body: { error: 'Workflow id is required.' } }
  if (action) return { status: 404, body: { error: 'No such API route.' } }
  if (method === 'GET') return respond(await getQueryWorkflow(id, cookies))
  if (method === 'DELETE') return respond(await deleteQueryWorkflow(id, cookies))
  return { status: 404, body: { error: 'No such API route.' } }
}

export async function listQueryWorkflows(cookies: Record<string, string>): Promise<QueryWorkflowList | ApiError> {
  const session = await sessionOwner(cookies)
  if (session.error) return session.error
  if (session.signInRequired) {
    return { workflows: [], limit: MAX_QUERY_WORKFLOWS, remaining: MAX_QUERY_WORKFLOWS, sign_in_required: true }
  }
  const rows = session.mode === 'mock' ? mockList(session.ownerId) : await supabaseList(session)
  if ('error' in rows) return rows
  return {
    workflows: rows,
    limit: MAX_QUERY_WORKFLOWS,
    remaining: Math.max(0, MAX_QUERY_WORKFLOWS - rows.length),
    sign_in_required: false,
  }
}

export async function createQueryWorkflow(body: unknown, cookies: Record<string, string>): Promise<QueryWorkflow | ApiError> {
  const session = await sessionOwner(cookies)
  if (session.error) return session.error
  if (session.signInRequired) return { error: 'Sign in to save a workflow.', status: 401 }
  const parsed = parseCreate(body)
  if ('error' in parsed) return parsed
  if (session.mode === 'mock') return mockCreate(session.ownerId, parsed)
  return supabaseCreate(session, parsed)
}

export async function getQueryWorkflow(id: string, cookies: Record<string, string>): Promise<QueryWorkflow | ApiError> {
  const session = await sessionOwner(cookies)
  if (session.error) return session.error
  if (session.signInRequired) return { error: 'Sign in to open a workflow.', status: 401 }
  if (session.mode === 'mock') {
    const row = mockStore.get(id)
    if (!row || row.owner_user_id !== session.ownerId) return { error: 'No such workflow.', status: 404 }
    return row
  }
  const client = userClient(session.accessToken)
  if (!client) return { error: 'Set SUPABASE_URL and SUPABASE_ANON_KEY on the server to save workflows.', status: 503 }
  const { data, error } = await client.from('query_workflows').select('*').eq('id', id).maybeSingle()
  if (error) return supabaseError(error.message)
  if (!data) return { error: 'No such workflow.', status: 404 }
  const mapped = mapRow(data)
  if (!mapped) return { error: 'That workflow is missing fields. Re-save it from Inspect.', status: 400 }
  return mapped
}

export async function deleteQueryWorkflow(id: string, cookies: Record<string, string>): Promise<{ ok: true } | ApiError> {
  const session = await sessionOwner(cookies)
  if (session.error) return session.error
  if (session.signInRequired) return { error: 'Sign in to delete a workflow.', status: 401 }
  if (session.mode === 'mock') {
    const row = mockStore.get(id)
    if (!row || row.owner_user_id !== session.ownerId) return { error: 'No such workflow.', status: 404 }
    mockStore.delete(id)
    return { ok: true }
  }
  const client = userClient(session.accessToken)
  if (!client) return { error: 'Set SUPABASE_URL and SUPABASE_ANON_KEY on the server to save workflows.', status: 503 }
  const { data, error } = await client.from('query_workflows').delete().eq('id', id).select('id')
  if (error) return supabaseError(error.message)
  if (!data || data.length === 0) return { error: 'No such workflow.', status: 404 }
  return { ok: true }
}

type ApiError = { error: string; status: number }
type SessionOwner =
  | { mode: 'mock'; ownerId: string; accessToken: string; signInRequired: false; error?: undefined }
  | { mode: 'supabase'; ownerId: string; accessToken: string; signInRequired: false; error?: undefined }
  | { signInRequired: true; error?: undefined }
  | { error: ApiError }

async function sessionOwner(cookies: Record<string, string>): Promise<SessionOwner> {
  if (readDataMode().resolved === 'mock') {
    return { mode: 'mock', ownerId: MOCK_OWNER, accessToken: '', signInRequired: false }
  }
  const resolved = await resolveUser(cookies)
  if (!resolved.user) return { signInRequired: true }
  const accessToken = cookies[ACCESS_COOKIE]
  if (!accessToken) return { error: { error: 'Sign in to save a workflow.', status: 401 } }
  return { mode: 'supabase', ownerId: resolved.user.id, accessToken, signInRequired: false }
}

function parseCreate(body: unknown): Omit<QueryWorkflow, 'id' | 'owner_user_id' | 'created_at' | 'updated_at'> | ApiError {
  if (!isRecord(body)) return { error: 'Request body must include name, sql, and h3_cells.', status: 400 }
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (name.length < 1 || name.length > 120) return { error: 'Name must be 1 to 120 characters.', status: 400 }
  if (typeof body.sql !== 'string') return { error: 'SQL is required.', status: 400 }
  const sqlError = validateInspectSql(stripGeneratedComments(body.sql))
  if (sqlError) return { error: sqlError, status: 400 }
  if (typeof body.custom_sql !== 'boolean') return { error: 'custom_sql must be true or false.', status: 400 }
  const cells = parseCells(body.h3_cells)
  if ('error' in cells) return cells
  const filters = asInspectFilters(body.filters) ?? defaultInspectFilters
  return {
    name,
    sql: body.sql.trim(),
    custom_sql: body.custom_sql,
    h3_cells: cells,
    filters,
  }
}

function parseCells(value: unknown): string[] | ApiError {
  if (!Array.isArray(value) || value.length === 0) return { error: 'Choose at least one hex.', status: 400 }
  if (!value.every((cell) => typeof cell === 'string')) return { error: 'Every hex must be a string.', status: 400 }
  const unique = [...new Set(value.map((cell) => cell.trim()).filter((cell) => cell.length > 0))]
  if (unique.length === 0) return { error: 'Choose at least one hex.', status: 400 }
  if (unique.length > MAX_SELECTED_CELLS) {
    return { error: `Selection is limited to ${MAX_SELECTED_CELLS} cells.`, status: 400 }
  }
  for (const cell of unique) {
    if (!isValidCell(cell) || getResolution(cell) !== 8) {
      return { error: 'Every hex must be a resolution-8 cell.', status: 400 }
    }
  }
  return unique
}

function mockList(ownerId: string): QueryWorkflow[] {
  return [...mockStore.values()]
    .filter((row) => row.owner_user_id === ownerId)
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
}

function mockCreate(
  ownerId: string,
  parsed: Omit<QueryWorkflow, 'id' | 'owner_user_id' | 'created_at' | 'updated_at'>,
): QueryWorkflow | ApiError {
  const existing = mockList(ownerId)
  if (existing.length >= MAX_QUERY_WORKFLOWS) return { error: 'Workflow limit is 5.', status: 400 }
  if (existing.some((row) => row.name.toLowerCase() === parsed.name.toLowerCase())) {
    return { error: 'A workflow with that name already exists.', status: 400 }
  }
  const now = new Date().toISOString()
  const row: QueryWorkflow = {
    ...parsed,
    id: randomUUID(),
    owner_user_id: ownerId,
    created_at: now,
    updated_at: now,
  }
  mockStore.set(row.id, row)
  return row
}

async function supabaseList(session: Extract<SessionOwner, { mode: 'supabase' }>): Promise<QueryWorkflow[] | ApiError> {
  const client = userClient(session.accessToken)
  if (!client) return { error: 'Set SUPABASE_URL and SUPABASE_ANON_KEY on the server to save workflows.', status: 503 }
  const { data, error } = await client
    .from('query_workflows')
    .select('*')
    .order('updated_at', { ascending: false })
  if (error) return supabaseError(error.message)
  const rows: QueryWorkflow[] = []
  for (const entry of data ?? []) {
    const mapped = mapRow(entry)
    if (mapped) rows.push(mapped)
  }
  return rows
}

async function supabaseCreate(
  session: Extract<SessionOwner, { mode: 'supabase' }>,
  parsed: Omit<QueryWorkflow, 'id' | 'owner_user_id' | 'created_at' | 'updated_at'>,
): Promise<QueryWorkflow | ApiError> {
  const client = userClient(session.accessToken)
  if (!client) return { error: 'Set SUPABASE_URL and SUPABASE_ANON_KEY on the server to save workflows.', status: 503 }
  const { count, error: countError } = await client
    .from('query_workflows')
    .select('id', { count: 'exact', head: true })
  if (countError) return supabaseError(countError.message)
  if ((count ?? 0) >= MAX_QUERY_WORKFLOWS) return { error: 'Workflow limit is 5.', status: 400 }
  const { data, error } = await client
    .from('query_workflows')
    .insert({
      owner_user_id: session.ownerId,
      name: parsed.name,
      sql: parsed.sql,
      custom_sql: parsed.custom_sql,
      h3_cells: parsed.h3_cells,
      filters: parsed.filters,
    })
    .select('*')
    .single()
  if (error) {
    if (/limit is 5/i.test(error.message)) return { error: 'Workflow limit is 5.', status: 400 }
    if (/duplicate|unique/i.test(error.message)) return { error: 'A workflow with that name already exists.', status: 400 }
    return supabaseError(error.message)
  }
  const mapped = mapRow(data)
  if (!mapped) return { error: 'The workflow was saved but could not be read back.', status: 500 }
  return mapped
}

function mapRow(value: unknown): QueryWorkflow | null {
  if (!isRecord(value)) return null
  if (typeof value.id !== 'string' || typeof value.name !== 'string' || typeof value.sql !== 'string') return null
  if (typeof value.custom_sql !== 'boolean' || !Array.isArray(value.h3_cells)) return null
  if (!value.h3_cells.every((cell) => typeof cell === 'string')) return null
  const filters = asInspectFilters(value.filters) ?? defaultInspectFilters
  return {
    id: value.id,
    owner_user_id: typeof value.owner_user_id === 'string' ? value.owner_user_id : null,
    name: value.name,
    sql: value.sql,
    custom_sql: value.custom_sql,
    h3_cells: value.h3_cells,
    filters,
    created_at: typeof value.created_at === 'string' ? value.created_at : new Date().toISOString(),
    updated_at: typeof value.updated_at === 'string' ? value.updated_at : new Date().toISOString(),
  }
}

function userClient(accessToken: string) {
  return createUserClient(accessToken)
}

function supabaseError(message: string): ApiError {
  if (/does not exist|relation|schema cache/i.test(message)) {
    return { error: 'Run supabase/migrations/20261027_query_workflows.sql in the Supabase SQL editor.', status: 400 }
  }
  return { error: message.length > 0 && message.length < 180 ? message : 'The workflow request failed.', status: 400 }
}

function respond(result: unknown): RouteResult {
  if (isRecord(result) && typeof result.error === 'string' && typeof result.status === 'number') {
    return { status: result.status, body: { error: result.error } }
  }
  return { status: 200, body: result }
}

/** Generated inspect SQL includes comments; custom SQL must not. */
function stripGeneratedComments(sql: string): string {
  return sql
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
