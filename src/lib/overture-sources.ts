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
