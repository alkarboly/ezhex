import type { InspectFilters } from '../lib/feature-rows'
import { MAX_QUERY_WORKFLOWS } from '../lib/limits'
import type { WorkflowEnrichment } from './enrichments'

export { MAX_QUERY_WORKFLOWS }

export type QueryWorkflow = {
  id: string
  owner_user_id: string | null
  name: string
  sql: string
  custom_sql: boolean
  h3_cells: string[]
  filters: InspectFilters
  enrichments: WorkflowEnrichment[]
  /** Null means latest stored snapshot. A pin is a historical query. */
  release_version: string | null
  created_at: string
  updated_at: string
}

export type QueryWorkflowCreate = {
  name: string
  sql: string
  custom_sql: boolean
  h3_cells: string[]
  filters: InspectFilters
  enrichments?: WorkflowEnrichment[]
  release_version?: string | null
}

export type QueryWorkflowPatch = {
  enrichments?: WorkflowEnrichment[]
  release_version?: string | null
}

export type QueryWorkflowList = {
  workflows: QueryWorkflow[]
  limit: number
  remaining: number
  sign_in_required: boolean
}
