import type { ResultColumn } from '../types/datasets'
import type { ResultRow } from '../types/queries'

export function rowsToCsv(columns: readonly ResultColumn[], rows: readonly ResultRow[]): string {
  const header = columns.map((column) => csvEscape(column.label)).join(',')
  const lines = rows.map((row) =>
    columns
      .map((column) => {
        const value = column.source === 'h3' ? row.h3 : row.values[column.field]
        return csvEscape(value == null ? '' : String(value))
      })
      .join(','),
  )
  return `\uFEFF${[header, ...lines].join('\r\n')}`
}

function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`
  return value
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
