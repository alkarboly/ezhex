import type { UseQueryResult } from '@tanstack/react-query'
import { Check, Hexagon, Maximize2, Plus, RotateCcw, Scan, X } from 'lucide-react'
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { formatCount } from '../../lib/format'
import type { ViewportStatus } from '../../lib/h3'
import type { CompiledQuery } from '../../lib/query-builder'
import { cn } from '../../lib/utils'
import { useExplorer, type HexMode, type MobileTab, type SheetSnap } from '../../store/explorer-store'
import { DATASET_META } from '../../types/datasets'
import type { QueryResult } from '../../types/queries'
import { QueryForm } from '../filters/QueryForm'
import { ResultsList } from '../results/ResultsList'

type DragState = {
  pointerId: number
  startY: number
  startHeight: number
  lastY: number
  lastTime: number
  velocity: number
  moved: boolean
}

export function MobileSheet({
  compiled,
  results,
  counts,
  countLabel,
  viewportStatus,
  hexMode,
  onHeightsChange,
}: {
  compiled: CompiledQuery
  results: UseQueryResult<QueryResult, Error>
  counts: ReadonlyMap<string, number>
  countLabel: string
  viewportStatus: ViewportStatus
  hexMode: HexMode
  /** Snap heights are reported up front so the map inset can follow a snap change in the same render. */
  onHeightsChange: (heights: Record<SheetSnap, number>) => void
}) {
  const centerCell = useExplorer((state) => (hexMode === 'off' ? null : state.centerCell))
  const centerCount = centerCell ? (counts.get(centerCell) ?? 0) : 0
  const snap = useExplorer((state) => state.sheetSnap)
  const setSnap = useExplorer((state) => state.setSheetSnap)
  const tab = useExplorer((state) => state.mobileTab)
  const setTab = useExplorer((state) => state.setMobileTab)
  const dataset = useExplorer((state) => state.dataset)
  const selectedCount = useExplorer((state) => state.selectedCells.length)
  const centerSelected = useExplorer((state) => (centerCell ? state.selectedCells.includes(centerCell) : false))
  const toggleCell = useExplorer((state) => state.toggleCell)
  const clearSelection = useExplorer((state) => state.clearSelection)
  const zoomToSelected = useExplorer((state) => state.zoomToSelected)
  const selectVisible = useExplorer((state) => state.selectVisible)
  const focusCell = useExplorer((state) => state.focusCell)
  const resetFilters = useExplorer((state) => state.resetFilters)

  const sheetRef = useRef<HTMLElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const suppressClick = useRef(false)
  const [bounds, setBounds] = useState({ container: window.innerHeight, header: 156 })
  const [dragHeight, setDragHeight] = useState<number | null>(null)

  useLayoutEffect(() => {
    const sheet = sheetRef.current
    const header = headerRef.current
    const parent = sheet?.parentElement
    if (!sheet || !header || !parent) return
    const measure = () => {
      const container = parent.clientHeight
      const headerHeight = header.offsetHeight
      setBounds((current) =>
        current.container === container && current.header === headerHeight
          ? current
          : { container, header: headerHeight },
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(parent)
    observer.observe(header)
    return () => observer.disconnect()
  }, [])

  const heights = useMemo(() => {
    const peek = bounds.header
    return {
      peek,
      half: Math.max(peek + 160, Math.round(bounds.container * 0.52)),
      full: Math.max(peek + 160, bounds.container - 84),
    }
  }, [bounds])
  const snapped = heights[snap]
  const height = dragHeight ?? snapped

  useEffect(() => {
    onHeightsChange(heights)
  }, [heights, onHeightsChange])

  const valid = compiled.errors.length === 0
  const total = valid && compiled.spec.h3_cells.length > 0 ? results.data?.total : undefined
  const conditions = compiled.spec.filters.length

  const openTab = (next: MobileTab) => {
    setTab(next)
    if (snap === 'peek') setSnap('half')
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    dragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: snapped,
      lastY: event.clientY,
      lastTime: event.timeStamp,
      velocity: 0,
      moved: false,
    }
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const delta = event.clientY - drag.startY
    if (!drag.moved) {
      if (Math.abs(delta) < 6) return
      drag.moved = true
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    const elapsed = Math.max(1, event.timeStamp - drag.lastTime)
    drag.velocity = (event.clientY - drag.lastY) / elapsed
    drag.lastY = event.clientY
    drag.lastTime = event.timeStamp
    setDragHeight(clamp(drag.startHeight - delta, heights.peek, heights.full))
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    dragRef.current = null
    if (!drag || drag.pointerId !== event.pointerId || !drag.moved) return
    suppressClick.current = true
    window.setTimeout(() => {
      suppressClick.current = false
    }, 0)
    const current = clamp(drag.startHeight - (event.clientY - drag.startY), heights.peek, heights.full)
    const projected = current - drag.velocity * 160
    setDragHeight(null)
    setSnap(nearestSnap(projected, heights))
  }

  const onClickCapture = (event: ReactMouseEvent) => {
    if (!suppressClick.current) return
    event.preventDefault()
    event.stopPropagation()
    suppressClick.current = false
  }

  const centerHint =
    hexMode === 'off'
      ? 'H3 cells are hidden. Turn them on in Map layers.'
      : viewportStatus === 'zoom-in' || viewportStatus === 'too-many'
        ? 'Globe view. Zoom in for hexes.'
        : 'Pan the map to line a cell up under the reticle.'

  return (
    <section
      ref={sheetRef}
      aria-label="Explorer panel"
      className="glass absolute inset-x-0 bottom-0 z-30 flex flex-col rounded-t-[28px] border-b-0"
      style={{
        height,
        transition: dragHeight == null ? 'height 320ms cubic-bezier(0.2, 0.8, 0.2, 1)' : 'none',
      }}
    >
      <div
        ref={headerRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          dragRef.current = null
          setDragHeight(null)
        }}
        onClickCapture={onClickCapture}
        className="shrink-0 touch-none px-4 pt-1.5 select-none"
      >
        <button
          type="button"
          aria-label={snap === 'peek' ? 'Expand panel' : 'Collapse panel'}
          onClick={() => setSnap(snap === 'peek' ? 'half' : 'peek')}
          className="mx-auto flex h-5 w-20 items-center justify-center"
        >
          <span className="h-1 w-10 rounded-full bg-white/25" />
        </button>

        <div className="mt-1 flex items-center gap-3" data-testid="center-cell">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-primary/30 bg-primary/10 text-primary">
            <Hexagon className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            {centerCell ? (
              <>
                <p className="truncate font-mono text-[11px] text-muted-foreground">{centerCell}</p>
                <p className="text-sm">
                  <span className="font-semibold tabular-nums">{formatCount(centerCount)}</span>{' '}
                  <span className="text-muted-foreground">{countLabel}</span>
                </p>
              </>
            ) : (
              <p className="text-xs leading-5 text-muted-foreground">{centerHint}</p>
            )}
          </div>
          {centerCell && (
            <button
              type="button"
              aria-label={centerSelected ? 'Remove the center cell from the selection' : 'Add the center cell to the selection'}
              onClick={() => toggleCell(centerCell, true)}
              className={cn(
                'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-4 text-xs font-semibold transition-colors',
                centerSelected
                  ? 'bg-select/15 text-select'
                  : 'bg-primary text-primary-foreground shadow-[0_0_22px_-6px_rgba(61,222,192,0.8)]',
              )}
            >
              {centerSelected ? <Check className="size-3.5" /> : <Plus className="size-3.5" />}
              {centerSelected ? 'Added' : 'Add'}
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 pt-3 pb-3">
          <div role="tablist" aria-label="Panel" className="flex rounded-full bg-white/[0.05] p-0.5">
            <TabButton active={tab === 'query'} onClick={() => openTab('query')} badge={conditions || null}>
              Filters
            </TabButton>
            <TabButton active={tab === 'results'} onClick={() => openTab('results')} badge={total ?? null}>
              Results
            </TabButton>
          </div>
          {selectedCount > 0 ? (
            <div className="ml-auto flex items-center rounded-full border border-select/30 bg-select/10">
              <span data-testid="selected-count" className="pr-1 pl-3 text-xs font-medium whitespace-nowrap text-select tabular-nums">
                {selectedCount} selected
              </span>
              <IconButton label="Zoom to selection" onClick={zoomToSelected}>
                <Maximize2 className="size-3.5" />
              </IconButton>
              <IconButton label="Clear selection" onClick={clearSelection}>
                <X className="size-3.5" />
              </IconButton>
            </div>
          ) : (
            <button
              type="button"
              disabled={viewportStatus !== 'ready'}
              onClick={selectVisible}
              className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-full border border-white/[0.1] px-3 text-xs font-medium whitespace-nowrap disabled:opacity-40"
            >
              <Scan className="size-3.5" />
              Visible
            </button>
          )}
        </div>
        {snap === 'peek' && <div className="h-[env(safe-area-inset-bottom)]" />}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-white/[0.06] px-4 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        {tab === 'query' ? (
          <>
            <div className="mb-4 flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold">{DATASET_META[dataset].title}</h2>
                <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{DATASET_META[dataset].blurb}</p>
              </div>
              <button
                type="button"
                onClick={resetFilters}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-white/[0.1] px-3 text-xs text-muted-foreground"
              >
                <RotateCcw className="size-3.5" />
                Reset
              </button>
            </div>
            <QueryForm />
          </>
        ) : (
          <ResultsList
            compiled={compiled}
            query={results}
            onFocusCell={(h3) => {
              focusCell(h3)
              setSnap('peek')
            }}
          />
        )}
      </div>
    </section>
  )
}

function TabButton({
  active,
  badge,
  onClick,
  children,
}: {
  active: boolean
  badge: number | null
  onClick: () => void
  children: string
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-xs font-medium transition-colors',
        active ? 'bg-white/[0.1] text-foreground' : 'text-muted-foreground',
      )}
    >
      {children}
      {badge != null && (
        <span
          className={cn(
            'rounded-full px-1.5 text-[10px] tabular-nums',
            active ? 'bg-primary/20 text-primary' : 'bg-white/[0.08] text-muted-foreground',
          )}
        >
          {formatCount(badge)}
        </span>
      )}
    </button>
  )
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="grid size-8 place-items-center rounded-full text-select/90 hover:bg-select/15"
    >
      {children}
    </button>
  )
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function nearestSnap(height: number, heights: Record<SheetSnap, number>): SheetSnap {
  let best: SheetSnap = 'peek'
  for (const snap of ['peek', 'half', 'full'] as const) {
    if (Math.abs(heights[snap] - height) < Math.abs(heights[best] - height)) best = snap
  }
  return best
}
