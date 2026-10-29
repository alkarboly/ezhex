import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Bell, Hexagon, MapPinned, Pencil, Trash2 } from 'lucide-react'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { useAuth } from '../hooks/useAuth'
import { formatCount } from '../lib/format'
import { MAX_QUERY_WORKFLOWS } from '../lib/limits'
import { DEFAULT_OVERTURE_RELEASE } from '../lib/overture-release'
import { cn } from '../lib/utils'
import {
  deleteQueryWorkflow,
  listQueryWorkflows,
  patchQueryWorkflow,
  quoteQueryWorkflow,
  runQueryWorkflow,
  runWorkflowNewDataCheck,
} from '../services/query-workflows'
import {
  createWorkflowIngestionPlan,
  getQuerySchemas,
  getWorkflowIngestionLimits,
} from '../services/workflow-ingestion'
import { useExplorer } from '../store/explorer-store'
import { WORKFLOW_DATASETS, type WorkflowIngestionPlan } from '../types/workflows'
import type { QueryWorkflow } from '../types/query-workflows'

export function SavedQueriesPage() {
  const navigate = useNavigate()
  const previewWorkflow = useExplorer((state) => state.previewWorkflow)
  const inspectReplay = useExplorer((state) => state.inspectReplay)
  const auth = useAuth()
  const client = useQueryClient()
  const user = auth.session.data?.user ?? null
  const configured = auth.session.data?.configured ?? false

  const saved = useQuery({
    queryKey: ['query-workflows'],
    queryFn: listQueryWorkflows,
  })
  const remove = useMutation({
    mutationFn: deleteQueryWorkflow,
    onSuccess: () => client.invalidateQueries({ queryKey: ['query-workflows'] }),
  })
  const run = useMutation({
    mutationFn: async (workflowId: string) => {
      const quote = await quoteQueryWorkflow(workflowId)
      const lines = quote.lines.map((line) => `${line.agent}: $${(line.clamped_usd_cents / 100).toFixed(2)} · ${line.reason}`)
      const ok = window.confirm(
        [
          `Agent quote total: $${(quote.total_usd_cents / 100).toFixed(2)}`,
          `Balance: $${(quote.balance_usd_cents / 100).toFixed(2)}`,
          '',
          ...lines,
          '',
          quote.missing_hexes.length > 0
            ? `Process agent will create one job per missing hex (${quote.missing_hexes.length}).`
            : 'All hexes are already processed.',
          '',
          'Run workflow now?',
        ].join('\n'),
      )
      if (!ok) return null
      return runQueryWorkflow(workflowId)
    },
    onSuccess: (result) => {
      if (!result) {
        useExplorer.getState().setNotice('Run cancelled.')
        return
      }
      void client.invalidateQueries({ queryKey: ['query-workflows'] })
      void client.invalidateQueries({ queryKey: ['agent-ledger'] })
      useExplorer.getState().setNotice(
        result.status === 'succeeded'
          ? `Workflow ran · ${result.row_count} rows · spent $${(result.quote_total_usd_cents / 100).toFixed(2)} · tips $${(result.tips_usd_cents / 100).toFixed(2)}`
          : result.error_message ?? 'Workflow run failed.',
      )
    },
    onError: (error) =>
      useExplorer
        .getState()
        .setNotice(error instanceof Error ? error.message : 'Could not quote and run this workflow.'),
  })
  const draftEnrichments = useExplorer((state) => state.draftEnrichments)
  const saveDraft = useMutation({
    mutationFn: (id: string) => patchQueryWorkflow(id, { enrichments: draftEnrichments }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['query-workflows'] }),
  })
  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => patchQueryWorkflow(id, { name }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['query-workflows'] }),
    onError: (error) =>
      useExplorer.getState().setNotice(error instanceof Error ? error.message : 'Could not rename that workflow.'),
  })
  const subscribe = useMutation({
    mutationFn: ({ id, subscribe_new_data }: { id: string; subscribe_new_data: boolean }) =>
      patchQueryWorkflow(id, { subscribe_new_data }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['query-workflows'] }),
    onError: (error) =>
      useExplorer
        .getState()
        .setNotice(error instanceof Error ? error.message : 'Could not update the subscribe flag.'),
  })

  const workflows = saved.data?.workflows ?? []
  const remaining = saved.data?.remaining ?? Math.max(0, MAX_QUERY_WORKFLOWS - workflows.length)
  const signInNeeded = configured && !user

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-5 px-6 py-8">
        <header className="overflow-hidden rounded-2xl border border-primary/20 bg-[linear-gradient(135deg,rgba(46,230,166,0.12),rgba(8,12,18,0.4)_55%,rgba(245,196,81,0.08))] p-5">
          <p className="font-mono text-[10px] tracking-[0.22em] text-primary uppercase">Query workflows</p>
          <h1 className="mt-1 text-xl font-semibold">Saved inspect SQL</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
            A workflow is a private inspect query plus optional add-ons. Rename it here. View workflow restores
            the hexes, Inspect filters, Add-ons, and the SQL editor. Quote & run executes it: process missing hexes,
            then geofence, weather, and AI enhance as specialist jobs on that run. Subscribe to new data checks
            stored snapshots as soon as you turn it on. No schedule yet.{' '}
            {MAX_QUERY_WORKFLOWS} per account.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px]">
            <span className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 font-mono text-primary">
              {formatCount(workflows.length)} / {MAX_QUERY_WORKFLOWS}
            </span>
            <span className="text-muted-foreground">{formatCount(remaining)} open slots</span>
          </div>
        </header>

        {signInNeeded && (
          <p className="rounded-xl border border-white/[0.08] bg-card px-4 py-3 text-sm text-muted-foreground">
            <Link to="/settings" className="text-primary hover:underline">
              Sign in
            </Link>{' '}
            to keep workflows. Create one from Inspect on the map.
          </p>
        )}

        {saved.isLoading && <p className="text-sm text-muted-foreground">Loading workflows…</p>}
        {saved.error && <p className="text-sm text-destructive">{saved.error.message}</p>}

        <section className="grid gap-3">
          {workflows.map((workflow) => (
            <WorkflowCard
              key={workflow.id}
              workflow={workflow}
              active={inspectReplay?.workflowId === workflow.id}
              onOpen={() => {
                previewWorkflow(workflow)
                navigate('/')
              }}
              onRename={(name) => rename.mutate({ id: workflow.id, name })}
              onSubscribe={(subscribe_new_data) => subscribe.mutate({ id: workflow.id, subscribe_new_data })}
              onRun={() => run.mutate(workflow.id)}
              onSaveEnrichments={() => saveDraft.mutate(workflow.id)}
              onDelete={() => remove.mutate(workflow.id)}
              deleting={remove.isPending && remove.variables === workflow.id}
              renaming={rename.isPending && rename.variables?.id === workflow.id}
              running={run.isPending && run.variables === workflow.id}
            />
          ))}
          {Array.from({ length: remaining }, (_, index) => (
            <OpenSlot key={`slot-${index}`} index={workflows.length + index + 1} />
          ))}
          {!saved.isLoading && workflows.length === 0 && !signInNeeded && (
            <p className="text-sm text-muted-foreground">
              No workflows yet. Open Inspect, copy or edit the SQL, then press Create a workflow.
            </p>
          )}
        </section>

        <IngestPlanSection />
      </div>
    </div>
  )
}

