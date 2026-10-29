import { gridDisk } from 'h3-js'

/** Split hexes into connected groups of at most `max`, so every group is one valid ingest job. */
export function connectedHexBatches(cells: readonly string[], max: number): string[][] {
  const size = Math.max(1, Math.floor(max))
  const order = [...new Set(cells.map((cell) => cell.trim()).filter((cell) => cell.length > 0))]
  const remaining = new Set(order)
  const batches: string[][] = []
  for (const seed of order) {
    if (!remaining.has(seed)) continue
    remaining.delete(seed)
    const batch: string[] = []
    const queue = [seed]
    while (queue.length > 0) {
      const cell = queue.shift() as string
      batch.push(cell)
      for (const next of neighbors(cell)) {
        if (batch.length + queue.length >= size) break
        if (!remaining.has(next)) continue
        remaining.delete(next)
        queue.push(next)
      }
    }
    batches.push(batch)
  }
  return batches
}

/** Same groups, sized evenly: 10 hexes become 5 + 5 instead of 9 + 1. */
export function balancedHexBatches(cells: readonly string[], max: number): string[][] {
  const unique = [...new Set(cells)]
  if (unique.length === 0) return []
  const count = Math.ceil(unique.length / Math.max(1, max))
  return connectedHexBatches(unique, Math.ceil(unique.length / count))
}

function neighbors(cell: string): string[] {
  try {
    return gridDisk(cell, 1)
  } catch {
    return []
  }
}
