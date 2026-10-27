import { useEffect, useRef } from 'react'
import { useExplorer } from '../../store/explorer-store'
import { HexQueryTable } from './HexQueryTable'

export function HexInspectWindow({ cells }: { cells: readonly string[] }) {
  const inspectOpen = useExplorer((state) => state.inspectOpen)
  const setInspectOpen = useExplorer((state) => state.setInspectOpen)
  const position = useExplorer((state) => state.inspectPosition)
  const setInspectPosition = useExplorer((state) => state.setInspectPosition)
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null)

  useEffect(() => {
    if (!inspectOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setInspectOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [inspectOpen, setInspectOpen])

  if (!inspectOpen) return null

  return (
    <div
      data-testid="inspect-window"
      className="glass pointer-events-auto absolute z-30 flex h-[min(36rem,calc(100%-1.5rem))] w-[min(52rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl shadow-[0_18px_50px_-24px_rgba(0,0,0,0.85)]"
      style={{ left: position.x, top: position.y }}
      onWheel={(event) => event.stopPropagation()}
    >
      <div
        className="flex cursor-grab items-center justify-between gap-2 px-3.5 py-2.5 active:cursor-grabbing"
        onPointerDown={(event) => {
          drag.current = { x: event.clientX, y: event.clientY, left: position.x, top: position.y }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          if (!drag.current) return
          setInspectPosition({
            x: Math.max(8, drag.current.left + event.clientX - drag.current.x),
            y: Math.max(8, drag.current.top + event.clientY - drag.current.y),
          })
        }}
        onPointerUp={() => {
          drag.current = null
        }}
      >
        <div className="min-w-0">
          <p className="text-xs font-medium">Inspect</p>
          <p className="truncate font-mono text-[10px] text-muted-foreground">
            {cells.length === 1 ? cells[0] : `${cells.length} hexes`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setInspectOpen(false)}
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
