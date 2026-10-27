export function formatValue(field: string, value: string | number | null): string {
  if (value == null || value === '') return '—'
  if (field === 'confidence' && typeof value === 'number') return value.toFixed(3)
  if (field === 'height' && typeof value === 'number') return value.toFixed(1)
  if (field === 'operating_status') {
    if (value === 'open') return 'Open'
    if (value === 'permanently_closed') return 'Permanently closed'
  }
  if (typeof value === 'string') return value.replaceAll('_', ' ')
  return String(value)
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat('en-US').format(value)
}
