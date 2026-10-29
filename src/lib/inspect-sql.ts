import { MAX_INSPECT_SQL_LENGTH, MAX_QUERY_LIMIT } from './limits'
import { defaultInspectFilters, INSPECT_NOT_NULL, INSPECT_NULL, type InspectFilters, type PresenceFilter } from './feature-rows'
import { DATASET_IDS, type DatasetId } from '../types/datasets'

const ALLOWED_TABLES = new Set(['overture_places', 'overture_buildings', 'overture_addresses'])
const FORBIDDEN =
  /\b(insert|update|delete|drop|alter|create|grant|revoke|copy|truncate|call|do|execute|comment|vacuum|refresh|merge|lock|notify|listen|security|set\s+role|into|returning)\b/i

export const INSPECT_SQL_TABLES = ['overture_places', 'overture_buildings', 'overture_addresses'] as const

/** Readable SELECT that describes the inspect join and filters. */
export function compileInspectSql(
  cells: readonly string[],
  filters: InspectFilters = defaultInspectFilters,
  releaseVersion?: string | null,
): string {
  const hexes = [...new Set(cells)]
  const lines = [
    '-- ReadyHex inspect',
    '-- Places left-join linked addresses and buildings. Inspect also appends unmatched rows from the same hexes.',
    'SELECT',
    '  places.id,',
    '  places.release_version AS snapshot,',
    "  split_part(places.release_version, '.', 1) AS snapshot_date,",
    '  places.h3_res8 AS h3,',
    '  places.names_primary AS name,',
    '  places.basic_category AS category,',
    "  split_part(places.taxonomy_primary, '<', 1) AS main_category,",
    '  places.taxonomy_primary AS taxonomy,',
    '  places.operating_status,',
    '  places.confidence,',
    '  places.phones,',
    '  places.emails,',
    '  places.socials,',
    '  places.brand_wikidata AS official_id,',
    '  places.sources,',
    '  buildings.class AS building_class,',
    '  buildings.is_underground,',
    '  addresses.number,',
    '  addresses.street,',
    '  addresses.postcode',
    'FROM overture_places AS places',
    'LEFT JOIN overture_addresses AS addresses',
    '  ON addresses.id = places.address_id',
    ' AND addresses.release_version = places.release_version',
    'LEFT JOIN overture_buildings AS buildings',
    '  ON buildings.id = places.building_id',
    ' AND buildings.release_version = places.release_version',
  ]

  const where = compileWhere(hexes, filters, releaseVersion)
  if (where.length > 0) {
    lines.push('WHERE')
    where.forEach((clause, index) => {
      lines.push(index === 0 ? `  ${clause}` : `  AND ${clause}`)
    })
  }

  lines.push('ORDER BY places.names_primary ASC')
  lines.push(`LIMIT ${MAX_QUERY_LIMIT};`)
  return lines.join('\n')
}

