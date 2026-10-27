import { formatCount } from '../../lib/format'
import { cn } from '../../lib/utils'
import type { HexAction, HexDataStatus, HexSnapshot } from '../../types/workflows'

export function HexHoverCard({
  h3,
  count,
  countLabel,
  selected,
  addMode,
  dataStatus,
  snapshot,
  releaseVersion,
  onAction,
  onMouseEnter,
  onMouseLeave,
}: {
  h3: string
  count: number
  countLabel: string
  selected: boolean
  addMode: boolean
  dataStatus: HexDataStatus
  snapshot: HexSnapshot | null
  releaseVersion: string | null
  onAction: (action: HexAction) => void
  onMouseEnter: () => void
  onMouseLeave: () => void
}) {
  const ready = dataStatus === 'ready'
  const processing = dataStatus === 'processing'

  return (
    <div
      data-testid="hover-card"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className="glass pointer-events-auto w-64 rounded-2xl px-3.5 py-3 shadow-[0_18px_50px_-24px_rgba(0,0,0,0.85)]"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-mono text-[11px] text-muted-foreground">{h3}</span>
        <StatusChip status={dataStatus} snapshot={snapshot} />
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="text-xl font-semibold tracking-tight tabular-nums">{formatCount(count)}</span>
        <span className="text-xs text-muted-foreground">{countLabel}</span>
      </div>
      <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
        {snapshot === 'stale'
          ? `Older snapshot${releaseVersion ? ` ${releaseVersion}` : ''}. Process again to refresh.`
          : snapshot === 'current'
            ? `Current snapshot${releaseVersion ? ` ${releaseVersion}` : ''}. Open inspect to see rows.`
            : processing
              ? 'An ingestion job is already queued for this hex.'
              : 'No processed data yet. Empty hexes stay unfilled until you process them.'}
      </p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <ActionButton disabled={!ready} onClick={() => onAction('query')}>
          Inspect
        </ActionButton>
        <ActionButton disabled={processing} onClick={() => onAction('process')}>
          {ready ? 'Reprocess' : 'Process'}
        </ActionButton>
        <ActionButton onClick={() => onAction('workflow')}>Workflow</ActionButton>
      </div>
      <p className="mt-2 text-[10px] text-muted-foreground">
        {ready
          ? selected
            ? 'Click the hex to inspect · Shift-click to remove it'
            : 'Click the hex to inspect · Shift-click to add'
          : addMode
            ? 'Click the hex to add it.'
            : 'Click to select · Shift-click to add'}
      </p>
    </div>
  )
}

function StatusChip({ status, snapshot }: { status: HexDataStatus; snapshot: HexSnapshot | null }) {
  const label =
    status === 'processing' ? 'Processing' : snapshot === 'current' ? 'Current' : snapshot === 'stale' ? 'Old snapshot' : 'No Data'
  return (
    <span
      className={cn(
        'rounded-full px-1.5 py-px text-[10px] font-medium',
        snapshot === 'current' && 'bg-[#2ee6a6]/15 text-[#2ee6a6]',
        snapshot === 'stale' && 'bg-[#f5c451]/15 text-[#f5c451]',
        status === 'processing' && 'bg-select/15 text-select',
        status === 'missing' && 'bg-white/10 text-muted-foreground',
      )}
    >
      {label}
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
