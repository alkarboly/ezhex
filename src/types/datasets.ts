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
    {
      field: 'phones',
      label: 'Phones',
      valueType: 'string',
      operators: ['contains'],
      sortable: false,
      showInTable: true,
      source: 'phones',
    },
    {
      field: 'websites',
      label: 'Websites',
      valueType: 'string',
      operators: ['contains'],
      sortable: false,
      showInTable: true,
      source: 'websites',
    },
    {
      field: 'brand_name',
      label: 'Brand',
      valueType: 'string',
      operators: ['contains'],
      sortable: true,
      showInTable: true,
      source: 'brand.names.primary',
    },
    {
      field: 'building_id',
      label: 'Building id',
      valueType: 'string',
      operators: [],
      sortable: false,
      showInTable: true,
      source: 'Computed: containing or nearest building GERS id',
    },
    {
      field: 'address_id',
      label: 'Address id',
      valueType: 'string',
      operators: [],
      sortable: false,
      showInTable: true,
      source: 'Computed: matched or nearest address GERS id',
    },
    {
      field: 'socials',
      label: 'Socials',
      valueType: 'string',
      operators: ['contains'],
      sortable: false,
      showInTable: true,
      source: 'socials',
    },
    {
      field: 'emails',
      label: 'Emails',
      valueType: 'string',
      operators: ['contains'],
      sortable: false,
      showInTable: true,
      source: 'emails',
    },
    {
      field: 'brand_wikidata',
      label: 'Brand Wikidata',
      valueType: 'string',
      operators: ['contains'],
      sortable: false,
      showInTable: true,
      source: 'brand.wikidata',
    },
    {
      field: 'taxonomy.hierarchy',
      label: 'Category hierarchy',
      valueType: 'string',
      operators: [],
      sortable: false,
      showInTable: true,
      source: 'taxonomy.hierarchy',
    },
    {
      field: 'main_category',
      label: 'Main category',
      valueType: 'string',
      operators: [],
      sortable: true,
      showInTable: true,
      source: 'Characters left of the first < in taxonomy.primary',
    },
    {
      field: 'place_addresses',
      label: 'Nested addresses',
      valueType: 'string',
      operators: [],
      sortable: false,
      showInTable: true,
      source: 'addresses[]',
    },
    {
      field: 'release_version',
      label: 'Snapshot',
      valueType: 'string',
      operators: [],
      sortable: true,
      showInTable: true,
      source: 'release_version',
    },
    {
      field: 'snapshot_date',
      label: 'Snapshot date',
      valueType: 'string',
      operators: [],
      sortable: true,
      showInTable: true,
      source: 'YYYY-MM-DD prefix of release_version',
    },
    {
      field: 'sources',
      label: 'Sources',
      valueType: 'string',
      operators: [],
      sortable: false,
      showInTable: true,
      source: 'sources (Overture property, dataset, record_id, update_time)',
    },
    {
      field: 'attribution',
      label: 'Attribution',
      valueType: 'string',
      operators: [],
      sortable: false,
      showInTable: true,
      source: 'Derived from sources[].dataset and /licenses terms',
    },
    {
      field: 'geometry',
      label: 'Geometry',
      valueType: 'string',
      operators: [],
      sortable: false,
      showInTable: false,
      source: 'geometry (Point)',
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
    {
      field: 'names.primary',
      label: 'Building name',
      valueType: 'string',
      operators: ['contains'],
      sortable: true,
      showInTable: true,
      source: 'names.primary',
    },
    {
      field: 'class',
      label: 'Building class',
      valueType: 'string',
      operators: ['eq', 'in', 'is_null', 'is_not_null'],
      sortable: true,
      showInTable: true,
      source: 'class',
    },
    {
      field: 'address_id',
      label: 'Address id',
      valueType: 'string',
      operators: [],
      sortable: false,
      showInTable: true,
      source: 'Computed: nearest address GERS id',
    },
    {
      field: 'has_parts',
      label: 'Has parts',
      valueType: 'string',
      operators: [],
      sortable: false,
      showInTable: true,
      source: 'has_parts',
    },
    {
      field: 'is_underground',
      label: 'Underground',
      valueType: 'string',
      operators: [],
      sortable: false,
      showInTable: true,
      source: 'is_underground',
    },
    {
      field: 'num_floors_underground',
      label: 'Underground floors',
      valueType: 'number',
      operators: [],
      sortable: true,
      showInTable: true,
      source: 'num_floors_underground',
    },
    {
      field: 'min_height',
      label: 'Min height',
      valueType: 'number',
      operators: [],
      sortable: true,
      showInTable: true,
      source: 'min_height',
      unit: 'm',
    },
    {
      field: 'min_floor',
      label: 'Min floor',
      valueType: 'number',
      operators: [],
      sortable: true,
      showInTable: true,
      source: 'min_floor',
    },
    {
      field: 'level',
      label: 'Level',
      valueType: 'number',
      operators: [],
      sortable: true,
      showInTable: true,
      source: 'level',
    },
    {
      field: 'facade_color',
      label: 'Facade color',
      valueType: 'string',
      operators: [],
      sortable: false,
      showInTable: true,
      source: 'facade_color',
    },
    {
      field: 'facade_material',
      label: 'Facade material',
      valueType: 'string',
      operators: [],
      sortable: false,
      showInTable: true,
      source: 'facade_material',
    },
    {
      field: 'roof_material',
      label: 'Roof material',
      valueType: 'string',
      operators: [],
      sortable: false,
      showInTable: true,
      source: 'roof_material',
    },
    {
      field: 'roof_shape',
      label: 'Roof shape',
      valueType: 'string',
      operators: [],
      sortable: false,
      showInTable: true,
      source: 'roof_shape',
    },
    {
      field: 'roof_direction',
      label: 'Roof direction',
      valueType: 'number',
      operators: [],
      sortable: true,
      showInTable: true,
      source: 'roof_direction',
    },
    {
      field: 'roof_color',
      label: 'Roof color',
      valueType: 'string',
      operators: [],
      sortable: false,
      showInTable: true,
      source: 'roof_color',
    },
    {
      field: 'release_version',
      label: 'Snapshot',
      valueType: 'string',
      operators: [],
      sortable: true,
      showInTable: true,
      source: 'release_version',
    },
    {
      field: 'snapshot_date',
      label: 'Snapshot date',
      valueType: 'string',
      operators: [],
      sortable: true,
      showInTable: true,
      source: 'YYYY-MM-DD prefix of release_version',
    },
    {
      field: 'sources',
      label: 'Sources',
      valueType: 'string',
      operators: [],
      sortable: false,
      showInTable: true,
      source: 'sources (Overture property, dataset, record_id, update_time)',
    },
    {
      field: 'attribution',
      label: 'Attribution',
      valueType: 'string',
      operators: [],
      sortable: false,
      showInTable: true,
      source: 'Derived from sources[].dataset and /licenses terms',
    },
    {
      field: 'geometry',
      label: 'Geometry',
      valueType: 'string',
      operators: [],
      sortable: false,
      showInTable: false,
      source: 'geometry (Polygon or MultiPolygon)',
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
    {
      field: 'unit',
      label: 'Unit',
      valueType: 'string',
      operators: ['contains'],
      sortable: true,
      showInTable: true,
      source: 'unit',
    },
    {
      field: 'postal_city',
      label: 'Postal city',
      valueType: 'string',
      operators: ['contains'],
      sortable: true,
      showInTable: true,
      source: 'postal_city',
    },
    {
      field: 'building_id',
      label: 'Building id',
      valueType: 'string',
      operators: [],
      sortable: false,
      showInTable: true,
      source: 'Computed: nearest building GERS id',
    },
    {
      field: 'country',
      label: 'Country',
      valueType: 'string',
      operators: [],
      sortable: true,
      showInTable: true,
      source: 'country',
    },
    {
      field: 'release_version',
      label: 'Snapshot',
      valueType: 'string',
      operators: [],
      sortable: true,
      showInTable: true,
      source: 'release_version',
    },
    {
      field: 'snapshot_date',
      label: 'Snapshot date',
      valueType: 'string',
      operators: [],
      sortable: true,
      showInTable: true,
      source: 'YYYY-MM-DD prefix of release_version',
    },
    {
      field: 'sources',
      label: 'Sources',
      valueType: 'string',
      operators: [],
      sortable: false,
      showInTable: true,
      source: 'sources (Overture property, dataset, record_id, update_time)',
    },
    {
      field: 'attribution',
      label: 'Attribution',
      valueType: 'string',
      operators: [],
      sortable: false,
      showInTable: true,
      source: 'Derived from sources[].dataset and /licenses terms',
    },
    {
      field: 'geometry',
      label: 'Geometry',
      valueType: 'string',
      operators: [],
      sortable: false,
      showInTable: false,
      source: 'geometry (Point)',
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
    blurb: 'Named destinations with category, contact, nested address, and a point geometry.',
  },
  buildings: {
    title: 'Buildings',
    singular: 'building',
    plural: 'buildings',
    blurb: 'Building footprints with subtype, class, height, and roof or facade attributes when those values exist.',
  },
  addresses: {
    title: 'Addresses',
    singular: 'address',
    plural: 'addresses',
    blurb: 'Point addresses with street, unit, postal city, US address levels, and postal code.',
  },
}

export function defaultSort(dataset: DatasetId): { field: string; direction: 'asc' | 'desc' } {
  if (dataset === 'buildings') return { field: 'height', direction: 'desc' }
  if (dataset === 'addresses') return { field: 'street', direction: 'asc' }
  return { field: 'names.primary', direction: 'asc' }
}
