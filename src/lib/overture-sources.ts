export type OvertureSource = {
  property: string | null
  dataset: string | null
  record_id: string | null
  update_time: string | null
  confidence: number | null
}

export function asSources(value: unknown): OvertureSource[] {
  if (typeof value === 'string') {
    try {
      return asSources(JSON.parse(value) as unknown)
    } catch {
      return []
    }
  }
  if (!Array.isArray(value)) return []
  const sources: OvertureSource[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const row = entry as Record<string, unknown>
    sources.push({
      property: asOptionalString(row.property),
      dataset: asOptionalString(row.dataset),
      record_id: asOptionalString(row.record_id),
      update_time: asOptionalString(row.update_time),
      confidence: asOptionalNumber(row.confidence),
    })
  }
  return sources
}

export function sourceDatasets(sources: readonly OvertureSource[]): string[] {
  const seen = new Set<string>()
  const names: string[] = []
  for (const source of sources) {
    const name = source.dataset?.trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }
  return names
}

export function mergeSourceDatasets(...groups: readonly (readonly string[])[]): string[] {
  const seen = new Set<string>()
  const names: string[] = []
  for (const group of groups) {
    for (const name of group) {
      const next = name.trim()
      if (!next || seen.has(next)) continue
      seen.add(next)
      names.push(next)
    }
  }
  return names
}

/** Compact Overture `sources` for a table cell: dataset, property, record, time. */
export function formatSources(sources: readonly OvertureSource[]): string | null {
  const parts = sources
    .map((source) =>
      [source.dataset, source.property, source.record_id, source.update_time].filter((part): part is string => Boolean(part)).join(' · '),
    )
    .filter((part) => part.length > 0)
  return parts.length > 0 ? parts.join('; ') : null
}

/**
 * License-facing attribution from Overture `sources[].dataset`.
 * Unknown datasets stay as the dataset name. Terms live on /licenses.
 */
export function formatAttribution(sources: readonly OvertureSource[]): string | null {
  const parts = sourceDatasets(sources).map((name) => {
    const license = ATTRIBUTION_BY_DATASET[name.toLowerCase()]
    return license ? `${name} (${license})` : name
  })
  return parts.length > 0 ? parts.join('; ') : null
}

const ATTRIBUTION_BY_DATASET: Record<string, string> = {
  meta: 'CDLA Permissive 2.0',
  foursquare: 'Apache 2.0',
  'foursquare labs': 'Apache 2.0',
  openstreetmap: 'ODbL',
  osm: 'ODbL',
  microsoft: 'ODbL',
  'microsoft building footprints': 'ODbL',
  'national address database': 'NAD / US government work',
  nad: 'NAD / US government work',
}

function asOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const next = value.trim()
  return next.length > 0 ? next : null
}

function asOptionalNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const next = Number(value)
    return Number.isFinite(next) ? next : null
  }
  return null
}
