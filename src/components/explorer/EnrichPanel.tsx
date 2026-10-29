import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { asGeometry, type GeoJsonPosition } from '../../lib/geojson'
import { HAIL_MESH_START, MAX_GEOFENCE_VERTICES } from '../../lib/limits'
import { addDay, closedRing } from '../../lib/enrichments'
import { formatCount } from '../../lib/format'
import { draftAgentAssist, quoteAgentAssist } from '../../services/agent-assist'
import { enrichHail } from '../../services/query-workflows'
import { useExplorer } from '../../store/explorer-store'
import type { GeofenceKeep, GeofencePolygon, WorkflowEnrichment } from '../../types/enrichments'

export function EnrichPanel() {
  const open = useExplorer((state) => state.enrichOpen)
  const setOpen = useExplorer((state) => state.setEnrichOpen)
  const selected = useExplorer((state) => state.selectedCells)
  const summaries = useExplorer((state) => state.hailSummaries)
  const setSummaries = useExplorer((state) => state.setHailSummaries)
  const drawMode = useExplorer((state) => state.drawMode)
  const setDrawMode = useExplorer((state) => state.setDrawMode)
  const geofenceDraft = useExplorer((state) => state.geofenceDraft)
  const closeGeofence = useExplorer((state) => state.closeGeofence)
  const undoGeofenceVertex = useExplorer((state) => state.undoGeofenceVertex)
  const clearGeofenceDraft = useExplorer((state) => state.clearGeofenceDraft)
  const upsert = useExplorer((state) => state.upsertDraftEnrichment)
  const draft = useExplorer((state) => state.draftEnrichments)
  const defaults = useMemo(() => defaultHailRange(), [])
  const [start, setStart] = useState(defaults.start)
  const [end, setEnd] = useState(defaults.end)
  const [keep, setKeep] = useState<GeofenceKeep>('inside')
  const [aiColumn, setAiColumn] = useState('broker_signal')
  const [aiType, setAiType] = useState<'bool' | 'enum' | 'number' | 'text'>('bool')
  const [aiPrompt, setAiPrompt] = useState('Is this record likely relevant to a data broker lead list?')
  const [aiFields, setAiFields] = useState('name, category, main_category, address, operating_status')
  const [aiEnumValues, setAiEnumValues] = useState('low, medium, high')
  const [aiError, setAiError] = useState<string | null>(null)
  const [agentPrompt, setAgentPrompt] = useState(
    'Find places likely to be broker-ready leads, use the latest 30 days of hail, and set a useful AI column.',
  )
  const [polygonText, setPolygonText] = useState('')
  const [polygonError, setPolygonError] = useState<string | null>(null)

  const hail = useMutation({
    mutationFn: () => enrichHail({ h3_cells: selected, start_date: start, end_date: end }),
    onSuccess: (result) => {
      setSummaries(result.cells)
      upsert({ id: 'hail_history', kind: 'hail_history', start_date: result.start_date, end_date: result.end_date })
    },
  })
  const assistBuild = useMutation({
    mutationFn: (prompt?: string) =>
      draftAgentAssist({
        h3_cells: selected,
        enrichments: draft,
        estimated_rows: selected.length * 22,
        prompt: prompt && prompt.trim().length > 0 ? prompt : undefined,
      }),
    onSuccess: (result) => {
      useExplorer.getState().applyAgentQuery({
        h3_cells: result.h3_cells,
        filters: result.filters,
        sql: result.sql,
        enrichments: result.enrichments,
        notes: result.notes,
      })
    },
  })
  const draftSignature = useMemo(() => JSON.stringify(draft), [draft])
  const assistQuote = useQuery({
    queryKey: ['agent-assist-quote', selected.join(','), draftSignature],
    enabled: open && selected.length > 0,
    queryFn: () => quoteAgentAssist({ h3_cells: selected, enrichments: draft, estimated_rows: selected.length * 22 }),
    refetchInterval: 1_500,
  })

  useEffect(() => {
    const geofence = draft.find((step): step is Extract<WorkflowEnrichment, { kind: 'geofence' }> => step.kind === 'geofence')
    if (geofence) setKeep(geofence.keep)
    const hailDraft = draft.find((step): step is Extract<WorkflowEnrichment, { kind: 'hail_history' }> => step.kind === 'hail_history')
    if (hailDraft) {
      setStart(hailDraft.start_date)
      setEnd(hailDraft.end_date)
    }
    const aiDraft = draft.find((step): step is Extract<WorkflowEnrichment, { kind: 'ai_column' }> => step.kind === 'ai_column')
    if (aiDraft) {
      setAiColumn(aiDraft.column)
      setAiType(aiDraft.value_type)
      setAiPrompt(aiDraft.prompt)
      setAiFields(aiDraft.source_fields.join(', '))
      setAiEnumValues((aiDraft.enum_values ?? []).join(', '))
    }
  }, [draft])

  const saveAi = () => {
    setAiError(null)
    const column = aiColumn.trim().toLowerCase()
    if (!/^[a-z][a-z0-9_]{1,63}$/.test(column)) {
      setAiError('Column must be snake_case, start with a letter, and stay under 64 chars.')
      return
    }
    const prompt = aiPrompt.trim()
    if (prompt.length < 6) {
      setAiError('Prompt must be at least 6 characters.')
      return
    }
    const sourceFields = [...new Set(aiFields.split(/[\s,]+/g).map((field) => field.trim()).filter(Boolean))]
    if (sourceFields.length === 0) {
      setAiError('Add at least one source field.')
      return
    }
    const enumValues = [...new Set(aiEnumValues.split(/[\n,]+/g).map((value) => value.trim()).filter(Boolean))]
    if (aiType === 'enum' && enumValues.length < 2) {
      setAiError('Enum type needs at least two values.')
      return
    }
    upsert({
      id: 'ai_column',
      kind: 'ai_column',
      column,
      value_type: aiType,
      prompt,
      source_fields: sourceFields,
      ...(aiType === 'enum' ? { enum_values: enumValues } : {}),
    })
  }

  const applyPolygonInput = (raw: string) => {
    setPolygonError(null)
    const parsed = parsePolygonText(raw)
    if (!parsed) {
      setPolygonError('Provide a Polygon GeoJSON, Feature, FeatureCollection, WKT POLYGON, or a list of [lng,lat] points.')
      return
    }
    const firstRing = parsed.coordinates[0] ?? []
    if (firstRing.length > MAX_GEOFENCE_VERTICES + 1) {
      setPolygonError(`Polygon is limited to ${MAX_GEOFENCE_VERTICES} vertices.`)
      return
    }
    upsert({ id: 'geofence', kind: 'geofence', keep, polygon: parsed })
    clearGeofenceDraft()
    useExplorer.getState().setNotice(`Geofence loaded · ${firstRing.length - 1} vertices · keep ${keep}`)
  }

  const loadPolygonFile = async (file: File) => {
    setPolygonError(null)
    try {
      const text = await file.text()
      setPolygonText(text)
      applyPolygonInput(text)
    } catch {
      setPolygonError('Could not read that polygon file.')
    }
  }

  if (!open) return null

  return (
    <section
      data-testid="enrich-panel"
      className="glass pointer-events-auto absolute right-2 bottom-2 left-2 z-30 flex max-h-[calc(100vh-1rem)] w-auto flex-col overflow-hidden rounded-2xl sm:right-3 sm:bottom-20 sm:left-auto sm:w-[min(30rem,calc(100vw-1.5rem))] sm:max-h-[calc(100vh-6rem)]"
    >
      <header className="flex items-center justify-between gap-2 px-3.5 py-2.5">
        <div>
          <p className="text-[10px] font-medium tracking-[0.16em] text-primary uppercase">Enrich</p>
          <p className="text-[11px] text-muted-foreground">{formatCount(selected.length)} hexes · private to this account</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="h-7 rounded-full bg-white/[0.06] px-2.5 text-[11px] hover:bg-primary/15 hover:text-primary"
        >
          Close
        </button>
      </header>
      <div className="grid gap-3 overflow-y-auto px-3.5 pb-3.5">
        <section className="rounded-xl border border-primary/20 bg-black/25 p-2.5">
          <p className="text-[11px] font-medium">Agent chat</p>
          <p className="mt-1 text-[10px] text-muted-foreground">
            Describe what you want. The agent builds the inspect query and all enrichments into these controls.
          </p>
          <label className="mt-2 grid gap-1 text-[10px] text-muted-foreground">
            Prompt
            <textarea
              value={agentPrompt}
              onChange={(event) => setAgentPrompt(event.target.value)}
              className="min-h-16 rounded-md border border-white/[0.08] bg-black/40 px-2 py-1.5 text-[11px] text-foreground"
              placeholder="Example: show buildings with strict confidence and 90 days of hail, then score lead quality from 0 to 100."
            />
          </label>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              disabled={selected.length === 0 || assistBuild.isPending}
              onClick={() => assistBuild.mutate(agentPrompt)}
              className="h-7 rounded-full bg-primary px-3 text-[11px] font-medium text-primary-foreground disabled:opacity-40"
            >
              {assistBuild.isPending ? 'Building…' : 'Build from chat'}
            </button>
            <button
              type="button"
              disabled={selected.length === 0 || assistBuild.isPending}
              onClick={() => assistBuild.mutate()}
              className="h-7 rounded-full bg-primary/15 px-3 text-[11px] font-medium text-primary hover:bg-primary/25 disabled:opacity-40"
            >
              Default build
            </button>
            <span className="text-[10px] text-muted-foreground">
              {assistQuote.isFetching ? 'Updating quote…' : 'Quote updates live'}
            </span>
          </div>
          {assistBuild.error && <p className="mt-1 text-[11px] text-destructive">{assistBuild.error.message}</p>}
          {assistQuote.error && <p className="mt-1 text-[11px] text-destructive">{assistQuote.error.message}</p>}
          {assistQuote.data && (
            <div className="mt-2 rounded-md border border-white/[0.08] bg-black/30 p-2">
              <p className="text-[10px] text-muted-foreground">
                Total {formatUsd(assistQuote.data.total_usd_cents)} · Balance {formatUsd(assistQuote.data.balance_usd_cents)}
                {assistQuote.data.missing_hexes.length > 0
                  ? ` · process ${assistQuote.data.missing_hexes.length} missing hexes in ${assistQuote.data.process_batches.length} batch(es)`
                  : ' · no missing hexes'}
              </p>
              <ul className="mt-1 grid gap-0.5 text-[10px] text-foreground/85">
                {assistQuote.data.lines.map((line) => (
                  <li key={line.agent}>
                    {line.agent} {formatUsd(line.clamped_usd_cents)} · {line.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="rounded-xl border border-primary/20 bg-black/25 p-2.5">
          <p className="text-[11px] font-medium">Geofence</p>
          <p className="mt-1 text-[10px] text-muted-foreground">
            Draw on the map, upload a file, or paste polygon text. Keep rows inside or outside it when the workflow runs.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setDrawMode(drawMode === 'geofence' ? 'off' : 'geofence')}
              className="h-7 rounded-full bg-primary/15 px-2.5 text-[11px] text-primary hover:bg-primary/25"
            >
              {drawMode === 'geofence' ? 'Drawing…' : 'Draw fence'}
            </button>
            <select
              value={keep}
              onChange={(event) => setKeep(event.target.value as GeofenceKeep)}
              className="h-7 rounded-full border border-white/[0.08] bg-black/40 px-2 text-[11px]"
            >
              <option value="inside">Keep inside</option>
              <option value="outside">Keep outside</option>
            </select>
            <button type="button" onClick={undoGeofenceVertex} className="h-7 rounded-full px-2 text-[11px] text-muted-foreground hover:text-foreground">
              Undo
            </button>
            <button
              type="button"
              onClick={() => closeGeofence(keep)}
              className="h-7 rounded-full bg-primary px-2.5 text-[11px] text-primary-foreground"
            >
              Save fence
            </button>
            <button type="button" onClick={clearGeofenceDraft} className="h-7 rounded-full px-2 text-[11px] text-muted-foreground">
              Clear
            </button>
          </div>
          <label className="mt-2 grid gap-1 text-[10px] text-muted-foreground">
            Upload polygon (.geojson, .json, .txt)
            <input
              type="file"
              accept=".geojson,.json,.txt,application/geo+json,application/json,text/plain"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void loadPolygonFile(file)
                event.currentTarget.value = ''
              }}
              className="rounded-md border border-white/[0.08] bg-black/40 px-2 py-1.5 text-[11px] text-foreground file:mr-2 file:rounded file:border-0 file:bg-primary/20 file:px-2 file:py-1 file:text-[11px] file:text-primary"
            />
          </label>
          <label className="mt-2 grid gap-1 text-[10px] text-muted-foreground">
            Polygon text (GeoJSON / Feature / FeatureCollection / WKT POLYGON / [[lng,lat],...])
            <textarea
              value={polygonText}
              onChange={(event) => setPolygonText(event.target.value)}
              className="min-h-20 rounded-md border border-white/[0.08] bg-black/40 px-2 py-1.5 text-[11px] text-foreground"
              placeholder='{"type":"Polygon","coordinates":[[[-97.75,30.27],[-97.72,30.27],[-97.72,30.24],[-97.75,30.24],[-97.75,30.27]]]}'
            />
          </label>
          <button
            type="button"
            onClick={() => applyPolygonInput(polygonText)}
            className="mt-2 h-7 rounded-full bg-primary px-3 text-[11px] font-medium text-primary-foreground"
          >
            Apply polygon text
          </button>
          {polygonError && <p className="mt-1.5 text-[11px] text-destructive">{polygonError}</p>}
          <p className="mt-1.5 font-mono text-[10px] text-muted-foreground">
            {geofenceDraft.length} vertices
            {draft.some((step) => step.kind === 'geofence') ? ' · fence on workflow' : ''}
          </p>
        </section>

        <section className="rounded-xl border border-primary/20 bg-black/25 p-2.5">
          <p className="text-[11px] font-medium">Hail history</p>
          <p className="mt-1 text-[10px] text-muted-foreground">
            NOAA MRMS MESH 24h max, 12Z file only, from {HAIL_MESH_START}. Temp GRIB is discarded; only hex-day mm stays.
          </p>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            <label className="grid gap-1 text-[10px] text-muted-foreground">
              Start
              <input
                type="date"
                min={HAIL_MESH_START}
                value={start}
                onChange={(event) => setStart(event.target.value)}
                className="h-7 rounded-md border border-white/[0.08] bg-black/40 px-2 text-[11px] text-foreground"
              />
            </label>
            <label className="grid gap-1 text-[10px] text-muted-foreground">
              End
              <input
                type="date"
                min={HAIL_MESH_START}
                value={end}
                onChange={(event) => setEnd(event.target.value)}
                className="h-7 rounded-md border border-white/[0.08] bg-black/40 px-2 text-[11px] text-foreground"
              />
            </label>
          </div>
          <button
            type="button"
            disabled={selected.length === 0 || hail.isPending}
            onClick={() => hail.mutate()}
            className="mt-2 h-7 rounded-full bg-primary px-3 text-[11px] font-medium text-primary-foreground disabled:opacity-40"
          >
            {hail.isPending ? 'Enriching…' : 'Run hail enrich'}
          </button>
          {hail.error && <p className="mt-1.5 text-[11px] text-destructive">{hail.error.message}</p>}
        </section>

        <section className="rounded-xl border border-primary/20 bg-black/25 p-2.5">
          <p className="text-[11px] font-medium">AI row column</p>
          <p className="mt-1 text-[10px] text-muted-foreground">
            Adds one typed run-only column per row. The orchestrator quotes per-row cost and caps this pass for demo
            safety.
          </p>
          <div className="mt-2 grid gap-1.5">
            <label className="grid gap-1 text-[10px] text-muted-foreground">
              Column name (snake_case)
              <input
                value={aiColumn}
                onChange={(event) => setAiColumn(event.target.value)}
                className="h-7 rounded-md border border-white/[0.08] bg-black/40 px-2 text-[11px] text-foreground"
              />
            </label>
            <label className="grid gap-1 text-[10px] text-muted-foreground">
              Value type
              <select
                value={aiType}
                onChange={(event) => setAiType(event.target.value as 'bool' | 'enum' | 'number' | 'text')}
                className="h-7 rounded-md border border-white/[0.08] bg-black/40 px-2 text-[11px] text-foreground"
              >
                <option value="bool">bool</option>
                <option value="enum">enum</option>
                <option value="number">number</option>
                <option value="text">text</option>
              </select>
            </label>
            <label className="grid gap-1 text-[10px] text-muted-foreground">
              Prompt
              <textarea
                value={aiPrompt}
                onChange={(event) => setAiPrompt(event.target.value)}
                className="min-h-16 rounded-md border border-white/[0.08] bg-black/40 px-2 py-1.5 text-[11px] text-foreground"
              />
            </label>
            <label className="grid gap-1 text-[10px] text-muted-foreground">
              Source fields (comma or space separated)
              <input
                value={aiFields}
                onChange={(event) => setAiFields(event.target.value)}
                className="h-7 rounded-md border border-white/[0.08] bg-black/40 px-2 text-[11px] text-foreground"
              />
            </label>
            {aiType === 'enum' && (
              <label className="grid gap-1 text-[10px] text-muted-foreground">
                Enum values
                <input
                  value={aiEnumValues}
                  onChange={(event) => setAiEnumValues(event.target.value)}
                  className="h-7 rounded-md border border-white/[0.08] bg-black/40 px-2 text-[11px] text-foreground"
                />
              </label>
            )}
            <button
              type="button"
              onClick={saveAi}
              className="mt-1 h-7 rounded-full bg-primary px-3 text-[11px] font-medium text-primary-foreground"
            >
              Save AI column
            </button>
            {aiError && <p className="text-[11px] text-destructive">{aiError}</p>}
            <p className="font-mono text-[10px] text-muted-foreground">
              {draft.some((step) => step.kind === 'ai_column') ? 'ai_column on workflow' : 'no ai_column saved'}
            </p>
          </div>
        </section>

        {summaries.length > 0 && (
          <div className="max-h-40 overflow-auto rounded-lg border border-white/[0.08]">
            <table className="w-full text-left text-[11px]">
              <thead className="sticky top-0 bg-[#0a1017] text-muted-foreground">
                <tr>
                  <th className="px-2 py-1 font-medium">Hex</th>
                  <th className="px-2 py-1 text-right font-medium">Max mm</th>
                  <th className="px-2 py-1 text-right font-medium">Days</th>
                  <th className="px-2 py-1 font-medium">Last</th>
                </tr>
              </thead>
              <tbody>
                {summaries.map((row) => (
                  <tr key={row.h3} className="border-t border-white/[0.04]">
                    <td className="px-2 py-1 font-mono">{row.h3}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{row.hail_mm_max ?? '—'}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{row.hail_days}</td>
                    <td className="px-2 py-1">{row.hail_last_date ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}

function defaultHailRange() {
  const end = new Date().toISOString().slice(0, 10)
  const start = addDay(end, -29)
  return { start: start < HAIL_MESH_START ? HAIL_MESH_START : start, end }
}

function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function parsePolygonText(raw: string): GeofencePolygon | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const asJson = parsePolygonJson(trimmed)
  if (asJson) return asJson
  return parsePolygonWkt(trimmed)
}

function parsePolygonJson(raw: string): GeofencePolygon | null {
  try {
    return polygonFromValue(JSON.parse(raw) as unknown)
  } catch {
    return null
  }
}

function polygonFromValue(value: unknown): GeofencePolygon | null {
  const geometry = asGeometry(value)
  if (geometry?.type === 'Polygon') return normalizePolygon(geometry.coordinates)
  if (geometry?.type === 'MultiPolygon') return normalizePolygon(geometry.coordinates[0] ?? [])
  if (!isRecord(value)) return null
  if (value.type === 'Feature' && value.geometry) return polygonFromValue(value.geometry)
  if (value.type === 'FeatureCollection' && Array.isArray(value.features)) {
    for (const feature of value.features) {
      const polygon = polygonFromValue(feature)
      if (polygon) return polygon
    }
    return null
  }
  if (Array.isArray(value) && value.every(isPosition)) return normalizePolygon([value])
  if (Array.isArray(value) && value.every((item) => Array.isArray(item) && item.every(isPosition))) {
    return normalizePolygon(value as GeoJsonPosition[][])
  }
  return null
}

function parsePolygonWkt(raw: string): GeofencePolygon | null {
  const normalized = raw.replace(/\s+/g, ' ').trim()
  if (!/^polygon\s*\(\(/i.test(normalized) || !/\)\)$/.test(normalized)) return null
  const body = normalized.replace(/^polygon\s*\(\(/i, '').replace(/\)\)\s*$/i, '')
  const rings: GeoJsonPosition[][] = []
  for (const ringText of body.split(/\)\s*,\s*\(/)) {
    const ring: GeoJsonPosition[] = []
    for (const pair of ringText.split(',')) {
      const parts = pair.trim().split(/\s+/)
      if (parts.length < 2) return null
      const lng = Number(parts[0])
      const lat = Number(parts[1])
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null
      ring.push([lng, lat])
    }
    rings.push(ring)
  }
  return normalizePolygon(rings)
}

function normalizePolygon(rings: GeoJsonPosition[][]): GeofencePolygon | null {
  if (rings.length === 0) return null
  const closed = rings.map((ring) => closedRing(ring))
  if (closed.some((ring) => !ring)) return null
  return { type: 'Polygon', coordinates: closed as GeoJsonPosition[][] }
}

function isPosition(value: unknown): value is GeoJsonPosition {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === 'number' &&
    Number.isFinite(value[0]) &&
    typeof value[1] === 'number' &&
    Number.isFinite(value[1])
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
