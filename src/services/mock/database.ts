import { latLngToCell } from 'h3-js'
import { AUSTIN_CENTER, cellCenter, mockCoverageCells } from '../../lib/h3'
import { H3_RESOLUTION } from '../../lib/limits'
import { BUILDING_SUBTYPES, type BuildingSubtype, type DatasetId } from '../../types/datasets'
import { PLACE_PRESETS } from '../../types/place-presets'
import type { AddressRecord, BuildingRecord, PlaceRecord } from './records'

export type MockDatabase = {
  cells: string[]
  places: Map<string, PlaceRecord[]>
  buildings: Map<string, BuildingRecord[]>
  addresses: Map<string, AddressRecord[]>
  totals: Record<DatasetId, number>
}

const NAME_STEMS = [
  'Lantern',
  'Shoal',
  'Mesa',
  'Cedar',
  'Violet',
  'Copper',
  'Hollow',
  'Marigold',
  'Pecan',
  'Switchgrass',
  'Northloop',
  'Cinder',
  'Lowwater',
  'Redbird',
  'Tinroof',
  'Arroyo',
  'Kinney',
  'Oakmill',
  'Saddle',
  'Glassell',
] as const

const STREETS = [
  'Congress Ave',
  'Guadalupe St',
  'Lamar Blvd',
  'South Congress Ave',
  'E 6th St',
  'Barton Springs Rd',
  'Manor Rd',
  'Burnet Rd',
  'Airport Blvd',
  'Cesar Chavez St',
  'Enfield Rd',
  'Duval St',
  'Exposition Blvd',
  'S 1st St',
  'E Riverside Dr',
  'Martin Luther King Jr Blvd',
  'W 38th St',
  'Springdale Rd',
  'Oltorf St',
  'Anderson Ln',
] as const

const SUBTYPE_WEIGHTS: { value: BuildingSubtype; weight: number }[] = [
  { value: 'residential', weight: 48 },
  { value: 'commercial', weight: 22 },
  { value: 'outbuilding', weight: 8 },
  { value: 'education', weight: 4 },
  { value: 'industrial', weight: 4 },
  { value: 'civic', weight: 3 },
  { value: 'religious', weight: 3 },
  { value: 'service', weight: 2 },
  { value: 'entertainment', weight: 2 },
  { value: 'medical', weight: 2 },
  { value: 'transportation', weight: 1 },
  { value: 'agricultural', weight: 0.7 },
  { value: 'military', weight: 0.3 },
]

export function buildMockDatabase(): MockDatabase {
  const cells = mockCoverageCells()
  if (cells.length === 0) throw new Error('H3 coverage polygon produced no cells.')
  if (cells.length > 2500) {
    throw new Error(`Mock coverage produced ${cells.length} H3 cells, which is too many to generate in the browser.`)
  }
  for (const item of SUBTYPE_WEIGHTS) {
    if (!(BUILDING_SUBTYPES as readonly string[]).includes(item.value)) {
      throw new Error(`Unknown building subtype: ${item.value}`)
    }
  }

  const places = new Map<string, PlaceRecord[]>()
  const buildings = new Map<string, BuildingRecord[]>()
  const addresses = new Map<string, AddressRecord[]>()
  const totals: Record<DatasetId, number> = { places: 0, buildings: 0, addresses: 0 }

  for (const cell of cells) addCell(places, buildings, addresses, totals, cell)

  return { cells, places, buildings, addresses, totals }
}

/** Generate mock rows for hexes that are not in the Austin seed coverage. */
export function ingestMockCells(db: MockDatabase, cells: readonly string[]): { rows: number; added: string[] } {
  const added: string[] = []
  let rows = 0
  for (const cell of cells) {
    const already = db.places.has(cell) && db.buildings.has(cell) && db.addresses.has(cell)
    if (!already) {
      addCell(db.places, db.buildings, db.addresses, db.totals, cell)
      if (!db.cells.includes(cell)) db.cells.push(cell)
      added.push(cell)
    }
    rows +=
      (db.places.get(cell)?.length ?? 0) +
      (db.buildings.get(cell)?.length ?? 0) +
      (db.addresses.get(cell)?.length ?? 0)
  }
  return { rows, added }
}

function addCell(
  places: Map<string, PlaceRecord[]>,
  buildings: Map<string, BuildingRecord[]>,
  addresses: Map<string, AddressRecord[]>,
  totals: Record<DatasetId, number>,
  cell: string,
) {
  const center = cellCenter(cell)
  if (latLngToCell(center.lat, center.lng, H3_RESOLUTION) !== cell) {
    throw new Error(`Cell center fell outside ${cell}.`)
  }
  const boost = downtownBoost(center.lat, center.lng)
  const placeRows = buildPlaces(cell, center, boost)
  const buildingRows = buildBuildings(cell, center, boost)
  const addressRows = buildAddresses(cell, center, boost)
  places.set(cell, placeRows)
  buildings.set(cell, buildingRows)
  addresses.set(cell, addressRows)
  totals.places += placeRows.length
  totals.buildings += buildingRows.length
  totals.addresses += addressRows.length
}

