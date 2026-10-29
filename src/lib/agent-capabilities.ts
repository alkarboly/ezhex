import {
  AGENT_DEFAULT_HAIL_DAYS,
  AGENT_CORRIDOR_KM,
  AGENT_DEFAULT_RADIUS_KM,
  AGENT_LOOSE_SPAN_KM,
  AGENT_MAX_NEW_HEXES,
  AGENT_MAX_RADIUS_KM,
  AGENT_NEIGHBORHOOD_RADIUS_KM,
  HAIL_MESH_START,
  MAX_HAIL_DAYS,
} from './limits'
import type { AgentPresenceField, AgentRegionKind } from '../types/agents'

export const AGENT_REGION_OPTIONS: readonly { kind: Exclude<AgentRegionKind, 'previous'>; label: string; hint: string }[] = [
  { kind: 'place', label: 'Named place', hint: 'A landmark, neighborhood, city, a street/highway corridor, or a loose area between two cities' },
  { kind: 'selection', label: 'Selected hexes', hint: 'Hexes already selected on the map, or a list of H3 ids in the prompt' },
  { kind: 'view', label: 'Map view', hint: 'Every hex in the current view' },
  { kind: 'point', label: 'Map center', hint: 'A circle around the middle of the map' },
  { kind: 'polygon', label: 'Custom polygon', hint: 'Uploaded, pasted, or drawn' },
]

export const AGENT_CAPABILITIES = [
  {
    id: 'hexes',
    title: 'Find hexes',
    body: 'Highlights hexes from the prompt: a corridor along a named street or highway, or a loose polygon around a neighborhood, city, or the area between two places. Uses selected or pasted hexes only when you point at those hexes.',
  },
  {
    id: 'process',
    title: 'Process',
    body: 'Creates one Overture job per missing hex.',
  },
  {
    id: 'query',
    title: 'Query',
    body: 'Reads the processed rows, then picks the dataset, categories, and filters.',
  },
  {
    id: 'enrich',
    title: 'Add-ons',
    body: 'Optional Weather (hail), a custom polygon, or AI enhance that writes one column from each row.',
  },
] as const

export const AGENT_SUGGESTIONS = [
  'Help me search for commercial properties in the Westgate neighborhood in Austin TX',
  'Help me find coffee shops along South Lamar',
  'Help me find commercial properties along I-35 between Austin and Buda, Texas',
] as const

export const AGENT_PRESENCE_LABELS: Record<AgentPresenceField, string> = {
  phone: 'Has phone',
  email: 'Has email',
  socials: 'Has socials',
  official_id: 'Has official id',
}

/** Row fields an `ai_column` may read. Hail fields exist when hail_history runs first. */
export const AGENT_AI_SOURCE_FIELDS = [
  'name',
  'category',
  'main_category',
  'taxonomy',
  'address',
  'locality',
  'postcode',
  'operating_status',
  'confidence',
  'phones',
  'websites',
  'emails',
  'socials',
  'brand',
  'building',
  'building_class',
  'height',
  'floors',
  'roof_shape',
  'roof_material',
  'hail_mm_max',
  'hail_days',
] as const

/** Capability brief for the planning model. Kept next to the UI copy so both describe the same options. */
export function agentCapabilityBrief(maxNewHexes = AGENT_MAX_NEW_HEXES): string {
  return [
    'WorldPulse is a hex-based exchange for Overture Maps data. Hexes are H3 resolution 8 (about 0.74 km2 each).',
    'Region kinds:',
    ...AGENT_REGION_OPTIONS.map((option) => `- ${option.kind}: ${option.hint}.`),
    `- previous: reuse the hexes from the previous plan (for follow-ups like "add hail" or "only open ones").`,
    'When the user names a place, geocode that place. If they name a city, search in that city even when the map is looking at another city. Austin, Dallas, and Houston always resolve, even if the geocoder misses. Prefer a named place over leftover selected hexes or the previous run. Use selection when they paste H3 ids or refer to selected hexes.',
    `A named street or highway (along/on/down, or just the road name) highlights a ${AGENT_CORRIDOR_KM} km corridor. A neighborhood or “between A and B” without a traced road highlights a loose polygon (about ${AGENT_LOOSE_SPAN_KM} km). Circles default to ${AGENT_DEFAULT_RADIUS_KM} km, ${AGENT_NEIGHBORHOOD_RADIUS_KM} km for a small neighborhood, capped at ${AGENT_MAX_RADIUS_KM} km.`,
    `Missing hexes are processed one hex per job; at most ${maxNewHexes} new hexes per run.`,
    'Datasets: places (points of interest with category, confidence, phones, emails, socials, websites, operating_status), buildings (class, height, floors, roof), addresses. "all" joins every theme.',
    'Filters: category_terms (plain words such as "coffee", "restaurant", "hotel", "hospital"), search (name text), confidence_min (0.5, 0.7, or 0.9), open_only, require (phone, email, socials, official_id).',
    `Add-ons are optional. Do not add them unless the user asks. Weather currently offers hail_history (NOAA MRMS MESH hail per hex for the last N days, 1-${MAX_HAIL_DAYS}, data from ${HAIL_MESH_START}, default ${AGENT_DEFAULT_HAIL_DAYS} when weather is requested). Custom polygon is geofence keep inside or outside. AI enhance is ai_column: one typed column per row (bool, enum, number, or text) from a prompt and source fields: ${AGENT_AI_SOURCE_FIELDS.join(', ')}.`,
  ].join('\n')
}
