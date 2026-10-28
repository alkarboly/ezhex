import type { GeoJsonGeometry } from '../lib/geojson'
import type { DatasetId } from './datasets'
import type { FieldOperator } from './datasets'

export type FeatureKind = DatasetId

export type QueryFilter = {
  field: string
  operator: FieldOperator
  value?: string | number | string[]
}

export type QuerySort = {
  field: string
  direction: 'asc' | 'desc'
}

/** Structured query sent to a data provider. This is not SQL. */
export type QuerySpec = {
  dataset: DatasetId
  h3_cells: string[]
  filters: QueryFilter[]
  sort: QuerySort
  limit: number
  offset: number
  /** Pin to one Overture release. Omitted uses the newest stored release per hex. */
  release_version?: string
}

export type CellCount = {
  h3: string
  count: number
}

export type CellCountRequest = {
  dataset: DatasetId
  h3_cells: string[]
  filters: QueryFilter[]
  release_version?: string
}

export type ResultRow = {
  id: string
  h3: string
  lat: number
  lng: number
  geometry: GeoJsonGeometry | null
  building_id?: string | null
  address_id?: string | null
  release_version: string
  values: Record<string, string | number | null>
}

export type QueryResult = {
  total: number
  byCell: CellCount[]
  rows: ResultRow[]
  limit: number
  offset: number
  source: 'mock' | 'supabase'
}

export type PlacesForm = {
  name: string
  basicCategories: string[]
  primaryCategory: string
  confidenceMin: string
  confidenceMax: string
}

export type BuildingsForm = {
  subtypes: string[]
  heightMin: string
  heightMax: string
  floorsMin: string
  floorsMax: string
  hasHeight: 'any' | 'present' | 'missing'
  hasSubtype: 'any' | 'present' | 'missing'
}

export type AddressesForm = {
  street: string
  locality: string
  region: string
  postcode: string
  address: string
}

export const defaultPlacesForm: PlacesForm = {
  name: '',
  basicCategories: [],
  primaryCategory: '',
  confidenceMin: '',
  confidenceMax: '',
}

export const defaultBuildingsForm: BuildingsForm = {
  subtypes: [],
  heightMin: '',
  heightMax: '',
  floorsMin: '',
  floorsMax: '',
  hasHeight: 'any',
  hasSubtype: 'any',
}

export const defaultAddressesForm: AddressesForm = {
  street: '',
  locality: '',
  region: '',
  postcode: '',
  address: '',
}
