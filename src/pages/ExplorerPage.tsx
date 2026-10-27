import { LocateFixed } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { DatasetSwitcher } from '../components/explorer/DatasetSwitcher'
import { LayersButton, MapControls } from '../components/explorer/MapControls'
import { MobileSheet } from '../components/explorer/MobileSheet'
import { SelectionDock } from '../components/explorer/SelectionDock'
import { FILTER_PANEL_WIDTH, FilterPanel } from '../components/filters/FilterPanel'
import { MobileNavButton } from '../components/layout/MobileNav'
import { H3Map, type H3MapHandle, type MapInsets } from '../components/map/H3Map'
import { RESULTS_BAR_HEIGHT, ResultsPanel } from '../components/results/ResultsPanel'
import { useCellStats, useCompiledQuery, useQueryResults } from '../hooks/useCompiledQuery'
import { MOBILE_QUERY, TOUCH_QUERY, useMediaQuery } from '../hooks/useMediaQuery'
import type { ViewportStatus } from '../lib/h3'
import { useExplorer, type SheetSnap } from '../store/explorer-store'
import { DATASET_META } from '../types/datasets'
import type { CellCount } from '../types/queries'

const NO_COUNTS: CellCount[] = []
const EDGE = 12
const DOCK_SPACE = 56
const MOBILE_TOP_BAR = 72

export function ExplorerPage() {
  const mobile = useMediaQuery(MOBILE_QUERY)
  const touch = useMediaQuery(TOUCH_QUERY)
  const mapRef = useRef<H3MapHandle>(null)
  const compiled = useCompiledQuery()
  const cells = useExplorer((state) => state.viewportCellIds)
  const viewportStatus = useExplorer((state) => state.viewportStatus)
  const selected = useExplorer((state) => state.selectedCells)
  const hexMode = useExplorer((state) => state.hexMode)
  const basemap = useExplorer((state) => state.basemap)
  const focus = useExplorer((state) => state.focus)
  const fit = useExplorer((state) => state.fit)
  const selectionMode = useExplorer((state) => state.selectionMode)
  const filtersOpen = useExplorer((state) => state.filtersOpen)
  const resultsOpen = useExplorer((state) => state.resultsOpen)
  const resultsHeight = useExplorer((state) => state.resultsHeight)
  const toggleCell = useExplorer((state) => state.toggleCell)
  const setViewportCells = useExplorer((state) => state.setViewportCells)
  const setCenterCell = useExplorer((state) => state.setCenterCell)
  const sheetSnap = useExplorer((state) => state.sheetSnap)
  const notice = useExplorer((state) => state.notice)
  const dismissNotice = useExplorer((state) => state.dismissNotice)
  const [sheetHeights, setSheetHeights] = useState<Record<SheetSnap, number>>({ peek: 130, half: 440, full: 760 })
  const sheetHeight = sheetHeights[sheetSnap]

  const stats = useCellStats(cells.length > 0 ? cells : selected, compiled)
  const results = useQueryResults(compiled)
  const meta = DATASET_META[compiled.spec.dataset]
  const counts = compiled.errors.length === 0 ? (stats.data ?? NO_COUNTS) : NO_COUNTS
  const countMap = useMemo(() => new Map(counts.map((entry) => [entry.h3, entry.count])), [counts])
  const allZero = stats.isSuccess && counts.length > 0 && counts.every((entry) => entry.count === 0)
  const hasFilters = compiled.spec.filters.length > 0
  const countLabel = hasFilters ? `matching ${meta.plural}` : meta.plural

  const panelRight = filtersOpen ? EDGE + FILTER_PANEL_WIDTH : 0
  const contentLeft = panelRight + EDGE
  const resultsSpace = (resultsOpen && selected.length > 0 ? resultsHeight : RESULTS_BAR_HEIGHT) + EDGE
  const insets = useMemo<MapInsets>(
    () =>
      mobile
        ? { top: MOBILE_TOP_BAR, right: 0, bottom: sheetHeight, left: 0 }
        : { top: 64, right: 0, bottom: resultsSpace + DOCK_SPACE, left: panelRight },
    [mobile, sheetHeight, resultsSpace, panelRight],
  )

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => dismissNotice(), 6000)
    return () => window.clearTimeout(timer)
  }, [notice, dismissNotice])

  const status = (
    <StatusPill status={viewportStatus} allZero={allZero} hasFilters={hasFilters} noun={meta.plural} />
  )

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-background">
      <H3Map
        ref={mapRef}
        cells={cells}
        counts={counts}
        selected={selected}
        focusedH3={focus?.h3 ?? null}
        hexMode={hexMode}
        basemap={basemap}
        countLabel={countLabel}
        addMode={selectionMode}
        touch={touch}
        insets={insets}
        fit={fit}
        focusNonce={focus?.nonce ?? 0}
        onCellClick={toggleCell}
        onViewportCells={setViewportCells}
        onCenterCell={setCenterCell}
      />

      {mobile ? (
        <>
          <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start gap-2 px-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
            <div className="pointer-events-auto">
              <MobileNavButton />
            </div>
            <div className="pointer-events-auto mx-auto min-w-0">
              <DatasetSwitcher compact />
            </div>
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
          {notice && sheetSnap !== 'full' && (
            <div
              className="pointer-events-none absolute inset-x-3 z-40 flex justify-center"
              style={{ bottom: sheetHeight + 40 }}
            >
              <Toast message={notice} onDismiss={dismissNotice} />
            </div>
          )}
          <MobileSheet
            compiled={compiled}
            results={results}
            counts={countMap}
            countLabel={countLabel}
            viewportStatus={viewportStatus}
            hexMode={hexMode}
            onHeightsChange={setSheetHeights}
          />
        </>
      ) : (
        <>
          <FilterPanel />
          <div
            className="pointer-events-none absolute top-3 right-16 z-20 flex flex-col items-center gap-2"
            style={{ left: contentLeft }}
          >
            <div className="pointer-events-auto">
              <DatasetSwitcher />
            </div>
            {status}
            {notice && <Toast message={notice} onDismiss={dismissNotice} />}
          </div>
          <div className="absolute top-3 right-3 z-20">
            <MapControls mapRef={mapRef} touch={touch} />
          </div>
          <div
            className="pointer-events-none absolute right-3 z-20 flex justify-center transition-[bottom] duration-200"
            style={{ left: contentLeft, bottom: resultsSpace + EDGE }}
          >
            <div className="pointer-events-auto">
              <SelectionDock viewportStatus={viewportStatus} viewportCount={cells.length} touch={touch} />
            </div>
          </div>
          <ResultsPanel compiled={compiled} query={results} left={contentLeft} />
        </>
      )}
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
  if (status === 'zoom-in') text = 'Zoom in to reveal H3 resolution 8 cells'
  else if (status === 'too-many') text = 'Too many cells in view. Zoom in to load the grid.'
  else if (status === 'ready' && allZero) text = hasFilters ? `No matching ${noun} in this view` : 'Outside the Austin mock coverage'
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
