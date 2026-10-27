import * as Dialog from '@radix-ui/react-dialog'
import { useMutation, useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useCompiledQuery, useQueryResults } from '../../hooks/useCompiledQuery'
import { formatCount } from '../../lib/format'
import {
  createIngestionJob,
  getQuerySchemas,
  getWorkflowIngestionLimits,
} from '../../services/workflow-ingestion'
import { useExplorer } from '../../store/explorer-store'
import { DATASET_META } from '../../types/datasets'
import type { HexAction, HexDataStatus, IngestionJob, WorkflowDataset } from '../../types/workflows'
import { WORKFLOW_DATASETS } from '../../types/workflows'
import { QueryForm } from '../filters/QueryForm'
import { ResultsList } from '../results/ResultsList'
import { Button } from '../ui/button'
import { Input } from '../ui/input'

export function HexActionDialog({
  open,
  mode,
  cells,
  coverage,
  onClose,
  onCreated,
}: {
  open: boolean
  mode: HexAction | null
  cells: readonly string[]
  coverage: ReadonlyMap<string, HexDataStatus>
  onClose: () => void
  onCreated: (job: IngestionJob) => void
}) {
  const ready = cells.length > 0 && cells.every((cell) => coverage.get(cell) === 'ready')
  const title =
    mode === 'query' ? 'Query hexes' : mode === 'workflow' ? 'Create workflow' : 'Process hexes'
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/55 data-[state=open]:animate-[wp-fade-in_160ms_ease-out]" />
        <Dialog.Content className="glass fixed top-[8%] bottom-[8%] left-1/2 z-50 flex w-[min(42rem,calc(100vw-1.5rem))] -translate-x-1/2 flex-col overflow-hidden rounded-2xl">
          <header className="flex items-start gap-3 border-b border-white/[0.06] px-5 py-4">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-sm font-semibold">{title}</Dialog.Title>
              <Dialog.Description className="mt-1 text-xs text-muted-foreground">
                {formatCount(cells.length)} selected · {ready ? 'processed data is available' : 'some hexes still need ingestion'}
              </Dialog.Description>
            </div>
            <Dialog.Close
              aria-label="Close"
              className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
            >
              <X className="size-4" />
            </Dialog.Close>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {mode === 'query' ? (
              <QueryPane ready={ready} />
            ) : (
              <JobPane
                mode={mode === 'workflow' ? 'workflow' : 'process'}
                cells={cells}
                ready={ready}
                onCreated={onCreated}
              />
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function QueryPane({ ready }: { ready: boolean }) {
  const compiled = useCompiledQuery()
  const results = useQueryResults(compiled)
  const schemas = useQuery({ queryKey: ['query-schemas'], queryFn: getQuerySchemas })
  const focusCell = useExplorer((state) => state.focusCell)
  const enabled = schemas.data?.query_enabled === true

  if (!ready) {
    return <p className="text-sm text-muted-foreground">Process these hexes first. The query editor unlocks when data is ready.</p>
  }
  if (schemas.data && !enabled) {
    return <p className="text-sm text-muted-foreground">{schemas.data.reason}</p>
  }
  return (
    <div className="grid gap-5">
      <QueryForm />
      <div className="rounded-xl border border-white/[0.06]">
        <ResultsList compiled={compiled} query={results} onFocusCell={focusCell} />
      </div>
    </div>
  )
}

function JobPane({
  mode,
  cells,
  ready,
  onCreated,
}: {
  mode: 'process' | 'workflow'
  cells: readonly string[]
  ready: boolean
  onCreated: (job: IngestionJob) => void
}) {
  const [releaseVersion, setReleaseVersion] = useState(defaultReleaseVersion())
  const [datasets, setDatasets] = useState<WorkflowDataset[]>([...WORKFLOW_DATASETS])
  const [error, setError] = useState<string | null>(null)
  const limits = useQuery({ queryKey: ['workflow-ingestion-limits'], queryFn: getWorkflowIngestionLimits })
  const create = useMutation({
    mutationFn: createIngestionJob,
    onSuccess: (job) => {
      setError(null)
      onCreated(job)
    },
    onError: (next) => setError(next instanceof Error ? next.message : 'Could not create the job.'),
  })

  const available = useMemo(
    () => WORKFLOW_DATASETS.map((id) => ({ id, title: DATASET_META[id].title })),
    [],
  )

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (datasets.length === 0) {
          setError('Choose at least one dataset.')
          return
        }
        create.mutate({
          release_version: releaseVersion.trim(),
          h3_cells: [...cells],
          datasets,
        })
      }}
    >
      <p className="text-sm leading-6 text-muted-foreground">
        {mode === 'workflow'
          ? 'A workflow starts from this hex set. If the data is missing, this queues an ingestion job first.'
          : ready
            ? 'These hexes already have data. Creating a job records a reprocess request.'
            : 'This queues a capped ingestion job for the selected hexes only.'}
      </p>
      {limits.data && (
        <p className="text-xs text-muted-foreground">
          Cap {limits.data.max_hexes} hexes · {formatCount(limits.data.max_bbox_area_km2)} km2 ·{' '}
          {formatCount(limits.data.max_rows_per_dataset)} rows / dataset
        </p>
      )}
      <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
        Release version
        <Input value={releaseVersion} onChange={(event) => setReleaseVersion(event.target.value)} />
      </label>
      <div className="flex flex-wrap gap-1.5">
        {available.map((dataset) => {
          const on = datasets.includes(dataset.id)
          return (
            <Button
              key={dataset.id}
              type="button"
              size="sm"
              variant={on ? 'default' : 'outline'}
              onClick={() =>
                setDatasets((current) =>
                  current.includes(dataset.id)
                    ? current.filter((entry) => entry !== dataset.id)
                    : [...current, dataset.id],
                )
              }
            >
              {dataset.title}
            </Button>
          )
        })}
      </div>
      <ul className="max-h-28 overflow-auto rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 font-mono text-[11px] text-muted-foreground">
        {cells.map((cell) => (
          <li key={cell}>{cell}</li>
        ))}
      </ul>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={create.isPending || cells.length === 0}>
        {create.isPending ? 'Creating…' : mode === 'workflow' ? 'Create workflow job' : 'Create ingestion job'}
      </Button>
    </form>
  )
}

function defaultReleaseVersion(): string {
  return `${new Date().toISOString().slice(0, 10)}.0`
}
