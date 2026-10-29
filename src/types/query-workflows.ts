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
  /** Demo flag. Check now reads snapshots; no schedule runs yet. */
  subscribe_new_data: boolean
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
  subscribe_new_data?: boolean
}

export type QueryWorkflowPatch = {
  name?: string
  sql?: string
  custom_sql?: boolean
  h3_cells?: string[]
  filters?: InspectFilters
  enrichments?: WorkflowEnrichment[]
  release_version?: string | null
  subscribe_new_data?: boolean
}

export type QueryWorkflowNewDataCheck = {
  workflow_id: string
  subscribe_new_data: boolean
  current_release_version: string
  processed_count: number
  current_count: number
  stale_count: number
  missing_count: number
  message: string
}

export type QueryWorkflowList = {
  workflows: QueryWorkflow[]
  limit: number
  remaining: number
  sign_in_required: boolean
}
