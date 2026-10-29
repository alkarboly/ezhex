import {
  AGENT_DEFAULT_HAIL_DAYS,
  AGENT_DEFAULT_RADIUS_KM,
  AGENT_MAX_NEW_HEXES,
  AGENT_MAX_RADIUS_KM,
  HAIL_MESH_START,
  MAX_AGENT_HEX_BATCH,
  MAX_HAIL_DAYS,
} from './limits'
import type { AgentPresenceField, AgentRegionKind } from '../types/agents'

export const AGENT_REGION_OPTIONS: readonly { kind: Exclude<AgentRegionKind, 'previous'>; label: string; hint: string }[] = [
  { kind: 'place', label: 'Named place', hint: 'A landmark, address, or neighborhood, with a radius' },
  { kind: 'selection', label: 'Selected hexes', hint: 'Hexes clicked on the map' },
  { kind: 'view', label: 'Map view', hint: 'Every hex in the current view' },
  { kind: 'point', label: 'Map center', hint: 'A circle around the middle of the map' },
  { kind: 'polygon', label: 'Custom polygon', hint: 'Uploaded, pasted, or drawn' },
]

export const AGENT_CAPABILITIES = [
  {
    id: 'hexes',
    title: 'Find hexes',
    body: 'From a named place, your selection, the map view, or a custom polygon.',
  },
  {
    id: 'process',
    title: 'Process',
    body: `Creates Overture jobs for missing hexes in connected batches of ${MAX_AGENT_HEX_BATCH} or fewer.`,
  },
  {
    id: 'query',
    title: 'Query',
    body: 'Reads the processed rows, then picks the dataset, categories, and filters.',
  },
  {
    id: 'enrich',
    title: 'Enrich',
    body: 'Geofence to the region, NOAA hail history, and one AI column per row.',
  },
] as const

export const AGENT_SUGGESTIONS = [
  'Coffee shops within 1 km of the Texas State Capitol, with 30 days of hail history',
  'Restaurants with phone numbers in my selected hexes, score each as a lead from 0 to 100',
  'Buildings around the map center, classify roof hail risk as low, medium, or high',
  'Hotels inside my polygon with high confidence',
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
    `Radius defaults to ${AGENT_DEFAULT_RADIUS_KM} km and is capped at ${AGENT_MAX_RADIUS_KM} km.`,
    `Missing hexes are processed in connected batches of at most ${MAX_AGENT_HEX_BATCH}; at most ${maxNewHexes} new hexes per run.`,
    'Datasets: places (points of interest with category, confidence, phones, emails, socials, websites, operating_status), buildings (class, height, floors, roof), addresses. "all" joins every theme.',
    'Filters: category_terms (plain words such as "coffee", "restaurant", "hotel", "hospital"), search (name text), confidence_min (0.5, 0.7, or 0.9), open_only, require (phone, email, socials, official_id).',
    `Enrichments: geofence keeps rows inside or outside the region polygon; hail_history adds NOAA MRMS MESH hail per hex for the last N days (1-${MAX_HAIL_DAYS}, data from ${HAIL_MESH_START}, default ${AGENT_DEFAULT_HAIL_DAYS}); ai_column adds one typed column per row (bool, enum, number, or text) from a prompt and source fields: ${AGENT_AI_SOURCE_FIELDS.join(', ')}.`,
  ].join('\n')
}
