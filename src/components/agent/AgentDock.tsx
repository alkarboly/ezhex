import { ArrowUpRight, ChevronDown, Cloud, DatabaseZap, Funnel, Hexagon, RotateCcw, Sparkles, type LucideIcon } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { AGENT_CAPABILITIES, AGENT_SUGGESTIONS } from '../../lib/agent-capabilities'
import { cn } from '../../lib/utils'
import { useAgent, type AgentTurn } from '../../store/agent-store'
import { useExplorer } from '../../store/explorer-store'
import { AgentComposer, DrawBar } from './AgentComposer'
import { AgentTurnCard } from './AgentTurnCard'
import { agentPrompt, attachAgentPolygon, stopAgent } from './agent-runner'
import { AgentOrb } from './agent-ui'

const CAPABILITY_ICONS: Record<(typeof AGENT_CAPABILITIES)[number]['id'], LucideIcon> = {
  hexes: Hexagon,
  process: DatabaseZap,
  query: Funnel,
  enrich: Cloud,
}

const STEP_STATUS: Record<string, string> = {
  plan: 'Understanding the request',
  region: 'Finding hexes',
  process: 'Processing hexes',
  query: 'Building the query',
  weather: 'Pulling weather',
  run: 'Running the workflow',
}

export function AgentDock({ mobile }: { mobile: boolean }) {
  const open = useAgent((state) => state.open)
  const setOpen = useAgent((state) => state.setOpen)
  const unread = useAgent((state) => state.unread)
  const drawing = useAgent((state) => state.drawing)
  const latest = useAgent((state) => state.turns[state.turns.length - 1] ?? null)
  const turnCount = useAgent((state) => state.turns.length)
  const introHint = useExplorer((state) => state.introHint)
  const busy = latest?.status === 'working' || latest?.status === 'running'

  const openAgent = () => {
    useExplorer.getState().dismissIntroHint()
    setOpen(true)
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        const state = useAgent.getState()
        if (state.open) state.setOpen(false)
        else openAgent()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const status = !open && latest ? launcherStatus(latest) : null

  return (
    <>
      {open && <AgentPanel mobile={mobile} onClose={() => setOpen(false)} />}
      {drawing && !open && (
        <div
          className="pointer-events-none absolute z-40 flex justify-center"
          style={mobile ? { left: 12, right: 12, bottom: 140 } : { left: 84, bottom: 18 }}
        >
          <DrawBar
            floating
            onDone={(polygon) => {
              attachAgentPolygon(polygon, 'Drawn polygon')
              useAgent.getState().setOpen(true)
            }}
          />
        </div>
      )}
      {!open && (
        <div
          className="group pointer-events-none absolute left-3 z-40 flex items-end gap-2.5"
          style={{ bottom: mobile ? 78 : 14 }}
        >
          <button
            type="button"
            aria-label="Open the WorldPulse agent"
            onClick={openAgent}
            className="wp-bubble-pop pointer-events-auto relative grid size-[4.25rem] place-items-center rounded-[1.65rem] rounded-bl-[6px] bg-[#071217] shadow-[0_16px_40px_-16px_rgba(61,222,192,0.85),0_0_0_1px_rgba(61,222,192,0.28)] transition-transform duration-200 hover:scale-[1.05] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary active:scale-95"
          >
            {introHint && (
              <>
                <span aria-hidden className="wp-intro-ping pointer-events-none absolute inset-[-6px] rounded-[1.85rem]" />
                <span aria-hidden className="wp-intro-ping pointer-events-none absolute inset-[-6px] rounded-[1.85rem] [animation-delay:0.7s]" />
              </>
            )}
            <AgentOrb size={58} busy={busy} />
            <span
              aria-hidden
              className="absolute -bottom-1 left-2 size-3 rotate-45 rounded-[2px] bg-[#071217] shadow-[1px_1px_0_rgba(61,222,192,0.28)]"
            />
            {(unread || latest?.status === 'review' || latest?.status === 'confirm') && (
              <span className="absolute top-0.5 right-0.5 grid size-[18px] place-items-center rounded-full border-2 border-[#05080c] bg-select text-[9px] font-bold text-[#1c1300] shadow-[0_0_12px_rgba(244,194,91,0.9)]">
                {latest?.status === 'review' || latest?.status === 'confirm' ? '!' : '•'}
              </span>
            )}
          </button>
          {status ? (
            <button
              type="button"
              onClick={openAgent}
              className="glass wp-rise pointer-events-auto flex max-w-[17rem] items-center gap-2 rounded-full py-1.5 pr-3.5 pl-2.5 text-[11.5px]"
            >
              <span
                className={cn(
                  'size-1.5 shrink-0 rounded-full',
                  busy ? 'wp-motion bg-select animate-[wp-blink_1s_ease-in-out_infinite]' : 'bg-primary',
                )}
              />
              <span className="truncate">{status}</span>
            </button>
          ) : (
            !mobile &&
            turnCount === 0 && (
              <button
                type="button"
                onClick={openAgent}
                className={cn(
                  'glass wp-rise pointer-events-auto rounded-full px-3.5 py-1.5 text-left text-[12px] text-foreground/90',
                  introHint && 'shadow-[0_0_24px_-6px_rgba(61,222,192,0.9)]',
                )}
              >
                <Sparkles className="mr-1 inline size-3.5 -translate-y-px text-primary" />
                {introHint ? 'Click to start' : 'Ask the agent'}
              </button>
            )
          )}
        </div>
      )}
    </>
  )
}

function AgentPanel({ mobile, onClose }: { mobile: boolean; onClose: () => void }) {
  const turns = useAgent((state) => state.turns)
  const latest = turns[turns.length - 1] ?? null
  const busy = latest?.status === 'working' || latest?.status === 'running'
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)

  useEffect(() => {
    const element = scrollRef.current
    if (!element || !stickRef.current) return
    element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' })
  }, [turns])

  const newSession = () => {
    if (busy) stopAgent()
    useAgent.getState().reset()
    useAgent.getState().setAttachment(null)
  }

  return (
    <section
      data-agent-panel
      role="dialog"
      aria-label="WorldPulse agent"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose()
      }}
      className={cn(
        'glass pointer-events-auto absolute z-40 flex origin-bottom-left animate-[wp-agent-open_280ms_cubic-bezier(0.2,0.8,0.2,1)] flex-col overflow-hidden rounded-[26px]',
        mobile
          ? 'inset-x-2 bottom-2 h-[64dvh]'
          : 'bottom-3 left-3 h-[min(46rem,calc(100%-1.5rem))] w-[min(25rem,calc(100%-1.5rem))]',
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[radial-gradient(70%_100%_at_15%_0%,rgba(61,222,192,0.16),transparent_70%)]"
      />
      <header className="relative flex items-center gap-2.5 px-3.5 pt-3 pb-2.5">
        <AgentOrb size={34} busy={busy} />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold tracking-tight">WorldPulse Agent</p>
          <p className="truncate text-[10.5px] text-muted-foreground">{headerStatus(latest)}</p>
        </div>
        <button
          type="button"
          aria-label="New session"
          title="New session"
          disabled={turns.length === 0}
          onClick={newSession}
          className="grid size-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground disabled:opacity-30"
        >
          <RotateCcw className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label="Minimize the agent"
          title="Minimize"
          onClick={onClose}
          className="grid size-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
        >
          <ChevronDown className="size-4" />
        </button>
        <div className="absolute inset-x-0 bottom-0 h-px overflow-hidden bg-white/[0.06]">
          {busy && <div className="wp-shimmer-bar absolute inset-y-0 left-0 w-1/3" />}
        </div>
      </header>
      <div
        ref={scrollRef}
        onScroll={(event) => {
          const element = event.currentTarget
          stickRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 140
        }}
        className="relative min-h-0 flex-1 overflow-y-auto px-3.5 pt-3 pb-4"
      >
        {turns.length === 0 ? (
          <AgentIntro />
        ) : (
          <div className="grid gap-6">
            {turns.map((turn, index) => (
              <AgentTurnCard key={turn.id} turn={turn} latest={index === turns.length - 1} />
            ))}
          </div>
        )}
      </div>
      <AgentComposer busy={busy} mobile={mobile} />
    </section>
  )
}

