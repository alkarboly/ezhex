import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { formatClock, formatCount } from '../lib/format'
import { DEFAULT_OVERTURE_RELEASE } from '../lib/overture-release'
import { cn } from '../lib/utils'
import {
  createIngestionJob,
  getWorkflowIngestionLimits,
  listIngestionJobs,
  runIngestionJob,
} from '../services/workflow-ingestion'
import { useExplorer } from '../store/explorer-store'
import { DATASET_META } from '../types/datasets'
import type { IngestionJob, IngestionJobStatus, JobLog, WorkflowDataset } from '../types/workflows'
import { WORKFLOW_DATASETS } from '../types/workflows'

export function JobsPage() {
  const selectedCells = useExplorer((state) => state.selectedCells)
  const client = useQueryClient()
  const [releaseVersion, setReleaseVersion] = useState(DEFAULT_OVERTURE_RELEASE)
  const [datasets, setDatasets] = useState<WorkflowDataset[]>([...WORKFLOW_DATASETS])
  const [error, setError] = useState<string | null>(null)

  const limits = useQuery({ queryKey: ['workflow-ingestion-limits'], queryFn: getWorkflowIngestionLimits })
  const jobs = useQuery({
    queryKey: ['ingestion-jobs'],
    queryFn: listIngestionJobs,
    refetchInterval: (query) => {
      const rows = query.state.data ?? []
      return rows.some((job) => job.status === 'queued' || job.status === 'running') ? 1_200 : 8_000
    },
  })
  const create = useMutation({
    mutationFn: createIngestionJob,
    onSuccess: async () => {
      setError(null)
      await client.invalidateQueries({ queryKey: ['ingestion-jobs'] })
      await client.invalidateQueries({ queryKey: ['hex-status'] })
    },
    onError: (next) => setError(next instanceof Error ? next.message : 'Could not create the job.'),
  })

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (selectedCells.length === 0) {
      setError('Select hexes on the map first.')
      return
    }
    if (datasets.length === 0) {
      setError('Choose at least one dataset.')
      return
    }
    create.mutate({
      release_version: releaseVersion.trim(),
      h3_cells: selectedCells,
      datasets,
    })
  }

  useEffect(() => {
    if (limits.data?.default_release_version) setReleaseVersion(limits.data.default_release_version)
  }, [limits.data])
  const counts = useMemo(() => tally(jobs.data ?? []), [jobs.data])
  const refreshJobs = async () => {
    await client.invalidateQueries({ queryKey: ['ingestion-jobs'] })
    await client.invalidateQueries({ queryKey: ['hex-status'] })
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-5 px-6 py-8">
        <header>
          <h1 className="text-xl font-semibold">Jobs</h1>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Process selected hexes from the public Overture Maps release into Supabase. Each job streams a live log of the download, hex filter, and writes.
          </p>
        </header>

        <section className="grid gap-2 rounded-lg border border-border bg-card p-4 text-xs text-muted-foreground sm:grid-cols-3">
          <p>Queued {formatCount(counts.queued)}</p>
          <p>Ready {formatCount(counts.succeeded)}</p>
          <p>Failed {formatCount(counts.failed)}</p>
        </section>

        <form onSubmit={submit} className="grid gap-4 rounded-lg border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">
            Using {formatCount(selectedCells.length)} hexes from Explorer.{' '}
            <Link to="/" className="text-primary hover:underline">
              Select on the map
            </Link>
          </p>
          {limits.data && (
            <p className="text-xs text-muted-foreground">
              Caps: {limits.data.max_hexes} hexes, {formatCount(limits.data.max_bbox_area_km2)} km2,{' '}
              {formatCount(limits.data.max_rows_per_dataset)} rows / dataset
            </p>
          )}
          <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
            Release version
            <Input value={releaseVersion} onChange={(event) => setReleaseVersion(event.target.value)} />
          </label>
          <div className="flex flex-wrap gap-1.5">
            {WORKFLOW_DATASETS.map((id) => {
              const on = datasets.includes(id)
              return (
                <Button
                  key={id}
                  type="button"
                  size="sm"
                  variant={on ? 'default' : 'outline'}
                  onClick={() =>
                    setDatasets((current) =>
                      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
                    )
                  }
                >
                  {DATASET_META[id].title}
                </Button>
              )
            })}
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? 'Processing…' : 'Process hexes'}
          </Button>
        </form>

        <section className="grid gap-2">
          <h2 className="text-sm font-semibold">Recent jobs</h2>
          {jobs.isLoading && <p className="text-sm text-muted-foreground">Loading jobs…</p>}
          {jobs.error && <p className="text-sm text-destructive">{jobs.error.message}</p>}
          {jobs.data?.length === 0 && <p className="text-sm text-muted-foreground">No jobs yet.</p>}
          {jobs.data?.map((job) => (
            <JobRow key={job.id} job={job} onRan={() => void refreshJobs()} />
          ))}
        </section>
      </div>
    </div>
  )
}

