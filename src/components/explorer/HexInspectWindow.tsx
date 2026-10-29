import { Maximize2, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef } from 'react'
import { MOBILE_QUERY, useMediaQuery } from '../../hooks/useMediaQuery'
import { cn } from '../../lib/utils'
import { useExplorer } from '../../store/explorer-store'
import { HexQueryTable } from './HexQueryTable'

export function HexInspectWindow({ cells }: { cells: readonly string[] }) {
  const mobile = useMediaQuery(MOBILE_QUERY)
  const inspectOpen = useExplorer((state) => state.inspectOpen)
  const queryHexPreview = useExplorer((state) => state.queryHexPreview)
  const setQueryHexPreview = useExplorer((state) => state.setQueryHexPreview)
  const previewQueryHexes = useExplorer((state) => state.previewQueryHexes)
  const exitQuery = useExplorer((state) => state.exitQuery)
  const position = useExplorer((state) => state.inspectPosition)
  const setInspectPosition = useExplorer((state) => state.setInspectPosition)
  const panelRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null)

  useEffect(() => {
    if (!inspectOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (queryHexPreview) {
        setQueryHexPreview(false)
        return
      }
      exitQuery()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [exitQuery, inspectOpen, queryHexPreview, setQueryHexPreview])

  useLayoutEffect(() => {
    if (!inspectOpen || mobile) return
    const panel = panelRef.current
    if (!panel) return
    const next = clampPosition(position.x, position.y, panel.offsetWidth, panel.offsetHeight)
    if (next.x !== position.x || next.y !== position.y) setInspectPosition(next)
  }, [inspectOpen, mobile, position.x, position.y, queryHexPreview, setInspectPosition])

  if (!inspectOpen) return null

  return (
    <div
      ref={panelRef}
      data-testid="inspect-window"
      data-preview={queryHexPreview ? 'hexes' : 'inspect'}
      className={
        mobile
          ? cn(
              'glass pointer-events-auto absolute inset-x-3 bottom-[4.75rem] z-30 flex flex-col overflow-hidden rounded-2xl shadow-[0_18px_50px_-24px_rgba(0,0,0,0.85)]',
              queryHexPreview ? 'max-h-40' : 'max-h-[min(34rem,calc(100dvh-8rem))]',
            )
          : cn(
              'glass pointer-events-auto absolute z-30 flex w-[min(46rem,calc(100vw-11rem))] flex-col overflow-hidden rounded-2xl shadow-[0_18px_50px_-24px_rgba(0,0,0,0.85)]',
              queryHexPreview ? 'max-h-40' : 'max-h-[calc(100dvh-6.5rem)]',
            )
      }
      style={
        mobile
          ? undefined
          : queryHexPreview
            ? { left: position.x, top: position.y }
            : { left: position.x, top: position.y, height: 'min(42rem, calc(100dvh - 6.5rem))' }
      }
      onWheel={(event) => event.stopPropagation()}
    >
      <div
        className="flex cursor-grab items-center justify-between gap-2 px-3.5 py-2.5 active:cursor-grabbing"
        onPointerDown={(event) => {
          if (mobile || (event.target as HTMLElement).closest('button, details')) return
          drag.current = { x: event.clientX, y: event.clientY, left: position.x, top: position.y }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          if (!drag.current || !panelRef.current) return
          setInspectPosition(
            clampPosition(
              drag.current.left + event.clientX - drag.current.x,
              drag.current.top + event.clientY - drag.current.y,
              panelRef.current.offsetWidth,
              panelRef.current.offsetHeight,
            ),
          )
        }}
        onPointerUp={() => {
          drag.current = null
        }}
      >
        <div className="min-w-0">
          <p className="text-[10px] font-medium tracking-[0.16em] text-primary uppercase">
            {queryHexPreview ? 'Query coverage' : 'Inspect SQL'}
          </p>
          <QueryHexMenu cells={cells} />
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {queryHexPreview ? (
            <button
              type="button"
              data-testid="inspect-back"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation()
                setQueryHexPreview(false)
              }}
              className="h-7 rounded-full bg-white/[0.06] px-2.5 text-[11px] font-medium hover:bg-primary/15 hover:text-primary"
            >
              Back to inspect
            </button>
          ) : (
            <button
              type="button"
              data-testid="inspect-preview-hexes"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation()
                previewQueryHexes()
              }}
              className="inline-flex h-7 items-center gap-1 rounded-full bg-select/15 px-2.5 text-[11px] font-medium text-select hover:bg-select/25"
            >
              <Maximize2 className="size-3" />
              Preview hexes
            </button>
          )}
          <button
            type="button"
            data-testid="inspect-exit-query"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation()
              exitQuery()
            }}
            className="inline-flex h-7 items-center gap-1 rounded-full bg-white/[0.06] px-2.5 text-[11px] font-medium hover:bg-primary/15 hover:text-primary"
          >
            <X className="size-3" />
            Exit query
          </button>
        </div>
      </div>
      <div
        className={cn(
          'flex min-h-0 flex-1 flex-col overflow-hidden px-3.5 pb-3',
          queryHexPreview && 'hidden',
        )}
      >
        <HexQueryTable />
      </div>
    </div>
  )
}

function QueryHexMenu({ cells }: { cells: readonly string[] }) {
  const focusCell = useExplorer((state) => state.focusCell)
  const previewQueryHexes = useExplorer((state) => state.previewQueryHexes)
  const label = cells.length === 1 ? cells[0] : `${cells.length} hexes`

  return (
    <details className="relative mt-1" data-testid="inspect-hexes">
      <summary className="inline-flex max-w-full cursor-pointer list-none items-center rounded-full border border-select/40 bg-select/15 px-2 py-0.5 font-mono text-[10px] text-select shadow-[0_0_12px_rgba(244,194,91,0.28)]">
        <span className="mr-1.5 size-1.5 shrink-0 rounded-full bg-select shadow-[0_0_8px_rgba(244,194,91,0.9)]" />
        <span className="truncate">{label || 'No hexes'}</span>
      </summary>
      <div className="absolute top-7 left-0 z-40 min-w-56 max-w-80 rounded-xl border border-white/[0.08] bg-[#0a1017] p-2 shadow-xl">
        <p className="px-1.5 pb-1.5 text-[10px] text-muted-foreground">
          {cells.length === 0
            ? 'No hexes in this query.'
            : cells.length === 1
              ? '1 hex in this query'
              : `${cells.length} hexes in this query`}
        </p>
        <ul data-testid="inspect-hex-list" className="max-h-44 overflow-auto">
          {cells.map((cell) => (
            <li key={cell}>
              <button
                type="button"
                onClick={() => focusCell(cell)}
                className="flex w-full items-center rounded-md px-1.5 py-1 font-mono text-[10px] text-foreground hover:bg-select/10 hover:text-select"
              >
                {cell}
              </button>
            </li>
          ))}
        </ul>
        {cells.length > 0 && (
          <button
            type="button"
            onClick={() => previewQueryHexes()}
            className="mt-1.5 flex w-full items-center justify-center gap-1 rounded-full bg-select/15 px-2 py-1 text-[10px] font-medium text-select hover:bg-select/25"
          >
            <Maximize2 className="size-3" />
            Preview hexes
          </button>
        )}
      </div>
    </details>
  )
}

function clampPosition(x: number, y: number, width: number, height: number) {
  const maxX = Math.max(84, window.innerWidth - width - 8)
  const maxY = Math.max(8, window.innerHeight - height - 72)
  return {
    x: Math.min(maxX, Math.max(84, x)),
    y: Math.min(maxY, Math.max(8, y)),
  }
}