function AgentIntro() {
  return (
    <div className="grid gap-4">
      <div className="flex flex-col items-center pt-2 text-center">
        <AgentOrb size={60} />
        <h2 className="mt-3 text-[17px] font-semibold tracking-tight">What should I build?</h2>
        <p className="mt-1 max-w-[19rem] text-[11.5px] leading-[1.55] text-muted-foreground">
          Describe the data you want. I find the hexes, process anything missing, and write the query. Weather,
          a custom polygon, and AI enhance are optional add-ons. You approve before anything is charged.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {AGENT_CAPABILITIES.map((capability, index) => {
          const Icon = CAPABILITY_ICONS[capability.id]
          return (
            <div
              key={capability.id}
              className="wp-rise rounded-xl border border-white/[0.06] bg-white/[0.025] p-2.5"
              style={{ animationDelay: `${index * 60}ms` }}
            >
              <p className="flex items-center gap-1.5 text-[11.5px] font-medium">
                <Icon className="size-3.5 text-primary" />
                {capability.title}
              </p>
              <p className="mt-1 text-[10.5px] leading-[1.45] text-muted-foreground">{capability.body}</p>
            </div>
          )
        })}
      </div>
      <div className="grid gap-1.5">
        <p className="text-[9.5px] font-medium tracking-[0.16em] text-muted-foreground uppercase">Try</p>
        {AGENT_SUGGESTIONS.map((suggestion, index) => (
          <button
            key={suggestion}
            type="button"
            onClick={() => agentPrompt(suggestion)}
            className="wp-rise group flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-left text-[11.5px] leading-snug text-foreground/90 transition-colors hover:border-primary/35 hover:bg-primary/[0.07]"
            style={{ animationDelay: `${240 + index * 60}ms` }}
          >
            <Sparkles className="size-3.5 shrink-0 text-primary" />
            <span className="flex-1">{suggestion}</span>
            <ArrowUpRight className="size-3.5 shrink-0 text-primary opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
        ))}
      </div>
    </div>
  )
}

