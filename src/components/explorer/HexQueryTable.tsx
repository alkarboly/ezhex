import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Copy, Download, LoaderCircle, Workflow } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { useThemeQuery } from '../../hooks/useCompiledQuery'
import { downloadCsv, featureRowsToCsv } from '../../lib/csv'
import {
  defaultInspectFilters,
  filterFeatureRows,
  mergeFeatureRows,
  observedValues,
  type FeatureRow,
  type InspectFilters,
  type PresenceFilter,
} from '../../lib/feature-rows'
import { formatCount } from '../../lib/format'
import { compileInspectSql, validateInspectSql } from '../../lib/inspect-sql'
import { MAX_QUERY_WORKFLOWS } from '../../lib/limits'
import { cn } from '../../lib/utils'
import { checkHexSnapshots, createQueryWorkflow, listQueryWorkflows } from '../../services/query-workflows'
import { useExplorer } from '../../store/explorer-store'
import { DATASET_IDS, DATASET_META, type DatasetId } from '../../types/datasets'
import { nativeSelectClass } from '../ui/input'
import { PageButton } from '../results/ResultsPanel'

const COLUMNS = [
  { field: 'kind', label: 'Theme', numeric: false },
  { field: 'snapshot', label: 'Snapshot', numeric: false },
  { field: 'snapshot_date', label: 'Snapshot date', numeric: false },
  { field: 'name', label: 'Place', numeric: false },
  { field: 'category', label: 'Category', numeric: false },
  { field: 'main_category', label: 'Main category', numeric: false },
  { field: 'taxonomy', label: 'Taxonomy', numeric: false },
  { field: 'operating_status', label: 'Status', numeric: false },
  { field: 'confidence', label: 'Confidence', numeric: true },
  { field: 'address', label: 'Address', numeric: false },
  { field: 'unit', label: 'Unit', numeric: false },
  { field: 'locality', label: 'Locality', numeric: false },
  { field: 'region', label: 'Region', numeric: false },
  { field: 'postcode', label: 'Postcode', numeric: false },
  { field: 'postal_city', label: 'Postal city', numeric: false },
  { field: 'country', label: 'Country', numeric: false },
  { field: 'building', label: 'Building', numeric: false },
  { field: 'building_class', label: 'Building class', numeric: false },
  { field: 'height', label: 'Height m', numeric: true },
  { field: 'floors', label: 'Floors', numeric: true },
  { field: 'min_height', label: 'Min height', numeric: true },
  { field: 'min_floor', label: 'Min floor', numeric: true },
  { field: 'level', label: 'Level', numeric: true },
  { field: 'underground_floors', label: 'Und. floors', numeric: true },
  { field: 'has_parts', label: 'Has parts', numeric: false },
  { field: 'is_underground', label: 'Underground', numeric: false },
  { field: 'facade_material', label: 'Facade', numeric: false },
  { field: 'facade_color', label: 'Facade color', numeric: false },
  { field: 'roof_shape', label: 'Roof', numeric: false },
  { field: 'roof_material', label: 'Roof material', numeric: false },
  { field: 'roof_color', label: 'Roof color', numeric: false },
  { field: 'roof_direction', label: 'Roof dir.', numeric: true },
  { field: 'phones', label: 'Phones', numeric: false },
  { field: 'websites', label: 'Websites', numeric: false },
  { field: 'socials', label: 'Socials', numeric: false },
  { field: 'emails', label: 'Emails', numeric: false },
  { field: 'brand', label: 'Brand', numeric: false },
  { field: 'official_id', label: 'Official id', numeric: false },
  { field: 'brand_wikidata', label: 'Brand Wikidata', numeric: false },
  { field: 'place_addresses', label: 'Nested addresses', numeric: false },
  { field: 'sources', label: 'Sources', numeric: false },
  { field: 'attribution', label: 'Attribution', numeric: false },
  { field: 'building_id', label: 'Building id', numeric: false },
  { field: 'address_id', label: 'Address id', numeric: false },
  { field: 'id', label: 'Id', numeric: false },
  { field: 'h3', label: 'H3', numeric: false },
  { field: 'hail_mm_max', label: 'Hail mm max', numeric: true },
  { field: 'hail_days', label: 'Hail days', numeric: true },
  { field: 'hail_last_date', label: 'Hail last date', numeric: false },
  { field: 'lat', label: 'Lat', numeric: true },
  { field: 'lng', label: 'Lng', numeric: true },
] as const

