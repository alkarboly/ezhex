import { densityGradientCss } from '../../lib/color-scale'
import { formatCount } from '../../lib/format'
import { cn } from '../../lib/utils'
import type { HexAction, HexDataStatus } from '../../types/workflows'

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
  const ready = dataStatus === 'ready'
  const processing = dataStatus === 'processing'
  return (
    <div
      data-testid="hover-card"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className="glass pointer-events-auto w-72 rounded-2xl px-3.5 py-3 shadow-[0_18px_50px_-24px_rgba(0,0,0,0.85)]"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] text-muted-foreground">{h3}</span>
        <StatusChip status={dataStatus} />
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="text-2xl font-semibold tracking-tight tabular-nums">{formatCount(count)}</span>
        <span className="text-xs text-muted-foreground">{countLabel}</span>
      </div>
      <div className="relative mt-2 h-1.5 rounded-full" style={{ background: densityGradientCss() }}>
        <span
          className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-background"
          style={{ left: `${maxCount > 0 ? (count / maxCount) * 100 : 0}%` }}
        />
      </div>
      <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
        {ready
          ? 'This hex has processed data. Filter it, or add it to a workflow.'
          : processing
            ? 'An ingestion job is already queued for this hex.'
            : 'No processed data yet. Request a job to ingest this hex.'}
      </p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <ActionButton disabled={!ready} onClick={() => onAction('query')}>
          Query
        </ActionButton>
        <ActionButton disabled={processing} onClick={() => onAction('process')}>
          {ready ? 'Reprocess' : 'Process'}
        </ActionButton>
        <ActionButton onClick={() => onAction('workflow')}>Workflow</ActionButton>
      </div>
      <p className="mt-2 text-[10px] text-muted-foreground">
        {selected
          ? addMode
            ? 'Click the hex to remove it from the set.'
            : 'Shift-click to remove · the set stays selected'
          : addMode
            ? 'Click the hex to add it.'
            : 'Click to select · Shift-click to add'}
      </p>
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
