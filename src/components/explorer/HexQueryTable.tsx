import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, LoaderCircle } from 'lucide-react'
import { useCompiledQuery, useQueryResults } from '../../hooks/useCompiledQuery'
import { formatCount, formatValue } from '../../lib/format'
import { cn } from '../../lib/utils'
import { useExplorer } from '../../store/explorer-store'
import {
  DATASET_IDS,
  DATASET_META,
  fieldByName,
  type DatasetId,
  type FieldDefinition,
} from '../../types/datasets'
import { useResultsModel } from '../results/useResultsModel'
import { PageButton } from '../results/ResultsPanel'

export function HexQueryTable() {
  const compiled = useCompiledQuery()
  const results = useQueryResults(compiled)
  const model = useResultsModel(compiled, results)
  const dataset = useExplorer((state) => state.dataset)
  const setDataset = useExplorer((state) => state.setDataset)
  const setSort = useExplorer((state) => state.setSort)
  const setPage = useExplorer((state) => state.setPage)
  const focusCell = useExplorer((state) => state.focusCell)
  const focusH3 = useExplorer((state) => state.focus?.h3 ?? null)
  const meta = DATASET_META[dataset]

  return (
    <div className="mt-3 grid gap-2" data-testid="hex-query-table">
      <div className="flex flex-wrap items-center gap-1.5">
        {DATASET_IDS.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setDataset(id)}
            className={cn(
              'h-6 rounded-full px-2 text-[11px] font-medium',
              dataset === id ? 'bg-primary/15 text-primary' : 'bg-white/[0.05] text-muted-foreground hover:text-foreground',
            )}
          >
            {DATASET_META[id].title}
          </button>
        ))}
        <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
          {model.result ? `${formatCount(model.result.total)} ${meta.plural}` : meta.plural}
        </span>
        {model.fetching && <LoaderCircle className="size-3 animate-spin text-muted-foreground" />}
      </div>
      {!model.valid && <p className="text-[11px] text-destructive">{compiled.errors[0]}</p>}
      {model.error && <p className="text-[11px] text-destructive">{model.error.message}</p>}
      {model.loading && <p className="text-[11px] text-muted-foreground">Loading {meta.plural}…</p>}
      <div className="max-h-72 overflow-auto rounded-lg border border-white/[0.08]">
        <table className="w-full border-collapse text-left text-[11px]">
          <thead className="sticky top-0 z-10 bg-[#0a1017]">
            <tr>
              {model.columns.map((column) => {
                const field = fieldByName(dataset, column.field)
                const sorted = compiled.spec.sort.field === column.field
                return (
                  <th
                    key={column.field}
                    className={cn(
                      'border-b border-white/[0.06] px-2 py-1.5 align-bottom font-medium text-muted-foreground',
                      column.numeric && 'text-right',
                    )}
                  >
                    {column.sortable ? (
                      <button
                        type="button"
                        className={cn('inline-flex items-center gap-1 hover:text-foreground', sorted && 'text-primary')}
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
                    {field && <ColumnFilter field={field} dataset={dataset} />}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {model.result?.rows.length === 0 && (
              <tr>
                <td colSpan={model.columns.length} className="px-2 py-6 text-center text-muted-foreground">
                  No {meta.plural} in these hexes.
                </td>
              </tr>
            )}
            {model.result?.rows.map((row) => (
              <tr
                key={row.id}
                onClick={() => focusCell(row.h3)}
                className={cn(
                  'cursor-pointer border-t border-white/[0.04]',
                  focusH3 === row.h3 ? 'bg-primary/[0.08]' : 'hover:bg-white/[0.03]',
                )}
              >
                {model.columns.map((column) => {
                  const raw = column.source === 'h3' ? row.h3 : (row.values[column.field] ?? null)
                  return (
                    <td
                      key={column.field}
                      className={cn(
                        'max-w-44 truncate px-2 py-1.5 whitespace-nowrap',
                        column.source === 'h3' && 'font-mono text-muted-foreground',
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
      {model.result && (
        <div className="flex items-center justify-end gap-1 text-[10px] text-muted-foreground">
          <PageButton label="Previous page" disabled={model.page <= 0} onClick={() => setPage(model.page - 1)}>
            <ChevronLeft className="size-3.5" />
          </PageButton>
          <span className="min-w-12 text-center tabular-nums">
            {model.result.total === 0 ? 0 : model.page + 1} / {model.pages}
          </span>
          <PageButton label="Next page" disabled={!model.hasNext} onClick={() => setPage(model.page + 1)}>
            <ChevronRight className="size-3.5" />
          </PageButton>
        </div>
      )}
    </div>
  )
}

function ColumnFilter({ field, dataset }: { field: FieldDefinition; dataset: DatasetId }) {
  const places = useExplorer((state) => state.filtersByDataset.places)
  const buildings = useExplorer((state) => state.filtersByDataset.buildings)
  const addresses = useExplorer((state) => state.filtersByDataset.addresses)
  const patchPlaces = useExplorer((state) => state.patchPlaces)
  const patchBuildings = useExplorer((state) => state.patchBuildings)
  const patchAddresses = useExplorer((state) => state.patchAddresses)
  if (field.operators.length === 0) return null

  const inputClass =
    'mt-1 h-6 w-full min-w-20 rounded border border-white/[0.08] bg-black/30 px-1.5 text-[10px] font-normal text-foreground placeholder:text-muted-foreground/70 focus-visible:border-primary/50 focus-visible:outline-none'

  if (dataset === 'places') {
    if (field.field === 'names.primary') {
      return (
        <input
          className={inputClass}
          value={places.name}
          placeholder="contains"
          onChange={(event) => patchPlaces({ name: event.target.value })}
        />
      )
    }
    if (field.field === 'basic_category') {
      return (
        <input
          className={inputClass}
          value={places.basicCategories.join(', ')}
          placeholder="restaurant, cafe"
          onChange={(event) =>
            patchPlaces({
              basicCategories: event.target.value
                .split(',')
                .map((entry) => entry.trim())
                .filter(Boolean),
            })
          }
        />
      )
    }
    if (field.field === 'taxonomy.primary') {
      return (
        <input
          className={inputClass}
          value={places.primaryCategory}
          placeholder="eq"
          onChange={(event) => patchPlaces({ primaryCategory: event.target.value })}
        />
      )
    }
    if (field.field === 'confidence') {
      return (
        <div className="mt-1 flex gap-1">
          <input
            className={inputClass}
            value={places.confidenceMin}
            placeholder="min"
            inputMode="decimal"
            onChange={(event) => patchPlaces({ confidenceMin: event.target.value })}
          />
          <input
            className={inputClass}
            value={places.confidenceMax}
            placeholder="max"
            inputMode="decimal"
            onChange={(event) => patchPlaces({ confidenceMax: event.target.value })}
          />
        </div>
      )
    }
  }

  if (dataset === 'buildings') {
    if (field.field === 'subtype') {
      return (
        <input
          className={inputClass}
          value={buildings.subtypes.join(', ')}
          placeholder="residential"
          onChange={(event) =>
            patchBuildings({
              subtypes: event.target.value
                .split(',')
                .map((entry) => entry.trim())
                .filter(Boolean),
            })
          }
        />
      )
    }
    if (field.field === 'height') {
      return (
        <div className="mt-1 flex gap-1">
          <input
            className={inputClass}
            value={buildings.heightMin}
            placeholder="min m"
            inputMode="decimal"
            onChange={(event) => patchBuildings({ heightMin: event.target.value })}
          />
          <input
            className={inputClass}
            value={buildings.heightMax}
            placeholder="max m"
            inputMode="decimal"
            onChange={(event) => patchBuildings({ heightMax: event.target.value })}
          />
        </div>
      )
    }
    if (field.field === 'num_floors') {
      return (
        <div className="mt-1 flex gap-1">
          <input
            className={inputClass}
            value={buildings.floorsMin}
            placeholder="min"
            inputMode="numeric"
            onChange={(event) => patchBuildings({ floorsMin: event.target.value })}
          />
          <input
            className={inputClass}
            value={buildings.floorsMax}
            placeholder="max"
            inputMode="numeric"
            onChange={(event) => patchBuildings({ floorsMax: event.target.value })}
          />
        </div>
      )
    }
  }

  if (dataset === 'addresses') {
    if (field.field === 'street') {
      return (
        <input
          className={inputClass}
          value={addresses.street}
          placeholder="contains"
          onChange={(event) => patchAddresses({ street: event.target.value })}
        />
      )
    }
    if (field.field === 'locality') {
      return (
        <input
          className={inputClass}
          value={addresses.locality}
          placeholder="contains"
          onChange={(event) => patchAddresses({ locality: event.target.value })}
        />
      )
    }
    if (field.field === 'region') {
      return (
        <input
          className={inputClass}
          value={addresses.region}
          placeholder="contains"
          onChange={(event) => patchAddresses({ region: event.target.value })}
        />
      )
    }
    if (field.field === 'postcode') {
      return (
        <input
          className={inputClass}
          value={addresses.postcode}
          placeholder="eq"
          onChange={(event) => patchAddresses({ postcode: event.target.value })}
        />
      )
    }
  }

  return null
}
