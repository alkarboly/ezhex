import { ChevronsLeft, RotateCcw, SlidersHorizontal } from 'lucide-react'
import { useCompiledQuery } from '../../hooks/useCompiledQuery'
import { useExplorer } from '../../store/explorer-store'
import { DATASET_META } from '../../types/datasets'
import { DATASET_ICONS } from '../explorer/DatasetSwitcher'
import { QueryForm } from './QueryForm'

export const FILTER_PANEL_WIDTH = 340

export function FilterPanel() {
  const open = useExplorer((state) => state.filtersOpen)
  const setOpen = useExplorer((state) => state.setFiltersOpen)
  const dataset = useExplorer((state) => state.dataset)
  const resetFilters = useExplorer((state) => state.resetFilters)
  const compiled = useCompiledQuery()
  const conditions = compiled.spec.filters.length
  const Icon = DATASET_ICONS[dataset]

  if (!open) {
    return (
      <button
        type="button"
        data-testid="open-query"
        onClick={() => setOpen(true)}
        className="glass absolute top-3 left-3 z-20 flex h-11 items-center gap-2 rounded-full pr-4 pl-3 text-sm font-medium transition-colors hover:text-primary"
      >
        <SlidersHorizontal className="size-4 text-primary" />
        Query
        {conditions > 0 && (
          <span className="rounded-full bg-primary/15 px-1.5 text-[11px] text-primary tabular-nums">{conditions}</span>
        )}
      </button>
    )
  }

  return (
    <aside
      aria-label="Query"
      className="glass absolute top-3 bottom-3 left-3 z-20 flex flex-col overflow-hidden rounded-2xl animate-[wp-slide-in_180ms_ease-out]"
      style={{ width: FILTER_PANEL_WIDTH }}
    >
      <header className="flex items-start gap-3 border-b border-white/[0.06] px-4 pt-4 pb-3.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/12 text-primary">
          <Icon className="size-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">{DATASET_META[dataset].title}</h2>
            {conditions > 0 && (
              <span className="rounded-full bg-primary/15 px-1.5 text-[11px] text-primary tabular-nums">
                {conditions} {conditions === 1 ? 'filter' : 'filters'}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs leading-4 text-muted-foreground">{DATASET_META[dataset].blurb}</p>
        </div>
        <div className="-mt-1 -mr-1 flex shrink-0">
          <button
            type="button"
            title="Reset filters"
            aria-label="Reset filters"
            onClick={resetFilters}
            className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
          >
            <RotateCcw className="size-3.5" />
          </button>
          <button
            type="button"
            title="Collapse"
            aria-label="Collapse query panel"
            onClick={() => setOpen(false)}
            className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
          >
            <ChevronsLeft className="size-4" />
          </button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
        <QueryForm />
      </div>
    </aside>
  )
}
