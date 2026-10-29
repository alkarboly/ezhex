import { CloudHail, DatabaseZap, Funnel, Hexagon, Sparkles } from 'lucide-react'
import { useAgent, type AgentStepId, type AgentTurn } from '../../store/agent-store'
import { AgentOrb, Chip, HexGlyph, ShimmerBar } from './agent-ui'

const STAGE: Record<AgentStepId, { kicker: string; line: (turn: AgentTurn) => string }> = {
  plan: { kicker: 'Orchestrator', line: () => 'Reading the request and choosing a region' },
  region: {
    kicker: 'Finding hexes',
    line: (turn) =>
      turn.status === 'confirm' && turn.plan
        ? `Confirm ${turn.plan.h3_cells.length.toLocaleString()} hexes · ${turn.plan.region.label}`
        : turn.plan
          ? `${turn.revealed.toLocaleString()} of ${turn.plan.h3_cells.length.toLocaleString()} hexes · ${turn.plan.region.label}`
          : 'Deriving hexes from the region',
  },
  process: {
    kicker: 'Process agent',
    line: (turn) => {
      const running = turn.batches.find((batch) => batch.state === 'running')
      const done = turn.batches.filter((batch) => batch.state === 'done').length
      if (running) return `Job ${running.runId ?? running.jobId ?? '…'} · hex ${running.index + 1} of ${turn.batches.length}`
      return done > 0 ? `${done} of ${turn.batches.length} hexes ready` : 'Creating one job per hex'
    },
  },
  query: {
    kicker: 'Query',
    line: (turn) => {
      if (!turn.query) return 'Reading the processed rows and choosing filters'
      const kept = turn.query.fenced_rows ?? turn.query.matched_rows
      return `${kept.toLocaleString()} of ${turn.query.total_rows.toLocaleString()} rows · ${turn.query.filters.kind}`
    },
  },
  weather: {
    kicker: 'Weather',
    line: (turn) =>
      turn.hail
        ? `Hail ${turn.hail.start} → ${turn.hail.end} · NOAA MESH`
        : 'Pulling weather for these hexes',
  },
  review: { kicker: 'Ready', line: (turn) => turn.query?.workflow_name ?? 'Waiting for your approval' },
  run: { kicker: 'Running', line: () => 'Saving the workflow and debiting the ledger' },
}

/** Live caption on the map while the agent builds a workflow. */
export function AgentStage({ mobile }: { mobile: boolean }) {
  const turn = useAgent((state) => state.turns[state.turns.length - 1] ?? null)
  const open = useAgent((state) => state.open)
  if (!turn) return null
  if (turn.status !== 'working' && turn.status !== 'running' && turn.status !== 'review' && turn.status !== 'confirm') {
    return null
  }

  const step = turn.steps.find((entry) => entry.state === 'active' || entry.state === 'waiting') ?? turn.steps.find((entry) => entry.state === 'done')
  if (!step) return null
  const copy = STAGE[step.id]
  const busy = turn.status === 'working' || turn.status === 'running'

  return (
    <div
      className="pointer-events-none absolute z-[25] flex justify-center"
      style={
        mobile
          ? { left: 12, right: 12, top: 'max(5.6rem, calc(env(safe-area-inset-top) + 5.2rem))' }
          : { left: open ? 440 : 96, right: 96, top: 64 }
      }
    >
      <div className="glass wp-rise pointer-events-none max-w-[28rem] overflow-hidden rounded-2xl px-3 py-2.5 shadow-[0_18px_50px_-24px_rgba(0,0,0,0.8)]">
        <div className="flex items-center gap-2.5">
          <AgentOrb size={28} busy={busy} />
          <div className="min-w-0 flex-1">
            <p className="text-[9.5px] font-medium tracking-[0.16em] text-primary uppercase">{copy.kicker}</p>
            <p className="truncate text-[12.5px] font-medium text-foreground">{copy.line(turn)}</p>
          </div>
        </div>
        {busy && <ShimmerBar className="mt-2" />}
        {step.id === 'region' && turn.plan && (
          <div className="mt-2 flex flex-wrap items-center gap-[3px]">
            {turn.plan.h3_cells.slice(0, 28).map((cell, index) => (
              <HexGlyph
                key={cell}
                tone={index < turn.revealed ? (turn.plan?.ready.includes(cell) ? 'ready' : 'missing') : 'idle'}
                delay={0}
                pulse={index === turn.revealed - 1}
              />
            ))}
            {turn.plan.h3_cells.length > 28 && (
              <span className="ml-1 font-mono text-[10px] text-muted-foreground">+{turn.plan.h3_cells.length - 28}</span>
            )}
          </div>
        )}
        {step.id === 'query' && turn.query && (
          <div className="mt-2 flex flex-wrap gap-1">
            <Chip tone="primary" icon={<Funnel className="size-3" />}>
              {turn.query.filters.kind}
            </Chip>
            {turn.query.categories.slice(0, 4).map((pick) => (
              <Chip key={pick.value}>
                {pick.value} · {pick.count}
              </Chip>
            ))}
          </div>
        )}
        {step.id === 'weather' && turn.hail && (
          <p className="mt-1.5 flex items-center gap-1 text-[10.5px] text-select">
            <CloudHail className="size-3" />
            {turn.hail.cells.filter((cell) => cell.hail_days > 0).length} hexes with hail
          </p>
        )}
        {(step.id === 'plan' || step.id === 'review') && (
          <div className="mt-2 flex flex-wrap gap-1 text-[10px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Hexagon className="size-3 text-primary" /> hexes
            </span>
            <span className="inline-flex items-center gap-1">
              <DatabaseZap className="size-3 text-primary" /> process
            </span>
            <span className="inline-flex items-center gap-1">
              <Funnel className="size-3 text-primary" /> query
            </span>
            <span className="inline-flex items-center gap-1">
              <CloudHail className="size-3 text-select" /> weather
            </span>
            <span className="inline-flex items-center gap-1">
              <Sparkles className="size-3 text-[#cbb8ff]" /> enrich
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
