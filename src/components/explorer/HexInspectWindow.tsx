import { useEffect, useLayoutEffect, useRef } from 'react'
import { MOBILE_QUERY, useMediaQuery } from '../../hooks/useMediaQuery'
import { useExplorer } from '../../store/explorer-store'
import { HexQueryTable } from './HexQueryTable'

export function HexInspectWindow({ cells }: { cells: readonly string[] }) {
  const mobile = useMediaQuery(MOBILE_QUERY)
  const inspectOpen = useExplorer((state) => state.inspectOpen)
  const setInspectOpen = useExplorer((state) => state.setInspectOpen)
  const position = useExplorer((state) => state.inspectPosition)
  const setInspectPosition = useExplorer((state) => state.setInspectPosition)
  const panelRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null)

  useEffect(() => {
    if (!inspectOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setInspectOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [inspectOpen, setInspectOpen])

  useLayoutEffect(() => {
    if (!inspectOpen || mobile) return
    const panel = panelRef.current
    if (!panel) return
    const next = clampPosition(position.x, position.y, panel.offsetWidth, panel.offsetHeight)
    if (next.x !== position.x || next.y !== position.y) setInspectPosition(next)
  }, [inspectOpen, mobile, position.x, position.y, setInspectPosition])

  if (!inspectOpen) return null

  return (
    <div
      ref={panelRef}
      data-testid="inspect-window"
      className={
        mobile
          ? 'glass pointer-events-auto absolute inset-x-3 bottom-[4.75rem] z-30 flex max-h-[min(34rem,calc(100dvh-8rem))] flex-col overflow-hidden rounded-2xl shadow-[0_18px_50px_-24px_rgba(0,0,0,0.85)]'
          : 'glass pointer-events-auto absolute z-30 flex max-h-[calc(100dvh-6.5rem)] w-[min(46rem,calc(100vw-11rem))] flex-col overflow-hidden rounded-2xl shadow-[0_18px_50px_-24px_rgba(0,0,0,0.85)]'
      }
      style={mobile ? undefined : { left: position.x, top: position.y, height: 'min(42rem, calc(100dvh - 6.5rem))' }}
      onWheel={(event) => event.stopPropagation()}
    >
      <div
        className="flex cursor-grab items-center justify-between gap-2 px-3.5 py-2.5 active:cursor-grabbing"
        onPointerDown={(event) => {
          if (mobile || (event.target as HTMLElement).closest('button')) return
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
          <p className="text-[10px] font-medium tracking-[0.16em] text-primary uppercase">Inspect SQL</p>
          <p className="truncate font-mono text-[10px] text-muted-foreground">
            {cells.length === 1 ? cells[0] : `${cells.length} hexes`}
          </p>
        </div>
        <button
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            setInspectOpen(false)
          }}
          className="h-7 rounded-full bg-white/[0.06] px-2.5 text-[11px] font-medium hover:bg-primary/15 hover:text-primary"
        >
          Close
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-3.5 pb-3">
        <HexQueryTable />
      </div>
    </div>
  )
}

function clampPosition(x: number, y: number, width: number, height: number) {
  const maxX = Math.max(8, window.innerWidth - width - 8)
  const maxY = Math.max(8, window.innerHeight - height - 72)
  return {
    x: Math.min(maxX, Math.max(8, x)),
    y: Math.min(maxY, Math.max(8, y)),
  }
}
