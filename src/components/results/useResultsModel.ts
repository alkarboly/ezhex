import type { UseQueryResult } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { downloadCsv, rowsToCsv } from '../../lib/csv'
import { formatCount } from '../../lib/format'
import { MAX_QUERY_LIMIT } from '../../lib/limits'
import type { CompiledQuery } from '../../lib/query-builder'
import { getDataProvider } from '../../services'
import { useExplorer } from '../../store/explorer-store'
import { resultColumns } from '../../types/datasets'
import type { QueryResult } from '../../types/queries'

export function useResultsModel(compiled: CompiledQuery, query: UseQueryResult<QueryResult, Error>) {
  const setNotice = useExplorer((state) => state.setNotice)
  const [exporting, setExporting] = useState(false)
  const dataset = compiled.spec.dataset
  const columns = useMemo(() => resultColumns(dataset), [dataset])
  const valid = compiled.errors.length === 0
  const hasSelection = compiled.spec.h3_cells.length > 0
  const result = hasSelection && valid ? query.data : undefined
  const page = compiled.spec.limit === 0 ? 0 : compiled.spec.offset / compiled.spec.limit
  const pages = Math.max(1, Math.ceil((result?.total ?? 0) / compiled.spec.limit))
  const ranked = useMemo(
    () => [...(result?.byCell ?? [])].sort((a, b) => b.count - a.count || a.h3.localeCompare(b.h3)),
    [result],
  )
  const matchedCells = ranked.filter((cell) => cell.count > 0).length
  const hasNext = result != null && compiled.spec.offset + result.rows.length < result.total

  const exportCsv = async () => {
    setExporting(true)
    try {
      const exported = await getDataProvider().runQuery({ ...compiled.spec, offset: 0, limit: MAX_QUERY_LIMIT })
      downloadCsv(`worldpulse-${dataset}.csv`, rowsToCsv(columns, exported.rows))
      if (exported.total > exported.rows.length) {
        setNotice(`Exported ${formatCount(exported.rows.length)} of ${formatCount(exported.total)} matching rows.`)
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Export failed.')
    } finally {
      setExporting(false)
    }
  }

  return {
    dataset,
    columns,
    valid,
    hasSelection,
    result,
    page,
    pages,
    ranked,
    matchedCells,
    hasNext,
    exporting,
    canExport: result != null && result.total > 0 && !exporting && valid,
    loading: hasSelection && valid && query.isLoading,
    fetching: hasSelection && valid && query.isFetching,
    error: valid ? query.error : null,
    exportCsv,
  }
}

export type ResultsModel = ReturnType<typeof useResultsModel>
