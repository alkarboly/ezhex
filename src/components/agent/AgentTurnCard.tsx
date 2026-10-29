import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  Brain,
  Check,
  CircleAlert,
  CloudHail,
  Code,
  DatabaseZap,
  Download,
  Funnel,
  Hexagon,
  MapPin,
  MapPinned,
  Minus,
  Rocket,
  Sparkles,
  UserCheck,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useMemo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AGENT_PRESENCE_LABELS } from '../../lib/agent-capabilities'
import { polygonVertexCount } from '../../lib/polygon-input'
import { downloadCsv, featureRowsToCsv } from '../../lib/csv'
import type { FeatureRow } from '../../lib/feature-rows'
import { cn } from '../../lib/utils'
import { quoteAgentAssist } from '../../services/agent-assist'
import type { AgentBatch, AgentStep, AgentStepId, AgentTurn } from '../../store/agent-store'
import { useExplorer } from '../../store/explorer-store'
import type { AgentName, AgentPlan, AgentQueryResponse, AgentRegion } from '../../types/agents'
import type { AiColumnEnrichment, GeofenceEnrichment } from '../../types/enrichments'
import { agentPrompt, approveAgent, confirmAgentHexes, formatUsd, reviewInInspect, stopAgent } from './agent-runner'
import { AgentOrb, Chip, formatElapsed, HexGlyph, ShimmerBar, useNow, useTypewriter, type HexGlyphTone } from './agent-ui'

const STEP_META: Record<AgentStepId, { title: string; icon: LucideIcon }> = {
  plan: { title: 'Understand the request', icon: Brain },
  region: { title: 'Find the hexes', icon: Hexagon },
  process: { title: 'Process missing hexes', icon: DatabaseZap },
  query: { title: 'Build the query', icon: Funnel },
  geofence: { title: 'Geofence', icon: MapPinned },
  weather: { title: 'Weather', icon: CloudHail },
  ai_column: { title: 'AI column', icon: Sparkles },
  review: { title: 'Your review', icon: UserCheck },
  run: { title: 'Run the workflow', icon: Rocket },
}

const AGENT_LABELS: Record<AgentName, string> = {
  orchestrator: 'Orchestrator',
  process: 'Process agent',
  geofence: 'Geofence agent',
  hail_history: 'Weather agent',
  ai_column: 'AI column agent',
}

const MAX_GLYPHS = 48
const typed = new Set<string>()

export function AgentTurnCard({ turn, latest }: { turn: AgentTurn; latest: boolean }) {
  return (
    <article className="grid gap-2.5">
      <div className="wp-rise flex justify-end">
        <p className="max-w-[85%] rounded-2xl rounded-br-md border border-primary/20 bg-primary/[0.12] px-3 py-2 text-[12.5px] leading-5 text-foreground">
          {turn.prompt}
        </p>
      </div>
      <AgentReply turn={turn} latest={latest} />
      {turn.plan && <SpecialistCast turn={turn} />}
      {turn.plan && <IntentChips plan={turn.plan} />}
      {(turn.plan || turn.status !== 'working') && (
        <ol className="mt-1 grid">
          {turn.steps.map((step, index) => (
            <StepRow key={step.id} step={step} turn={turn} last={index === turn.steps.length - 1} />
          ))}
        </ol>
      )}
      {turn.error && <ErrorCard turn={turn} />}
    </article>
  )
}

function AgentReply({ turn, latest }: { turn: AgentTurn; latest: boolean }) {
  const reply = turn.plan?.reply ?? ''
  const animate = latest && reply.length > 0 && !typed.has(turn.id)
  const { shown, typing } = useTypewriter(reply, animate)
  useEffect(() => {
    if (reply && !typing) typed.add(turn.id)
  }, [reply, typing, turn.id])
  const busy = turn.status === 'working' || turn.status === 'running' || turn.status === 'confirm'
  if (!turn.plan) {
    if (turn.status !== 'working') return null
    return (
      <div className="wp-rise flex items-center gap-2">
        <AgentOrb size={22} busy />
        <span className="text-[12px] text-muted-foreground">
          Reading your request
          <ThinkingDots />
        </span>
      </div>
    )
  }
  return (
    <div className="flex items-start gap-2">
      <AgentOrb size={22} busy={busy} className="mt-0.5" />
      <p className="min-w-0 text-[12.5px] leading-5 text-foreground/95">
        <InlineCode text={shown} />
        {typing && (
          <span className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 bg-primary animate-[wp-caret_0.9s_steps(1)_infinite]" />
        )}
      </p>
    </div>
  )
}

