import { compareOvertureRelease } from './overture-release'

export function recordsForRelease<T extends { release_version: string }>(
  records: readonly T[],
  release?: string,
): T[] {
  if (release) return records.filter((row) => row.release_version === release)
  let newest = ''
  for (const row of records) {
    if (!newest || compareOvertureRelease(row.release_version, newest) > 0) {
      newest = row.release_version
    }
  }
  return newest ? records.filter((row) => row.release_version === newest) : []
}
