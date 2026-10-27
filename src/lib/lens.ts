/** Caps feature-state writes per frame when zoomed out and cells are small on screen. */
export const LENS_MAX_RINGS = 9

export type LensInput = 'pointer' | 'touch'

/** 1 at the lens anchor, easing smoothly to 0 at the lens edge. */
export function lensFalloff(distancePx: number, radiusPx: number): number {
  if (!(radiusPx > 0)) return 0
  const t = distancePx / radiusPx
  if (t >= 1) return 0
  const inner = 1 - t * t
  return inner * inner
}

/** Lens radius in screen pixels, scaled to the distance between neighboring cell centers. */
export function lensRadius(spacingPx: number, input: LensInput): number {
  const [min, max, factor] = input === 'touch' ? [120, 240, 2.4] : [150, 320, 3]
  return Math.min(max, Math.max(min, spacingPx * factor))
}

/** H3 grid rings needed so the disk around the anchor cell covers the lens radius. */
export function lensRings(radiusPx: number, spacingPx: number): number {
  if (!(spacingPx > 0)) return 1
  return Math.min(LENS_MAX_RINGS, Math.max(1, Math.ceil(radiusPx / spacingPx) + 1))
}
