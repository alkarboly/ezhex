import type { IngestionJob } from '../types/workflows'

const STORE = Symbol.for('worldpulse.ingestion-jobs')

type Store = { jobs: Map<string, IngestionJob> }

/** One Map for the whole Node isolate. Vite SSR and circular imports must not each get an empty copy. */
export function jobStore(): Map<string, IngestionJob> {
  const global = globalThis as typeof globalThis & { [STORE]?: Store }
  if (!global[STORE]) global[STORE] = { jobs: new Map() }
  return global[STORE].jobs
}
