/**
 * Hex grid motion.
 *
 * Initial lay uses a radial stagger (delay by distance from the view
 * center, not list order) so the grid reads as a honeycomb wave. That
 * is the same pattern as a staggered-grid ripple: neighbors of one cell
 * stay 30–80 ms apart, and the far edge lands under about 1.2 s.
 *
 * Zoom swaps replace one resolution with another. Raster maps hide that
 * pop by keeping the previous tiles until the next ones are in. The
 * outgoing source does that for hexes: last grid fades out while the
 * next grid appears.
 */

export type AppearKind = 'lay' | 'swap' | 'pan' | 'none'

export function appearKind(previous: ReadonlySet<string>, next: readonly string[]): AppearKind {
  if (next.length === 0) return previous.size === 0 ? 'none' : 'swap'
  if (previous.size === 0) return 'lay'
  let overlap = 0
  for (const id of next) {
    if (previous.has(id)) overlap += 1
  }
  return overlap / Math.max(previous.size, next.length) < 0.18 ? 'swap' : 'pan'
}

export function appearEase(progress: number): number {
  const t = Math.min(1, Math.max(0, progress))
  return 1 - (1 - t) ** 3
}

export function appearDurationMs(kind: Exclude<AppearKind, 'none'>): number {
  if (kind === 'lay') return 560
  if (kind === 'swap') return 280
  return 160
}

/** Delay grows with hex rings from the view center. Caps keep the wave short. */
export function appearDelayMs(distancePx: number, spacingPx: number, kind: Exclude<AppearKind, 'none'>): number {
  const ring = spacingPx > 0 ? distancePx / spacingPx : 0
  if (kind === 'lay') return Math.min(720, ring * 70)
  if (kind === 'swap') return Math.min(220, ring * 36)
  return Math.min(90, ring * 18)
}

export function outgoingDurationMs(): number {
  return 300
}

/** Fade the last grid when the set is replaced, or when enough cells leave at once. */
export function shouldFadeOutgoing(kind: AppearKind, removedCount: number): boolean {
  return kind === 'swap' || removedCount >= 8
}
