import { Check, Crosshair, Maximize2, Scan, SquarePlus, X } from 'lucide-react'
import type { ButtonHTMLAttributes, ComponentType } from 'react'
import type { ViewportStatus } from '../../lib/h3'
import { cn } from '../../lib/utils'
import { useExplorer } from '../../store/explorer-store'

export function viewportLabel(status: ViewportStatus, count: number): string {
  if (status === 'idle') return 'Loading map…'
  if (status === 'zoom-in') return 'Zoom in to load cells'
  if (status === 'too-many') return 'Too many cells · zoom in'
  return `${count} cells in view`
}

export function SelectionDock({
  viewportStatus,
  viewportCount,
  touch,
}: {
  viewportStatus: ViewportStatus
  viewportCount: number
  touch: boolean
}) {
  const centerCell = useExplorer((state) => (touch && state.hexMode !== 'off' ? state.centerCell : null))
  const selectedCount = useExplorer((state) => state.selectedCells.length)
  const centerSelected = useExplorer((state) => (centerCell ? state.selectedCells.includes(centerCell) : false))
  const selectionMode = useExplorer((state) => state.selectionMode)
  const setSelectionMode = useExplorer((state) => state.setSelectionMode)
  const clearSelection = useExplorer((state) => state.clearSelection)
  const selectVisible = useExplorer((state) => state.selectVisible)
  const zoomToSelected = useExplorer((state) => state.zoomToSelected)
  const toggleCell = useExplorer((state) => state.toggleCell)

  return (
    <div className="glass flex items-center gap-0.5 rounded-full p-1 pl-4 text-xs">
      <span data-testid="viewport-status" className="whitespace-nowrap text-muted-foreground tabular-nums">
        {viewportLabel(viewportStatus, viewportCount)}
      </span>
      <span className="mx-2.5 h-4 w-px bg-white/10" />
      <span
        data-testid="selected-count"
        className={cn(
          'flex items-center gap-2 pr-1.5 whitespace-nowrap',
          selectedCount > 0 ? 'font-medium text-foreground' : 'text-muted-foreground',
        )}
      >
        <span
          className={cn(
            'size-2 rounded-full transition-colors',
            selectedCount > 0 ? 'bg-select shadow-[0_0_10px_rgba(244,194,91,0.9)]' : 'bg-white/20',
          )}
        />
        {selectedCount > 0 ? `${selectedCount} selected` : touch ? 'Tap cells to select' : 'Click cells to select'}
      </span>
      {touch && centerCell && (
        <DockButton
          icon={centerSelected ? Check : Crosshair}
          onClick={() => toggleCell(centerCell, true)}
          className={centerSelected ? 'text-select' : undefined}
        >
          {centerSelected ? 'Center added' : 'Add center'}
        </DockButton>
      )}
      <DockButton icon={Scan} onClick={selectVisible} disabled={viewportStatus !== 'ready'}>
        Select visible
      </DockButton>
      <DockButton icon={Maximize2} onClick={zoomToSelected} disabled={selectedCount === 0}>
        Zoom
      </DockButton>
      <DockButton icon={X} onClick={clearSelection} disabled={selectedCount === 0}>
        Clear
      </DockButton>
      {!touch && (
        <DockButton
          icon={SquarePlus}
          aria-pressed={selectionMode}
          title="Add mode: every click adds or removes a cell. Shift-click does the same at any time."
          onClick={() => setSelectionMode(!selectionMode)}
          className={selectionMode ? 'bg-select/15 text-select hover:bg-select/20' : undefined}
        >
          Add mode
        </DockButton>
      )}
    </div>
  )
}

function DockButton({
  icon: Icon,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: ComponentType<{ className?: string }> }) {
  return (
    <button
      type="button"
      className={cn(
        'flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-3 font-medium whitespace-nowrap text-foreground/85 transition-colors hover:bg-white/[0.07] hover:text-foreground disabled:pointer-events-none disabled:opacity-35',
        className,
      )}
      {...props}
    >
      <Icon className="size-3.5" />
      {children}
    </button>
  )
}
