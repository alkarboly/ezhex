import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getResolution } from 'h3-js'
import { LocateFixed } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { HexActionDialog } from '../components/explorer/HexActionDialog'
import { HexInspectWindow } from '../components/explorer/HexInspectWindow'
import { LayersButton, MapControls } from '../components/explorer/MapControls'
import { MobileNavButton } from '../components/layout/MobileNav'
import { H3Map, type H3MapHandle, type MapInsets } from '../components/map/H3Map'
import { useCellStats, useCompiledQuery, useInspectFeatures } from '../hooks/useCompiledQuery'
import { useDataSource } from '../hooks/useDataSource'
import { MOBILE_QUERY, TOUCH_QUERY, useMediaQuery } from '../hooks/useMediaQuery'
import { readyCellsInParents, type ViewportStatus } from '../lib/h3'
import { H3_RESOLUTION } from '../lib/limits'
import { getHexStatus } from '../services/workflow-ingestion'
import { useExplorer } from '../store/explorer-store'
import { DATASET_META } from '../types/datasets'
import type { CellCount } from '../types/queries'
import type { HexAction, HexCoverage, HexDataStatus, IngestionJob } from '../types/workflows'

const NO_COUNTS: CellCount[] = []
const MOBILE_TOP_BAR = 72

export function ExplorerPage() {
  const mobile = useMediaQuery(MOBILE_QUERY)
  const touch = useMediaQuery(TOUCH_QUERY)
  const source = useDataSource()
  const client = useQueryClient()
  const mapRef = useRef<H3MapHandle>(null)
  const compiled = useCompiledQuery()
  const cells = useExplorer((state) => state.viewportCellIds)
  const viewportStatus = useExplorer((state) => state.viewportStatus)
  const selected = useExplorer((state) => state.selectedCells)
  const clearSelection = useExplorer((state) => state.clearSelection)
  const hexMode = useExplorer((state) => state.hexMode)
  const basemap = useExplorer((state) => state.basemap)
  const focus = useExplorer((state) => state.focus)
  const fit = useExplorer((state) => state.fit)
  const toggleCell = useExplorer((state) => state.toggleCell)
  const setViewportCells = useExplorer((state) => state.setViewportCells)
  const setCenterCell = useExplorer((state) => state.setCenterCell)
  const notice = useExplorer((state) => state.notice)
  const dismissNotice = useExplorer((state) => state.dismissNotice)
  const setNotice = useExplorer((state) => state.setNotice)
  const setInspectOpen = useExplorer((state) => state.setInspectOpen)
  const inspectOpen = useExplorer((state) => state.inspectOpen)
  const configured = Boolean(source.data?.supabase?.urlConfigured && source.data?.supabase?.anonKeyConfigured)
  const queryUnavailable = source.data?.mode === 'supabase' && !configured
  const canQueryCells = source.data?.mode === 'mock' || (source.data?.mode === 'supabase' && configured)
  const [action, setAction] = useState<{ mode: HexAction; cells: string[] } | null>(null)
  const inspect = useInspectFeatures(inspectOpen)

  const queryCells = useMemo(
    () => cells.filter((cell) => getResolution(cell) === H3_RESOLUTION),
    [cells],
  )
  const stats = useCellStats(canQueryCells ? (queryCells.length > 0 ? queryCells : selected) : [], compiled)
  const meta = DATASET_META[compiled.spec.dataset]
  const counts = canQueryCells && compiled.errors.length === 0 ? (stats.data ?? NO_COUNTS) : NO_COUNTS
  const allZero = stats.isSuccess && counts.length > 0 && counts.every((entry) => entry.count === 0)
  const hasFilters = compiled.spec.filters.length > 0
  const statusCells = useMemo(() => [...new Set([...queryCells, ...selected])], [queryCells, selected])
  const coverage = useQuery({
    queryKey: ['hex-status', statusCells.join(',')],
    enabled: statusCells.length > 0,
    queryFn: () => getHexStatus(statusCells),
    staleTime: 4_000,
  })
  const [knownCoverage, setKnownCoverage] = useState<Map<string, HexCoverage>>(() => new Map())
  useEffect(() => {
    if (!coverage.data) return
    setKnownCoverage((current) => {
      const next = new Map(current)
      for (const cell of coverage.data.cells) {
        if (getResolution(cell.h3) === H3_RESOLUTION) next.set(cell.h3, cell)
      }
      return next
    })
  }, [coverage.data])
  const coverageByCell = knownCoverage
  const mapCells = useMemo(() => {
    const extra = readyCellsInParents(cells, knownCoverage)
    return extra.length === 0 ? cells : [...cells, ...extra]
  }, [cells, knownCoverage])
  const statusMap = useMemo(() => {
    const next = new Map<string, HexDataStatus>()
    for (const [h3, cell] of coverageByCell) next.set(h3, cell.status)
    return next
  }, [coverageByCell])

  const insets = useMemo<MapInsets>(
    () =>
      mobile
        ? { top: MOBILE_TOP_BAR, right: 0, bottom: 72, left: 0 }
        : { top: 56, right: 0, bottom: 72, left: 0 },
    [mobile],
  )

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => dismissNotice(), 6000)
    return () => window.clearTimeout(timer)
  }, [notice, dismissNotice])

  const openHexAction = (h3: string, mode: HexAction) => {
    const cells = selected.includes(h3) ? selected : [h3]
    if (mode === 'query') {
      if (!selected.includes(h3)) toggleCell(h3, selected.length > 0)
      openQuery(cells)
      return
    }
    if (!selected.includes(h3)) toggleCell(h3, selected.length > 0)
    openAction(mode, cells)
  }

  const openQuery = (next: readonly string[]) => {
    if (next.length === 0) {
      setNotice('Select at least one hex.')
      return
    }
    if (next.some((cell) => statusMap.get(cell) !== 'ready')) {
      setNotice('Process these hexes first. The table unlocks when data is ready.')
      setInspectOpen(false)
      setAction({ mode: 'process', cells: [...next] })
      return
    }
    setAction(null)
    setInspectOpen(true)
  }

  const openAction = (mode: HexAction, next: readonly string[]) => {
    if (next.length === 0) {
      setNotice('Select at least one hex.')
      return
    }
    if (mode === 'query') {
      openQuery(next)
      return
    }
    setInspectOpen(false)
    setAction({ mode, cells: [...next] })
  }

  const onCreated = async (job: IngestionJob) => {
    setAction(null)
    setNotice(
      job.status === 'succeeded'
        ? 'These hexes are ready. You can query or start a workflow.'
        : 'Still processing these hexes.',
    )
    await client.invalidateQueries({ queryKey: ['hex-status'] })
    await client.invalidateQueries({ queryKey: ['ingestion-jobs'] })
  }

  const status = (
    <StatusPill status={viewportStatus} allZero={allZero} hasFilters={hasFilters} noun={meta.plural} />
  )
  const dock = (
    <SelectionDock
      selected={selected}
      coverage={statusMap}
      onClear={clearSelection}
      onAction={(mode) => openAction(mode, selected)}
    />
  )

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-background">
      <H3Map
        ref={mapRef}
        cells={mapCells}
        counts={counts}
        selected={selected}
        focusedH3={focus?.h3 ?? null}
        hexMode={hexMode}
        basemap={basemap}
        touch={touch}
        insets={insets}
        fit={fit}
        focusNonce={focus?.nonce ?? 0}
        onCellClick={toggleCell}
        onViewportCells={setViewportCells}
        onCenterCell={setCenterCell}
        cellCoverage={coverageByCell}
        onHexAction={openHexAction}
        inspectFeatures={inspect.rows}
      />
      <HexInspectWindow cells={selected} />

      {mobile ? (
        <>
          <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start gap-2 px-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
            <div className="pointer-events-auto">
              <MobileNavButton />
            </div>
            <div className="min-w-0 flex-1" />
            <div className="glass pointer-events-auto flex flex-col overflow-hidden rounded-full">
              <LayersButton touch={touch} side="bottom" align="end" className="size-11" />
              <span className="mx-2.5 h-px bg-white/[0.08]" />
              <button
                type="button"
                aria-label="Back to Austin"
                onClick={() => mapRef.current?.resetView()}
                className="grid size-11 place-items-center text-muted-foreground active:text-foreground"
              >
                <LocateFixed className="size-[18px]" />
              </button>
            </div>
          </div>
          <div
            className="pointer-events-none absolute inset-x-16 z-20 flex justify-center"
            style={{ top: `calc(max(0.75rem, env(safe-area-inset-top)) + 3.5rem)` }}
          >
            {status}
          </div>
          <div
            className="pointer-events-none absolute inset-x-3 z-20 flex justify-center"
            style={{ top: `calc(max(0.75rem, env(safe-area-inset-top)) + 5.6rem)` }}
          >
            <SnapshotLegend />
          </div>
          {queryUnavailable && (
            <div
              role="status"
              className="glass pointer-events-none absolute inset-x-3 z-20 mx-auto max-w-md rounded-full px-3.5 py-2 text-center text-xs text-muted-foreground"
              style={{ top: `calc(max(0.75rem, env(safe-area-inset-top)) + 8.2rem)` }}
            >
              Set SUPABASE_URL and SUPABASE_ANON_KEY on the server, then process hexes to pull Overture.
            </div>
          )}
          <div className="pointer-events-none absolute inset-x-3 z-20 flex justify-center" style={{ bottom: 16 }}>
            <div className="pointer-events-auto">{dock}</div>
          </div>
          {notice && (
            <div className="pointer-events-none absolute inset-x-3 z-40 flex justify-center" style={{ bottom: 84 }}>
              <Toast message={notice} onDismiss={dismissNotice} />
            </div>
          )}
        </>
      ) : (
        <>
          <div className="pointer-events-none absolute top-3 left-3 z-20">
            <SnapshotLegend />
          </div>
          <div className="pointer-events-none absolute top-3 left-1/2 z-20 -translate-x-1/2">{status}</div>
          {queryUnavailable && (
            <div
              role="status"
              className="glass pointer-events-none absolute top-14 left-1/2 z-20 -translate-x-1/2 rounded-full px-3.5 py-2 text-xs text-muted-foreground"
            >
              Set SUPABASE_URL and SUPABASE_ANON_KEY on the server, then process hexes to pull Overture.
            </div>
          )}
          <div className="absolute top-3 right-3 z-20">
            <MapControls mapRef={mapRef} touch={touch} />
          </div>
          <div className="pointer-events-none absolute right-3 bottom-3 left-3 z-20 flex justify-center">
            <div className="pointer-events-auto">{dock}</div>
          </div>
          {notice && (
            <div className="pointer-events-none absolute right-3 bottom-20 left-3 z-30 flex justify-center">
              <Toast message={notice} onDismiss={dismissNotice} />
            </div>
          )}
        </>
      )}

      <HexActionDialog
        open={action != null}
        mode={action?.mode ?? null}
        cells={action?.cells ?? []}
        coverage={statusMap}
        onClose={() => setAction(null)}
        onCreated={(job) => void onCreated(job)}
      />
    </div>
  )
}

