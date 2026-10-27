import { useMutation, useQuery } from '@tanstack/react-query'
import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { formatCount } from '../lib/format'
import { DEFAULT_OVERTURE_RELEASE } from '../lib/overture-release'
import {
  createWorkflowIngestionPlan,
  getQuerySchemas,
  getWorkflowIngestionLimits,
} from '../services/workflow-ingestion'
import { useExplorer } from '../store/explorer-store'
import { DATASET_META } from '../types/datasets'
import { WORKFLOW_DATASETS, type WorkflowDataset, type WorkflowIngestionPlan } from '../types/workflows'

export function SavedQueriesPage() {
  const selectedCells = useExplorer((state) => state.selectedCells)
  const [releaseVersion, setReleaseVersion] = useState(DEFAULT_OVERTURE_RELEASE)
  const [datasets, setDatasets] = useState<WorkflowDataset[]>([...WORKFLOW_DATASETS])
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

  useEffect(() => {
    const available = schemas.data?.datasets.map((dataset) => dataset.id)
    if (!available || available.length === 0) return
    const allowed = new Set(available)
    setDatasets((current) => {
      const filtered = current.filter((dataset) => allowed.has(dataset))
      if (filtered.length > 0) return filtered
      return [available[0] as WorkflowDataset]
    })
  }, [schemas.data])

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
  const availableDatasets = useMemo(
    () =>
      schemas.data?.datasets ??
      WORKFLOW_DATASETS.map((id) => ({
        id,
        title: DATASET_META[id].title,
        singular: DATASET_META[id].singular,
        plural: DATASET_META[id].plural,
        fields: [],
      })),
    [schemas.data],
  )

  const toggleDataset = (dataset: WorkflowDataset) => {
    setDatasets((current) => {
      if (current.includes(dataset)) return current.filter((entry) => entry !== dataset)
      return [...current, dataset]
    })
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const release = releaseVersion.trim()
    if (!release) {
      setFormError('Release version is required.')
      return
    }
    if (datasets.length === 0) {
      setFormError('Choose at least one dataset.')
      return
    }
    if (inputCells.length === 0) {
      setFormError('Choose at least one hex cell.')
      return
    }
    createPlan.mutate({
      release_version: release,
      h3_cells: inputCells,
      datasets,
    })
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-5 px-6 py-8">
        <header>
          <h1 className="text-xl font-semibold">Workflows</h1>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Build a guarded ingestion plan from selected H3 cells. Queue the run from{' '}
            <Link to="/jobs" className="text-primary hover:underline">
              Jobs
            </Link>
            , or process the hexes from the map. Jobs run on this server.
          </p>
        </header>

        <section className="rounded-lg border border-border bg-card p-4 text-sm">
          <h2 className="text-sm font-semibold">Ingestion limits</h2>
          {limits.isLoading && <p className="mt-2 text-muted-foreground">Loading limits…</p>}
          {limits.error && <p className="mt-2 text-destructive">{limits.error.message}</p>}
          {limits.data && (
            <dl className="mt-3 grid gap-2 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">H3 resolution</dt>
                <dd className="font-mono">{limits.data.h3_resolution}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Max hexes per run</dt>
                <dd className="font-mono">{formatCount(limits.data.max_hexes)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Max bbox area</dt>
                <dd className="font-mono">{formatCount(limits.data.max_bbox_area_km2)} km2</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Rows per dataset</dt>
                <dd className="font-mono">{formatCount(limits.data.max_rows_per_dataset)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Rows per run</dt>
                <dd className="font-mono">{formatCount(limits.data.max_total_rows)}</dd>
              </div>
            </dl>
          )}
          {schemas.isLoading && <p className="mt-2 text-xs text-muted-foreground">Loading query schemas…</p>}
          {schemas.error && <p className="mt-2 text-xs text-destructive">{schemas.error.message}</p>}
          {schemas.data && (
            <div className="mt-3 rounded-md border border-white/[0.08] bg-white/[0.02] px-3 py-2">
              <p className="text-xs text-muted-foreground">
                Query schemas from server whitelist:{' '}
                {schemas.data.datasets.map((dataset) => `${dataset.title} (${dataset.fields.length})`).join(' · ')}
              </p>
              {!schemas.data.query_enabled && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {schemas.data.reason} UI plan creation still works for ingestion.
                </p>
              )}
            </div>
          )}
        </section>

        <form onSubmit={submit} className="grid gap-4 rounded-lg border border-border bg-card p-4">
          <div className="grid gap-2">
            <label htmlFor="workflow-release" className="text-xs font-medium text-muted-foreground">
              Release version
            </label>
            <Input
              id="workflow-release"
              value={releaseVersion}
              onChange={(event) => setReleaseVersion(event.target.value)}
              placeholder="2026-09-24.0"
            />
          </div>

          <div className="grid gap-2">
            <span className="text-xs font-medium text-muted-foreground">Datasets</span>
            <div className="flex flex-wrap gap-2">
              {availableDatasets.map((dataset) => {
                const selected = datasets.includes(dataset.id)
                return (
                  <Button
                    key={dataset.id}
                    size="sm"
                    variant={selected ? 'default' : 'outline'}
                    type="button"
                    onClick={() => toggleDataset(dataset.id)}
                  >
                    {dataset.title}
                  </Button>
                )
              })}
            </div>
          </div>

          <div className="grid gap-2">
            <span className="text-xs font-medium text-muted-foreground">Hex source</span>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant={useSelection ? 'default' : 'outline'}
                type="button"
                onClick={() => setUseSelection(true)}
              >
                Explorer selection ({selectedCells.length})
              </Button>
              <Button
                size="sm"
                variant={useSelection ? 'outline' : 'default'}
                type="button"
                onClick={() => setUseSelection(false)}
              >
                Manual list
              </Button>
            </div>

            {useSelection ? (
              <p className="text-xs text-muted-foreground">
                Using {formatCount(inputCells.length)} selected cells from Explorer.
              </p>
            ) : (
              <>
                <textarea
                  value={manualCells}
                  onChange={(event) => setManualCells(event.target.value)}
                  placeholder={'88489e3467fffff\n88489e30bdfffff'}
                  className="min-h-28 w-full rounded-lg border border-white/[0.08] bg-white/[0.03] p-3 font-mono text-xs leading-5 text-foreground transition-colors hover:border-white/15 focus-visible:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
                />
                <p className="text-xs text-muted-foreground">
                  Parsed {formatCount(inputCells.length)} unique cells from the manual list.
                </p>
              </>
            )}
          </div>

          {formError && <p className="text-sm text-destructive">{formError}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={createPlan.isPending}>
              {createPlan.isPending ? 'Creating plan…' : 'Create ingestion plan'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setPlan(null)
                setFormError(null)
              }}
            >
              Clear output
            </Button>
          </div>
        </form>

        {plan && (
          <section className="grid gap-3 rounded-lg border border-border bg-card p-4">
            <div className="flex flex-wrap items-center gap-2">
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
    </div>
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
