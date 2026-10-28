import { compareOvertureRelease, snapshotDate } from './overture-release'
import type { HexSnapshotCheck, HexSnapshotCheckCell, HexReleaseSnapshot } from '../types/releases'

export function buildHexSnapshotCheck(
  cells: readonly string[],
  stored: readonly HexReleaseSnapshot[],
  currentRelease: string,
): HexSnapshotCheck {
  const byHex = new Map<string, string[]>()
  for (const row of stored) {
    const list = byHex.get(row.h3_res8) ?? []
    if (!list.includes(row.release_version)) list.push(row.release_version)
    byHex.set(row.h3_res8, list)
  }
  const checked = cells.map((h3) => cellCheck(h3, byHex.get(h3) ?? [], currentRelease))
  return {
    current_release_version: currentRelease,
    cells: checked,
    processed_count: checked.filter((cell) => cell.processed).length,
    missing_count: checked.filter((cell) => !cell.processed).length,
    stale_count: checked.filter((cell) => cell.processed && !cell.has_current).length,
    current_count: checked.filter((cell) => cell.has_current).length,
  }
}

export function earliestSnapshotDate(cells: readonly HexSnapshotCheckCell[]): string | null {
  let earliest: string | null = null
  for (const cell of cells) {
    const day = snapshotDate(cell.first_release_version)
    if (!day) continue
    if (!earliest || day < earliest) earliest = day
  }
  return earliest
}

/** Historical pin is allowed only for releases stored after first process. */
export function historicalPinError(check: HexSnapshotCheck, release: string): string | null {
  for (const cell of check.cells) {
    if (!cell.processed) {
      return `Process ${cell.h3} first. History starts when a hex is processed.`
    }
    if (!cell.releases.includes(release)) {
      return `${cell.h3} has no snapshot ${release}. History starts at ${cell.first_release_version}.`
    }
  }
  return null
}

export function unprocessedHexError(check: HexSnapshotCheck): string | null {
  const missing = check.cells.find((cell) => !cell.processed)
  if (!missing) return null
  return `Process ${missing.h3} first. Snapshots are saved from first process, and only on a workflow run.`
}

function cellCheck(h3: string, releases: readonly string[], currentRelease: string): HexSnapshotCheckCell {
  const ordered = [...releases].sort(compareOvertureRelease)
  const first = ordered[0] ?? null
  const latest = ordered[ordered.length - 1] ?? null
  return {
    h3,
    processed: ordered.length > 0,
    first_release_version: first,
    latest_release_version: latest,
    has_current: latest != null && compareOvertureRelease(latest, currentRelease) >= 0,
    releases: ordered,
  }
}