function SelectionDock({
  selected,
  coverage,
  onClear,
  onAction,
}: {
  selected: readonly string[]
  coverage: ReadonlyMap<string, HexDataStatus>
  onClear: () => void
  onAction: (mode: HexAction) => void
}) {
  const ready = selected.length > 0 && selected.every((cell) => coverage.get(cell) === 'ready')
  const processing = selected.some((cell) => coverage.get(cell) === 'processing')
  return (
    <div className="glass flex flex-wrap items-center justify-center gap-1.5 rounded-full px-2 py-1">
      <span className="rounded-full bg-white/[0.05] px-2.5 py-1 text-xs text-muted-foreground">
        {selected.length} selected
      </span>
      <button
        type="button"
        disabled={selected.length === 0}
        onClick={onClear}
        className="rounded-full px-3 py-1 text-xs text-foreground/85 transition-colors hover:bg-white/[0.06] hover:text-foreground disabled:opacity-40"
      >
        Clear
      </button>
      <button
        type="button"
        disabled={selected.length === 0 || !ready}
        onClick={() => onAction('query')}
        className="rounded-full px-3 py-1 text-xs text-foreground/85 transition-colors hover:bg-primary/15 hover:text-primary disabled:opacity-40"
      >
        Query
      </button>
      <button
        type="button"
        disabled={selected.length === 0 || processing}
        onClick={() => onAction('process')}
        className="rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
      >
        Process
      </button>
    </div>
  )
}