function WorkflowCard({
  workflow,
  active,
  onOpen,
  onRename,
  onSubscribe,
  onRun,
  onSaveEnrichments,
  onDelete,
  deleting,
  renaming,
  running,
}: {
  workflow: QueryWorkflow
  active: boolean
  onOpen: () => void
  onRename: (name: string) => void
  onSubscribe: (subscribe_new_data: boolean) => void
  onRun: () => void
  onSaveEnrichments: () => void
  onDelete: () => void
  deleting: boolean
  renaming: boolean
  running: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [nameDraft, setNameDraft] = useState(workflow.name)
  const [subscribed, setSubscribed] = useState(Boolean(workflow.subscribe_new_data))
  const [checkMessage, setCheckMessage] = useState<string | null>(null)
  const checkNew = useMutation({
    mutationFn: () => runWorkflowNewDataCheck(workflow),
    onSuccess: (result) => setCheckMessage(result.message),
    onError: (error) =>
      setCheckMessage(error instanceof Error ? error.message : 'Could not check for new data.'),
  })

  useEffect(() => {
    setNameDraft(workflow.name)
  }, [workflow.name])

  useEffect(() => {
    setSubscribed(Boolean(workflow.subscribe_new_data))
  }, [workflow.id])

  const toggleSubscribe = (next: boolean) => {
    setSubscribed(next)
    onSubscribe(next)
    if (next) {
      setCheckMessage(null)
      checkNew.mutate()
      return
    }
    setCheckMessage('Subscription off.')
  }

  const commitName = () => {
    const next = nameDraft.trim()
    setEditing(false)
    if (!next || next === workflow.name) {
      setNameDraft(workflow.name)
      return
    }
    onRename(next)
  }

  const preview = workflow.sql
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('--'))
    .slice(0, 4)
    .join('\n')
  return (
    <article
      className={cn(
        'overflow-hidden rounded-2xl border bg-[#080c12]/80 shadow-[0_16px_40px_-24px_rgba(0,0,0,0.85)]',
        active ? 'border-primary/50 shadow-[0_0_24px_-8px_rgba(46,230,166,0.45)]' : 'border-white/[0.08]',
      )}
    >
      <div className="px-4 pt-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {editing ? (
              <input
                data-testid="workflow-name-input"
                value={nameDraft}
                autoFocus
                disabled={renaming}
                onChange={(event) => setNameDraft(event.target.value)}
                onBlur={commitName}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    commitName()
                  }
                  if (event.key === 'Escape') {
                    setNameDraft(workflow.name)
                    setEditing(false)
                  }
                }}
                className="h-7 w-full rounded-md border border-primary/40 bg-black/40 px-2 text-sm font-semibold text-foreground focus-visible:outline-none"
              />
            ) : (
              <button
                type="button"
                data-testid="workflow-rename"
                onClick={() => setEditing(true)}
                className="flex max-w-full items-center gap-1.5 text-left"
              >
                <span className="truncate text-sm font-semibold">{workflow.name}</span>
                <Pencil className="size-3 shrink-0 text-muted-foreground" />
              </button>
            )}
            <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <MapPinned className="size-3 text-primary" />
              {formatCount(workflow.h3_cells.length)} hexes
              {workflow.custom_sql ? ' · custom SQL' : ' · generated SQL'}
              {workflow.release_version ? ` · ${workflow.release_version}` : ' · latest snapshot'}
              {workflow.enrichments.length > 0
                ? ` · ${workflow.enrichments.map((step) => step.kind.replace('_', ' ')).join(' · ')}`
                : ''}
            </p>
          </div>
          <span className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
            <Hexagon className="size-4" />
          </span>
        </div>
        <button type="button" onClick={onOpen} className="mt-3 block w-full text-left">
          <pre className="max-h-20 overflow-hidden rounded-lg border border-white/[0.06] bg-[#05080c] px-3 py-2 font-mono text-[10px] leading-4 text-[#9fd9c8]">
            {preview}
          </pre>
          <p className="mt-2 truncate font-mono text-[10px] text-muted-foreground">
            {workflow.h3_cells.slice(0, 3).join(' · ')}
            {workflow.h3_cells.length > 3 ? ` · +${workflow.h3_cells.length - 3}` : ''}
          </p>
        </button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <button
          type="button"
          data-testid="view-workflow"
          onClick={onOpen}
          className="rounded-full bg-primary/15 px-3 py-1 text-[11px] font-medium text-primary hover:bg-primary/25"
        >
          View workflow
        </button>
        <button
          type="button"
          disabled={running}
          onClick={onRun}
          className="rounded-full bg-primary px-3 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
        >
          {running ? 'Running…' : 'Quote & run'}
        </button>
        <button
          type="button"
          onClick={onSaveEnrichments}
          className="rounded-full px-3 py-1 text-[11px] text-muted-foreground hover:bg-white/[0.05] hover:text-foreground"
        >
          Save add-ons
        </button>
        <button
          type="button"
          disabled={deleting}
          onClick={onDelete}
          className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] text-muted-foreground hover:bg-white/[0.05] hover:text-destructive disabled:opacity-40"
        >
          <Trash2 className="size-3" />
          {deleting ? 'Removing…' : 'Delete'}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.06] px-4 py-2.5">
        <label className="inline-flex items-center gap-1.5 text-[11px] text-foreground">
          <input
            data-testid="workflow-subscribe"
            type="checkbox"
            checked={subscribed}
            disabled={checkNew.isPending}
            onChange={(event) => toggleSubscribe(event.target.checked)}
            className="size-3.5 accent-[oklch(0.78_0.16_165)]"
          />
          Subscribe to new data
        </label>
        <button
          type="button"
          data-testid="workflow-check-new-data"
          disabled={checkNew.isPending}
          onClick={() => checkNew.mutate()}
          className="inline-flex items-center gap-1 rounded-full bg-white/[0.06] px-2.5 py-1 text-[11px] text-foreground hover:bg-primary/15 hover:text-primary disabled:opacity-40"
        >
          <Bell className="size-3" />
          {checkNew.isPending ? 'Checking…' : 'Check now'}
        </button>
        <p
          data-testid="workflow-check-message"
          className={cn('w-full text-[10px]', checkMessage ? 'text-primary' : 'text-muted-foreground')}
        >
          {checkNew.isPending
            ? 'Checking stored snapshots…'
            : (checkMessage ?? 'Turn on to check these hexes for a newer snapshot.')}
        </p>
      </div>
    </article>
  )
}

