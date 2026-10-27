/**
 * Sample place categories used by the Austin mock.
 *
 * Paths below use only nodes named in the Overture places guide
 * (https://docs.overturemaps.org/guides/places/, October 2026):
 * food_and_drink, restaurant, casual_eatery, cafe, lodging, hotel,
 * arts_and_entertainment, museum, art_museum, park, playground.
 * bar and hospital are named as basic-level terms; the guide does not
 * publish their parent path, so those hierarchies start at the named node.
 * park records are split between primary "park" and primary "playground".
 */
export type PlacePreset = {
  basic_category: string
  primary: string
  hierarchy: readonly string[]
  nameForms: readonly string[]
  weight: number
}

export const PLACE_PRESETS: readonly PlacePreset[] = [
  {
    basic_category: 'restaurant',
    primary: 'restaurant',
    hierarchy: ['food_and_drink', 'restaurant'],
    nameForms: ['Kitchen', 'Grill', 'Table'],
    weight: 28,
  },
  {
    basic_category: 'cafe',
    primary: 'cafe',
    hierarchy: ['food_and_drink', 'casual_eatery', 'cafe'],
    nameForms: ['Cafe', 'Coffee'],
    weight: 18,
  },
  {
    basic_category: 'bar',
    primary: 'bar',
    hierarchy: ['bar'],
    nameForms: ['Bar', 'Taproom'],
    weight: 12,
  },
  {
    basic_category: 'hotel',
    primary: 'hotel',
    hierarchy: ['lodging', 'hotel'],
    nameForms: ['Hotel'],
    weight: 8,
  },
  {
    basic_category: 'museum',
    primary: 'art_museum',
    hierarchy: ['arts_and_entertainment', 'museum', 'art_museum'],
    nameForms: ['Museum'],
    weight: 6,
  },
  {
    basic_category: 'park',
    primary: 'park',
    hierarchy: ['park'],
    nameForms: ['Park', 'Playground'],
    weight: 16,
  },
  {
    basic_category: 'hospital',
    primary: 'hospital',
    hierarchy: ['hospital'],
    nameForms: ['Hospital'],
    weight: 12,
  },
]

export const BASIC_CATEGORIES = [
  'restaurant',
  'cafe',
  'bar',
  'hotel',
  'museum',
  'park',
  'hospital',
] as const

export const PRIMARY_CATEGORIES = [
  'restaurant',
  'cafe',
  'bar',
  'hotel',
  'art_museum',
  'park',
  'playground',
  'hospital',
] as const

export const OPERATING_STATUSES = ['open', 'permanently_closed'] as const

export type OperatingStatus = (typeof OPERATING_STATUSES)[number]
