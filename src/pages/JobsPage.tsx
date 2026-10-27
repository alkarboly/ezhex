import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { formatCount } from '../lib/format'
import { createIngestionJob, getWorkflowIngestionLimits, listIngestionJobs } from '../services/workflow-ingestion'
import { useExplorer } from '../store/explorer-store'
import { DATASET_META } from '../types/datasets'
import type { IngestionJob, IngestionJobStatus, WorkflowDataset } from '../types/workflows'
import { WORKFLOW_DATASETS } from '../types/workflows'

export function JobsPage() {
  const selectedCells = useExplorer((state) => state.selectedCells)
  const client = useQueryClient()
  const [releaseVersion, setReleaseVersion] = useState(defaultReleaseVersion())
  const [datasets, setDatasets] = useState<WorkflowDataset[]>([...WORKFLOW_DATASETS])
  const [error, setError] = useState<string | null>(null)

  const limits = useQuery({ queryKey: ['workflow-ingestion-limits'], queryFn: getWorkflowIngestionLimits })
  const jobs = useQuery({ queryKey: ['ingestion-jobs'], queryFn: listIngestionJobs, refetchInterval: 8_000 })
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

  const counts = useMemo(() => tally(jobs.data ?? []), [jobs.data])

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-5 px-6 py-8">
        <header>
          <h1 className="text-xl font-semibold">Jobs</h1>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Queue a hex-scoped ingestion job. Spark still runs outside this process. Mock-covered Austin hexes resolve as ready.
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
            {create.isPending ? 'Creating…' : 'Create ingestion job'}
          </Button>
        </form>

        <section className="grid gap-2">
          <h2 className="text-sm font-semibold">Recent jobs</h2>
          {jobs.isLoading && <p className="text-sm text-muted-foreground">Loading jobs…</p>}
          {jobs.error && <p className="text-sm text-destructive">{jobs.error.message}</p>}
          {jobs.data?.length === 0 && <p className="text-sm text-muted-foreground">No jobs yet.</p>}
          {jobs.data?.map((job) => (
            <JobRow key={job.id} job={job} />
          ))}
        </section>
      </div>
    </div>
  )
}

function JobRow({ job }: { job: IngestionJob }) {
  return (
    <article className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusDot status={job.status} />
        <span className="font-mono text-xs">{job.run_id}</span>
        <span className="text-xs text-muted-foreground">{job.release_version}</span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {formatCount(job.h3_cells.length)} hexes · {job.datasets.join(', ')} · {formatCount(job.bbox.area_km2)} km2
      </p>
      {job.note && <p className="mt-1 text-xs text-muted-foreground">{job.note}</p>}
    </article>
  )
}

function StatusDot({ status }: { status: IngestionJobStatus }) {
  const label = status[0].toUpperCase() + status.slice(1)
  return <span className="text-xs font-medium text-foreground">{label}</span>
}

function tally(jobs: readonly IngestionJob[]) {
  return {
    queued: jobs.filter((job) => job.status === 'queued' || job.status === 'running').length,
    succeeded: jobs.filter((job) => job.status === 'succeeded').length,
    failed: jobs.filter((job) => job.status === 'failed').length,
  }
}

function defaultReleaseVersion(): string {
  return `${new Date().toISOString().slice(0, 10)}.0`
}
