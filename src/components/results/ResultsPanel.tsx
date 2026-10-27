import type { UseQueryResult } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronUp, Download, LoaderCircle, Search } from 'lucide-react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { formatCount, formatValue } from '../../lib/format'
import type { CompiledQuery } from '../../lib/query-builder'
import { summarizeQuery } from '../../lib/query-builder'
import { cn } from '../../lib/utils'
import { configuredDataMode } from '../../services'
import { useExplorer } from '../../store/explorer-store'
import { DATASET_META, RESULT_SEARCH_FIELD } from '../../types/datasets'
import type { QueryResult } from '../../types/queries'
import { useResultsModel } from './useResultsModel'

export const RESULTS_BAR_HEIGHT = 52

export function DataModeChip({ className }: { className?: string }) {
  const mode = configuredDataMode().resolved
  return (
    <span
      className={cn(
        'shrink-0 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-primary',
        className,
      )}
    >
      {mode === 'supabase' ? 'Supabase' : 'Mock data'}
    </span>
  )
}

export function searchPlaceholder(dataset: string): string {
  if (dataset === 'places') return 'Search place names'
  if (dataset === 'addresses') return 'Search address text'
  return 'Text search is not available for buildings'
}

export function ResultsPanel({
  compiled,
  query,
  left,
}: {
  compiled: CompiledQuery
  query: UseQueryResult<QueryResult, Error>
  left: number
}) {
  const open = useExplorer((state) => state.resultsOpen)
  const setOpen = useExplorer((state) => state.setResultsOpen)
  const height = useExplorer((state) => state.resultsHeight)
  const setHeight = useExplorer((state) => state.setResultsHeight)
  const resultsSearch = useExplorer((state) => state.resultsSearch)
  const setResultsSearch = useExplorer((state) => state.setResultsSearch)
  const focusCell = useExplorer((state) => state.focusCell)
  const focusH3 = useExplorer((state) => state.focus?.h3 ?? null)
  const setPage = useExplorer((state) => state.setPage)
  const setSort = useExplorer((state) => state.setSort)
  const model = useResultsModel(compiled, query)
  const meta = DATASET_META[model.dataset]
  const searchable = RESULT_SEARCH_FIELD[model.dataset] != null
  const expanded = open && model.hasSelection

  const onResizeStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const startY = event.clientY
    const startHeight = height
    const move = (pointer: PointerEvent) => {
      setHeight(Math.min(window.innerHeight * 0.7, Math.max(200, startHeight - (pointer.clientY - startY))))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <section
      aria-label="Query results"
      className="glass @container absolute right-3 bottom-3 z-20 flex flex-col overflow-hidden rounded-2xl transition-[left,height] duration-200 ease-out"
      style={{ left, height: expanded ? height : RESULTS_BAR_HEIGHT }}
    >
      {expanded && (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize results"
          onPointerDown={onResizeStart}
          className="group absolute inset-x-0 top-0 z-10 flex h-3 cursor-row-resize justify-center"
        >
          <span className="mt-1 h-1 w-10 rounded-full bg-white/15 transition-colors group-hover:bg-primary/70" />
        </div>
      )}
      <header className="flex shrink-0 items-center gap-3 px-3" style={{ height: RESULTS_BAR_HEIGHT }}>
        <button
          type="button"
          aria-expanded={expanded}
          disabled={!model.hasSelection}
          onClick={() => setOpen(!open)}
          className="flex shrink-0 items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-semibold transition-colors hover:bg-white/[0.05] disabled:pointer-events-none"
        >
          <ChevronUp className={cn('size-4 text-muted-foreground transition-transform', expanded && 'rotate-180')} />
          Results
        </button>
        <span data-testid="results-total" className="shrink-0 text-sm whitespace-nowrap tabular-nums">
          {model.result
            ? `${formatCount(model.result.total)} ${meta.plural}`
            : model.hasSelection
              ? ''
              : 'No cells selected'}
        </span>
        {model.result ? (
          <span className="hidden text-xs whitespace-nowrap text-muted-foreground @3xl:inline">
            {model.matchedCells} of {model.ranked.length} cells match
          </span>
        ) : (
          !model.hasSelection && (
            <span className="hidden truncate text-xs text-muted-foreground @3xl:inline">
              Select cells on the map to list {meta.plural}.
            </span>
          )
        )}
        <DataModeChip className="hidden @2xl:inline" />
        {model.fetching && <LoaderCircle aria-label="Updating" className="size-3.5 animate-spin text-muted-foreground" />}
        <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2">
          {expanded && (
            <label className="relative hidden min-w-0 flex-1 @md:block @md:max-w-64">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={resultsSearch}
                data-testid="results-search"
                disabled={!searchable}
                placeholder={searchPlaceholder(model.dataset)}
                onChange={(event) => setResultsSearch(event.target.value)}
                className="h-8 w-full rounded-lg border border-white/[0.08] bg-white/[0.03] pr-3 pl-8 text-xs placeholder:text-muted-foreground/60 focus-visible:border-primary/60 focus-visible:outline-none disabled:opacity-50"
              />
            </label>
          )}
          <button
            type="button"
            disabled={!model.canExport}
            onClick={() => void model.exportCsv()}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:bg-white/[0.06] disabled:text-muted-foreground"
          >
            <Download className="size-3.5" />
            {model.exporting ? 'Exporting…' : 'Export CSV'}
          </button>
        </div>
      </header>

      {expanded && (
        <div className="flex min-h-0 flex-1 flex-col gap-2.5 px-3 pb-3">
          <p className="truncate px-1 text-xs text-muted-foreground">{summarizeQuery(compiled.spec)}</p>
          {!model.valid && <p className="px-1 text-xs text-destructive">{compiled.errors[0]}</p>}
          {model.error && <p className="px-1 text-xs text-destructive">{model.error.message}</p>}
          {model.loading && <p className="px-1 text-sm text-muted-foreground">Querying {meta.plural}…</p>}
          {model.result && (
            <>
              <div className="flex min-w-0 gap-1.5 overflow-x-auto pb-0.5">
                {model.ranked.map((cell) => (
                  <button
                    key={cell.h3}
                    type="button"
                    onClick={() => focusCell(cell.h3)}
                    className={cn(
                      'flex shrink-0 items-center gap-2 rounded-full border py-1 pr-2.5 pl-2 text-left transition-colors',
                      focusH3 === cell.h3
                        ? 'border-primary/60 bg-primary/10'
                        : 'border-white/[0.07] hover:border-white/20',
                      cell.count === 0 && 'opacity-50',
                    )}
                  >
                    <span className="size-1.5 rounded-full bg-select" />
                    <span className="font-mono text-[10px] text-muted-foreground">{cell.h3}</span>
                    <span className="font-mono text-[11px] font-medium tabular-nums">{cell.count}</span>
                  </button>
                ))}
              </div>
              <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-white/[0.06]">
                <table className="w-full border-collapse text-left text-xs">
                  <thead className="sticky top-0 z-10 bg-[#0a1017]">
                    <tr>
                      {model.columns.map((column) => {
                        const sorted = compiled.spec.sort.field === column.field
                        return (
                          <th
                            key={column.field}
                            scope="col"
                            aria-sort={
                              sorted ? (compiled.spec.sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'
                            }
                            className={cn(
                              'border-b border-white/[0.06] px-3 py-2 text-[10px] font-semibold tracking-wider whitespace-nowrap text-muted-foreground uppercase',
                              column.numeric && 'text-right',
                            )}
                          >
                            {column.sortable ? (
                              <button
                                type="button"
                                className={cn(
                                  'inline-flex items-center gap-1 uppercase hover:text-foreground',
                                  sorted && 'text-primary',
                                )}
                                onClick={() => setSort(column.field)}
                              >
                                {column.label}
                                {sorted &&
                                  (compiled.spec.sort.direction === 'asc' ? (
                                    <ArrowUp className="size-3" />
                                  ) : (
                                    <ArrowDown className="size-3" />
                                  ))}
                              </button>
                            ) : (
                              column.label
                            )}
                          </th>
                        )
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {model.result.rows.length === 0 && (
                      <tr>
                        <td colSpan={model.columns.length} className="px-3 py-8 text-center text-muted-foreground">
                          No {meta.plural} match this query.
                        </td>
                      </tr>
                    )}
                    {model.result.rows.map((row) => (
                      <tr
                        key={row.id}
                        onClick={() => focusCell(row.h3)}
                        className={cn(
                          'cursor-pointer border-t border-white/[0.04] transition-colors',
                          focusH3 === row.h3
                            ? 'bg-primary/[0.08] shadow-[inset_2px_0_0_#3ddec0]'
                            : 'hover:bg-white/[0.03]',
                        )}
                      >
                        {model.columns.map((column) => {
                          const raw = column.source === 'h3' ? row.h3 : (row.values[column.field] ?? null)
                          return (
                            <td
                              key={column.field}
                              className={cn(
                                'px-3 py-2 whitespace-nowrap',
                                column.source === 'h3' && 'font-mono text-[11px] text-muted-foreground',
                                column.numeric && 'text-right font-mono tabular-nums',
                              )}
                            >
                              {column.source === 'h3' ? row.h3 : formatValue(column.field, raw)}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <footer className="flex items-center gap-3 px-1 text-[11px] text-muted-foreground">
                <span>Click a row to fly to its cell. Mock rows sit on the cell center.</span>
                <div className="ml-auto flex items-center gap-1">
                  <PageButton label="Previous page" disabled={model.page <= 0} onClick={() => setPage(model.page - 1)}>
                    <ChevronLeft className="size-3.5" />
                  </PageButton>
                  <span className="min-w-16 text-center tabular-nums">
                    {model.result.total === 0 ? 0 : model.page + 1} / {model.pages}
                  </span>
                  <PageButton label="Next page" disabled={!model.hasNext} onClick={() => setPage(model.page + 1)}>
                    <ChevronRight className="size-3.5" />
                  </PageButton>
                </div>
              </footer>
            </>
          )}
        </div>
      )}
    </section>
  )
}

export function PageButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-7 place-items-center rounded-lg border border-white/[0.08] text-foreground transition-colors hover:bg-white/[0.05] disabled:opacity-35"
    >
      {children}
    </button>
  )
}
