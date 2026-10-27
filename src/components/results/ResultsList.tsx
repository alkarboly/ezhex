import type { UseQueryResult } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Download, Hexagon, LoaderCircle, Scan, Search } from 'lucide-react'
import { formatCount, formatValue } from '../../lib/format'
import type { CompiledQuery } from '../../lib/query-builder'
import { cn } from '../../lib/utils'
import { useExplorer } from '../../store/explorer-store'
import { DATASET_META, RESULT_SEARCH_FIELD, type DatasetId } from '../../types/datasets'
import type { QueryResult, ResultRow } from '../../types/queries'
import { DataModeChip, PageButton, searchPlaceholder } from './ResultsPanel'
import { useResultsModel } from './useResultsModel'

export function ResultsList({
  compiled,
  query,
  onFocusCell,
}: {
  compiled: CompiledQuery
  query: UseQueryResult<QueryResult, Error>
  onFocusCell: (h3: string) => void
}) {
  const resultsSearch = useExplorer((state) => state.resultsSearch)
  const setResultsSearch = useExplorer((state) => state.setResultsSearch)
  const focusH3 = useExplorer((state) => state.focus?.h3 ?? null)
  const setPage = useExplorer((state) => state.setPage)
  const selectVisible = useExplorer((state) => state.selectVisible)
  const viewportStatus = useExplorer((state) => state.viewportStatus)
  const model = useResultsModel(compiled, query)
  const meta = DATASET_META[model.dataset]

  if (!model.hasSelection) {
    return (
      <div className="flex flex-col items-center px-4 py-8 text-center">
        <span className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
          <Hexagon className="size-6" />
        </span>
        <p className="mt-3 text-sm font-medium">No cells selected</p>
        <p className="mt-1 max-w-64 text-xs leading-5 text-muted-foreground">
          Tap cells on the map, or line one up under the reticle and press Add, to list {meta.plural}.
        </p>
        <button
          type="button"
          disabled={viewportStatus !== 'ready'}
          onClick={selectVisible}
          className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-full border border-white/[0.1] px-4 text-xs font-medium disabled:opacity-40"
        >
          <Scan className="size-3.5" />
          Select visible cells
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span data-testid="results-total-mobile" className="text-sm font-semibold tabular-nums">
          {model.result ? `${formatCount(model.result.total)} ${meta.plural}` : ' '}
        </span>
        {model.result && (
          <span className="text-xs text-muted-foreground">
            {model.matchedCells} of {model.ranked.length} cells
          </span>
        )}
        {model.fetching && <LoaderCircle className="size-3.5 animate-spin text-muted-foreground" />}
        <button
          type="button"
          disabled={!model.canExport}
          onClick={() => void model.exportCsv()}
          className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-full bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:bg-white/[0.06] disabled:text-muted-foreground"
        >
          <Download className="size-3.5" />
          {model.exporting ? 'Exporting…' : 'CSV'}
        </button>
      </div>

      {!model.valid && <p className="text-xs text-destructive">{compiled.errors[0]}</p>}
      {model.error && <p className="text-xs text-destructive">{model.error.message}</p>}
      {model.loading && <p className="text-sm text-muted-foreground">Querying {meta.plural}…</p>}

      {model.result && (
        <>
          <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-0.5">
            {model.ranked.map((cell) => (
              <button
                key={cell.h3}
                type="button"
                onClick={() => onFocusCell(cell.h3)}
                className={cn(
                  'flex shrink-0 items-center gap-1.5 rounded-full border py-1 pr-2.5 pl-2',
                  focusH3 === cell.h3 ? 'border-primary/60 bg-primary/10' : 'border-white/[0.08]',
                  cell.count === 0 && 'opacity-50',
                )}
              >
                <span className="size-1.5 rounded-full bg-select" />
                <span className="font-mono text-[10px] text-muted-foreground">{cell.h3.slice(0, 9)}…</span>
                <span className="font-mono text-[11px] font-medium tabular-nums">{cell.count}</span>
              </button>
            ))}
          </div>

          {RESULT_SEARCH_FIELD[model.dataset] != null && (
            <label className="relative block">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={resultsSearch}
                placeholder={searchPlaceholder(model.dataset)}
                onChange={(event) => setResultsSearch(event.target.value)}
                className="h-10 w-full rounded-xl border border-white/[0.08] bg-white/[0.03] pr-3 pl-9 text-sm placeholder:text-muted-foreground/60 focus-visible:border-primary/60 focus-visible:outline-none"
              />
            </label>
          )}

          {model.result.rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No {meta.plural} match this query.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {model.result.rows.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    data-testid="result-card"
                    onClick={() => onFocusCell(row.h3)}
                    className={cn(
                      'w-full rounded-xl border px-3 py-2.5 text-left transition-colors',
                      focusH3 === row.h3
                        ? 'border-primary/50 bg-primary/[0.08]'
                        : 'border-white/[0.06] bg-white/[0.02] active:bg-white/[0.05]',
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{rowTitle(model.dataset, row)}</span>
                      <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">{row.h3}</span>
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {rowDetails(model.dataset, row).join(' · ')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-center justify-center gap-2 pb-2 text-xs text-muted-foreground">
            <PageButton label="Previous page" disabled={model.page <= 0} onClick={() => setPage(model.page - 1)}>
              <ChevronLeft className="size-3.5" />
            </PageButton>
            <span className="min-w-20 text-center tabular-nums">
              Page {model.result.total === 0 ? 0 : model.page + 1} of {model.pages}
            </span>
            <PageButton label="Next page" disabled={!model.hasNext} onClick={() => setPage(model.page + 1)}>
              <ChevronRight className="size-3.5" />
            </PageButton>
          </div>
          <div className="flex justify-center pb-1">
            <DataModeChip />
          </div>
        </>
      )}
    </div>
  )
}

function rowTitle(dataset: DatasetId, row: ResultRow): string {
  const values = row.values
  if (dataset === 'places') return formatValue('names.primary', values['names.primary'] ?? null)
  if (dataset === 'addresses') {
    return [values.number, values.street].filter((part) => part != null && part !== '').join(' ') || 'Address'
  }
  const subtype = values.subtype
  return typeof subtype === 'string' ? `${subtype.charAt(0).toUpperCase()}${subtype.slice(1)} building` : 'Building'
}

function rowDetails(dataset: DatasetId, row: ResultRow): string[] {
  const values = row.values
  if (dataset === 'places') {
    const details = [formatValue('basic_category', values.basic_category ?? null)]
    if (values.confidence != null) details.push(`${formatValue('confidence', values.confidence)} confidence`)
    if (values.operating_status != null) details.push(formatValue('operating_status', values.operating_status))
    return details
  }
  if (dataset === 'addresses') {
    return [values.locality, values.region, values.postcode]
      .filter((part) => part != null && part !== '')
      .map((part) => String(part))
  }
  const details = [values.height != null ? `${formatValue('height', values.height)} m tall` : 'No height']
  if (values.num_floors != null) details.push(`${values.num_floors} floors`)
  if (values.subtype == null) details.push('No subtype')
  return details
}
