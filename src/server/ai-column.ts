import { createHash } from 'node:crypto'
import { AI_COLUMN_ROW_CAP } from './agent-marketplace'
import { serverEnv } from '../lib/server-env'
import type { AiColumnValue } from '../lib/feature-rows'
import type { FeatureRow } from '../lib/feature-rows'
import type { AiColumnEnrichment } from '../types/enrichments'

const aiCache = new Map<string, AiColumnValue>()

export type AiColumnResult = {
  rows: FeatureRow[]
  applied_rows: number
  warnings: string[]
  used_model: boolean
}

export async function applyAiColumnEnrichment(
  rows: readonly FeatureRow[],
  step: AiColumnEnrichment,
): Promise<AiColumnResult> {
  const limit = Math.max(1, Math.min(AI_COLUMN_ROW_CAP, intEnv('AI_COLUMN_ROW_CAP', AI_COLUMN_ROW_CAP)))
  const warnings: string[] = []
  const next = rows.map((row) => ({ ...row, ai_columns: { ...row.ai_columns } }))
  const candidates = next.slice(0, limit)
  const useModel = aiColumnApiKey().length > 0
  if (next.length > limit) {
    warnings.push(`ai_column limited to ${limit} rows in this run; ${next.length - limit} rows were set to null.`)
  }
  for (const row of candidates) {
    const source = sourcePayload(row, step.source_fields)
    const cacheKey = `${step.column}:${step.value_type}:${hashInput(`${step.prompt}|${JSON.stringify(source)}|${JSON.stringify(step.enum_values ?? [])}`)}`
    let value: AiColumnValue
    if (aiCache.has(cacheKey)) {
      value = aiCache.get(cacheKey) ?? null
    } else {
      value = await inferValue(step, source)
      aiCache.set(cacheKey, value)
    }
    row.ai_columns[step.column] = value
  }
  for (const row of next.slice(limit)) {
    row.ai_columns[step.column] = null
  }
  return { rows: next, applied_rows: Math.min(next.length, limit), warnings, used_model: useModel }
}

async function inferValue(
  step: AiColumnEnrichment,
  source: Record<string, string | number | boolean | null>,
): Promise<AiColumnValue> {
  const key = aiColumnApiKey()
  if (!key) return deterministicValue(step, source)
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: serverEnv('OPENAI_AI_COLUMN_MODEL') || serverEnv('OPENAI_MODEL') || 'gpt-4o-mini',
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'Return only JSON with one key `value`. Keep it strictly typed to the requested value_type. Return null when uncertain.',
          },
          {
            role: 'user',
            content: JSON.stringify({
              value_type: step.value_type,
              column: step.column,
              prompt: step.prompt,
              enum_values: step.enum_values ?? [],
              source,
            }),
          },
        ],
      }),
    })
    if (!response.ok) return deterministicValue(step, source)
    const payload = (await response.json()) as unknown
    const content =
      isRecord(payload) &&
      Array.isArray(payload.choices) &&
      isRecord(payload.choices[0]) &&
      isRecord(payload.choices[0].message) &&
      typeof payload.choices[0].message.content === 'string'
        ? payload.choices[0].message.content
        : ''
    if (!content) return deterministicValue(step, source)
    const decoded = JSON.parse(content) as unknown
    const raw = isRecord(decoded) ? decoded.value : null
    return coerceValue(step, raw)
  } catch {
    return deterministicValue(step, source)
  }
}

function deterministicValue(
  step: AiColumnEnrichment,
  source: Record<string, string | number | boolean | null>,
): AiColumnValue {
  const text = `${step.prompt}|${JSON.stringify(source)}`
  const digest = createHash('sha256').update(text).digest()
  if (step.value_type === 'bool') return (digest[0] & 1) === 0
  if (step.value_type === 'enum') {
    const values = step.enum_values ?? []
    if (values.length === 0) return null
    return values[digest[0] % values.length] ?? null
  }
  if (step.value_type === 'number') return Math.round(((digest[0] / 255) * 1000 + digest[1]) * 10) / 10
  const tokens = Object.values(source)
    .map((value) => (value == null ? '' : String(value)))
    .join(' ')
    .trim()
  if (tokens.length === 0) return `ai_${hashInput(step.prompt).slice(0, 8)}`
  return tokens.slice(0, 180)
}

function coerceValue(step: AiColumnEnrichment, raw: unknown): AiColumnValue {
  if (raw == null) return null
  if (step.value_type === 'bool') {
    if (typeof raw === 'boolean') return raw
    if (typeof raw === 'string') {
      const lower = raw.trim().toLowerCase()
      if (lower === 'true') return true
      if (lower === 'false') return false
    }
    return null
  }
  if (step.value_type === 'enum') {
    if (typeof raw !== 'string') return null
    const values = step.enum_values ?? []
    return values.includes(raw) ? raw : null
  }
  if (step.value_type === 'number') {
    const number = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN
    return Number.isFinite(number) ? number : null
  }
  if (typeof raw !== 'string') return null
  const text = raw.trim()
  return text.length > 0 ? text.slice(0, 2000) : null
}

function sourcePayload(
  row: FeatureRow,
  fields: readonly string[],
): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {}
  for (const field of fields) {
    const fromColumns = row.ai_columns[field]
    if (fromColumns !== undefined) {
      out[field] = fromColumns
      continue
    }
    const key = field as keyof FeatureRow
    const value = row[key]
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value == null) {
      out[field] = value
    } else {
      out[field] = value == null ? null : JSON.stringify(value)
    }
  }
  return out
}

function hashInput(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function intEnv(name: string, fallback: number): number {
  const value = Number.parseInt(serverEnv(name), 10)
  if (!Number.isFinite(value) || value <= 0) return fallback
  return value
}

function aiColumnApiKey(): string {
  return serverEnv('OPENAI_AI_COLUMN_API_KEY') || serverEnv('OPENAI_API_KEY')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