export function validateInspectSql(sql: string): string | null {
  const trimmed = sql.trim()
  if (!trimmed) return 'SQL is required.'
  if (trimmed.length > MAX_INSPECT_SQL_LENGTH) return 'SQL is too long.'
  if (/--|\/\*|\*\//.test(trimmed)) return 'Comments are not allowed in custom SQL.'
  const statements = trimmed.split(';').map((part) => part.trim()).filter((part) => part.length > 0)
  if (statements.length !== 1) return 'Use a single SELECT statement.'
  const statement = statements[0]
  if (!/^\s*select\b/i.test(statement)) return 'Only SELECT is allowed.'
  if (FORBIDDEN.test(statement)) return 'That statement is not allowed.'
  const tables = [...statement.matchAll(/\b(?:from|join)\s+(?:public\.)?([a-z_][a-z0-9_]*)/gi)]
  if (tables.length === 0) return 'Query overture_places, overture_buildings, or overture_addresses.'
  for (const match of tables) {
    const name = match[1].toLowerCase()
    if (!ALLOWED_TABLES.has(name)) {
      return 'Only overture_places, overture_buildings, and overture_addresses may be queried.'
    }
  }
  return null
}

export function asInspectFilters(value: unknown): InspectFilters | null {
  if (!isRecord(value)) return null
  const kind = value.kind
  if (kind !== 'all' && !DATASET_IDS.includes(kind as DatasetId)) return null
  if (typeof value.search !== 'string') return null
  if (!isStringArray(value.categories) || !isStringArray(value.mainCategories) || !isStringArray(value.snapshotDates)) {
    return null
  }
  if (!isStringArray(value.statuses) || !isStringArray(value.buildingClasses)) return null
  if (!isNullableNumber(value.confidenceMin) || !isNullableNumber(value.confidenceMax)) return null
  if (!isPresence(value.underground) || !isPresence(value.hasPhone) || !isPresence(value.hasEmail)) return null
  if (!isPresence(value.hasSocials) || !isPresence(value.hasOfficialId)) return null
  const columnFilters = value.columnFilters === undefined ? {} : asColumnFilters(value.columnFilters)
  if (!columnFilters) return null
  return {
    kind: kind as DatasetId | 'all',
    search: value.search,
    categories: value.categories,
    mainCategories: value.mainCategories,
    snapshotDates: value.snapshotDates,
    statuses: value.statuses,
    buildingClasses: value.buildingClasses,
    columnFilters,
    confidenceMin: value.confidenceMin,
    confidenceMax: value.confidenceMax,
    confidencePresence: isPresence(value.confidencePresence) ? value.confidencePresence : 'any',
    underground: value.underground,
    hasPhone: value.hasPhone,
    hasEmail: value.hasEmail,
    hasSocials: value.hasSocials,
    hasOfficialId: value.hasOfficialId,
  }
}

function asColumnFilters(value: unknown): Record<string, string[]> | null {
  if (!isRecord(value)) return null
  const next: Record<string, string[]> = {}
  for (const [field, values] of Object.entries(value)) {
    if (!isStringArray(values)) return null
    if (values.length > 0) next[field] = values
  }
  return next
}

function compileWhere(cells: readonly string[], filters: InspectFilters, releaseVersion?: string | null): string[] {
  const clauses: string[] = []
  if (cells.length === 0) {
    clauses.push('false')
  } else {
    clauses.push(`places.h3_res8 IN (\n    ${cells.map(sqlString).join(',\n    ')}\n  )`)
  }
  if (releaseVersion) {
    clauses.push(`places.release_version = ${sqlString(releaseVersion)}`)
  }
  if (filters.kind !== 'all') {
    if (filters.kind === 'places') clauses.push('places.id IS NOT NULL')
    if (filters.kind === 'buildings') clauses.push('buildings.id IS NOT NULL')
    if (filters.kind === 'addresses') clauses.push('addresses.id IS NOT NULL')
  }
  const category = inOrNull('places.basic_category', filters.categories)
  if (category) clauses.push(category)
  const main = inOrNull("split_part(places.taxonomy_primary, '<', 1)", filters.mainCategories)
  if (main) clauses.push(main)
  const snapshot = inOrNull("split_part(places.release_version, '.', 1)", filters.snapshotDates)
  if (snapshot) clauses.push(snapshot)
  const status = inOrNull('places.operating_status', filters.statuses)
  if (status) clauses.push(status)
  const buildingClass = inOrNull('buildings.class', filters.buildingClasses)
  if (buildingClass) clauses.push(buildingClass)
  const confidence = confidenceSql(filters)
  if (confidence) clauses.push(confidence)
  const underground = presenceSql('buildings.is_underground', filters.underground)
  if (underground) clauses.push(underground)
  const phone = presenceSql('places.phones', filters.hasPhone)
  if (phone) clauses.push(phone)
  const email = presenceSql('places.emails', filters.hasEmail)
  if (email) clauses.push(email)
  const socials = presenceSql('places.socials', filters.hasSocials)
  if (socials) clauses.push(socials)
  const official = presenceSql('places.brand_wikidata', filters.hasOfficialId)
  if (official) clauses.push(official)
  const search = filters.search.trim()
  if (search) {
    const like = sqlString(`%${search}%`)
    clauses.push(
      `(places.names_primary ILIKE ${like} OR places.basic_category ILIKE ${like} OR places.taxonomy_primary ILIKE ${like} OR places.sources ILIKE ${like} OR addresses.street ILIKE ${like})`,
    )
  }
  for (const [field, values] of Object.entries(filters.columnFilters ?? {})) {
    if (NAMED_SQL_COLUMNS.has(field)) continue
    const column = COLUMN_SQL[field]
    if (!column) continue
    const clause = inOrNull(column, values)
    if (clause) clauses.push(clause)
  }
  return clauses
}

const NAMED_SQL_COLUMNS = new Set(['category', 'main_category', 'snapshot_date', 'operating_status', 'building_class', 'kind'])

const COLUMN_SQL: Record<string, string> = {
  snapshot: 'places.release_version',
  name: 'places.names_primary',
  taxonomy: 'places.taxonomy_primary',
  phones: 'places.phones',
  emails: 'places.emails',
  socials: 'places.socials',
  websites: 'places.websites',
  brand: 'places.brand_name',
  official_id: 'places.brand_wikidata',
  brand_wikidata: 'places.brand_wikidata',
  sources: 'places.sources',
  id: 'places.id',
  h3: 'places.h3_res8',
  building: 'buildings.names_primary',
  building_class: 'buildings.class',
  height: 'CAST(buildings.height AS text)',
  floors: 'CAST(buildings.num_floors AS text)',
  is_underground: 'CAST(buildings.is_underground AS text)',
  has_parts: 'CAST(buildings.has_parts AS text)',
  facade_material: 'buildings.facade_material',
  facade_color: 'buildings.facade_color',
  roof_shape: 'buildings.roof_shape',
  roof_material: 'buildings.roof_material',
  roof_color: 'buildings.roof_color',
  unit: 'addresses.unit',
  locality: 'addresses.locality',
  region: 'addresses.region',
  postcode: 'addresses.postcode',
  postal_city: 'addresses.postal_city',
  country: 'addresses.country',
}

function inOrNull(column: string, values: readonly string[]): string | null {
  if (values.length === 0) return null
  if (values.length === 1 && values[0] === INSPECT_NOT_NULL) {
    return `(${column} IS NOT NULL AND CAST(${column} AS text) <> '')`
  }
  const listed = values.filter((value) => value !== INSPECT_NULL)
  const allowNull = values.includes(INSPECT_NULL)
  const parts: string[] = []
  if (listed.length > 0) parts.push(`${column} IN (${listed.map(sqlString).join(', ')})`)
  if (allowNull) parts.push(`${column} IS NULL`)
  return parts.length === 1 ? parts[0] : `(${parts.join(' OR ')})`
}

function confidenceSql(filters: InspectFilters): string | null {
  const presence = filters.confidencePresence ?? 'any'
  if (presence === 'null' || presence === 'no') return 'places.confidence IS NULL'
  const parts: string[] = []
  if (filters.confidenceMin != null) parts.push(`places.confidence >= ${filters.confidenceMin}`)
  if (filters.confidenceMax != null) parts.push(`places.confidence <= ${filters.confidenceMax}`)
  if (presence === 'yes' || parts.length > 0) {
    parts.unshift('places.confidence IS NOT NULL')
    return parts.join(' AND ')
  }
  return null
}

function presenceSql(column: string, value: PresenceFilter): string | null {
  if (value === 'any') return null
  if (column.includes('is_underground')) {
    if (value === 'yes') return `${column} IS TRUE`
    if (value === 'null') return `${column} IS NULL`
    return `${column} IS FALSE`
  }
  if (value === 'yes') return `${column} IS NOT NULL AND ${column} <> ''`
  return `(${column} IS NULL OR ${column} = '')`
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value))
}

function isPresence(value: unknown): value is PresenceFilter {
  return value === 'any' || value === 'yes' || value === 'no' || value === 'null'
}
