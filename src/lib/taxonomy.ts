/** Overture taxonomy labels arrive as `primary_category < category`. */
export function parseTaxonomyLabel(value: string | null | undefined): {
  main: string | null
  category: string | null
  raw: string | null
} {
  const raw = value?.trim() || null
  if (!raw) return { main: null, category: null, raw: null }
  const cut = raw.indexOf('<')
  if (cut === -1) return { main: raw, category: null, raw }
  const main = raw.slice(0, cut).trim()
  const category = raw.slice(cut + 1).trim()
  return { main: main || null, category: category || null, raw }
}
