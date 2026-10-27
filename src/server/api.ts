import { readDataMode, supabasePublicConfig } from '../lib/server-env'
import { mockProvider } from '../services/mock-provider'
import { SUPABASE_NOT_CONNECTED, supabaseProvider } from '../services/supabase-provider'
import type { SourceDescription } from '../services/data-provider'
import type { CellCountRequest, QuerySpec } from '../types/queries'
import { DATASET_IDS, DATASET_META, FIELD_CATALOG } from '../types/datasets'
import {
  asWorkflowIngestionPlanRequest,
  planWorkflowIngestion,
  workflowIngestionLimits,
} from './workflow-ingestion'

export type ApiResult = { status: number; body: unknown }

const BODY_LIMIT = 1_000_000

export async function routeApi(method: string, pathname: string, body: unknown): Promise<ApiResult> {
  if (method === 'GET' && pathname === '/api/health') {
    return { status: 200, body: { ok: true } }
  }

  if (method === 'GET' && pathname === '/api/source') {
    const mode = readDataMode()
    const described = await serverProvider().describeSource()
    const source: SourceDescription = {
      ...described,
      mode: mode.resolved,
      rawMode: mode.raw,
      unrecognized: mode.unrecognized,
      supabase: supabasePublicConfig(),
    }
    return { status: 200, body: source }
  }

  if (method === 'POST' && pathname === '/api/cell-counts') {
    const request = asCellCountRequest(body)
    if (!request) return invalid('Request body must include dataset, h3_cells, and filters.')
    return call(() => serverProvider().getCellCounts(request))
  }

  if (method === 'POST' && pathname === '/api/query') {
    const spec = asQuerySpec(body)
    if (!spec) return invalid('Request body must be a query spec.')
    return call(() => serverProvider().runQuery(spec))
  }

  if (method === 'GET' && pathname === '/api/query-schemas') {
    const mode = readDataMode().resolved
    const queryEnabled = mode === 'mock'
    return {
      status: 200,
      body: {
        query_enabled: queryEnabled,
        reason: queryEnabled ? null : SUPABASE_NOT_CONNECTED,
        datasets: DATASET_IDS.map((id) => ({
          id,
          title: DATASET_META[id].title,
          singular: DATASET_META[id].singular,
          plural: DATASET_META[id].plural,
          fields: FIELD_CATALOG[id].map((field) => ({
            field: field.field,
            label: field.label,
            valueType: field.valueType,
            operators: [...field.operators],
            sortable: field.sortable,
          })),
        })),
      },
    }
  }

  if (method === 'GET' && pathname === '/api/workflow-ingestion/limits') {
    return { status: 200, body: workflowIngestionLimits() }
  }

  if (method === 'POST' && pathname === '/api/workflow-ingestion/plan') {
    const request = asWorkflowIngestionPlanRequest(body)
    if (!request) return invalid('Request body must include release_version and h3_cells.')
    return call(async () => planWorkflowIngestion(request))
  }

  return { status: 404, body: { error: 'No such API route.' } }
}

export async function readJsonBody(req: AsyncIterable<Buffer | string>, limit = BODY_LIMIT): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    size += buffer.length
    if (size > limit) throw new BodyTooLargeError()
    chunks.push(buffer)
  }
  if (size === 0) return undefined
  const text = Buffer.concat(chunks).toString('utf8')
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new InvalidJsonError()
  }
}

export class BodyTooLargeError extends Error {
  constructor() {
    super('Request body is too large.')
    this.name = 'BodyTooLargeError'
  }
}

export class InvalidJsonError extends Error {
  constructor() {
    super('Request body must be JSON.')
    this.name = 'InvalidJsonError'
  }
}

function serverProvider() {
  return readDataMode().resolved === 'supabase' ? supabaseProvider : mockProvider
}

async function call(work: () => Promise<unknown>): Promise<ApiResult> {
  try {
    return { status: 200, body: await work() }
  } catch (error) {
    if (error instanceof Error && error.name === 'Error') {
      return { status: 400, body: { error: error.message } }
    }
    console.error(error)
    return { status: 500, body: { error: 'The query failed.' } }
  }
}

function invalid(message: string): ApiResult {
  return { status: 400, body: { error: message } }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asCellCountRequest(body: unknown): CellCountRequest | null {
  if (!isRecord(body) || typeof body.dataset !== 'string' || !Array.isArray(body.h3_cells) || !Array.isArray(body.filters)) {
    return null
  }
  return body as CellCountRequest
}

function asQuerySpec(body: unknown): QuerySpec | null {
  if (
    !isRecord(body) ||
    typeof body.dataset !== 'string' ||
    !Array.isArray(body.h3_cells) ||
    !Array.isArray(body.filters) ||
    !isRecord(body.sort) ||
    typeof body.limit !== 'number' ||
    typeof body.offset !== 'number'
  ) {
    return null
  }
  return body as QuerySpec
}
