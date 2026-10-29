import { create } from 'zustand'
import type { FeatureRow } from '../lib/feature-rows'
import type { AgentPlan, AgentQueryResponse } from '../types/agents'
import type { GeofencePolygon, HailHexSummary } from '../types/enrichments'

export const AGENT_STEP_IDS = ['plan', 'region', 'process', 'query', 'weather', 'review', 'run'] as const
export type AgentStepId = (typeof AGENT_STEP_IDS)[number]
export type AgentStepState = 'pending' | 'active' | 'done' | 'skipped' | 'error' | 'waiting'

export type AgentStep = {
  id: AgentStepId
  state: AgentStepState
  detail: string | null
  startedAt: number | null
  endedAt: number | null
}

export type AgentBatchState = 'queued' | 'running' | 'done' | 'error'

export type AgentBatch = {
  index: number
  cells: string[]
  state: AgentBatchState
  jobId: string | null
  runId: string | null
  rows: number | null
  log: string | null
  error: string | null
}

export type AgentTurnStatus = 'working' | 'confirm' | 'review' | 'running' | 'done' | 'error' | 'stopped' | 'replaced'

export type AgentHailPreview = {
  start: string
  end: string
  days: number
  cells: HailHexSummary[]
}

export type AgentResult = {
  workflowId: string
  workflowName: string
  runId: string
  rowCount: number
  rows: FeatureRow[]
  spentCents: number
  tipsCents: number
}

export type AgentErrorKind = 'auth' | 'limit' | 'credits' | 'generic'

export type AgentTurn = {
  id: string
  prompt: string
  createdAt: number
  status: AgentTurnStatus
  steps: AgentStep[]
  plan: AgentPlan | null
  batches: AgentBatch[]
  revealed: number
  query: AgentQueryResponse | null
  hail: AgentHailPreview | null
  hailError: string | null
  /** Saved on approve. A retry re-runs it instead of saving a duplicate. */
  workflow: { id: string; name: string } | null
  result: AgentResult | null
  error: { message: string; kind: AgentErrorKind; step: AgentStepId } | null
}

export type AgentAttachment = { polygon: GeofencePolygon; label: string; vertices: number; simplified: boolean }

type AgentState = {
  open: boolean
  /** Something finished or needs approval while the panel was closed. */
  unread: boolean
  weather: boolean
  attachment: AgentAttachment | null
  drawing: boolean
  turns: AgentTurn[]
  /** Hexes in the batch being processed right now. The map pulses them. */
  processingCells: string[]
  setOpen: (open: boolean) => void
  setWeather: (weather: boolean) => void
  setAttachment: (attachment: AgentAttachment | null) => void
  setDrawing: (drawing: boolean) => void
  setProcessingCells: (cells: string[]) => void
  addTurn: (turn: AgentTurn) => void
  patchTurn: (id: string, patch: Partial<AgentTurn> | ((turn: AgentTurn) => Partial<AgentTurn>)) => void
  patchStep: (id: string, step: AgentStepId, patch: Partial<AgentStep>) => void
  patchBatch: (id: string, index: number, patch: Partial<AgentBatch>) => void
  markUnread: () => void
  reset: () => void
}

export function newAgentTurn(id: string, prompt: string): AgentTurn {
  return {
    id,
    prompt,
    createdAt: Date.now(),
    status: 'working',
    steps: AGENT_STEP_IDS.map((step) => ({ id: step, state: 'pending', detail: null, startedAt: null, endedAt: null })),
    plan: null,
    batches: [],
    revealed: 0,
    query: null,
    hail: null,
    hailError: null,
    workflow: null,
    result: null,
    error: null,
  }
}

export const useAgent = create<AgentState>((set) => ({
  open: false,
  unread: false,
  weather: false,
  attachment: null,
  drawing: false,
  turns: [],
  processingCells: [],
  setOpen: (open) => set(open ? { open, unread: false } : { open }),
  setWeather: (weather) => set({ weather }),
  setAttachment: (attachment) => set({ attachment }),
  setDrawing: (drawing) => set({ drawing }),
  setProcessingCells: (processingCells) => set({ processingCells }),
  addTurn: (turn) =>
    set((state) => ({
      turns: [
        ...state.turns.map((existing) =>
          existing.status === 'review' || existing.status === 'confirm'
            ? { ...existing, status: 'replaced' as const }
            : existing,
        ),
        turn,
      ],
    })),
  patchTurn: (id, patch) =>
    set((state) => ({
      turns: state.turns.map((turn) => (turn.id === id ? { ...turn, ...(typeof patch === 'function' ? patch(turn) : patch) } : turn)),
    })),
  patchStep: (id, step, patch) =>
    set((state) => ({
      turns: state.turns.map((turn) =>
        turn.id === id
          ? { ...turn, steps: turn.steps.map((entry) => (entry.id === step ? { ...entry, ...patch } : entry)) }
          : turn,
      ),
    })),
  patchBatch: (id, index, patch) =>
    set((state) => ({
      turns: state.turns.map((turn) =>
        turn.id === id
          ? { ...turn, batches: turn.batches.map((batch) => (batch.index === index ? { ...batch, ...patch } : batch)) }
          : turn,
      ),
    })),
  markUnread: () => set((state) => (state.open ? {} : { unread: true })),
  reset: () => set({ turns: [], processingCells: [], unread: false }),
}))
