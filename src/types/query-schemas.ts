import type { DatasetId, FieldOperator, FieldValueType } from './datasets'

export type QuerySchemaField = {
  field: string
  label: string
  valueType: FieldValueType
  operators: readonly FieldOperator[]
  sortable: boolean
}

export type QuerySchemaDataset = {
  id: DatasetId
  title: string
  singular: string
  plural: string
  fields: QuerySchemaField[]
}

export type QuerySchemasResponse = {
  query_enabled: boolean
  reason: string | null
  datasets: QuerySchemaDataset[]
}
