import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, LoaderCircle } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useThemeQuery } from '../../hooks/useCompiledQuery'
import { filterFeatureRows, mergeFeatureRows, type FeatureRow } from '../../lib/feature-rows'
import { formatCount, formatValue } from '../../lib/format'
import { cn } from '../../lib/utils'
import { useExplorer } from '../../store/explorer-store'
import { BUILDING_SUBTYPES, DATASET_IDS, DATASET_META, type DatasetId } from '../../types/datasets'
import { BASIC_CATEGORIES } from '../../types/place-presets'
import { nativeSelectClass } from '../ui/input'
import { PageButton } from '../results/ResultsPanel'

const COLUMNS = [
  { field: 'kind', label: 'Kind', numeric: false },
  { field: 'name', label: 'Name', numeric: false },
  { field: 'category', label: 'Category', numeric: false },
  { field: 'address', label: 'Address', numeric: false },
  { field: 'extra', label: 'Detail', numeric: false },
  { field: 'lat', label: 'Lat', numeric: true },
  { field: 'lng', label: 'Lng', numeric: true },
] as const

type ColumnField = (typeof COLUMNS)[number]['field']

const compactSelectClass = 'h-6 rounded border border-white/[0.08] bg-black/30 px-1.5 pr-6 text-[10px] font-normal'

export function HexQueryTable() {
  const inspectOpen = useExplorer((state) => state.inspectOpen)
  const places = useThemeQuery('places', inspectOpen)
  const buildings = useThemeQuery('buildings', inspectOpen)
  const addresses = useThemeQuery('addresses', inspectOpen)
  const page = useExplorer((state) => state.page)
  const setPage = useExplorer((state) => state.setPage)
  const limit = useExplorer((state) => state.limit)
  const focusCell = useExplorer((state) => state.focusCell)
  const focusH3 = useExplorer((state) => state.focus?.h3 ?? null)
  const [kind, setKind] = useState<DatasetId | 'all'>('all')
  const [search, setSearch] = useState('')
  const [sortField, setSortField] = useState<ColumnField>('name')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')

  const merged = useMemo(
    () =>
      mergeFeatureRows(
        places.results.data?.rows ?? [],
        buildings.results.data?.rows ?? [],
        addresses.results.data?.rows ?? [],
      ),
    [places.results.data, buildings.results.data, addresses.results.data],
  )
  const filtered = useMemo(() => filterFeatureRows(merged, kind, search), [merged, kind, search])
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

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2" data-testid="hex-query-table">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        <select
          aria-label="Feature kind"
          className={cn(nativeSelectClass, compactSelectClass, 'w-32')}
          value={kind}
          onChange={(event) => {
            setKind(event.target.value as DatasetId | 'all')
            setPage(0)
          }}
        >
          <option value="all">All kinds</option>
          {DATASET_IDS.map((id) => (
            <option key={id} value={id}>
              {DATASET_META[id].title}
            </option>
          ))}
        </select>
        <input
          value={search}
          onChange={(event) => {
            setSearch(event.target.value)
            setPage(0)
          }}
          placeholder="Search name or address"
          className="h-6 min-w-36 flex-1 rounded border border-white/[0.08] bg-black/30 px-2 text-[11px] text-foreground placeholder:text-muted-foreground/70 focus-visible:border-primary/50 focus-visible:outline-none"
        />
        <span className="text-[11px] tabular-nums text-muted-foreground">{formatCount(filtered.length)} features</span>
        {fetching && <LoaderCircle className="size-3 animate-spin text-muted-foreground" />}
      </div>
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
                    {column.field === 'name' && <NameFilter />}
                    {column.field === 'category' && <CategoryFilter />}
                    {column.field === 'address' && <AddressFilter />}
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
                <td className="px-2 py-1.5 capitalize">{row.kind === 'places' ? 'place' : row.kind === 'buildings' ? 'building' : 'address'}</td>
                <td className="max-w-44 truncate px-2 py-1.5">{row.name || '—'}</td>
                <td className="max-w-36 truncate px-2 py-1.5">{formatValue('basic_category', row.category || null)}</td>
                <td className="max-w-52 truncate px-2 py-1.5">{row.address || '—'}</td>
                <td className="max-w-36 truncate px-2 py-1.5">{row.extra || '—'}</td>
                <td className="px-2 py-1.5 text-right font-mono tabular-nums">{row.lat.toFixed(5)}</td>
                <td className="px-2 py-1.5 text-right font-mono tabular-nums">{row.lng.toFixed(5)}</td>
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

function NameFilter() {
  const value = useExplorer((state) => state.filtersByDataset.places.name)
  const patchPlaces = useExplorer((state) => state.patchPlaces)
  return (
    <input
      className="mt-1 h-6 w-full min-w-20 rounded border border-white/[0.08] bg-black/30 px-1.5 text-[10px] font-normal text-foreground placeholder:text-muted-foreground/70 focus-visible:border-primary/50 focus-visible:outline-none"
      value={value}
      placeholder="contains"
      onChange={(event) => patchPlaces({ name: event.target.value })}
    />
  )
}

function CategoryFilter() {
  const categories = useExplorer((state) => state.filtersByDataset.places.basicCategories)
  const patchPlaces = useExplorer((state) => state.patchPlaces)
  const subtypes = useExplorer((state) => state.filtersByDataset.buildings.subtypes)
  const patchBuildings = useExplorer((state) => state.patchBuildings)
  return (
    <div className="mt-1 grid gap-1">
      <select
        aria-label="Place category"
        className={cn(nativeSelectClass, compactSelectClass, 'w-full min-w-24')}
        value={categories[0] ?? ''}
        onChange={(event) => patchPlaces({ basicCategories: event.target.value ? [event.target.value] : [] })}
      >
        <option value="">Any place category</option>
        {BASIC_CATEGORIES.map((category) => (
          <option key={category} value={category}>
            {category.replaceAll('_', ' ')}
          </option>
        ))}
      </select>
      <select
        aria-label="Building subtype"
        className={cn(nativeSelectClass, compactSelectClass, 'w-full min-w-24')}
        value={subtypes[0] ?? ''}
        onChange={(event) => patchBuildings({ subtypes: event.target.value ? [event.target.value] : [] })}
      >
        <option value="">Any building subtype</option>
        {BUILDING_SUBTYPES.map((subtype) => (
          <option key={subtype} value={subtype}>
            {subtype}
          </option>
        ))}
      </select>
    </div>
  )
}

function AddressFilter() {
  const value = useExplorer((state) => state.filtersByDataset.addresses.address)
  const patchAddresses = useExplorer((state) => state.patchAddresses)
  return (
    <input
      className="mt-1 h-6 w-full min-w-20 rounded border border-white/[0.08] bg-black/30 px-1.5 text-[10px] font-normal text-foreground placeholder:text-muted-foreground/70 focus-visible:border-primary/50 focus-visible:outline-none"
      value={value}
      placeholder="contains"
      onChange={(event) => patchAddresses({ address: event.target.value })}
    />
  )
}

function compareFeature(left: FeatureRow, right: FeatureRow, field: ColumnField, direction: 'asc' | 'desc') {
  const a = left[field]
  const b = right[field]
  const base =
    typeof a === 'number' && typeof b === 'number'
      ? a - b
      : String(a).localeCompare(String(b), undefined, { sensitivity: 'base', numeric: true })
  return direction === 'asc' ? base : -base
}