function activeStep(turn: AgentTurn) {
  return turn.steps.find((step) => step.state === 'active') ?? null
}

function launcherStatus(turn: AgentTurn): string | null {
  if (turn.status === 'confirm') return 'Confirm the selected hexes'
  if (turn.status === 'review') return 'Ready for your approval'
  if (turn.status === 'done') return turn.result ? `Done · ${turn.result.rowCount.toLocaleString()} rows` : null
  if (turn.status === 'error') return 'The agent needs attention'
  if (turn.status !== 'working' && turn.status !== 'running') return null
  const step = activeStep(turn)
  if (!step) return 'Working'
  if (step.id === 'process') {
    const done = turn.batches.filter((batch) => batch.state === 'done' || batch.state === 'error').length
    return turn.batches.length > 0
      ? `Processing hex ${Math.min(done + 1, turn.batches.length)} of ${turn.batches.length}`
      : STEP_STATUS.process
  }
  return STEP_STATUS[step.id] ?? 'Working'
}

function headerStatus(turn: AgentTurn | null): string {
  if (!turn) return 'Finds hexes, processes data, builds queries, adds weather'
  if (turn.status === 'confirm') return 'Waiting for you to confirm the hexes'
  if (turn.status === 'review') return 'Waiting for your approval'
  if (turn.status === 'done') return turn.result ? `Workflow ran · ${turn.result.rowCount.toLocaleString()} rows` : 'Done'
  if (turn.status === 'error') return 'Needs attention'
  if (turn.status === 'stopped') return 'Stopped'
  if (turn.status === 'replaced') return 'Ready'
  return launcherStatus(turn) ?? 'Working'
}
