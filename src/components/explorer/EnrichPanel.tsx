import { useMutation } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { HAIL_MESH_START } from '../../lib/limits'
import { addDay } from '../../lib/enrichments'
import { formatCount } from '../../lib/format'
import { enrichHail } from '../../services/query-workflows'
import { useExplorer } from '../../store/explorer-store'
import type { GeofenceKeep } from '../../types/enrichments'

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

  const hail = useMutation({
    mutationFn: () => enrichHail({ h3_cells: selected, start_date: start, end_date: end }),
    onSuccess: (result) => {
      setSummaries(result.cells)
      upsert({ id: 'hail_history', kind: 'hail_history', start_date: result.start_date, end_date: result.end_date })
    },
  })

  if (!open) return null

  return (
    <section
      data-testid="enrich-panel"
      className="glass pointer-events-auto absolute right-3 bottom-20 z-30 flex w-[min(26rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl"
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
      <div className="grid gap-3 px-3.5 pb-3.5">
        <section className="rounded-xl border border-primary/20 bg-black/25 p-2.5">
          <p className="text-[11px] font-medium">Geofence</p>
          <p className="mt-1 text-[10px] text-muted-foreground">
            Draw a custom polygon. Keep only rows inside or outside it when the workflow runs.
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
