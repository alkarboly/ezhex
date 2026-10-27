/**
 * Hex grid motion.
 *
 * Opening drop lives in hex-drop: hexes fall onto the sphere, north
 * first. City zoom stays quiet. Zoom swaps keep the last grid on an
 * outgoing source so resolution changes dissolve instead of popping.
 */

import { getResolution } from 'h3-js'

export type AppearKind = 'intro' | 'lay' | 'swap' | 'pan' | 'none'

export function appearKind(previous: ReadonlySet<string>, next: readonly string[]): AppearKind {
  if (next.length === 0) return previous.size === 0 ? 'none' : 'swap'
  if (isEarthGrid(next) && !isEarthGrid([...previous])) return 'intro'
  if (previous.size === 0) return isEarthGrid(next) ? 'intro' : 'lay'
  let overlap = 0
  for (const id of next) {
    if (previous.has(id)) overlap += 1
  }
  return overlap / Math.max(previous.size, next.length) < 0.18 ? 'swap' : 'pan'
}

function cellResolution(id: string): number | null {
  try {
    return getResolution(id)
  } catch {
    return null
  }
}

/** City-scale grids stay still. The show is the globe. */
export function appearIsQuiet(ids: readonly string[]): boolean {
  const resolution = ids.length > 0 ? cellResolution(ids[0]) : null
  return resolution !== null && resolution >= 7
}

export function isEarthGrid(ids: readonly string[]): boolean {
  return ids.length > 0 && cellResolution(ids[0]) === 1
}

export function appearEase(progress: number): number {
  const t = Math.min(1, Math.max(0, progress))
  return 1 - (1 - t) ** 3
}

export function appearDurationMs(kind: Exclude<AppearKind, 'none'>): number {
  if (kind === 'intro') return 780
  if (kind === 'lay') return 560
  if (kind === 'swap') return 280
  return 160
}

export function appearDelayMs(distancePx: number, spacingPx: number, kind: Exclude<AppearKind, 'none'>): number {
  const ring = spacingPx > 0 ? distancePx / spacingPx : 0
  if (kind === 'lay') return Math.min(720, ring * 70)
  if (kind === 'swap') return Math.min(220, ring * 36)
  return Math.min(90, ring * 18)
}

/** North (90) starts first. South (-90) lands last. */
export function introDelayMs(lat: number): number {
  return Math.min(1800, Math.max(0, ((90 - lat) / 180) * 1800))
}

export function outgoingDurationMs(): number {
  return 300
}

export function shouldFadeOutgoing(kind: AppearKind, removedCount: number): boolean {
  return kind === 'swap' || kind === 'intro' || removedCount >= 8
}
