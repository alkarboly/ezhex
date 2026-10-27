import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { mergeFeatureRows } from '../lib/feature-rows'
import { MAX_QUERY_LIMIT } from '../lib/limits'
import { buildQuerySpec, type CompiledQuery } from '../lib/query-builder'
import { getDataProvider } from '../services'
import { useExplorer } from '../store/explorer-store'
import { defaultSort, type DatasetId } from '../types/datasets'
import { defaultAddressesForm, defaultBuildingsForm, defaultPlacesForm } from '../types/queries'

export function useCompiledQuery(): CompiledQuery {
  const dataset = useExplorer((state) => state.dataset)
  const selectedCells = useExplorer((state) => state.selectedCells)
  const places = useExplorer((state) => state.filtersByDataset.places)
  const buildings = useExplorer((state) => state.filtersByDataset.buildings)
  const addresses = useExplorer((state) => state.filtersByDataset.addresses)
  const sortField = useExplorer((state) => state.sortField)
  const sortDirection = useExplorer((state) => state.sortDirection)
  const limit = useExplorer((state) => state.limit)
  const page = useExplorer((state) => state.page)
  const resultsSearch = useExplorer((state) => state.resultsSearch)

  return useMemo(
    () =>
      buildQuerySpec({
        dataset,
        selectedCells,
        places,
        buildings,
        addresses,
        sortField,
        sortDirection,
        limit,
        page,
        resultsSearch,
      }),
    [
      dataset,
      selectedCells,
      places,
      buildings,
      addresses,
      sortField,
      sortDirection,
      limit,
      page,
      resultsSearch,
    ],
  )
}

export function useCellStats(cells: readonly string[], compiled: CompiledQuery) {
  const filtersKey = JSON.stringify(compiled.spec.filters)
  const cellsKey = cells.join(',')
  const dataset = compiled.spec.dataset
  return useQuery({
    queryKey: ['cell-counts', dataset, filtersKey, cellsKey],
    enabled: compiled.errors.length === 0 && cells.length > 0,
    // Keep the last counts while panning, but never paint one dataset's counts under another.
    placeholderData: (previous, previousQuery) => (previousQuery?.queryKey[1] === dataset ? previous : undefined),
    queryFn: () =>
      getDataProvider().getCellCounts({
        dataset: compiled.spec.dataset,
        h3_cells: [...cells],
        filters: compiled.spec.filters,
      }),
  })
}

export function useQueryResults(compiled: CompiledQuery) {
  const spec = compiled.spec
  return useQuery({
    queryKey: ['dataset-query', spec],
    enabled: compiled.errors.length === 0 && spec.h3_cells.length > 0,
    placeholderData: (previous, previousQuery) => {
      const key = previousQuery?.queryKey[1]
      return typeof key === 'object' && key.dataset === spec.dataset ? previous : undefined
    },
    queryFn: () => getDataProvider().runQuery(spec),
  })
}

export function useInspectFeatures(enabled: boolean) {
  const places = useThemeQuery('places', enabled)
  const buildings = useThemeQuery('buildings', enabled)
  const addresses = useThemeQuery('addresses', enabled)
  const rows = useMemo(
    () =>
      mergeFeatureRows(
        places.results.data?.rows ?? [],
        buildings.results.data?.rows ?? [],
        addresses.results.data?.rows ?? [],
      ),
    [places.results.data, buildings.results.data, addresses.results.data],
  )
  return { rows, places, buildings, addresses }
}

export function useThemeQuery(dataset: DatasetId, enabled: boolean) {
  const selectedCells = useExplorer((state) => state.selectedCells)
  const compiled = useMemo(
    () =>
      buildQuerySpec({
        dataset,
        selectedCells,
        places: defaultPlacesForm,
        buildings: defaultBuildingsForm,
        addresses: defaultAddressesForm,
        sortField: defaultSort(dataset).field,
        sortDirection: defaultSort(dataset).direction,
        limit: MAX_QUERY_LIMIT,
        page: 0,
        resultsSearch: '',
      }),
    [dataset, selectedCells],
  )
  const results = useQuery({
    queryKey: ['hex-features', compiled.spec],
    enabled: enabled && compiled.errors.length === 0 && compiled.spec.h3_cells.length > 0,
    queryFn: () => getDataProvider().runQuery(compiled.spec),
  })
  return { compiled, results }
}