function JobRow({ job, onRan }: { job: IngestionJob; onRan: () => void }) {
  const live = job.status === 'queued' || job.status === 'running'
  const logs = job.logs ?? []
  const [open, setOpen] = useState(live || logs.length > 0)
  const run = useMutation({
    mutationFn: () => runIngestionJob(job.id),
    onSuccess: onRan,
  })
  const canRun = job.status === 'queued' || job.status === 'failed'

  useEffect(() => {
    if (live) setOpen(true)
  }, [live])

  return (
    <article className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusDot status={job.status} live={live} />
        <span className="font-mono text-xs">{job.run_id}</span>
        <span className="text-xs text-muted-foreground">{job.release_version}</span>
        {canRun && (
          <Button type="button" size="sm" variant="outline" disabled={run.isPending} onClick={() => run.mutate()}>
            {run.isPending ? 'Processing…' : 'Process now'}
          </Button>
        )}
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className="ml-auto text-xs text-muted-foreground hover:text-foreground"
        >
          {open ? 'Hide logs' : `Logs ${formatCount(logs.length)}`}
        </button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {formatCount(job.h3_cells.length)} hexes · {job.datasets.join(', ')} · {formatCount(job.bbox.area_km2)} km2
        {job.rows_total > 0 ? ` · ${formatCount(job.rows_total)} rows` : ''}
      </p>
      {job.note && <p className="mt-1 text-xs text-muted-foreground">{job.note}</p>}
      {job.error_message && <p className="mt-1 text-xs text-destructive">{job.error_message}</p>}
      {run.error && <p className="mt-1 text-xs text-destructive">{run.error.message}</p>}
      {open && <JobLogPane logs={logs} live={live} />}
    </article>
  )
}

function JobLogPane({ logs, live }: { logs: readonly JobLog[]; live: boolean }) {
  const scroller = useRef<HTMLPreElement>(null)
  useEffect(() => {
    const node = scroller.current
    if (node) node.scrollTop = node.scrollHeight
  }, [logs.length])
  return (
    <div className="mt-3 overflow-hidden rounded-md border border-white/[0.08] bg-black/40">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-1.5 text-[10px] text-muted-foreground">
        <span>{live ? 'Live' : 'Log'} · {formatCount(logs.length)} lines</span>
        {live && <span className="text-primary">updating</span>}
      </div>
      <pre
        ref={scroller}
        className="max-h-64 overflow-auto px-3 py-2 font-mono text-[11px] leading-5"
        data-testid="job-log"
      >
        {logs.length === 0 ? (
          <span className="text-muted-foreground">Waiting for the first log line…</span>
        ) : (
          logs.map((entry, index) => (
            <div
              key={`${entry.at}-${index}`}
              className={cn(
                'whitespace-pre-wrap',
                entry.level === 'error' && 'text-destructive',
                entry.level === 'warn' && 'text-amber-300',
                entry.level === 'info' && 'text-foreground/85',
              )}
            >
              <span className="text-muted-foreground">{formatClock(entry.at)}</span>{' '}
              <span className="uppercase">{entry.level}</span> {entry.message}
            </div>
          ))
        )}
      </pre>
    </div>
  )
}

function StatusDot({ status, live }: { status: IngestionJobStatus; live?: boolean }) {
  const label = status[0].toUpperCase() + status.slice(1)
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground">
      {live && <span className="size-1.5 animate-pulse rounded-full bg-primary" />}
      {label}
    </span>
  )
}

function tally(jobs: readonly IngestionJob[]) {
  return {
    queued: jobs.filter((job) => job.status === 'queued' || job.status === 'running').length,
    succeeded: jobs.filter((job) => job.status === 'succeeded').length,
    failed: jobs.filter((job) => job.status === 'failed').length,
  }
}

