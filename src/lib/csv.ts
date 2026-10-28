import type { FeatureRow } from './feature-rows'
import type { ResultColumn } from '../types/datasets'
import type { ResultRow } from '../types/queries'

export const FEATURE_CSV_COLUMNS = [
  { field: 'kind', label: 'Theme' },
  { field: 'snapshot', label: 'Snapshot' },
  { field: 'snapshot_date', label: 'Snapshot date' },
  { field: 'name', label: 'Place' },
  { field: 'category', label: 'Category' },
  { field: 'main_category', label: 'Main category' },
  { field: 'taxonomy', label: 'Taxonomy' },
  { field: 'operating_status', label: 'Status' },
  { field: 'confidence', label: 'Confidence' },
  { field: 'address', label: 'Address' },
  { field: 'unit', label: 'Unit' },
  { field: 'locality', label: 'Locality' },
  { field: 'region', label: 'Region' },
  { field: 'postcode', label: 'Postcode' },
  { field: 'postal_city', label: 'Postal city' },
  { field: 'country', label: 'Country' },
  { field: 'building', label: 'Building' },
  { field: 'building_class', label: 'Building class' },
  { field: 'height', label: 'Height m' },
  { field: 'floors', label: 'Floors' },
  { field: 'min_height', label: 'Min height' },
  { field: 'min_floor', label: 'Min floor' },
  { field: 'level', label: 'Level' },
  { field: 'underground_floors', label: 'Und. floors' },
  { field: 'has_parts', label: 'Has parts' },
  { field: 'is_underground', label: 'Underground' },
  { field: 'facade_material', label: 'Facade' },
  { field: 'facade_color', label: 'Facade color' },
  { field: 'roof_shape', label: 'Roof' },
  { field: 'roof_material', label: 'Roof material' },
  { field: 'roof_color', label: 'Roof color' },
  { field: 'roof_direction', label: 'Roof dir.' },
  { field: 'phones', label: 'Phones' },
  { field: 'websites', label: 'Websites' },
  { field: 'socials', label: 'Socials' },
  { field: 'emails', label: 'Emails' },
  { field: 'brand', label: 'Brand' },
  { field: 'official_id', label: 'Official id' },
  { field: 'brand_wikidata', label: 'Brand Wikidata' },
  { field: 'place_addresses', label: 'Nested addresses' },
  { field: 'sources', label: 'Sources' },
  { field: 'attribution', label: 'Attribution' },
  { field: 'building_id', label: 'Building id' },
  { field: 'address_id', label: 'Address id' },
  { field: 'id', label: 'Id' },
  { field: 'h3', label: 'H3' },
  { field: 'hail_mm_max', label: 'Hail mm max' },
  { field: 'hail_days', label: 'Hail days' },
  { field: 'hail_last_date', label: 'Hail last date' },
  { field: 'lat', label: 'Lat' },
  { field: 'lng', label: 'Lng' },
] as const satisfies readonly { field: keyof FeatureRow; label: string }[]

export function featureRowsToCsv(rows: readonly FeatureRow[]): string {
  const aiColumns = [...new Set(rows.flatMap((row) => Object.keys(row.ai_columns)))].sort((left, right) =>
    left.localeCompare(right),
  )
  const header = [...FEATURE_CSV_COLUMNS.map((column) => csvEscape(column.label)), ...aiColumns.map(csvEscape)].join(',')
  const lines = rows.map((row) =>
    [
      ...FEATURE_CSV_COLUMNS.map((column) => {
        const value = row[column.field]
        if (value == null) return ''
        if (column.field === 'lat' || column.field === 'lng') return csvEscape((value as number).toFixed(5))
        return csvEscape(String(value))
      }),
      ...aiColumns.map((field) => {
        const value = row.ai_columns[field]
        return value == null ? '' : csvEscape(String(value))
      }),
    ].join(','),
  )
  return `\uFEFF${[header, ...lines].join('\r\n')}`
}

export function rowsToCsv(columns: readonly ResultColumn[], rows: readonly ResultRow[]): string {
  const header = columns.map((column) => csvEscape(column.label)).join(',')
  const lines = rows.map((row) =>
    columns
      .map((column) => {
        const value = column.source === 'h3' ? row.h3 : row.values[column.field]
        return csvEscape(value == null ? '' : String(value))
      })
      .join(','),
  )
  return `\uFEFF${[header, ...lines].join('\r\n')}`
}

function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`
  return value
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
