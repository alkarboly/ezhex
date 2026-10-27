import { BASIC_CATEGORIES, PRIMARY_CATEGORIES } from './place-presets'

export const DATASET_IDS = ['buildings', 'addresses', 'places'] as const

export type DatasetId = (typeof DATASET_IDS)[number]

export const BUILDING_SUBTYPES = [
  'agricultural',
  'civic',
  'commercial',
  'education',
  'entertainment',
  'industrial',
  'medical',
  'military',
  'outbuilding',
  'religious',
  'residential',
  'service',
  'transportation',
] as const

export type BuildingSubtype = (typeof BUILDING_SUBTYPES)[number]

export type FieldOperator =
  | 'eq'
  | 'in'
  | 'contains'
  | 'gte'
  | 'lte'
  | 'is_null'
  | 'is_not_null'

export type FieldValueType = 'string' | 'number' | 'enum'

export type FieldDefinition = {
  field: string
  label: string
  valueType: FieldValueType
  operators: readonly FieldOperator[]
  sortable: boolean
  showInTable: boolean
  source: string
  unit?: string
  /** Closed set published by the Overture schema. */
  enumValues?: readonly string[]
  /** Values this Austin mock actually generates. Not the full Overture vocabulary. */
  sampleValues?: readonly string[]
}

export const FIELD_CATALOG: Record<DatasetId, readonly FieldDefinition[]> = {
  places: [
    {
      field: 'names.primary',
      label: 'Place name',
      valueType: 'string',
      operators: ['contains'],
      sortable: true,
      showInTable: true,
      source: 'names.primary',
    },
    {
      field: 'basic_category',
      label: 'Basic category',
      valueType: 'enum',
      operators: ['eq', 'in'],
      sortable: true,
      showInTable: true,
      source: 'basic_category',
      sampleValues: BASIC_CATEGORIES,
    },
    {
      field: 'taxonomy.primary',
      label: 'Primary category',
      valueType: 'enum',
      operators: ['eq', 'in'],
      sortable: true,
      showInTable: true,
      source: 'taxonomy.primary',
      sampleValues: PRIMARY_CATEGORIES,
    },
    {
      field: 'confidence',
      label: 'Confidence',
      valueType: 'number',
      operators: ['gte', 'lte'],
      sortable: true,
      showInTable: true,
      source: 'confidence',
    },
    {
      field: 'operating_status',
      label: 'Operating status',
      valueType: 'enum',
      operators: [],
      sortable: true,
      showInTable: true,
      source: 'operating_status',
      sampleValues: ['open', 'permanently_closed'],
    },
  ],
  buildings: [
    {
      field: 'subtype',
      label: 'Building subtype',
      valueType: 'enum',
      operators: ['eq', 'in', 'is_null', 'is_not_null'],
      sortable: true,
      showInTable: true,
      source: 'subtype',
      enumValues: BUILDING_SUBTYPES,
    },
    {
      field: 'height',
      label: 'Height',
      valueType: 'number',
      operators: ['gte', 'lte', 'is_null', 'is_not_null'],
      sortable: true,
      showInTable: true,
      source: 'height',
      unit: 'm',
    },
    {
      field: 'num_floors',
      label: 'Number of floors',
      valueType: 'number',
      operators: ['gte', 'lte', 'is_null', 'is_not_null'],
      sortable: true,
      showInTable: true,
      source: 'num_floors',
    },
  ],
  addresses: [
    {
      field: 'number',
      label: 'Number',
      valueType: 'string',
      operators: [],
      sortable: true,
      showInTable: true,
      source: 'number',
    },
    {
      field: 'street',
      label: 'Street',
      valueType: 'string',
      operators: ['contains'],
      sortable: true,
      showInTable: true,
      source: 'street',
    },
    {
      field: 'locality',
      label: 'Locality',
      valueType: 'string',
      operators: ['contains'],
      sortable: true,
      showInTable: true,
      source: 'address_levels[1].value (United States locality)',
    },
    {
      field: 'region',
      label: 'Region',
      valueType: 'string',
      operators: ['contains'],
      sortable: true,
      showInTable: true,
      source: 'address_levels[0].value (United States state)',
    },
    {
      field: 'postcode',
      label: 'Postal code',
      valueType: 'string',
      operators: ['eq'],
      sortable: true,
      showInTable: true,
      source: 'postcode',
    },
    {
      field: 'address',
      label: 'Address',
      valueType: 'string',
      operators: ['contains'],
      sortable: false,
      showInTable: false,
      source: 'Derived from number, street, locality, region, and postcode for text search',
    },
  ],
}

export const RESULT_SEARCH_FIELD: Record<DatasetId, string | null> = {
  places: 'names.primary',
  buildings: null,
  addresses: 'address',
}

export type ResultColumn = {
  field: string
  label: string
  sortable: boolean
  numeric: boolean
  source: 'value' | 'h3'
}

export function resultColumns(dataset: DatasetId): ResultColumn[] {
  const columns: ResultColumn[] = FIELD_CATALOG[dataset]
    .filter((field) => field.showInTable)
    .map((field) => ({
      field: field.field,
      label: field.unit ? `${field.label} (${field.unit})` : field.label,
      sortable: field.sortable,
      numeric: field.valueType === 'number',
      source: 'value',
    }))
  columns.push({
    field: 'h3',
    label: 'H3 cell',
    sortable: false,
    numeric: false,
    source: 'h3',
  })
  return columns
}

export function fieldByName(dataset: DatasetId, field: string): FieldDefinition | undefined {
  return FIELD_CATALOG[dataset].find((entry) => entry.field === field)
}

export const DATASET_META: Record<
  DatasetId,
  { title: string; singular: string; plural: string; blurb: string }
> = {
  places: {
    title: 'Places',
    singular: 'place',
    plural: 'places',
    blurb: 'Named destinations with a basic category, taxonomy, and existence confidence.',
  },
  buildings: {
    title: 'Buildings',
    singular: 'building',
    plural: 'buildings',
    blurb: 'Building footprints described by subtype, height, and floor count when those values exist.',
  },
  addresses: {
    title: 'Addresses',
    singular: 'address',
    plural: 'addresses',
    blurb: 'Point addresses with street, US address levels, and postal code.',
  },
}

export function defaultSort(dataset: DatasetId): { field: string; direction: 'asc' | 'desc' } {
  if (dataset === 'buildings') return { field: 'height', direction: 'desc' }
  if (dataset === 'addresses') return { field: 'street', direction: 'asc' }
  return { field: 'names.primary', direction: 'asc' }
}
