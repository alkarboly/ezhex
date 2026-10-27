import { useEffect } from 'react'
import { densityGradientCss } from '../../lib/color-scale'
import { formatCount } from '../../lib/format'
import { cn } from '../../lib/utils'
import { useExplorer } from '../../store/explorer-store'
import type { HexAction, HexDataStatus } from '../../types/workflows'
import { HexQueryTable } from './HexQueryTable'

export function HexHoverCard({
  h3,
  count,
  countLabel,
  maxCount,
  selected,
  addMode,
  dataStatus,
  onAction,
  onMouseEnter,
  onMouseLeave,
}: {
  h3: string
  count: number
  countLabel: string
  maxCount: number
  selected: boolean
  addMode: boolean
  dataStatus: HexDataStatus
  onAction: (action: HexAction) => void
  onMouseEnter: () => void
  onMouseLeave: () => void
}) {
  const inspectOpen = useExplorer((state) => state.inspectOpen)
  const setInspectOpen = useExplorer((state) => state.setInspectOpen)
  const selectedCells = useExplorer((state) => state.selectedCells)
  const toggleCell = useExplorer((state) => state.toggleCell)
  const ready = dataStatus === 'ready'
  const processing = dataStatus === 'processing'
  const open = inspectOpen

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setInspectOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setInspectOpen])

  const openTable = () => {
    if (!selectedCells.includes(h3)) toggleCell(h3, selectedCells.length > 0)
    setInspectOpen(true)
  }

  return (
    <div
      data-testid="hover-card"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={cn(
        'glass pointer-events-auto rounded-2xl px-3.5 py-3 shadow-[0_18px_50px_-24px_rgba(0,0,0,0.85)]',
        open ? 'w-[min(40rem,calc(100vw-1.5rem))]' : 'w-64',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-mono text-[11px] text-muted-foreground">
          {selectedCells.length > 1 && open ? `${selectedCells.length} hexes` : h3}
        </span>
        <StatusChip status={dataStatus} />
      </div>
      {!open && (
        <>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-xl font-semibold tracking-tight tabular-nums">{formatCount(count)}</span>
            <span className="text-xs text-muted-foreground">{countLabel}</span>
          </div>
          <div className="relative mt-2 h-1 rounded-full" style={{ background: densityGradientCss() }}>
            <span
              className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-background"
              style={{ left: `${maxCount > 0 ? (count / maxCount) * 100 : 0}%` }}
            />
          </div>
        </>
      )}
      {open && ready ? (
        <HexQueryTable />
      ) : (
        <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
          {ready
            ? 'Open the table to inspect rows in this hex.'
            : processing
              ? 'An ingestion job is already queued for this hex.'
              : 'No processed data yet. Process this hex, then inspect the table.'}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-1.5">
        <ActionButton
          disabled={!ready}
          onClick={() => {
            if (open) setInspectOpen(false)
            else openTable()
          }}
        >
          {open ? 'Hide table' : 'Inspect'}
        </ActionButton>
        <ActionButton disabled={processing} onClick={() => onAction('process')}>
          {ready ? 'Reprocess' : 'Process'}
        </ActionButton>
        <ActionButton onClick={() => onAction('workflow')}>Workflow</ActionButton>
      </div>
      {!open && (
        <p className="mt-2 text-[10px] text-muted-foreground">
          {selected
            ? addMode
              ? 'Click the hex to remove it from the set.'
              : 'Shift-click to remove · the set stays selected'
            : addMode
              ? 'Click the hex to add it.'
              : 'Click to select · Shift-click to add'}
        </p>
      )}
    </div>
  )
}

function StatusChip({ status }: { status: HexDataStatus }) {
  return (
    <span
      className={cn(
        'rounded-full px-1.5 py-px text-[10px] font-medium',
        status === 'ready' && 'bg-primary/15 text-primary',
        status === 'processing' && 'bg-select/15 text-select',
        status === 'missing' && 'bg-white/10 text-muted-foreground',
      )}
    >
      {status === 'ready' ? 'Ready' : status === 'processing' ? 'Processing' : 'No data'}
    </span>
  )
}

function ActionButton({
  children,
  disabled,
  onClick,
}: {
  children: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="h-7 rounded-full bg-white/[0.06] px-2.5 text-[11px] font-medium text-foreground transition-colors hover:bg-primary/15 hover:text-primary disabled:pointer-events-none disabled:opacity-35"
    >
      {children}
    </button>
  )
}
