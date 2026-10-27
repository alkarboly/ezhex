import type { DataProvider, SourceDescription } from './data-provider'
import type { CellCount, CellCountRequest, QueryResult, QuerySpec } from '../types/queries'

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message =
      isRecord(payload) && typeof payload.error === 'string' ? payload.error : `Request failed (${response.status})`
    throw new Error(message)
  }
  return payload as T
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

const httpProvider: DataProvider = {
  id: 'mock',
  label: 'Server',
  describeSource: () => request<SourceDescription>('/api/source'),
  getCellCounts: (requestBody: CellCountRequest) => request<CellCount[]>('/api/cell-counts', requestBody),
  runQuery: (spec: QuerySpec) => request<QueryResult>('/api/query', spec),
}

export function getDataProvider(): DataProvider {
  return httpProvider
}
