import type { InspectFilters } from '../lib/feature-rows'
import { MAX_QUERY_WORKFLOWS } from '../lib/limits'

export { MAX_QUERY_WORKFLOWS }

export type QueryWorkflow = {
  id: string
  owner_user_id: string | null
  name: string
  sql: string
  custom_sql: boolean
  h3_cells: string[]
  filters: InspectFilters
  created_at: string
  updated_at: string
}

export type QueryWorkflowCreate = {
  name: string
  sql: string
  custom_sql: boolean
  h3_cells: string[]
  filters: InspectFilters
}

export type QueryWorkflowList = {
  workflows: QueryWorkflow[]
  limit: number
  remaining: number
  sign_in_required: boolean
}