type ColumnField = (typeof COLUMNS)[number]['field']

const compactSelectClass = 'h-6 rounded border border-white/[0.08] bg-black/30 px-1.5 pr-6 text-[10px] font-normal'

export function HexQueryTable() {
  const inspectOpen = useExplorer((state) => state.inspectOpen)
  const selectedCells = useExplorer((state) => state.selectedCells)
  const inspectReplay = useExplorer((state) => state.inspectReplay)
  const previewWorkflow = useExplorer((state) => state.previewWorkflow)
  const draftEnrichments = useExplorer((state) => state.draftEnrichments)
  const inspectRelease = useExplorer((state) => state.inspectRelease)
  const setInspectRelease = useExplorer((state) => state.setInspectRelease)
  const snapshots = useQuery({
    queryKey: ['hex-snapshots', selectedCells],
    queryFn: () => checkHexSnapshots(selectedCells),
    enabled: inspectOpen && selectedCells.length > 0,
  })
  const storedReleases = useMemo(() => {
    const found = new Set<string>()
    for (const cell of snapshots.data?.cells ?? []) {
      for (const release of cell.releases) found.add(release)
    }
    return [...found].sort()
  }, [snapshots.data])
  const places = useThemeQuery('places', inspectOpen)
  const buildings = useThemeQuery('buildings', inspectOpen)
  const addresses = useThemeQuery('addresses', inspectOpen)
  const page = useExplorer((state) => state.page)
  const setPage = useExplorer((state) => state.setPage)
  const limit = useExplorer((state) => state.limit)
  const focusCell = useExplorer((state) => state.focusCell)
  const focusH3 = useExplorer((state) => state.focus?.h3 ?? null)
  const [kind, setKind] = useState<DatasetId | 'all'>(defaultInspectFilters.kind)
  const [search, setSearch] = useState(defaultInspectFilters.search)
  const [categories, setCategories] = useState<string[]>([])
  const [mainCategories, setMainCategories] = useState<string[]>([])
  const [snapshotDates, setSnapshotDates] = useState<string[]>([])
  const [statuses, setStatuses] = useState<string[]>([])
  const [buildingClasses, setBuildingClasses] = useState<string[]>([])
  const [confidenceMin, setConfidenceMin] = useState<number | null>(null)
  const [confidenceMax, setConfidenceMax] = useState<number | null>(null)
  const [underground, setUnderground] = useState<PresenceFilter>('any')
  const [hasPhone, setHasPhone] = useState<PresenceFilter>('any')
  const [hasEmail, setHasEmail] = useState<PresenceFilter>('any')
  const [hasSocials, setHasSocials] = useState<PresenceFilter>('any')
  const [hasOfficialId, setHasOfficialId] = useState<PresenceFilter>('any')
  const [sortField, setSortField] = useState<ColumnField>('name')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
  const [customSql, setCustomSql] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [workflowName, setWorkflowName] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const client = useQueryClient()
  const create = useMutation({
    mutationFn: createQueryWorkflow,
    onSuccess: (workflow) => {
      setCreateOpen(false)
      setCreateError(null)
      setWorkflowName('')
      void client.invalidateQueries({ queryKey: ['query-workflows'] })
      previewWorkflow(workflow)
    },
    onError: (next) => setCreateError(next instanceof Error ? next.message : 'Could not save the workflow.'),
  })

  const merged = useMemo(
    () =>
      mergeFeatureRows(
        places.results.data?.rows ?? [],
        buildings.results.data?.rows ?? [],
        addresses.results.data?.rows ?? [],
      ),
    [places.results.data, buildings.results.data, addresses.results.data],
  )
  const categoryOptions = useMemo(() => observedValues(merged, 'category'), [merged])
  const mainCategoryOptions = useMemo(() => observedValues(merged, 'main_category'), [merged])
  const snapshotDateOptions = useMemo(() => observedValues(merged, 'snapshot_date'), [merged])
  const statusOptions = useMemo(() => observedValues(merged, 'operating_status'), [merged])
  const classOptions = useMemo(() => observedValues(merged, 'building_class'), [merged])
  const filtered = useMemo(
    () =>
      filterFeatureRows(merged, {
        kind,
        search,
        categories,
        mainCategories,
        snapshotDates,
        statuses,
        buildingClasses,
        confidenceMin,
        confidenceMax,
        underground,
        hasPhone,
        hasEmail,
        hasSocials,
        hasOfficialId,
      }),
    [
      merged,
      kind,
      search,
      categories,
      mainCategories,
      snapshotDates,
      statuses,
      buildingClasses,
      confidenceMin,
      confidenceMax,
      underground,
      hasPhone,
      hasEmail,
      hasSocials,
      hasOfficialId,
    ],
  )
  const sorted = useMemo(() => {
    const next = [...filtered]
    next.sort((left, right) => compareFeature(left, right, sortField, sortDirection))
    return next
  }, [filtered, sortField, sortDirection])
  const pages = Math.max(1, Math.ceil(sorted.length / limit))
  const pageIndex = Math.min(page, pages - 1)
  const visible = sorted.slice(pageIndex * limit, pageIndex * limit + limit)

  const fetching = places.results.isFetching || buildings.results.isFetching || addresses.results.isFetching
  const loading = (places.results.isLoading || buildings.results.isLoading || addresses.results.isLoading) && merged.length === 0
  const error = places.results.error ?? buildings.results.error ?? addresses.results.error
  const invalid = [...places.compiled.errors, ...buildings.compiled.errors, ...addresses.compiled.errors]
  const inspectFilters = useMemo<InspectFilters>(
    () => ({
      kind,
      search,
      categories,
      mainCategories,
      snapshotDates,
      statuses,
      buildingClasses,
      confidenceMin,
      confidenceMax,
      underground,
      hasPhone,
      hasEmail,
      hasSocials,
      hasOfficialId,
    }),
    [
      kind,
      search,
      categories,
      mainCategories,
      snapshotDates,
      statuses,
      buildingClasses,
      confidenceMin,
      confidenceMax,
      underground,
      hasPhone,
      hasEmail,
      hasSocials,
      hasOfficialId,
    ],
  )
  const generatedSql = useMemo(
    () => compileInspectSql(selectedCells, inspectFilters, inspectRelease),
    [inspectFilters, inspectRelease, selectedCells],
  )
  const sql = customSql ?? generatedSql
  const sqlError = customSql ? validateInspectSql(customSql) : null

  useEffect(() => {
    if (!inspectReplay) return
    applyInspectFilters(inspectReplay.filters, {
      setKind,
      setSearch,
      setCategories,
      setMainCategories,
      setSnapshotDates,
      setStatuses,
      setBuildingClasses,
      setConfidenceMin,
      setConfidenceMax,
      setUnderground,
      setHasPhone,
      setHasEmail,
      setHasSocials,
      setHasOfficialId,
    })
    setCustomSql(inspectReplay.customSql ? inspectReplay.sql : null)
    setInspectRelease(inspectReplay.releaseVersion)
    setPage(0)
  }, [inspectReplay, setInspectRelease, setPage])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2" data-testid="hex-query-table">
      <div className="flex shrink-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <select
            aria-label="Row source"
            className={cn(nativeSelectClass, compactSelectClass, 'w-28')}
            value={kind}
            onChange={(event) => {
              setKind(event.target.value as DatasetId | 'all')
              setPage(0)
            }}
          >
            <option value="all">All rows</option>
            {DATASET_IDS.map((id) => (
              <option key={id} value={id}>
                {DATASET_META[id].title}
              </option>
            ))}
          </select>
          <MultiPick label="Category" options={categoryOptions} value={categories} onChange={setCategories} resetPage={() => setPage(0)} />
          <MultiPick
            label="Main category"
            options={mainCategoryOptions}
            value={mainCategories}
            onChange={setMainCategories}
            resetPage={() => setPage(0)}
          />
          <select
            aria-label="Snapshot"
            className={cn(nativeSelectClass, compactSelectClass, 'min-w-36')}
            value={inspectRelease ?? ''}
            onChange={(event) => setInspectRelease(event.target.value || null)}
          >
            <option value="">Latest snapshot</option>
            {storedReleases.map((release) => (
              <option key={release} value={release}>
                {release}
              </option>
            ))}
          </select>
          <MultiPick
            label="Snapshot date"
            options={snapshotDateOptions}
            value={snapshotDates}
            onChange={setSnapshotDates}
            resetPage={() => setPage(0)}
          />
          <MultiPick label="Status" options={statusOptions} value={statuses} onChange={setStatuses} resetPage={() => setPage(0)} />
          <MultiPick
            label="Building class"
            options={classOptions}
            value={buildingClasses}
            onChange={setBuildingClasses}
            resetPage={() => setPage(0)}
          />
          <input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
              setPage(0)
            }}
            placeholder="Search place, address, snapshot, sources"
            className="h-6 min-w-28 flex-1 rounded border border-white/[0.08] bg-black/30 px-2 text-[11px] text-foreground placeholder:text-muted-foreground/70 focus-visible:border-primary/50 focus-visible:outline-none"
          />
          <span className="text-[11px] tabular-nums text-muted-foreground">{formatCount(filtered.length)} rows</span>
          {fetching && <LoaderCircle className="size-3 animate-spin text-muted-foreground" />}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <ConfidenceSlider
            label="Confidence ≥"
            value={confidenceMin}
            onChange={(next) => {
              setConfidenceMin(next)
              setPage(0)
            }}
          />
          <ConfidenceSlider
            label="Confidence ≤"
            value={confidenceMax}
            onChange={(next) => {
              setConfidenceMax(next)
              setPage(0)
            }}
          />
          <PresencePick label="Underground" value={underground} onChange={setUnderground} resetPage={() => setPage(0)} />
          <PresencePick label="Phone" value={hasPhone} onChange={setHasPhone} resetPage={() => setPage(0)} />
          <PresencePick label="Email" value={hasEmail} onChange={setHasEmail} resetPage={() => setPage(0)} />
          <PresencePick label="Socials" value={hasSocials} onChange={setHasSocials} resetPage={() => setPage(0)} />
          <PresencePick label="Official id" value={hasOfficialId} onChange={setHasOfficialId} resetPage={() => setPage(0)} />
        </div>
      </div>
      <SqlWorkbench
        sql={sql}
        custom={customSql != null}
        sqlError={sqlError}
        copied={copied}
        createOpen={createOpen}
        workflowName={workflowName}
        createError={createError}
        rowCount={sorted.length}
        hexCount={selectedCells.length}
        onSqlChange={(next) => {
          setCustomSql(next === generatedSql ? null : next)
        }}
        onReset={() => setCustomSql(null)}
        onCopy={() => {
          void navigator.clipboard.writeText(sql).then(() => {
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1400)
          })
        }}
        onDownload={() => {
          const stamp = new Date().toISOString().slice(0, 10)
          downloadCsv(`worldpulse-inspect-${stamp}.csv`, featureRowsToCsv(sorted))
        }}
        onToggleCreate={() => {
          setCreateOpen((open) => !open)
          setCreateError(null)
        }}
        onNameChange={setWorkflowName}
        onCreate={() => {
          setCreateError(null)
          if (sqlError) {
            setCreateError(sqlError)
            return
          }
          create.mutate({
            name: workflowName.trim() || defaultWorkflowName(selectedCells.length),
            sql,
            custom_sql: customSql != null,
            h3_cells: selectedCells,
            filters: inspectFilters,
            enrichments: draftEnrichments,
            release_version: inspectRelease,
          })
        }}
        creating={create.isPending}
      />
      {invalid[0] && <p className="text-[11px] text-destructive">{invalid[0]}</p>}
      {error && <p className="text-[11px] text-destructive">{error.message}</p>}
      {loading && <p className="text-[11px] text-muted-foreground">Loading features…</p>}
      <div className="min-h-0 flex-1 overflow-auto overscroll-contain rounded-lg border border-white/[0.08]">
        <table className="w-full border-collapse text-left text-[11px]">
          <thead className="sticky top-0 z-10 bg-[#0a1017]">
            <tr>
              {COLUMNS.map((column) => {
                const sortedCol = sortField === column.field
                return (
                  <th
                    key={column.field}
                    className={cn(
                      'border-b border-white/[0.06] px-2 py-1.5 font-medium text-muted-foreground',
                      column.numeric && 'text-right',
                    )}
                  >
                    <button
                      type="button"
                      className={cn('inline-flex items-center gap-1 hover:text-foreground', sortedCol && 'text-primary')}
                      onClick={() => {
                        if (sortField === column.field) setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'))
                        else {
                          setSortField(column.field)
                          setSortDirection('asc')
                        }
                      }}
                    >
                      {column.label}
                      {sortedCol && (sortDirection === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
                    </button>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length} className="px-2 py-6 text-center text-muted-foreground">
                  No features in these hexes.
                </td>
              </tr>
            )}
            {visible.map((row) => (
              <tr
                key={row.key}
                onClick={() => focusCell(row.h3)}
                className={cn(
                  'cursor-pointer border-t border-white/[0.04]',
                  focusH3 === row.h3 ? 'bg-primary/[0.08]' : 'hover:bg-white/[0.03]',
                )}
              >
                {COLUMNS.map((column) => (
                  <td
                    key={column.field}
                    className={cn(
                      'max-w-52 truncate px-2 py-1.5',
                      column.numeric && 'text-right font-mono tabular-nums',
                      (column.field === 'sources' || column.field === 'attribution') && 'max-w-72',
                    )}
                  >
                    {formatCell(row, column.field)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex shrink-0 items-center justify-end gap-1 text-[10px] text-muted-foreground">
        <PageButton label="Previous page" disabled={pageIndex <= 0} onClick={() => setPage(pageIndex - 1)}>
          <ChevronLeft className="size-3.5" />
        </PageButton>
        <span className="min-w-12 text-center tabular-nums">
          {sorted.length === 0 ? 0 : pageIndex + 1} / {pages}
        </span>
        <PageButton label="Next page" disabled={pageIndex >= pages - 1} onClick={() => setPage(pageIndex + 1)}>
          <ChevronRight className="size-3.5" />
        </PageButton>
      </div>
    </div>
  )
}

function SqlWorkbench({
  sql,
  custom,
  sqlError,
  copied,
  createOpen,
  workflowName,
  createError,
  rowCount,
  hexCount,
  creating,
  onSqlChange,
  onReset,
  onCopy,
  onDownload,
  onToggleCreate,
  onNameChange,
  onCreate,
}: {
  sql: string
  custom: boolean
  sqlError: string | null
  copied: boolean
  createOpen: boolean
  workflowName: string
  createError: string | null
  rowCount: number
  hexCount: number
  creating: boolean
  onSqlChange: (next: string) => void
  onReset: () => void
  onCopy: () => void
  onDownload: () => void
  onToggleCreate: () => void
  onNameChange: (next: string) => void
  onCreate: () => void
}) {
  const auth = useAuth()
  const user = auth.session.data?.user ?? null
  const configured = auth.session.data?.configured ?? false
  const { data: saved } = useQuery({
    queryKey: ['query-workflows'],
    queryFn: listQueryWorkflows,
    enabled: createOpen,
  })

  return (
    <section className="shrink-0 overflow-hidden rounded-xl border border-primary/20 bg-[linear-gradient(180deg,rgba(46,230,166,0.08),rgba(8,12,18,0.55))]">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-white/[0.06] px-2.5 py-1.5">
        <span className="font-mono text-[10px] tracking-[0.18em] text-primary uppercase">SQL</span>
        <span className="rounded-full bg-black/30 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">
          {custom ? 'custom' : 'generated'}
        </span>
        {custom && (
          <button type="button" onClick={onReset} className="text-[10px] text-primary hover:underline">
            Reset
          </button>
        )}
        <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">{formatCount(rowCount)} rows</span>
      </div>
      <textarea
        data-testid="inspect-sql"
        spellCheck={false}
        value={sql}
        onChange={(event) => onSqlChange(event.target.value)}
        className="min-h-28 w-full resize-y bg-[#05080c] px-3 py-2 font-mono text-[11px] leading-5 text-[#d7fff2] placeholder:text-muted-foreground/50 focus-visible:outline-none"
      />
      {sqlError && <p className="px-2.5 pb-1 text-[10px] text-destructive">{sqlError}</p>}
      <div className="flex flex-wrap items-center gap-1.5 px-2 py-1.5">
        <SqlAction onClick={onCopy}>
          <Copy className="size-3" />
          {copied ? 'Copied' : 'Copy SQL'}
        </SqlAction>
        <SqlAction onClick={onDownload}>
          <Download className="size-3" />
          Download CSV
        </SqlAction>
        <SqlAction primary onClick={onToggleCreate}>
          <Workflow className="size-3" />
          Create a workflow
        </SqlAction>
      </div>
      {createOpen && (
        <div className="grid gap-2 border-t border-white/[0.06] bg-black/25 px-2.5 py-2.5">
          {configured && !user ? (
            <p className="text-[11px] text-muted-foreground">
              <Link to="/settings" className="text-primary hover:underline">
                Sign in
              </Link>{' '}
              to save up to {MAX_QUERY_WORKFLOWS} workflows. Hexes can sit anywhere on the map.
            </p>
          ) : (
            <>
              <p className="text-[10px] text-muted-foreground">
                Saves this SQL and every selected hex. Preview later from Workflows.                 {MAX_QUERY_WORKFLOWS} max
                {typeof saved?.remaining === 'number' ? ` · ${saved.remaining} left` : ''}.
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                <input
                  value={workflowName}
                  onChange={(event) => onNameChange(event.target.value)}
                  placeholder={defaultWorkflowName(hexCount)}
                  className="h-7 min-w-40 flex-1 rounded-md border border-white/[0.08] bg-black/40 px-2 text-[11px] text-foreground placeholder:text-muted-foreground/70 focus-visible:border-primary/50 focus-visible:outline-none"
                />
                <button
                  type="button"
                  disabled={creating}
                  onClick={onCreate}
                  className="h-7 rounded-full bg-primary px-3 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
                >
                  {creating ? 'Saving…' : 'Save workflow'}
                </button>
              </div>
            </>
          )}
          {createError && <p className="text-[11px] text-destructive">{createError}</p>}
        </div>
      )}
    </section>
  )
}

function SqlAction({
  children,
  onClick,
  primary,
}: {
  children: ReactNode
  onClick: () => void
  primary?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-[10px] font-medium',
        primary
          ? 'bg-primary text-primary-foreground hover:bg-primary/90'
          : 'bg-white/[0.06] text-foreground/90 hover:bg-primary/15 hover:text-primary',
      )}
    >
      {children}
    </button>
  )
}

function defaultWorkflowName(hexCount: number) {
  return `Inspect · ${hexCount} hexes`
}

function applyInspectFilters(
  filters: InspectFilters,
  setters: {
    setKind: (next: DatasetId | 'all') => void
    setSearch: (next: string) => void
    setCategories: (next: string[]) => void
    setMainCategories: (next: string[]) => void
    setSnapshotDates: (next: string[]) => void
    setStatuses: (next: string[]) => void
    setBuildingClasses: (next: string[]) => void
    setConfidenceMin: (next: number | null) => void
    setConfidenceMax: (next: number | null) => void
    setUnderground: (next: PresenceFilter) => void
    setHasPhone: (next: PresenceFilter) => void
    setHasEmail: (next: PresenceFilter) => void
    setHasSocials: (next: PresenceFilter) => void
    setHasOfficialId: (next: PresenceFilter) => void
  },
) {
  setters.setKind(filters.kind)
  setters.setSearch(filters.search)
  setters.setCategories([...filters.categories])
  setters.setMainCategories([...filters.mainCategories])
  setters.setSnapshotDates([...filters.snapshotDates])
  setters.setStatuses([...filters.statuses])
  setters.setBuildingClasses([...filters.buildingClasses])
  setters.setConfidenceMin(filters.confidenceMin)
  setters.setConfidenceMax(filters.confidenceMax)
  setters.setUnderground(filters.underground)
  setters.setHasPhone(filters.hasPhone)
  setters.setHasEmail(filters.hasEmail)
  setters.setHasSocials(filters.hasSocials)
  setters.setHasOfficialId(filters.hasOfficialId)
}

function MultiPick({
  label,
  options,
  value,
  onChange,
  resetPage,
}: {
  label: string
  options: readonly string[]
  value: readonly string[]
  onChange: (next: string[]) => void
  resetPage: () => void
}) {
  return (
    <details className="relative">
      <summary className="flex h-6 cursor-pointer list-none items-center rounded border border-white/[0.08] bg-black/30 px-2 text-[10px] text-foreground">
        {label}
        {value.length > 0 ? ` · ${value.length}` : ''}
      </summary>
      <div className="absolute top-7 left-0 z-20 max-h-48 min-w-40 overflow-auto rounded-lg border border-white/[0.08] bg-[#0a1017] p-1.5 shadow-xl">
        {options.length === 0 && <p className="px-1.5 py-1 text-[10px] text-muted-foreground">None in these hexes</p>}
        {options.map((option) => {
          const checked = value.includes(option)
          return (
            <label key={option} className="flex items-center gap-1.5 rounded px-1.5 py-1 text-[10px] hover:bg-white/[0.04]">
              <input
                type="checkbox"
                checked={checked}
                onChange={() => {
                  onChange(checked ? value.filter((entry) => entry !== option) : [...value, option])
                  resetPage()
                }}
              />
              <span className="truncate">{option.replaceAll('_', ' ')}</span>
            </label>
          )
        })}
      </div>
    </details>
  )
}

function PresencePick({
  label,
  value,
  onChange,
  resetPage,
}: {
  label: string
  value: PresenceFilter
  onChange: (next: PresenceFilter) => void
  resetPage: () => void
}) {
  return (
    <select
      aria-label={label}
      className={cn(nativeSelectClass, compactSelectClass, 'w-32')}
      value={value}
      onChange={(event) => {
        onChange(event.target.value as PresenceFilter)
        resetPage()
      }}
    >
      <option value="any">Any {label.toLowerCase()}</option>
      <option value="yes">Has {label.toLowerCase()}</option>
      <option value="no">No {label.toLowerCase()}</option>
    </select>
  )
}

function ConfidenceSlider({
  label,
  value,
  onChange,
}: {
  label: string
  value: number | null
  onChange: (next: number | null) => void
}) {
  return (
    <label className="flex h-6 items-center gap-1 rounded border border-white/[0.08] bg-black/30 px-2 text-[10px] text-muted-foreground">
      {label}
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value ?? 0}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-16 accent-primary"
      />
      <span className="w-8 tabular-nums text-foreground">{value == null ? 'any' : value.toFixed(2)}</span>
      {value != null && (
        <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => onChange(null)}>
          ×
        </button>
      )}
    </label>
  )
}

function formatCell(row: FeatureRow, field: ColumnField): string {
  const value = row[field]
  if (value == null || value === '') return '—'
  if (field === 'lat' || field === 'lng') return (value as number).toFixed(5)
  return String(value)
}

function compareFeature(left: FeatureRow, right: FeatureRow, field: ColumnField, direction: 'asc' | 'desc') {
  const a = left[field]
  const b = right[field]
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  const base =
    typeof a === 'number' && typeof b === 'number'
      ? a - b
      : String(a).localeCompare(String(b), undefined, { sensitivity: 'base', numeric: true })
  return direction === 'asc' ? base : -base
}