function ThinkingDots() {
  return (
    <span className="ml-0.5 inline-flex gap-0.5">
      {[0, 160, 320].map((delay) => (
        <span
          key={delay}
          className="wp-motion inline-block size-1 translate-y-[-1px] rounded-full bg-primary animate-[wp-blink_1s_ease-in-out_infinite]"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  )
}

function InlineCode({ text }: { text: string }) {
  const parts = text.split('`')
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <code key={index} className="rounded bg-white/[0.08] px-1 py-px font-mono text-[11px] text-[#cbb8ff]">
            {part}
          </code>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  )
}

const SPECIALISTS: { id: AgentStepId; label: string; icon: LucideIcon }[] = [
  { id: 'plan', label: 'Orchestrator', icon: Brain },
  { id: 'region', label: 'Hexes', icon: Hexagon },
  { id: 'process', label: 'Process', icon: DatabaseZap },
  { id: 'query', label: 'Query', icon: Funnel },
  { id: 'geofence', label: 'Geofence', icon: MapPinned },
  { id: 'weather', label: 'Weather', icon: CloudHail },
  { id: 'ai_column', label: 'AI column', icon: Sparkles },
  { id: 'run', label: 'Run', icon: Rocket },
]

function SpecialistCast({ turn }: { turn: AgentTurn }) {
  return (
    <ul className="flex flex-wrap gap-1 pl-[30px]">
      {SPECIALISTS.map((specialist, index) => {
        const step = turn.steps.find((entry) => entry.id === specialist.id)
        const state = step?.state ?? 'pending'
        const Icon = specialist.icon
        return (
          <li
            key={specialist.id}
            className={cn(
              'wp-rise inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] transition-colors duration-300',
              state === 'active' && 'border-primary/40 bg-primary/15 text-primary',
              state === 'done' && 'border-primary/25 bg-primary/[0.08] text-foreground/90',
              state === 'waiting' && 'border-select/40 bg-select/15 text-select',
              state === 'error' && 'border-destructive/40 bg-destructive/10 text-destructive',
              (state === 'pending' || state === 'skipped') && 'border-white/[0.06] bg-white/[0.02] text-muted-foreground/70',
            )}
            style={{ animationDelay: `${index * 45}ms` }}
          >
            <Icon className="size-3" />
            {specialist.label}
          </li>
        )
      })}
    </ul>
  )
}

function IntentChips({ plan }: { plan: AgentPlan }) {
  const intent = plan.intent
  const chips: { key: string; node: (delay: number) => ReactNode }[] = [
    {
      key: 'region',
      node: (delay) => (
        <Chip tone="primary" delay={delay} icon={<MapPin className="size-3 shrink-0" />}>
          {regionLabel(plan.region)}
        </Chip>
      ),
    },
    { key: 'dataset', node: (delay) => <Chip delay={delay}>{intent.dataset === 'all' ? 'all themes' : intent.dataset}</Chip> },
    ...intent.category_terms.map((term) => ({ key: `term-${term}`, node: (delay: number) => <Chip delay={delay}>{term}</Chip> })),
  ]
  if (intent.search) chips.push({ key: 'search', node: (delay) => <Chip delay={delay}>“{intent.search}”</Chip> })
  if (intent.confidence_min != null) {
    chips.push({ key: 'confidence', node: (delay) => <Chip delay={delay}>confidence ≥ {intent.confidence_min}</Chip> })
  }
  if (intent.open_only) chips.push({ key: 'open', node: (delay) => <Chip delay={delay}>open now</Chip> })
  for (const field of intent.require) {
    chips.push({ key: `has-${field}`, node: (delay) => <Chip delay={delay}>{AGENT_PRESENCE_LABELS[field]}</Chip> })
  }
  if (plan.region.polygon) {
    chips.push({ key: 'fence', node: (delay) => <Chip delay={delay}>fence · keep {intent.geofence_keep ?? 'inside'}</Chip> })
  }
  if (intent.hail_days != null) {
    chips.push({
      key: 'hail',
      node: (delay) => (
        <Chip tone="amber" delay={delay} icon={<CloudHail className="size-3 shrink-0" />}>
          {intent.hail_days} days of hail
        </Chip>
      ),
    })
  }
  if (intent.ai_column) {
    const ai = intent.ai_column
    chips.push({
      key: 'ai',
      node: (delay) => (
        <Chip tone="violet" delay={delay} icon={<Sparkles className="size-3 shrink-0" />}>
          {ai.column} · {ai.value_type}
        </Chip>
      ),
    })
  }
  return <div className="flex flex-wrap gap-1 pl-[30px]">{chips.map((chip, index) => <span key={chip.key}>{chip.node(index * 55)}</span>)}</div>
}

function StepRow({ step, turn, last }: { step: AgentStep; turn: AgentTurn; last: boolean }) {
  const meta = STEP_META[step.id]
  const now = useNow(step.state === 'active')
  const elapsed = step.startedAt ? (step.endedAt ?? (step.state === 'active' ? now : step.startedAt)) - step.startedAt : null
  const dim = step.state === 'pending' || step.state === 'skipped'
  const detail =
    (step.id === 'review' || step.id === 'region') && turn.status === 'replaced'
      ? 'Replaced by your next request'
      : step.detail
  return (
    <li className="relative grid grid-cols-[22px_minmax(0,1fr)] gap-x-2.5">
      {!last && (
        <span
          aria-hidden
          className={cn(
            'absolute top-[24px] bottom-0 left-[10.5px] w-px transition-colors duration-500',
            step.state === 'done' ? 'bg-primary/50' : 'bg-white/[0.08]',
          )}
        />
      )}
      <StepNode state={step.state} icon={meta.icon} />
      <div className={cn('min-w-0', last ? 'pb-0.5' : 'pb-3.5')}>
        <div className="flex min-h-[22px] items-center justify-between gap-2">
          <p
            className={cn(
              'text-[12px] font-medium transition-colors',
              dim && 'text-muted-foreground/70',
              step.state === 'active' && 'text-foreground',
              step.state === 'waiting' && 'text-select',
              step.state === 'error' && 'text-destructive',
            )}
          >
            {meta.title}
          </p>
          {elapsed != null && step.state !== 'skipped' && step.state !== 'waiting' && (
            <span className="font-mono text-[10px] text-muted-foreground tabular-nums">{formatElapsed(elapsed)}</span>
          )}
        </div>
        {detail && step.state !== 'pending' && (
          <p className={cn('text-[11px] leading-4', step.state === 'error' ? 'text-destructive/90' : 'text-muted-foreground')}>
            {detail}
          </p>
        )}
        <StepBody step={step} turn={turn} />
      </div>
    </li>
  )
}

function StepNode({ state, icon: Icon }: { state: AgentStep['state']; icon: LucideIcon }) {
  return (
    <span className="relative z-[1] grid size-[22px] place-items-center">
      {state === 'active' && <span aria-hidden className="wp-agent-ring absolute inset-0 rounded-full" data-busy="true" />}
      {state === 'waiting' && (
        <span aria-hidden className="wp-motion absolute -inset-1 rounded-full bg-select/25 animate-[wp-blink_1.4s_ease-in-out_infinite]" />
      )}
      <span
        className={cn(
          'relative grid place-items-center rounded-full transition-all duration-300',
          state === 'active' ? 'size-[18px] bg-[#071017]' : 'size-[22px]',
          state === 'pending' && 'border border-white/[0.12] bg-[#0a1017]',
          state === 'skipped' && 'border border-dashed border-white/[0.14] bg-transparent',
          state === 'done' && 'bg-primary shadow-[0_0_12px_-2px_rgba(61,222,192,0.8)]',
          state === 'waiting' && 'border border-select/60 bg-[#1c1608]',
          state === 'error' && 'border border-destructive/60 bg-destructive/15',
        )}
      >
        {state === 'done' ? (
          <Check className="size-3 text-primary-foreground" strokeWidth={3} />
        ) : state === 'error' ? (
          <X className="size-3 text-destructive" strokeWidth={3} />
        ) : state === 'skipped' ? (
          <Minus className="size-3 text-muted-foreground/60" />
        ) : (
          <Icon
            className={cn(
              'size-3',
              state === 'active' && 'text-primary',
              state === 'waiting' && 'text-select',
              state === 'pending' && 'text-muted-foreground/60',
            )}
          />
        )}
      </span>
    </span>
  )
}

function StepBody({ step, turn }: { step: AgentStep; turn: AgentTurn }) {
  if (step.state === 'pending') return null
  if (step.id === 'region' && turn.plan) return <RegionBody turn={turn} plan={turn.plan} />
  if (step.id === 'process' && turn.batches.length > 0) return <BatchList batches={turn.batches} />
  if (step.id === 'query' && turn.query) return <QueryBody query={turn.query} />
  if (step.id === 'geofence' && turn.query) return <GeofenceBody query={turn.query} />
  if (step.id === 'weather' && turn.hail) return <WeatherBody turn={turn} />
  if (step.id === 'ai_column' && turn.query) return <AiColumnBody query={turn.query} />
  if (step.id === 'review' && turn.query && (turn.status === 'review' || turn.status === 'running')) {
    return <ReviewBody turn={turn} query={turn.query} />
  }
  if (step.id === 'run' && step.state === 'active') return <ShimmerBar className="mt-2" />
  if (step.id === 'run' && turn.result) return <ResultCard turn={turn} />
  return null
}

function RegionBody({ turn, plan }: { turn: AgentTurn; plan: AgentPlan }) {
  const selected = useExplorer((state) => state.selectedCells)
  const cells = turn.status === 'confirm' ? selected : plan.h3_cells
  const ready = useMemo(() => new Set(plan.ready), [plan.ready])
  const missing = useMemo(() => new Set(plan.missing), [plan.missing])
  const shown = cells.slice(0, MAX_GLYPHS)
  const hidden = cells.length - MAX_GLYPHS
  const waiting = turn.status === 'confirm'
  return (
    <div className="mt-2 grid gap-1.5">
      <div className="flex flex-wrap items-center gap-[3px]">
        {shown.map((cell, index) => (
          <HexGlyph
            key={cell}
            tone={ready.has(cell) ? 'ready' : missing.has(cell) || waiting ? 'missing' : 'idle'}
            delay={Math.min(index, 20) * 12}
          />
        ))}
        {hidden > 0 && <span className="ml-1 font-mono text-[10px] text-muted-foreground">+{hidden}</span>}
      </div>
      <div className="flex gap-3 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <HexGlyph tone="ready" size={9} /> has data
        </span>
        <span className="inline-flex items-center gap-1">
          <HexGlyph tone="missing" size={9} /> needs processing
        </span>
      </div>
      <Notes notes={plan.notes} />
      {waiting && (
        <div className="wp-rise overflow-hidden rounded-2xl border border-select/35 bg-select/[0.07] p-2.5">
          <p className="text-[11.5px] font-medium text-foreground">
            {plan.region.kind === 'place'
              ? `I matched ${plan.region.label}`
              : `Confirm these ${cells.length.toLocaleString()} hexes`}
          </p>
          <p className="mt-0.5 text-[10.5px] leading-4 text-muted-foreground">
            {plan.region.kind === 'place'
              ? `${cells.length.toLocaleString()} hexes around this area · ${plan.region.radius_km} km. Click the map to add or remove hexes, then confirm.`
              : 'Click hexes on the map to add or remove them. Processing starts one hex at a time after you confirm.'}
          </p>
          <div className="mt-2 flex gap-1.5">
            <button
              type="button"
              disabled={cells.length === 0}
              onClick={() => void confirmAgentHexes(turn.id)}
              className="h-8 flex-1 rounded-full bg-primary text-[12px] font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
            >
              Confirm hexes
            </button>
            <button
              type="button"
              onClick={stopAgent}
              className="h-8 rounded-full bg-white/[0.06] px-3 text-[12px] hover:bg-white/[0.1]"
            >
              Stop
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function BatchList({ batches }: { batches: AgentBatch[] }) {
  return (
    <ul className="mt-2 grid gap-1.5">
      {batches.map((batch) => {
        const tone: HexGlyphTone =
          batch.state === 'running' ? 'running' : batch.state === 'done' ? 'done' : batch.state === 'error' ? 'error' : 'missing'
        return (
          <li
            key={batch.index}
            className={cn(
              'wp-rise rounded-xl border px-2.5 py-2 transition-colors duration-300',
              batch.state === 'running' && 'border-select/35 bg-select/[0.06]',
              batch.state === 'done' && 'border-primary/20 bg-primary/[0.04]',
              batch.state === 'error' && 'border-destructive/35 bg-destructive/[0.06]',
              batch.state === 'queued' && 'border-white/[0.06] bg-white/[0.02]',
            )}
            style={{ animationDelay: `${batch.index * 70}ms` }}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2">
                <span className="flex gap-[2px]">
                  {batch.cells.map((cell) => (
                    <HexGlyph key={cell} tone={tone} size={9} pulse={batch.state === 'running'} />
                  ))}
                </span>
                <span className="text-[11px] text-foreground/90">
                  Job {batch.index + 1}
                  <span className="text-muted-foreground">
                    {' '}
                    · {batch.cells.length === 1 ? shortHex(batch.cells[0]) : `${batch.cells.length} hexes`}
                  </span>
                </span>
              </span>
              <span
                className={cn(
                  'shrink-0 text-[10px]',
                  batch.state === 'running' && 'text-select',
                  batch.state === 'done' && 'text-primary',
                  batch.state === 'error' && 'text-destructive',
                  batch.state === 'queued' && 'text-muted-foreground',
                )}
              >
                {batch.state === 'queued' && 'Queued'}
                {batch.state === 'running' && 'Processing'}
                {batch.state === 'done' && `${(batch.rows ?? 0).toLocaleString()} rows`}
                {batch.state === 'error' && 'Failed'}
              </span>
            </div>
            {batch.state === 'running' && <ShimmerBar className="mt-1.5" />}
            {(batch.error || batch.log) && batch.state !== 'queued' && (
              <p
                className={cn(
                  'mt-1 truncate font-mono text-[9.5px]',
                  batch.error ? 'text-destructive/90' : 'text-muted-foreground',
                )}
                title={batch.error ?? batch.log ?? undefined}
              >
                {batch.error ?? batch.log}
              </p>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function QueryBody({ query }: { query: AgentQueryResponse }) {
  const filters = query.filters
  const kept = query.fenced_rows ?? query.matched_rows
  const filterChips: string[] = []
  if (filters.search) filterChips.push(`name has “${filters.search}”`)
  if (filters.confidenceMin != null) filterChips.push(`confidence ≥ ${filters.confidenceMin}`)
  if (filters.statuses.length > 0) filterChips.push(`status ${filters.statuses.join(', ')}`)
  if (filters.hasPhone === 'yes') filterChips.push('has phone')
  if (filters.hasEmail === 'yes') filterChips.push('has email')
  if (filters.hasSocials === 'yes') filterChips.push('has socials')
  if (filters.hasOfficialId === 'yes') filterChips.push('has official id')
  return (
    <div className="mt-2 grid gap-2">
      <div className="flex flex-wrap items-center gap-1 text-[10.5px]">
        <Funnelstep label="read" value={query.total_rows} />
        <span className="text-muted-foreground">→</span>
        <Funnelstep label="match" value={query.matched_rows} />
        {query.fenced_rows != null && (
          <>
            <span className="text-muted-foreground">→</span>
            <Funnelstep label="in fence" value={query.fenced_rows} highlight />
          </>
        )}
        {query.fenced_rows == null && <span className="sr-only">{kept} rows kept</span>}
      </div>
      <div className="flex flex-wrap gap-1">
        <Chip delay={0}>{filters.kind === 'all' ? 'all themes' : filters.kind}</Chip>
        {query.categories.slice(0, 6).map((pick, index) => (
          <Chip key={pick.value} tone="primary" delay={(index + 1) * 50}>
            {pick.value} · {pick.count}
          </Chip>
        ))}
        {query.categories.length > 6 && <Chip delay={350}>+{query.categories.length - 6} more</Chip>}
        {filterChips.map((label, index) => (
          <Chip key={label} delay={(index + 2) * 50}>
            {label}
          </Chip>
        ))}
      </div>
      {query.sample.length > 0 && (
        <ul className="grid overflow-hidden rounded-xl border border-white/[0.06]">
          {query.sample.slice(0, 4).map((row, index) => (
            <li
              key={row.key}
              className="wp-rise flex items-center justify-between gap-2 border-white/[0.05] px-2.5 py-1.5 text-[11px] not-first:border-t"
              style={{ animationDelay: `${index * 60}ms` }}
            >
              <span className="min-w-0 truncate">{rowLabel(row)}</span>
              <span className="shrink-0 truncate text-[10px] text-muted-foreground">{row.category ?? row.building_class ?? row.kind}</span>
            </li>
          ))}
        </ul>
      )}
      <details className="group rounded-xl border border-white/[0.06] bg-black/20">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2.5 py-1.5 text-[10.5px] text-muted-foreground hover:text-foreground">
          <Code className="size-3" />
          SQL the agent wrote
        </summary>
        <pre className="max-h-48 overflow-auto border-t border-white/[0.06] px-2.5 py-2 font-mono text-[9.5px] leading-[1.45] text-foreground/80">
          {query.sql}
        </pre>
      </details>
      <Notes notes={query.notes} />
    </div>
  )
}

function Funnelstep({ label, value, highlight = false }: { label: string; value: number; highlight?: boolean }) {
  return (
    <span
      className={cn(
        'wp-rise inline-flex items-baseline gap-1 rounded-lg px-1.5 py-0.5',
        highlight ? 'bg-primary/15 text-primary' : 'bg-white/[0.05] text-foreground/90',
      )}
    >
      <span className="font-mono font-medium tabular-nums">{value.toLocaleString()}</span>
      <span className="text-[9.5px] text-muted-foreground">{label}</span>
    </span>
  )
}

function GeofenceBody({ query }: { query: AgentQueryResponse }) {
  const fence = query.enrichments.find((step): step is GeofenceEnrichment => step.kind === 'geofence')
  if (!fence) return null
  return (
    <p className="mt-1.5 text-[11px] text-muted-foreground">
      Keep {fence.keep} · {polygonVertexCount(fence.polygon)} vertices. Applied on the workflow run, not as an ingest job.
    </p>
  )
}

function AiColumnBody({ query }: { query: AgentQueryResponse }) {
  const ai = query.enrichments.find((step): step is AiColumnEnrichment => step.kind === 'ai_column')
  if (!ai) return null
  return (
    <div className="mt-1.5 grid gap-0.5 text-[11px] text-muted-foreground">
      <p>
        <code className="rounded bg-white/[0.08] px-1 py-px font-mono text-[10.5px] text-[#cbb8ff]">{ai.column}</code>
        {' · '}
        {ai.value_type}. Written on Approve & run.
      </p>
      <p className="truncate" title={ai.prompt}>
        {ai.prompt}
      </p>
    </div>
  )
}

function WeatherBody({ turn }: { turn: AgentTurn }) {
  const hail = turn.hail
  if (!hail) return null
  const bars = [...hail.cells].sort((left, right) => (right.hail_mm_max ?? 0) - (left.hail_mm_max ?? 0)).slice(0, 18)
  const max = Math.max(1, ...bars.map((cell) => cell.hail_mm_max ?? 0))
  const floor = turn.query?.hail_window?.floor ?? null
  return (
    <div className="mt-2 grid gap-1.5">
      <div className="flex h-12 items-end gap-[3px] rounded-xl border border-select/20 bg-select/[0.04] px-2 pt-2 pb-1.5">
        {bars.map((cell, index) => {
          const value = cell.hail_mm_max ?? 0
          return (
            <span
              key={cell.h3}
              title={`${cell.h3} · ${value.toFixed(1)} mm · ${cell.hail_days} days`}
              className="wp-rise flex-1 rounded-t-sm bg-gradient-to-t from-select/50 to-select"
              style={{ height: `${Math.max(6, (value / max) * 100)}%`, opacity: value > 0 ? 1 : 0.25, animationDelay: `${index * 30}ms` }}
            />
          )
        })}
      </div>
      <p className="text-[10px] text-muted-foreground">
        {hail.start} to {hail.end} · NOAA MRMS MESH, max per hex
      </p>
      {floor && (
        <p className="text-[10px] text-select/90">
          These hexes entered the exchange on {floor}, so hail history starts there.
        </p>
      )}
    </div>
  )
}

function ReviewBody({ turn, query }: { turn: AgentTurn; query: AgentQueryResponse }) {
  const selected = useExplorer((state) => state.selectedCells)
  const draft = useExplorer((state) => state.draftEnrichments)
  const signature = useMemo(() => JSON.stringify(draft), [draft])
  const estimatedRows = query.fenced_rows ?? query.matched_rows
  const live = useQuery({
    queryKey: ['agent-review-quote', selected.join(','), signature, estimatedRows],
    queryFn: () => quoteAgentAssist({ h3_cells: [...selected], enrichments: draft, estimated_rows: estimatedRows }),
    enabled: turn.status === 'review' && selected.length > 0,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  })
  const quote = live.data ?? query.quote
  const running = turn.status === 'running'
  return (
    <div className="wp-rise mt-2 overflow-hidden rounded-2xl border border-primary/25 bg-[linear-gradient(160deg,rgba(61,222,192,0.1),rgba(8,12,18,0.35)_55%)]">
      <div className="flex items-center justify-between px-3 pt-2.5">
        <p className="text-[11px] font-medium">Quote for “{query.workflow_name}”</p>
        <span className="text-[10px] text-muted-foreground">{live.isFetching ? 'Updating' : 'Live'}</span>
      </div>
      <ul className="grid gap-1.5 px-3 py-2">
        {quote.lines.map((line, index) => (
          <li
            key={line.agent}
            className="wp-rise flex items-start justify-between gap-3 text-[11px]"
            style={{ animationDelay: `${index * 50}ms` }}
          >
            <span className="min-w-0">
              <span className="text-foreground/90">{AGENT_LABELS[line.agent]}</span>
              <span className="block truncate text-[10px] text-muted-foreground" title={line.reason}>
                {line.reason}
              </span>
            </span>
            <span className="shrink-0 font-mono tabular-nums">{formatUsd(line.clamped_usd_cents)}</span>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between border-t border-white/[0.06] px-3 py-2">
        <span className="text-[10.5px] text-muted-foreground">Balance {formatUsd(quote.balance_usd_cents)}</span>
        <span className="font-mono text-[14px] font-semibold text-primary tabular-nums">{formatUsd(quote.total_usd_cents)}</span>
      </div>
      <div className="flex gap-1.5 px-3 pb-3">
        <button
          type="button"
          disabled={running}
          onClick={() => void approveAgent(turn.id)}
          className="h-9 flex-1 rounded-full bg-primary text-[12px] font-semibold text-primary-foreground shadow-[0_0_28px_-8px_rgba(61,222,192,0.9)] transition-colors hover:bg-primary/90 disabled:opacity-60"
        >
          {running ? 'Running…' : 'Approve & run'}
        </button>
        <button
          type="button"
          disabled={running}
          onClick={reviewInInspect}
          className="h-9 rounded-full bg-white/[0.06] px-3 text-[12px] transition-colors hover:bg-white/[0.1] disabled:opacity-60"
        >
          Edit in Inspect
        </button>
      </div>
    </div>
  )
}

function ResultCard({ turn }: { turn: AgentTurn }) {
  const result = turn.result
  if (!result) return null
  const ai = turn.query?.enrichments.find((step): step is AiColumnEnrichment => step.kind === 'ai_column') ?? null
  const hail = turn.query?.enrichments.some((step) => step.kind === 'hail_history') ?? false
  const rows = sortForPreview(result.rows, ai?.column ?? null)
  return (
    <div className="wp-rise mt-2 grid gap-2">
      <div className="grid grid-cols-3 gap-1.5">
        <Stat label="Rows" value={result.rowCount.toLocaleString()} />
        <Stat label="Charged" value={formatUsd(result.spentCents)} />
        <Stat label="Agent tips" value={formatUsd(result.tipsCents)} amber />
      </div>
      {rows.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-white/[0.07]">
          <table className="w-full table-fixed text-left text-[10.5px]">
            <thead className="bg-white/[0.03] text-muted-foreground">
              <tr>
                <th className="px-2 py-1 font-medium">Row</th>
                {hail && <th className="w-16 px-2 py-1 text-right font-medium">Hail mm</th>}
                {ai && <th className="w-24 truncate px-2 py-1 text-right font-medium">{ai.column}</th>}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 5).map((row, index) => (
                <tr key={row.key} className="wp-rise border-t border-white/[0.05]" style={{ animationDelay: `${index * 60}ms` }}>
                  <td className="truncate px-2 py-1">{rowLabel(row)}</td>
                  {hail && <td className="px-2 py-1 text-right font-mono tabular-nums">{row.hail_mm_max == null ? '—' : row.hail_mm_max.toFixed(1)}</td>}
                  {ai && (
                    <td className="truncate px-2 py-1 text-right font-mono text-[#cbb8ff]">{formatAiValue(row.ai_columns[ai.column])}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {result.logs.some((line) => line.message.startsWith('agent run ')) && (
        <ul className="grid gap-0.5 font-mono text-[10px] text-muted-foreground">
          {result.logs
            .filter((line) => line.message.startsWith('agent run '))
            .map((line) => (
              <li key={`${line.at}-${line.message}`}>{line.message.replace(/^agent run /, '')}</li>
            ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          disabled={result.rows.length === 0}
          onClick={() => downloadCsv(`${slug(result.workflowName)}.csv`, featureRowsToCsv(result.rows))}
          className="inline-flex h-7 items-center gap-1 rounded-full bg-primary/15 px-2.5 text-[11px] font-medium text-primary hover:bg-primary/25 disabled:opacity-40"
        >
          <Download className="size-3" /> CSV
        </button>
        <Link to="/workflows" className="inline-flex h-7 items-center rounded-full bg-white/[0.06] px-2.5 text-[11px] hover:bg-white/[0.1]">
          Workflows
        </Link>
        <Link to="/ledger" className="inline-flex h-7 items-center rounded-full bg-white/[0.06] px-2.5 text-[11px] hover:bg-white/[0.1]">
          Ledger
        </Link>
      </div>
    </div>
  )
}

function Stat({ label, value, amber = false }: { label: string; value: string; amber?: boolean }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] px-2.5 py-1.5">
      <p className="text-[9.5px] tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className={cn('font-mono text-[13px] font-semibold tabular-nums', amber ? 'text-select' : 'text-foreground')}>{value}</p>
    </div>
  )
}

function ErrorCard({ turn }: { turn: AgentTurn }) {
  const error = turn.error
  if (!error) return null
  return (
    <div className="wp-rise rounded-2xl border border-destructive/35 bg-destructive/[0.08] p-3 text-[11.5px]">
      <p className="flex items-center gap-1.5 font-medium text-destructive">
        <CircleAlert className="size-3.5" />
        {error.kind === 'auth'
          ? 'Sign in to continue'
          : error.kind === 'limit'
            ? 'Workflow limit reached'
            : error.kind === 'credits'
              ? 'Not enough credits'
              : `${STEP_META[error.step].title} failed`}
      </p>
      <p className="mt-1 text-foreground/85">{error.message}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {error.kind === 'auth' && <ErrorLink to="/settings">Sign in</ErrorLink>}
        {error.kind === 'limit' && <ErrorLink to="/workflows">Manage workflows</ErrorLink>}
        {error.kind === 'credits' && <ErrorLink to="/ledger">Open ledger</ErrorLink>}
        {(turn.status === 'error' || turn.status === 'stopped') && (
          <button
            type="button"
            onClick={() => agentPrompt(turn.prompt)}
            className="h-7 rounded-full bg-white/[0.08] px-2.5 text-[11px] hover:bg-white/[0.12]"
          >
            Try again
          </button>
        )}
      </div>
    </div>
  )
}

function ErrorLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="inline-flex h-7 items-center rounded-full bg-primary px-2.5 text-[11px] font-medium text-primary-foreground">
      {children}
    </Link>
  )
}

function Notes({ notes }: { notes: readonly string[] }) {
  if (notes.length === 0) return null
  return (
    <ul className="grid gap-0.5">
      {notes.map((note) => (
        <li key={note} className="text-[10.5px] leading-4 text-muted-foreground">
          · {note}
        </li>
      ))}
    </ul>
  )
}

function shortHex(cell: string): string {
  return cell.length > 10 ? `${cell.slice(0, 6)}…${cell.slice(-3)}` : cell
}

function regionLabel(region: AgentRegion): string {
  if (region.kind === 'place') return `${region.label} · ${region.radius_km} km`
  if (region.kind === 'point') return `Map center · ${region.radius_km} km`
  return region.label
}

function rowLabel(row: FeatureRow): string {
  return row.name ?? row.address ?? (row.building_class ? `${row.building_class} building` : null) ?? row.id.slice(0, 12)
}

function sortForPreview(rows: readonly FeatureRow[], column: string | null): FeatureRow[] {
  if (!column) return [...rows]
  return [...rows].sort((left, right) => {
    const a = left.ai_columns[column]
    const b = right.ai_columns[column]
    if (typeof a === 'number' && typeof b === 'number') return b - a
    if (typeof a === 'boolean' && typeof b === 'boolean') return Number(b) - Number(a)
    return 0
  })
}

function formatAiValue(value: unknown): string {
  if (value == null) return '—'
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2)
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  return String(value)
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'agent-workflow'
}
