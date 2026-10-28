export const DEFAULT_OVERTURE_RELEASE = '2026-10-21.0'

export const OVERTURE_RELEASE_RE = /^[A-Za-z0-9._-]{3,64}$/

export function assertOvertureRelease(release: string): string {
  const value = release.trim()
  if (!OVERTURE_RELEASE_RE.test(value)) throw new Error('release_version is not a valid Overture release id.')
  return value
}

/** Overture ids are `YYYY-MM-DD.N`, so lexical order matches recency. */
export function compareOvertureRelease(left: string, right: string): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}