function OpenSlot({ index }: { index: number }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/[0.1] px-4 py-5 text-center">
      <p className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase">Open slot {index}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Create from Inspect ·{' '}
        <Link to="/" className="text-primary hover:underline">
          Open explorer
        </Link>
      </p>
    </div>
  )
}

function IngestPlanSection() {
  const selectedCells = useExplorer((state) => state.selectedCells)
  const [releaseVersion, setReleaseVersion] = useState(DEFAULT_OVERTURE_RELEASE)
  const [useSelection, setUseSelection] = useState(true)
  const [manualCells, setManualCells] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [plan, setPlan] = useState<WorkflowIngestionPlan | null>(null)

  const limits = useQuery({
    queryKey: ['workflow-ingestion-limits'],
    queryFn: getWorkflowIngestionLimits,
  })
  const schemas = useQuery({
    queryKey: ['query-schemas'],
    queryFn: getQuerySchemas,
  })

  useEffect(() => {
    if (limits.data?.default_release_version) setReleaseVersion(limits.data.default_release_version)
  }, [limits.data])

  const createPlan = useMutation({
    mutationFn: createWorkflowIngestionPlan,
    onSuccess: (nextPlan) => {
      setPlan(nextPlan)
      setFormError(null)
    },
    onError: (error) => {
      setFormError(error instanceof Error ? error.message : 'Failed to create plan.')
    },
  })

  const inputCells = useMemo(
    () => (useSelection ? selectedCells : parseCells(manualCells)),
    [manualCells, selectedCells, useSelection],
  )
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const release = releaseVersion.trim()
    if (!release) {
      setFormError('Release version is required.')
      return
    }
    if (inputCells.length === 0) {
      setFormError('Choose at least one hex cell.')
      return
    }
    createPlan.mutate({
      release_version: release,
      h3_cells: inputCells,
      datasets: [...WORKFLOW_DATASETS],
    })
  }

  return (
    <details className="rounded-2xl border border-white/[0.08] bg-card">
      <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium">
        Ingest plan
        <span className="ml-2 text-xs font-normal text-muted-foreground">
          Connected hexes, 20 max, for Process / Spark
        </span>
      </summary>
      <div className="grid gap-4 border-t border-white/[0.06] px-4 py-4">
        <p className="text-sm leading-6 text-muted-foreground">
          This is the guarded ingestion plan. Query workflows above do not use these caps. Queue a run from{' '}
          <Link to="/jobs" className="text-primary hover:underline">
            Jobs
          </Link>
          .
        </p>
        {limits.data && (
          <p className="text-xs text-muted-foreground">
            Caps: {formatCount(limits.data.max_hexes)} hexes, {formatCount(limits.data.max_bbox_area_km2)} km2,{' '}
            {formatCount(limits.data.max_rows_per_dataset)} rows / dataset
          </p>
        )}
        {schemas.data && !schemas.data.query_enabled && (
          <p className="text-xs text-muted-foreground">{schemas.data.reason}</p>
        )}
        <form onSubmit={submit} className="grid gap-3">
          <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
            Release version
            <Input value={releaseVersion} onChange={(event) => setReleaseVersion(event.target.value)} />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant={useSelection ? 'default' : 'outline'} type="button" onClick={() => setUseSelection(true)}>
              Explorer selection ({selectedCells.length})
            </Button>
            <Button size="sm" variant={useSelection ? 'outline' : 'default'} type="button" onClick={() => setUseSelection(false)}>
              Manual list
            </Button>
          </div>
          {!useSelection && (
            <textarea
              value={manualCells}
              onChange={(event) => setManualCells(event.target.value)}
              placeholder={'88489e3467fffff\n88489e30bdfffff'}
              className="min-h-24 w-full rounded-lg border border-white/[0.08] bg-white/[0.03] p-3 font-mono text-xs leading-5"
            />
          )}
          {formError && <p className="text-sm text-destructive">{formError}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={createPlan.isPending}>
              {createPlan.isPending ? 'Creating plan…' : 'Create ingestion plan'}
            </Button>
            <Button type="button" variant="outline" onClick={() => { setPlan(null); setFormError(null) }}>
              Clear output
            </Button>
          </div>
        </form>
        {plan && (
          <section className="grid gap-2">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold">Plan JSON</h2>
              <Button size="sm" variant="outline" onClick={() => downloadPlan(plan)}>
                Download
              </Button>
            </div>
            <pre className="overflow-auto rounded-md border border-border bg-background p-3 font-mono text-[11px] leading-5 text-muted-foreground">
              {JSON.stringify(plan, null, 2)}
            </pre>
          </section>
        )}
      </div>
    </details>
  )
}

function parseCells(value: string): string[] {
  const tokens = value
    .split(/[\s,]+/g)
    .map((cell) => cell.trim())
    .filter((cell) => cell.length > 0)
  return [...new Set(tokens)]
}

function downloadPlan(plan: WorkflowIngestionPlan) {
  const file = new Blob([JSON.stringify(plan, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(file)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `workflow-plan-${plan.run_id}.json`
  anchor.click()
  URL.revokeObjectURL(url)
}
