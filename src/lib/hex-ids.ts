import { cellToChildren, cellToParent, getResolution, isValidCell } from 'h3-js'
import { H3_RESOLUTION, MAX_SELECTED_CELLS } from './limits'

/** H3 indexes are 15 hex digits. Accept an optional 0x prefix. */
const HEX_INDEX = /\b(?:0x)?([0-9a-f]{15})\b/gi

/** Pull valid resolution-8 cells from free text. Finer cells become their parent; coarser cells expand when they stay under the cap. */
export function extractHexCells(text: string, cap = MAX_SELECTED_CELLS): string[] {
  const found: string[] = []
  const seen = new Set<string>()
  HEX_INDEX.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = HEX_INDEX.exec(text)) && found.length < cap) {
    for (const cell of normalizeHexCell(match[1])) {
      if (seen.has(cell)) continue
      seen.add(cell)
      found.push(cell)
      if (found.length >= cap) break
    }
  }
  return found
}

export function normalizeHexCell(raw: string): string[] {
  const cell = raw.trim().toLowerCase()
  if (!isValidCell(cell)) return []
  const resolution = getResolution(cell)
  if (resolution === H3_RESOLUTION) return [cell]
  if (resolution > H3_RESOLUTION) {
    try {
      const parent = cellToParent(cell, H3_RESOLUTION)
      return isValidCell(parent) ? [parent] : []
    } catch {
      return []
    }
  }
  try {
    const children = cellToChildren(cell, H3_RESOLUTION)
    return children.length > 0 && children.length <= MAX_SELECTED_CELLS ? children : []
  } catch {
    return []
  }
}