function SnapshotLegend() {
  return (
    <div className="glass flex items-center gap-2.5 rounded-full px-3 py-1.5 text-[10px] text-muted-foreground">
      <span className="inline-flex items-center gap-1">
        <span className="size-2 rounded-sm border border-[#6d7d8f] bg-transparent" />
        No Data
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="size-2 rounded-sm bg-[#2ee6a6]" />
        Current
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="size-2 rounded-sm bg-[#f5c451]" />
        Old snapshot
      </span>
    </div>
  )
}

function StatusPill({
  status,
  allZero,
  hasFilters,
  noun,
}: {
  status: ViewportStatus
  allZero: boolean
  hasFilters: boolean
  noun: string
}) {
  let text: string | null = null
  if (status === 'zoom-in') text = 'Globe view · zoom in for hexes'
  else if (status === 'too-many') text = 'Too many cells in view. Zoom in to load the grid.'
  else if (status === 'ready' && allZero && hasFilters) text = `No matching ${noun} in this view`
  if (!text) return null
  return (
    <div role="status" className="glass rounded-full px-3.5 py-1.5 text-center text-xs text-muted-foreground">
      {text}
    </div>
  )
}

function Toast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div
      role="status"
      className="glass pointer-events-auto flex items-center gap-3 rounded-full py-1.5 pr-1.5 pl-4 text-xs animate-[wp-pop-in_160ms_ease-out]"
    >
      <span>{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        className="rounded-full px-2.5 py-1 text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
      >
        Dismiss
      </button>
    </div>
  )
}
