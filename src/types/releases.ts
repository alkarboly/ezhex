export type ReleaseSnapshot = {
  release_version: string
  accessed_on: string
  source_uri: string
  themes: string[]
  hex_count: number
  place_count: number
  building_count: number
  address_count: number
  source_datasets: string[]
  ingested_at: string
  current: boolean
}

export type ReleaseCatalog = {
  current_release_version: string
  snapshots: ReleaseSnapshot[]
}

export type HexReleaseSnapshot = {
  release_version: string
  h3_res8: string
  place_count: number
  building_count: number
  address_count: number
  source_datasets: string[]
  ingested_at: string
}