function buildPlaces(
  cell: string,
  center: { lat: number; lng: number },
  boost: number,
): PlaceRecord[] {
  const rng = mulberry32(hashString(`${cell}:places`))
  const count = Math.max(1, Math.round((2 + rng() * 10) * boost))
  const rows: PlaceRecord[] = []
  for (let index = 0; index < count; index += 1) {
    const identity = placeIdentity(rng)
    const stem = NAME_STEMS[Math.floor(rng() * NAME_STEMS.length)]
    const roll = rng()
    let confidence: number | null
    let operating_status: PlaceRecord['operating_status']
    if (roll < 0.06) {
      operating_status = 'permanently_closed'
      confidence = 0
    } else if (roll < 0.16) {
      operating_status = 'open'
      confidence = null
    } else {
      operating_status = 'open'
      confidence = Math.round((0.45 + rng() * 0.54) * 1000) / 1000
    }
    rows.push({
      id: `place_${cell}_${index}`,
      h3: cell,
      lat: center.lat,
      lng: center.lng,
      names: { primary: `${stem} ${identity.form}` },
      basic_category: identity.basic_category,
      taxonomy: {
        primary: identity.primary,
        hierarchy: identity.hierarchy,
        alternates: null,
      },
      confidence,
      operating_status,
    })
  }
  return rows
}

function placeIdentity(rng: () => number): {
  basic_category: string
  primary: string
  hierarchy: string[]
  form: string
} {
  const preset = pickWeighted(rng, PLACE_PRESETS, PLACE_PRESETS.map((preset) => preset.weight))
  if (preset.basic_category === 'park') {
    const playground = rng() < 0.55
    return {
      basic_category: 'park',
      primary: playground ? 'playground' : 'park',
      hierarchy: playground ? ['park', 'playground'] : ['park'],
      form: playground ? 'Playground' : 'Park',
    }
  }
  return {
    basic_category: preset.basic_category,
    primary: preset.primary,
    hierarchy: [...preset.hierarchy],
    form: preset.nameForms[Math.floor(rng() * preset.nameForms.length)],
  }
}

function buildBuildings(
  cell: string,
  center: { lat: number; lng: number },
  boost: number,
): BuildingRecord[] {
  const rng = mulberry32(hashString(`${cell}:buildings`))
  const count = Math.max(2, Math.round((8 + rng() * 20) * boost))
  const rows: BuildingRecord[] = []
  for (let index = 0; index < count; index += 1) {
    const subtype = rng() < 0.22 ? null : pickWeighted(rng, SUBTYPE_WEIGHTS, SUBTYPE_WEIGHTS.map((item) => item.weight)).value
    const height = buildingHeight(rng, subtype, boost > 1.05)
    let num_floors: number | null = null
    if (rng() > 0.48) {
      num_floors =
        height == null
          ? 1 + Math.floor(rng() * (subtype === 'commercial' ? 12 : 4))
          : Math.max(1, Math.round(height / (3 + rng() * 0.6)))
    }
    rows.push({
      id: `building_${cell}_${index}`,
      h3: cell,
      lat: center.lat,
      lng: center.lng,
      subtype,
      height,
      num_floors,
    })
  }
  return rows
}

function buildingHeight(rng: () => number, subtype: BuildingSubtype | null, central: boolean): number | null {
  if (rng() < 0.38) return null
  let height: number
  if (subtype === 'commercial' && central && rng() < 0.35) height = 30 + rng() * 140
  else if (subtype === 'residential') height = 4 + rng() * 14
  else if (subtype === 'commercial') height = 6 + rng() * 28
  else height = 3.5 + rng() * 16
  return Math.round(height * 10) / 10
}

function buildAddresses(
  cell: string,
  center: { lat: number; lng: number },
  boost: number,
): AddressRecord[] {
  const rng = mulberry32(hashString(`${cell}:addresses`))
  const count = Math.max(1, Math.round((5 + rng() * 12) * boost))
  const locality = localityFor(center.lat, center.lng)
  const postcode = postcodeFor(center.lat, center.lng)
  const rows: AddressRecord[] = []
  for (let index = 0; index < count; index += 1) {
    const number = String(100 + Math.floor(rng() * 9800))
    const street = STREETS[Math.floor(rng() * STREETS.length)]
    rows.push({
      id: `address_${cell}_${index}`,
      h3: cell,
      lat: center.lat,
      lng: center.lng,
      country: 'US',
      number,
      street,
      postcode,
      address_levels: [{ value: 'TX' }, { value: locality }],
    })
  }
  return rows
}

function localityFor(lat: number, lng: number): string {
  if (lng < -97.84 && lat > 30.27 && lat < 30.32) return 'West Lake Hills'
  if (lat < 30.23 && lng < -97.8 && lng > -97.86) return 'Sunset Valley'
  return 'Austin'
}

function postcodeFor(lat: number, lng: number): string {
  if (lat > 30.35 && lng < -97.75) return '78731'
  if (lat > 30.35) return '78757'
  if (lat > 30.3 && lng < -97.76) return '78703'
  if (lat > 30.29 && lng > -97.72) return '78722'
  if (lat > 30.27 && lng > -97.75 && lng < -97.73) return '78705'
  if (lat < 30.22) return '78745'
  if (lat < 30.25 && lng < -97.75) return '78704'
  if (lng > -97.72) return '78702'
  if (lng < -97.76) return '78703'
  return '78701'
}

function downtownBoost(lat: number, lng: number): number {
  const km = distanceKm(lat, lng, AUSTIN_CENTER.lat, AUSTIN_CENTER.lng)
  return Math.max(0.35, 1.3 - km / 12)
}

function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = (lat1 - lat2) * 110.574
  const dLng = (lng1 - lng2) * 111.32 * Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180)
  return Math.hypot(dLat, dLng)
}

function pickWeighted<T>(rng: () => number, items: readonly T[], weights: readonly number[]): T {
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  let target = rng() * total
  for (let index = 0; index < items.length; index += 1) {
    target -= weights[index]
    if (target <= 0) return items[index]
  }
  return items[items.length - 1]
}

function hashString(input: string): number {
  let hash = 2166136261
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function mulberry32(seed: number): () => number {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
