import { metersBetween, pointInGeometry, type GeoJsonGeometry } from './geojson'

export const ASSOCIATE_NEAR_M = 40

export type PlaceAddressLabel = {
  freeform?: string
  number?: string
  street?: string
  postcode?: string
  locality?: string
  region?: string
  country?: string
}

export type AssociatePlace = {
  id: string
  lat: number
  lng: number
  geometry?: GeoJsonGeometry | null
  place_addresses?: PlaceAddressLabel[] | null
  country?: string
}

export type AssociateBuilding = {
  id: string
  lat: number
  lng: number
  geometry?: GeoJsonGeometry | null
}

export type AssociateAddress = {
  id: string
  lat: number
  lng: number
  number: string
  street: string
  postcode: string
  country?: string
}

export type FeatureLinks = {
  building_id: string | null
  address_id: string | null
}

export type AssociateResult = {
  places: Map<string, FeatureLinks>
  buildings: Map<string, { address_id: string | null }>
  addresses: Map<string, { building_id: string | null }>
  place_building_matches: number
  place_address_matches: number
  building_address_matches: number
}

export function associateFeatures(input: {
  places: readonly AssociatePlace[]
  buildings: readonly AssociateBuilding[]
  addresses: readonly AssociateAddress[]
}): AssociateResult {
  const places = new Map<string, FeatureLinks>()
  const buildings = new Map<string, { address_id: string | null }>()
  const addresses = new Map<string, { building_id: string | null }>()
  const byKey = new Map<string, AssociateAddress>()
  for (const address of input.addresses) {
    addresses.set(address.id, { building_id: null })
    const key = addressKey(address.number, address.street, address.postcode, address.country)
    if (key && !byKey.has(key)) byKey.set(key, address)
  }

  let placeBuilding = 0
  let placeAddress = 0
  let buildingAddress = 0

  for (const building of input.buildings) {
    const nearest = nearestAddress(building, input.addresses)
    buildings.set(building.id, { address_id: nearest?.id ?? null })
    if (nearest) {
      buildingAddress += 1
      const current = addresses.get(nearest.id)
      if (current && !current.building_id) current.building_id = building.id
    }
  }

  for (const place of input.places) {
    const buildingId = buildingForPlace(place, input.buildings)
    const addressId = addressForPlace(place, input.addresses, byKey)
    places.set(place.id, { building_id: buildingId, address_id: addressId })
    if (buildingId) placeBuilding += 1
    if (addressId) placeAddress += 1
  }

  return {
    places,
    buildings,
    addresses,
    place_building_matches: placeBuilding,
    place_address_matches: placeAddress,
    building_address_matches: buildingAddress,
  }
}

function buildingForPlace(place: AssociatePlace, buildings: readonly AssociateBuilding[]): string | null {
  for (const building of buildings) {
    if (pointInGeometry(place.lng, place.lat, building.geometry)) return building.id
  }
  return nearestWithin(place, buildings)?.id ?? null
}

function addressForPlace(
  place: AssociatePlace,
  addresses: readonly AssociateAddress[],
  byKey: ReadonlyMap<string, AssociateAddress>,
): string | null {
  const label = place.place_addresses?.[0]
  if (label) {
    const key = addressKey(
      label.number ?? firstToken(label.freeform),
      label.street ?? restStreet(label.freeform),
      label.postcode,
      label.country ?? place.country,
    )
    const exact = key ? byKey.get(key) : undefined
    if (exact) return exact.id
  }
  return nearestWithin(place, addresses)?.id ?? null
}

function nearestAddress(origin: { lat: number; lng: number }, addresses: readonly AssociateAddress[]) {
  return nearestWithin(origin, addresses)
}

function nearestWithin<T extends { id: string; lat: number; lng: number }>(
  origin: { lat: number; lng: number },
  items: readonly T[],
): T | null {
  let best: T | null = null
  let bestMeters = ASSOCIATE_NEAR_M
  for (const item of items) {
    const distance = metersBetween(origin, item)
    if (distance <= bestMeters) {
      best = item
      bestMeters = distance
    }
  }
  return best
}

export function addressKey(
  number?: string | null,
  street?: string | null,
  postcode?: string | null,
  country?: string | null,
): string | null {
  const parts = [norm(number), norm(street), norm(postcode), norm(country)].filter((part) => part.length > 0)
  if (parts.length < 3) return null
  return parts.join('|')
}

export function asPlaceAddresses(value: unknown): PlaceAddressLabel[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const row = entry as Record<string, unknown>
    return [
      {
        freeform: asText(row.freeform),
        number: asText(row.number),
        street: asText(row.street),
        postcode: asText(row.postcode),
        locality: asText(row.locality),
        region: asText(row.region),
        country: asText(row.country),
      },
    ]
  })
}

function firstToken(value?: string): string {
  return (value ?? '').trim().split(/\s+/)[0] ?? ''
}

function restStreet(value?: string): string {
  return (value ?? '').trim().split(/\s+/).slice(1).join(' ')
}

function norm(value?: string | null): string {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function asText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}
