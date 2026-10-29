import { useMutation, useQuery } from '@tanstack/react-query'
import { Cloud, CloudHail, Sparkles, Upload } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { HAIL_MESH_START, MAX_GEOFENCE_VERTICES } from '../../lib/limits'
import { addDay } from '../../lib/enrichments'
import { formatCount } from '../../lib/format'
import { parsePolygonText } from '../../lib/polygon-input'
import { cn } from '../../lib/utils'
import { quoteAgentAssist } from '../../services/agent-assist'
import { enrichHail } from '../../services/query-workflows'
import { useAgent } from '../../store/agent-store'
import { useExplorer } from '../../store/explorer-store'
import type { GeofenceKeep, WorkflowEnrichment } from '../../types/enrichments'

type AddonId = 'weather' | 'polygon' | 'ai'

const ADDONS: readonly { id: AddonId; label: string; hint: string; icon: typeof Cloud }[] = [
  { id: 'weather', label: 'Weather', hint: 'Hail and other weather layers', icon: Cloud },
  { id: 'polygon', label: 'Custom polygon', hint: 'Upload, paste, or draw a fence', icon: Upload },
  { id: 'ai', label: 'AI enhance', hint: 'Score or label each row with AI', icon: Sparkles },
]

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
  const remove = useExplorer((state) => state.removeDraftEnrichment)
  const draft = useExplorer((state) => state.draftEnrichments)
  const defaults = useMemo(() => defaultHailRange(), [])
  const [addon, setAddon] = useState<AddonId | null>(null)
  const [hailLayer, setHailLayer] = useState(false)
  const [start, setStart] = useState(defaults.start)
  const [end, setEnd] = useState(defaults.end)
  const [keep, setKeep] = useState<GeofenceKeep>('inside')
  const [aiColumn, setAiColumn] = useState('broker_signal')
  const [aiType, setAiType] = useState<'bool' | 'enum' | 'number' | 'text'>('bool')
  const [aiPrompt, setAiPrompt] = useState('Is this record likely relevant to a data broker lead list?')
  const [aiFields, setAiFields] = useState('name, category, main_category, address, operating_status')
  const [aiEnumValues, setAiEnumValues] = useState('low, medium, high')
  const [aiError, setAiError] = useState<string | null>(null)
  const [polygonText, setPolygonText] = useState('')
  const [polygonError, setPolygonError] = useState<string | null>(null)

  const hasHail = draft.some((step) => step.kind === 'hail_history')
  const hasFence = draft.some((step) => step.kind === 'geofence')
  const hasAi = draft.some((step) => step.kind === 'ai_column')

  const hail = useMutation({
    mutationFn: () => enrichHail({ h3_cells: selected, start_date: start, end_date: end }),
    onSuccess: (result) => {
      setSummaries(result.cells)
      upsert({ id: 'hail_history', kind: 'hail_history', start_date: result.start_date, end_date: result.end_date })
      setHailLayer(true)
    },
  })
  const draftSignature = useMemo(() => JSON.stringify(draft), [draft])
  const assistQuote = useQuery({
    queryKey: ['agent-assist-quote', selected.join(','), draftSignature],
    enabled: open && selected.length > 0,
    queryFn: () => quoteAgentAssist({ h3_cells: selected, enrichments: draft, estimated_rows: selected.length * 22 }),
    staleTime: 30_000,
  })

  useEffect(() => {
    const geofence = draft.find((step): step is Extract<WorkflowEnrichment, { kind: 'geofence' }> => step.kind === 'geofence')
    if (geofence) setKeep(geofence.keep)
    const hailDraft = draft.find((step): step is Extract<WorkflowEnrichment, { kind: 'hail_history' }> => step.kind === 'hail_history')
    if (hailDraft) {
      setStart(hailDraft.start_date)
      setEnd(hailDraft.end_date)
      setHailLayer(true)
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
    useExplorer.getState().setNotice(`Polygon loaded · ${firstRing.length - 1} vertices · keep ${keep}`)
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

  const toggleHailLayer = () => {
    if (hailLayer || hasHail) {
      setHailLayer(false)
      remove('hail_history')
      setSummaries([])
      return
    }
    setHailLayer(true)
  }

  if (!open) return null

  return (
    <section
      data-testid="enrich-panel"
      className="glass pointer-events-auto absolute right-2 bottom-2 left-2 z-30 flex max-h-[calc(100vh-1rem)] w-auto flex-col overflow-hidden rounded-2xl sm:right-3 sm:bottom-20 sm:left-auto sm:w-[min(30rem,calc(100vw-1.5rem))] sm:max-h-[calc(100vh-6rem)]"
    >
      <header className="flex items-center justify-between gap-2 px-3.5 py-2.5">
        <div>
          <p className="text-[10px] font-medium tracking-[0.16em] text-primary uppercase">Add-ons</p>
          <p className="text-[11px] text-muted-foreground">
            {formatCount(selected.length)} {selected.length === 1 ? 'hex' : 'hexes'} · optional layers on this query
          </p>
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
        <div className="grid grid-cols-3 gap-1.5">
          {ADDONS.map((item) => {
            const active =
              item.id === 'weather' ? hasHail : item.id === 'polygon' ? hasFence : hasAi
            const selectedAddon = addon === item.id
            const Icon = item.icon
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setAddon(selectedAddon ? null : item.id)}
                className={cn(
                  'grid gap-1 rounded-xl border px-2 py-2 text-left transition-colors',
                  selectedAddon
                    ? 'border-primary/50 bg-primary/15 text-foreground'
                    : 'border-white/[0.08] bg-black/25 text-muted-foreground hover:border-white/[0.16] hover:text-foreground',
                )}
              >
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-foreground">
                  <Icon className="size-3.5 shrink-0" />
                  {item.label}
                </span>
                <span className="text-[10px] leading-3.5">{item.hint}</span>
                {active && <span className="text-[10px] text-primary">On this query</span>}
              </button>
            )
          })}
        </div>

        {addon === 'weather' && (
          <section className="rounded-xl border border-primary/20 bg-black/25 p-2.5">
            <p className="text-[11px] font-medium">Weather</p>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Pick a weather layer. Hail is optional and is not added until you run it.
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <button
                type="button"
                aria-pressed={hailLayer || hasHail}
                onClick={toggleHailLayer}
                className={cn(
                  'inline-flex h-8 items-center gap-1 rounded-full border px-3 text-[11px] font-medium',
                  hailLayer || hasHail
                    ? 'border-select/45 bg-select/15 text-select'
                    : 'border-white/[0.1] bg-white/[0.03] text-muted-foreground hover:text-foreground',
                )}
              >
                <CloudHail className="size-3.5" />
                Hail
              </button>
            </div>
            {(hailLayer || hasHail) && (
              <div className="mt-2 grid gap-1.5">
                <p className="text-[10px] text-muted-foreground">
                  NOAA MRMS MESH 24h max, 12Z file only, from {HAIL_MESH_START}. Temp GRIB is discarded; only hex-day mm
                  stays.
                </p>
                <div className="grid grid-cols-2 gap-1.5">
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
                  className="mt-1 h-7 rounded-full bg-primary px-3 text-[11px] font-medium text-primary-foreground disabled:opacity-40"
                >
                  {hail.isPending ? 'Loading hail…' : 'Add hail to this query'}
                </button>
                {hail.error && <p className="text-[11px] text-destructive">{hail.error.message}</p>}
              </div>
            )}
          </section>
        )}

        {addon === 'polygon' && (
          <section className="rounded-xl border border-primary/20 bg-black/25 p-2.5">
            <p className="text-[11px] font-medium">Custom polygon</p>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Upload a file, paste GeoJSON or WKT, or draw on the map. Keep rows inside or outside it when the workflow
              runs.
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setDrawMode(drawMode === 'geofence' ? 'off' : 'geofence')}
                className="h-7 rounded-full bg-primary/15 px-2.5 text-[11px] text-primary hover:bg-primary/25"
              >
                {drawMode === 'geofence' ? 'Drawing…' : 'Draw'}
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
              <button
                type="button"
                onClick={() => {
                  clearGeofenceDraft()
                  remove('geofence')
                }}
                className="h-7 rounded-full px-2 text-[11px] text-muted-foreground"
              >
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
              {hasFence ? ' · polygon on query' : ''}
            </p>
          </section>
        )}

        {addon === 'ai' && (
          <section className="rounded-xl border border-primary/20 bg-black/25 p-2.5">
            <p className="text-[11px] font-medium">AI enhance</p>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Uses AI plus each row’s fields to write one new column. Nothing is added until you save it.
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
                Row fields the model may read
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
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={saveAi}
                  className="h-7 rounded-full bg-primary px-3 text-[11px] font-medium text-primary-foreground"
                >
                  Save AI column
                </button>
                {hasAi && (
                  <button
                    type="button"
                    onClick={() => remove('ai_column')}
                    className="h-7 rounded-full px-3 text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    Remove
                  </button>
                )}
              </div>
              {aiError && <p className="text-[11px] text-destructive">{aiError}</p>}
              <p className="font-mono text-[10px] text-muted-foreground">{hasAi ? 'ai_column on query' : 'not saved'}</p>
            </div>
          </section>
        )}

        <section className="rounded-xl border border-white/[0.08] bg-black/20 p-2.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-medium">Quote</p>
            <button
              type="button"
              onClick={() => useAgent.getState().setOpen(true)}
              className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full bg-primary px-3 text-[11px] font-medium text-primary-foreground"
            >
              <Sparkles className="size-3" />
              Open agent
            </button>
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">
            {assistQuote.isFetching ? 'Updating quote…' : 'Follows the add-ons on this query'}
          </p>
          {assistQuote.error && <p className="mt-1 text-[11px] text-destructive">{assistQuote.error.message}</p>}
          {assistQuote.data && (
            <div className="mt-2 rounded-md border border-white/[0.08] bg-black/30 p-2">
              <p className="text-[10px] text-muted-foreground">
                Total {formatUsd(assistQuote.data.total_usd_cents)} · Balance {formatUsd(assistQuote.data.balance_usd_cents)}
                {assistQuote.data.missing_hexes.length > 0
                  ? ` · process ${assistQuote.data.missing_hexes.length} missing hexes in ${assistQuote.data.process_batches.length} job(s)`
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

        {summaries.length > 0 && hailLayer && (
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
