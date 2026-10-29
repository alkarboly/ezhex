import { randomUUID } from 'node:crypto'
import { cellToLatLng, getResolution, gridDisk, isValidCell, latLngToCell, polygonToCells } from 'h3-js'
import { extractPlace, namesSelection, pickBetterPlace, placeMentionedInPrompt } from '../lib/agent-place'
import { AGENT_AI_SOURCE_FIELDS, agentCapabilityBrief } from '../lib/agent-capabilities'
import { addDay, applyGeofence, asEnrichment } from '../lib/enrichments'
import {
  defaultInspectFilters,
  filterFeatureRows,
  INSPECT_NULL,
  type FeatureRow,
  type InspectFilters,
} from '../lib/feature-rows'
import { asGeometry, metersBetween, type GeoJsonPosition } from '../lib/geojson'
import { balancedHexBatches, connectedHexBatches } from '../lib/hex-batches'
import { extractHexCells } from '../lib/hex-ids'
import { earliestSnapshotDate } from '../lib/hex-snapshots'
import { compileInspectSql } from '../lib/inspect-sql'
import {
  AGENT_DEFAULT_HAIL_DAYS,
  AGENT_DEFAULT_RADIUS_KM,
  AGENT_MAX_NEW_HEXES,
  AGENT_MAX_RADIUS_KM,
  AGENT_NEIGHBORHOOD_RADIUS_KM,
  H3_RESOLUTION,
  HAIL_MESH_START,
  MAX_AGENT_HEX_BATCH,
  MAX_GEOFENCE_VERTICES,
  MAX_HAIL_DAYS,
  MAX_SELECTED_CELLS,
  MIN_VIEWPORT_ZOOM,
} from '../lib/limits'
import { fitGeofencePolygon } from '../lib/polygon-input'
import { serverEnv } from '../lib/server-env'
import {
  AGENT_PRESENCE_FIELDS,
  AGENT_REGION_KINDS,
  type AgentAiColumn,
  type AgentCategoryPick,
  type AgentIntent,
  type AgentPlan,
  type AgentPresenceField,
  type AgentPrevious,
  type AgentQueryResponse,
  type AgentRegion,
  type AgentRegionKind,
  type AgentViewContext,
} from '../types/agents'
import type { AiColumnValueType, GeofencePolygon, WorkflowEnrichment } from '../types/enrichments'
import { assistOwner } from './agent-assist'
import { quoteWorkflowAgents } from './agent-marketplace'
import { checkHexSnapshots } from './hex-snapshots'
import { hexCoverageFor } from './ingestion-jobs'
import { loadInspectRows } from './workflow-runs'

type ApiError = { error: string; status: number }
type LatLng = { lat: number; lng: number }
type ResolvedRegion = { region: AgentRegion; cells: string[] }

type PlanInput = {
  prompt: string
  selection: string[]
  /** Resolution-8 hexes parsed from the prompt. These win over the map selection. */
  promptCells: string[]
  view: AgentViewContext | null
  polygon: GeofencePolygon | null
  polygonSimplified: boolean
  weather: boolean
  previous: AgentPrevious | null
}

/** Res-8 circumradius and neighbor spacing, in km. */
const HEX_RADIUS_KM = 0.4614
const HEX_SPACING_KM = 0.799
const MIN_RADIUS_KM = 0.2
const WIDE_VIEW_KM2 = 60
const VIEW_FALLBACK_RADIUS_KM = 1.5
const MAX_POLYGON_KM2 = 2500
const CIRCLE_VERTICES = 48
const SAMPLE_ROWS = 6
const DATASETS: readonly AgentIntent['dataset'][] = ['places', 'buildings', 'addresses', 'all']
const VALUE_TYPES: readonly AiColumnValueType[] = ['bool', 'enum', 'number', 'text']

/** Plain words the heuristic recognizes, expanded to tokens matched against observed Overture categories. */
const CATEGORY_SYNONYMS: Record<string, readonly string[]> = {
  coffee: ['coffee', 'cafe', 'espresso'],
  cafe: ['cafe', 'coffee'],
  restaurant: ['restaurant', 'diner', 'eatery', 'bistro'],
  food: ['restaurant', 'food', 'cafe', 'bakery', 'diner', 'eatery', 'pizza', 'burger', 'taco'],
  dining: ['restaurant', 'diner', 'eatery'],
  bar: ['bar', 'pub', 'brewery', 'lounge', 'tavern'],
  pub: ['pub', 'bar', 'tavern'],
  brewery: ['brewery', 'beer', 'bar'],
  nightlife: ['bar', 'night', 'lounge', 'pub'],
  hotel: ['hotel', 'motel', 'inn', 'lodging', 'resort', 'accommodation'],
  lodging: ['hotel', 'motel', 'inn', 'lodging', 'resort', 'accommodation'],
  museum: ['museum', 'gallery'],
  park: ['park', 'playground', 'garden'],
  hospital: ['hospital', 'clinic', 'medical', 'emergency'],
  clinic: ['clinic', 'medical', 'doctor', 'urgent'],
  doctor: ['doctor', 'physician', 'clinic', 'medical'],
  pharmacy: ['pharmac*', 'drugstore'],
  dentist: ['dentist', 'dental'],
  health: ['hospital', 'clinic', 'medical', 'pharmac*', 'dentist', 'doctor', 'health'],
  school: ['school', 'college', 'university', 'academy'],
  university: ['university', 'college'],
  gym: ['gym', 'fitness'],
  fitness: ['fitness', 'gym', 'yoga'],
  church: ['church', 'religious', 'worship', 'temple', 'mosque', 'synagogue'],
  bank: ['bank', 'atm', 'credit'],
  grocery: ['grocery', 'supermarket', 'market'],
  supermarket: ['supermarket', 'grocery'],
  shop: ['shop', 'store', 'retail', 'boutique', 'shopping'],
  store: ['store', 'shop', 'retail'],
  retail: ['retail', 'store', 'shop', 'shopping'],
  gas: ['gas', 'fuel'],
  salon: ['salon', 'beauty', 'barber', 'spa', 'nail'],
  barber: ['barber', 'salon'],
  spa: ['spa', 'massage', 'salon'],
  bakery: ['bakery', 'bake*'],
  pizza: ['pizza'],
  taco: ['taco', 'mexican'],
  mexican: ['mexican', 'taco'],
  sushi: ['sushi', 'japanese'],
  burger: ['burger', 'fast'],
  auto: ['auto*', 'car', 'automotive'],
  car: ['car', 'auto*'],
  office: ['office', 'coworking'],
  theater: ['theater', 'theatre', 'cinema'],
  cinema: ['cinema', 'theater', 'theatre', 'movie'],
  library: ['library'],
  pet: ['pet', 'veterinar*', 'animal'],
  vet: ['veterinar*', 'animal'],
  lawyer: ['lawyer', 'legal', 'attorney', 'law'],
  insurance: ['insurance'],
  daycare: ['daycare', 'child', 'childcare', 'preschool'],
  apartment: ['apartment*', 'residential'],
  residential: ['residential', 'house', 'apartment*', 'detached'],
  house: ['house', 'detached', 'residential'],
  commercial: ['commercial', 'retail', 'office'],
  industrial: ['industrial', 'warehouse', 'factory'],
  warehouse: ['warehouse', 'industrial'],
}

const AI_VERBS = String.raw`score|scoring|rank|ranking|rate|rating|classify|classification|categori[sz]e|label|tag|flag|assess|estimate|segment|tier|summari[sz]e|describe`
const AI_VERB_RE = new RegExp(String.raw`\b(?:${AI_VERBS})\b`)
const AI_SUBJECT_RE = new RegExp(
  String.raw`^(?:${AI_VERBS})\s+(?:(?:each|every|all|the|them|it|its|their|these|those|rows?|places?|buildings?|businesses|one|by|for|on|as|an?)\s+)*([a-z][a-z -]{1,40}?)(?=\s+(?:from|between|as|on|with|using|and|for|in|of|out|based|if|that|to|by)\b|[,.;!?]|$)`,
)
const COLUMN_STOP_WORDS = new Set([
  'a', 'an', 'the', 'each', 'every', 'row', 'rows', 'place', 'places', 'building', 'buildings', 'them', 'it', 'its',
  'their', 'likely', 'how', 'very', 'one', 'ones', 'overall', 'business', 'businesses',
])
const LARGE_PLACE_SPAN_KM = 8
const GEOCODE_HINT_KM = 25
const CITY_VIEWBOX_PAD_DEG = 0.28
const NEIGHBORHOOD_HIT_TYPES = new Set([
  'neighbourhood',
  'suburb',
  'quarter',
  'city_block',
  'residential',
  'retail',
  'commercial',
  'hamlet',
])

export async function planAgentRun(body: unknown, cookies: Record<string, string>): Promise<AgentPlan | ApiError> {
  const input = parsePlanRequest(body)
  if ('error' in input) return input
  const owner = await assistOwner(cookies)
  if ('error' in owner) return owner

  const locality = await mapLocality(input.view)
  const heuristic = heuristicIntent(input)
  const model = await modelIntent(input, heuristic, locality)
  const intent = model?.intent ?? heuristic
  if (input.weather && intent.hail_days == null) intent.hail_days = AGENT_DEFAULT_HAIL_DAYS
  withHailSourceFields(intent)

  const notes: string[] = []
  if (input.polygonSimplified) notes.push(`Simplified the attached polygon to ${MAX_GEOFENCE_VERTICES} vertices.`)
  const resolved = await resolveRegion(intent, input, model?.placeHint ?? null, notes, locality)
  if ('error' in resolved) return resolved
  let cells = resolved.cells
  if (cells.length === 0) return { error: 'That region has no hexes. Try a larger radius or another area.', status: 422 }
  if (cells.length > MAX_SELECTED_CELLS) {
    notes.push(`The region has ${cells.length} hexes. I kept the ${MAX_SELECTED_CELLS} closest to its center.`)
    cells = cells.slice(0, MAX_SELECTED_CELLS)
  }

  const coverage = await hexCoverageFor(cells)
  const status = new Map(coverage.cells.map((cell) => [cell.h3, cell]))
  const cap = maxNewHexes()
  const missingAll = cells.filter((cell) => status.get(cell)?.status === 'missing')
  if (missingAll.length > cap) {
    const allowed = new Set(missingAll.slice(0, cap))
    cells = cells.filter((cell) => status.get(cell)?.status !== 'missing' || allowed.has(cell))
    notes.push(
      `${missingAll.length} hexes need processing. I'll process the ${cap} closest to the center this run; ask again to extend.`,
    )
  }
  const missing = cells.filter((cell) => status.get(cell)?.status === 'missing')
  const processingJobs = [
    ...new Set(
      cells
        .map((cell) => status.get(cell))
        .filter((cell) => cell?.status === 'processing' && cell.job_id)
        .map((cell) => cell?.job_id as string),
    ),
  ]
  if (!intent.workflow_name) intent.workflow_name = defaultWorkflowName(intent, resolved.region)
  if (intent.geofence_keep === 'outside' && !resolved.region.polygon) {
    notes.push('Selections and map views have no boundary, so there is no geofence. Name a place or attach a polygon to fence rows.')
  }

  return {
    id: randomUUID(),
    reply: model?.reply || describePlan(intent, resolved.region, missing.length),
    used_model: Boolean(model),
    intent,
    region: resolved.region,
    h3_cells: cells,
    ready: cells.filter((cell) => status.get(cell)?.status === 'ready'),
    missing,
    processing_jobs: processingJobs,
    batches: balancedHexBatches(missing, MAX_AGENT_HEX_BATCH),
    release_version: coverage.current_release_version,
    max_new_hexes: cap,
    notes,
  }
}

export async function buildAgentQuery(body: unknown, cookies: Record<string, string>): Promise<AgentQueryResponse | ApiError> {
  if (!isRecord(body)) return { error: 'Request body must include h3_cells, intent, and region.', status: 400 }
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim().slice(0, 1500) : ''
  const parsedCells = parseCells(body.h3_cells)
  if ('error' in parsedCells) return parsedCells
  const cells = parsedCells.cells
  if (cells.length === 0) return { error: 'Choose at least one hex.', status: 400 }
  const region = parseRegion(body.region)
  if (!region) return { error: 'Region is invalid.', status: 400 }
  const intent = sanitizeIntent(body.intent, emptyIntent())
  const owner = await assistOwner(cookies)
  if ('error' in owner) return owner

  const [rows, check] = await Promise.all([loadInspectRows(cells, null), checkHexSnapshots(cells)])
  const notes: string[] = []
  const filters: InspectFilters = { ...defaultInspectFilters, kind: intent.dataset }
  let categories: AgentCategoryPick[] = []
  let usedModel = false
  const placeRows = rows.filter((row) => row.kind === 'places')
  const categoryCounts = countValues(placeRows, 'category')

  if (intent.category_terms.length > 0) {
    const termsLabel = intent.category_terms.map((term) => `“${term}”`).join(', ')
    if (intent.dataset === 'buildings') {
      const picks = matchTerms(intent.category_terms, countValues(rows, 'building_class'))
      if (picks.length > 0) {
        filters.buildingClasses = picks.map((pick) => pick.value)
        categories = picks
        notes.push(`Matched ${termsLabel} to building class ${picks.map((pick) => pick.value).join(', ')}.`)
      } else {
        notes.push(`No building class here matches ${termsLabel}, so I kept every building.`)
      }
    } else {
      const choice = await chooseCategories(prompt, intent.category_terms, categoryCounts)
      usedModel = choice.used_model
      filters.kind = 'places'
      if (choice.values.length > 0) {
        categories = choice.values.map((value) => ({ value, count: categoryCounts.get(value) ?? 0 }))
        filters.categories = choice.values
        notes.push(`Matched ${termsLabel} to ${categories.length} of ${categoryCounts.size} categories in these hexes.`)
      } else {
        filters.search = intent.category_terms[0]
        notes.push(`No category in these hexes matches ${termsLabel}, so I search names for “${filters.search}”.`)
      }
    }
  }
  if (intent.search) filters.search = intent.search
  if (intent.confidence_min != null && filters.kind !== 'buildings' && filters.kind !== 'addresses') {
    filters.confidenceMin = intent.confidence_min
  }
  if (intent.open_only) {
    if (countValues(placeRows, 'operating_status').has('open')) filters.statuses = ['open']
    else notes.push('No operating status is published for these places, so I kept all of them.')
  }
  for (const field of intent.require) filters[presenceFilterKey(field)] = 'yes'

  const matched = filterFeatureRows(rows, filters)
  const enrichments = agentEnrichments(intent, region)
  const geofence = enrichments.find((step) => step.kind === 'geofence')
  const fenced = geofence && geofence.kind === 'geofence' ? applyGeofence(matched, geofence) : null
  const hailStep = enrichments.find((step) => step.kind === 'hail_history')
  const floor = earliestSnapshotDate(check.cells)
  const hailWindow =
    hailStep && hailStep.kind === 'hail_history'
      ? { start_date: hailStep.start_date, end_date: hailStep.end_date, floor: floor && floor > hailStep.start_date ? floor : null }
      : null
  if (hailWindow?.floor) {
    notes.push(`These hexes were first processed on ${hailWindow.floor}, so the hail window starts there.`)
  }
  const missing = check.cells.filter((cell) => !cell.processed).map((cell) => cell.h3)
  const finalRows = fenced ?? matched
  const quote = await quoteWorkflowAgents({
    ownerId: owner.ownerId,
    workflowId: 'agent-draft',
    releaseVersion: check.current_release_version,
    selectedHexCount: cells.length,
    missingHexes: missing,
    processBatches: connectedHexBatches(missing, MAX_AGENT_HEX_BATCH),
    enrichments,
    estimatedRows: finalRows.length,
  })

  return {
    filters,
    sql: compileInspectSql(cells, filters, null),
    enrichments,
    categories,
    observed_categories: categoryCounts.size,
    total_rows: rows.length,
    matched_rows: matched.length,
    fenced_rows: fenced ? fenced.length : null,
    sample: sampleRows(finalRows),
    workflow_name: intent.workflow_name || defaultWorkflowName(intent, region),
    hail_window: hailWindow,
    quote,
    notes,
    used_model: usedModel,
  }
}

// ---------- request parsing ----------

function parsePlanRequest(body: unknown): PlanInput | ApiError {
  if (!isRecord(body)) return { error: 'Request body must include a prompt.', status: 400 }
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim().slice(0, 8000) : ''
  if (prompt.length < 2) return { error: 'Tell the agent what to build.', status: 400 }
  const selection = parseCells(body.selection ?? [])
  if ('error' in selection) return selection
  const promptCells = extractHexCells(prompt)
  let polygon: GeofencePolygon | null = null
  let polygonSimplified = false
  if (body.polygon != null) {
    const parsed = parsePolygon(body.polygon)
    if (!parsed) return { error: 'The attached region must be a GeoJSON Polygon with valid coordinates.', status: 400 }
    const fitted = fitGeofencePolygon(parsed)
    polygon = fitted.polygon
    polygonSimplified = fitted.simplified
  }
  return {
    prompt,
    selection: selection.cells,
    promptCells,
    view: parseView(body.view),
    polygon,
    polygonSimplified,
    weather: body.weather === true,
    previous: parsePrevious(body.previous),
  }
}

function parseCells(value: unknown): { cells: string[] } | ApiError {
  if (!Array.isArray(value)) return { error: 'h3_cells must be a list.', status: 400 }
  const cells = [
    ...new Set(value.filter((cell): cell is string => typeof cell === 'string').map((cell) => cell.trim()).filter(Boolean)),
  ]
  if (cells.length > MAX_SELECTED_CELLS) {
    return { error: `Use at most ${MAX_SELECTED_CELLS} hexes.`, status: 400 }
  }
  for (const cell of cells) {
    if (!isValidCell(cell) || getResolution(cell) !== H3_RESOLUTION) {
      return { error: `Every hex must be a resolution-${H3_RESOLUTION} cell.`, status: 400 }
    }
  }
  return { cells }
}

function parseView(value: unknown): AgentViewContext | null {
  if (!isRecord(value) || !isRecord(value.center)) return null
  const center = latLng(value.center.lat, value.center.lng)
  if (!center) return null
  const zoom = Number(value.zoom)
  let bounds: AgentViewContext['bounds'] = null
  if (isRecord(value.bounds)) {
    const west = Number(value.bounds.west)
    const south = Number(value.bounds.south)
    const east = Number(value.bounds.east)
    const north = Number(value.bounds.north)
    if ([west, south, east, north].every(Number.isFinite) && east > west && north > south) {
      bounds = { west, south, east, north }
    }
  }
  return { center, bounds, zoom: Number.isFinite(zoom) ? zoom : 12 }
}

function parsePolygon(value: unknown): GeofencePolygon | null {
  const geometry = asGeometry(value)
  if (!geometry || geometry.type !== 'Polygon') return null
  const ring = geometry.coordinates[0]
  if (!ring || ring.length < 4) return null
  if (!geometry.coordinates.every((part) => part.every(([lng, lat]) => latLng(lat, lng) !== null))) return null
  return { type: 'Polygon', coordinates: geometry.coordinates }
}

function parseRegion(value: unknown): AgentRegion | null {
  if (!isRecord(value) || !isRecord(value.center)) return null
  const kind = value.kind
  if (kind !== 'selection' && kind !== 'view' && kind !== 'place' && kind !== 'point' && kind !== 'polygon') return null
  const center = latLng(value.center.lat, value.center.lng)
  if (!center) return null
  let polygon: GeofencePolygon | null = null
  if (value.polygon != null) {
    const parsed = parsePolygon(value.polygon)
    if (!parsed) return null
    polygon = fitGeofencePolygon(parsed).polygon
  }
  const radius = Number(value.radius_km)
  return {
    kind,
    label: typeof value.label === 'string' && value.label.trim() ? value.label.trim().slice(0, 120) : 'Region',
    center,
    radius_km: value.radius_km != null && Number.isFinite(radius) && radius > 0 ? Math.min(radius, AGENT_MAX_RADIUS_KM) : null,
    polygon,
  }
}

function parsePrevious(value: unknown): AgentPrevious | null {
  if (!isRecord(value)) return null
  const cells = parseCells(value.h3_cells ?? [])
  if ('error' in cells || cells.cells.length === 0) return null
  const region = parseRegion(value.region)
  if (!region) return null
  return { intent: sanitizeIntent(value.intent, emptyIntent()), region, h3_cells: cells.cells }
}

// ---------- intent ----------

function emptyIntent(): AgentIntent {
  return {
    region: { kind: 'selection', place: null, radius_km: null },
    dataset: 'places',
    category_terms: [],
    search: null,
    confidence_min: null,
    open_only: false,
    require: [],
    geofence_keep: null,
    hail_days: null,
    ai_column: null,
    workflow_name: '',
  }
}

function cloneIntent(intent: AgentIntent): AgentIntent {
  return {
    ...intent,
    region: { ...intent.region },
    category_terms: [...intent.category_terms],
    require: [...intent.require],
    ai_column: intent.ai_column
      ? {
          ...intent.ai_column,
          source_fields: [...intent.ai_column.source_fields],
          ...(intent.ai_column.enum_values ? { enum_values: [...intent.ai_column.enum_values] } : {}),
        }
      : null,
  }
}

/** Validate an intent from the model or the browser. Keys that are missing or invalid fall back to `base`. */
function sanitizeIntent(value: unknown, base: AgentIntent): AgentIntent {
  const next = cloneIntent(base)
  if (!isRecord(value)) return next
  if (isRecord(value.region)) {
    const region = value.region
    if (AGENT_REGION_KINDS.includes(region.kind as AgentRegionKind)) next.region.kind = region.kind as AgentRegionKind
    if ('place' in region) next.region.place = cleanText(region.place, 120)
    if ('radius_km' in region) next.region.radius_km = cleanRadius(region.radius_km)
    if (next.region.kind !== 'place') next.region.place = null
  }
  if (DATASETS.includes(value.dataset as AgentIntent['dataset'])) next.dataset = value.dataset as AgentIntent['dataset']
  if (Array.isArray(value.category_terms)) {
    next.category_terms = [
      ...new Set(
        value.category_terms
          .filter((term): term is string => typeof term === 'string')
          .map((term) => term.trim().toLowerCase().replace(/[^a-z0-9 _-]/g, ''))
          .filter((term) => term.length >= 2 && term.length <= 40),
      ),
    ].slice(0, 8)
  }
  if ('search' in value) next.search = cleanText(value.search, 80)
  if ('confidence_min' in value) next.confidence_min = cleanConfidence(value.confidence_min)
  if (typeof value.open_only === 'boolean') next.open_only = value.open_only
  if (Array.isArray(value.require)) {
    next.require = [...new Set(value.require.filter(isPresenceField))]
  }
  if ('geofence_keep' in value) {
    next.geofence_keep = value.geofence_keep === 'inside' || value.geofence_keep === 'outside' ? value.geofence_keep : null
  }
  if ('hail_days' in value) next.hail_days = cleanDays(value.hail_days)
  if ('ai_column' in value) next.ai_column = sanitizeAiColumn(value.ai_column)
  if (typeof value.workflow_name === 'string') next.workflow_name = value.workflow_name.replace(/\s+/g, ' ').trim().slice(0, 60)
  return next
}

function sanitizeAiColumn(value: unknown): AgentAiColumn | null {
  if (!isRecord(value)) return null
  const valueType = VALUE_TYPES.includes(value.value_type as AiColumnValueType) ? (value.value_type as AiColumnValueType) : 'number'
  const prompt = typeof value.prompt === 'string' ? value.prompt.replace(/\s+/g, ' ').trim().slice(0, 600) : ''
  if (prompt.length < 6) return null
  const column = typeof value.column === 'string' ? columnName(value.column, valueType) : defaultColumn(valueType)
  const allowed = new Set<string>(AGENT_AI_SOURCE_FIELDS)
  const fields = Array.isArray(value.source_fields)
    ? [...new Set(value.source_fields.filter((field): field is string => typeof field === 'string' && allowed.has(field)))]
    : []
  let enumValues: string[] | undefined
  if (valueType === 'enum') {
    enumValues = Array.isArray(value.enum_values)
      ? [
          ...new Set(
            value.enum_values
              .filter((entry): entry is string => typeof entry === 'string')
              .map((entry) => entry.trim().toLowerCase())
              .filter((entry) => entry.length > 0 && entry.length <= 32),
          ),
        ].slice(0, 12)
      : []
    if (enumValues.length < 2) enumValues = ['low', 'medium', 'high']
  }
  return {
    column,
    value_type: valueType,
    prompt,
    source_fields: fields.length > 0 ? fields.slice(0, 20) : ['name', 'category', 'address'],
    ...(enumValues ? { enum_values: enumValues } : {}),
  }
}

function heuristicIntent(input: PlanInput): AgentIntent {
  const text = input.prompt
  const lower = text.toLowerCase()
  const region = detectRegion(text, lower, input)
  const refine = input.previous != null && region.kind === 'previous' && isRefinement(lower)
  const intent = refine && input.previous ? cloneIntent(input.previous.intent) : emptyIntent()
  intent.region = region
  intent.workflow_name = ''

  const aiVerb = AI_VERB_RE.exec(lower)
  const head = aiVerb ? lower.slice(0, aiVerb.index) : lower
  const dataset = detectDataset(head)
  if (dataset) intent.dataset = dataset
  const terms = detectCategoryTerms(head)
  if (terms.length > 0) {
    intent.category_terms = terms
    if (!dataset && intent.dataset === 'all') intent.dataset = 'places'
  }
  const search = detectSearch(text)
  if (search) intent.search = search
  const confidence = detectConfidence(lower)
  if (confidence != null) intent.confidence_min = confidence
  if (/\b(?:only open|open only|currently open|still open|that are open|open (?:ones|places|businesses|restaurants|shops|stores|now))\b/.test(lower)) {
    intent.open_only = true
  }
  intent.require = [...new Set([...intent.require, ...detectRequired(lower)])]
  if (/\boutside\b/.test(lower)) intent.geofence_keep = 'outside'

  if (/\b(?:no|without|remove|drop|skip)\s+(?:the\s+)?(?:hail|weather|storm)/.test(lower)) intent.hail_days = null
  else if (/\b(?:hail|hailstorms?|storms?|weather|mesh|noaa|severe)\b/.test(lower)) {
    intent.hail_days = detectDays(lower) ?? intent.hail_days ?? AGENT_DEFAULT_HAIL_DAYS
  } else if (intent.hail_days != null) {
    intent.hail_days = detectDays(lower) ?? intent.hail_days
  }
  if (input.weather && intent.hail_days == null) intent.hail_days = AGENT_DEFAULT_HAIL_DAYS

  if (/\b(?:no|without|remove|drop|skip)\s+(?:the\s+)?(?:ai|score|scoring|column|label)/.test(lower)) intent.ai_column = null
  else {
    const ai = detectAiColumn(text, lower, intent)
    if (ai) intent.ai_column = ai
  }
  return intent
}

function isRefinement(lower: string): boolean {
  return /^(?:add|also|now|only|just|remove|drop|without|make|change|switch|include|exclude|then|and|plus|filter|keep|limit|narrow|expand|increase|decrease|use|same|instead|with|but|score|rank|rate|classify|label|flag|tag|no)\b/.test(
    lower.trim(),
  ) || /\b(?:same (?:area|hexes|region|place)|those|these ones|that area)\b/.test(lower)
}

function detectRegion(text: string, lower: string, input: PlanInput): AgentIntent['region'] {
  const radius = detectRadius(lower)
  if (input.promptCells.length > 0) {
    return { kind: 'selection', place: null, radius_km: null }
  }
  if (/\b(?:polygon|boundary|outline|geojson|wkt|drawn|uploaded|pasted)\b/.test(lower)) {
    return { kind: 'polygon', place: null, radius_km: null }
  }
  if (input.polygon && /\b(?:shape|attached|my area|the area)\b/.test(lower)) {
    return { kind: 'polygon', place: null, radius_km: null }
  }
  if (namesSelection(text)) {
    return { kind: 'selection', place: null, radius_km: null }
  }
  const place = extractPlace(text)
  if (place) return { kind: 'place', place, radius_km: radius }
  if (/\b(?:map cent(?:er|re)|cent(?:er|re) of the map|middle of the map|right here|around here|near here|here)\b/.test(lower)) {
    return { kind: 'point', place: null, radius_km: radius }
  }
  if (/\b(?:in view|on screen|visible|this view|current view|map view|the view|whole map|entire view|what i see|everything i see)\b/.test(lower)) {
    return { kind: 'view', place: null, radius_km: null }
  }
  if (input.polygon) return { kind: 'polygon', place: null, radius_km: null }
  if (input.previous) return { kind: 'previous', place: null, radius_km: radius }
  if (input.selection.length > 0) return { kind: 'selection', place: null, radius_km: null }
  return { kind: 'point', place: null, radius_km: radius }
}

function detectRadius(lower: string): number | null {
  const match = lower.match(new RegExp(String.raw`(\d+(?:\.\d+)?)\s*(km|kilomet(?:er|re)s?|mi|miles?|m|met(?:er|re)s?)\b`))
  if (!match) return null
  const value = Number(match[1])
  if (!Number.isFinite(value) || value <= 0) return null
  const unit = match[2]
  const km = unit.startsWith('mi') ? value * 1.609 : unit === 'm' || unit.startsWith('met') ? value / 1000 : value
  return cleanRadius(km)
}

function detectDataset(lower: string): AgentIntent['dataset'] | null {
  if (/\b(?:everything|all (?:rows|themes|data|datasets|records|features))\b/.test(lower)) return 'all'
  if (/\b(?:buildings?|roofs?|rooftops?|structures?|footprints?)\b/.test(lower)) return 'buildings'
  if (/^\s*(?:all\s+)?addresses\b|\b(?:address points|only addresses|just addresses|addresses only)\b/.test(lower)) return 'addresses'
  if (/\b(?:places?|pois?|points? of interest|business(?:es)?|leads?|venues?|shops?|stores?|restaurants?)\b/.test(lower)) {
    return 'places'
  }
  return null
}

function detectCategoryTerms(lower: string): string[] {
  const tokens = lower.split(/[^a-z0-9]+/).filter(Boolean)
  const terms: string[] = []
  tokens.forEach((token, index) => {
    const key = CATEGORY_SYNONYMS[token] ? token : singular(token)
    if (!CATEGORY_SYNONYMS[key]) return
    const previous = index > 0 ? tokens[index - 1] : ''
    const previousKey = CATEGORY_SYNONYMS[previous] ? previous : singular(previous)
    if ((key === 'shop' || key === 'store') && CATEGORY_SYNONYMS[previousKey]) return
    if (key === 'gas' && tokens[index + 1] !== 'station' && tokens[index + 1] !== 'stations') return
    terms.push(key)
  })
  return [...new Set(terms)].slice(0, 6)
}

function detectSearch(text: string): string | null {
  const quoted = text.match(/["“]([^"”]{2,40})["”]/)?.[1]
  if (quoted) return quoted.trim()
  const named = text.match(/\b(?:named|called)\s+([A-Za-z0-9&' -]{2,40}?)(?=\s+(?:in|near|around|with|and|within)\b|[,.;!?]|$)/)?.[1]
  return named ? named.trim() : null
}

function detectConfidence(lower: string): number | null {
  if (/\b(?:very high confidence|strict confidence|confidence (?:of |above |over |at least )?0?\.9|90\s*%)/.test(lower)) return 0.9
  if (/\b(?:high confidence|reliable|trusted|confidence (?:of |above |over |at least )?0?\.7|70\s*%)/.test(lower)) return 0.7
  if (/\b(?:confident|confidence)\b/.test(lower)) return 0.5
  return null
}

function detectRequired(lower: string): AgentPresenceField[] {
  const required: AgentPresenceField[] = []
  if (/\b(?:with|has|have|having|including|that have)\s+(?:a\s+)?(?:phone|phones|phone numbers?|telephone)/.test(lower)) required.push('phone')
  if (/\b(?:with|has|have|having|including|that have)\s+(?:an?\s+)?(?:email|emails|email address(?:es)?)/.test(lower)) required.push('email')
  if (/\b(?:with|has|have|having|including|that have)\s+(?:social|socials|social media|instagram|facebook)/.test(lower)) required.push('socials')
  if (/\b(?:with|has|have|having|including|that have)\s+(?:an?\s+)?(?:official id|registry id|license)/.test(lower)) required.push('official_id')
  return required
}

function detectDays(lower: string): number | null {
  const match = lower.match(/\b(\d{1,3})\s*-?\s*(day|week|month|year)s?\b/)
  if (match) {
    const unit = { day: 1, week: 7, month: 30, year: 365 }[match[2] as 'day' | 'week' | 'month' | 'year']
    return cleanDays(Number(match[1]) * unit)
  }
  if (/\b(?:last|past|this)\s+week\b/.test(lower)) return 7
  if (/\b(?:last|past|this)\s+month\b/.test(lower)) return 30
  if (/\b(?:last|past)\s+(?:quarter|season)\b/.test(lower)) return 90
  if (/\b(?:last|past|this)\s+year\b/.test(lower)) return 365
  return null
}

function detectAiColumn(text: string, lower: string, intent: AgentIntent): AgentAiColumn | null {
  const verb = AI_VERB_RE.exec(lower)
  if (!verb) return null
  const from = lower.slice(verb.index)
  const valueType = detectValueType(from)
  const subject = from.match(AI_SUBJECT_RE)?.[1] ?? ''
  const clause = text.slice(verb.index).split(/[.!?\n]/)[0].trim()
  const prompt = clause.length >= 6 ? `${clause[0].toUpperCase()}${clause.slice(1)}` : 'Assess each row for this request.'
  return {
    column: columnName(subject, valueType),
    value_type: valueType,
    prompt: prompt.slice(0, 600),
    source_fields: defaultSourceFields(intent.dataset),
    ...(valueType === 'enum' ? { enum_values: detectEnumValues(from) ?? ['low', 'medium', 'high'] } : {}),
  }
}

function detectValueType(from: string): AiColumnValueType {
  if (/\b(?:classify|classification|categori[sz]e|label|tier|segment|bucket)\b/.test(from)) return 'enum'
  if (/\bas\s+[a-z]+\s*(?:,|\/)\s*[a-z]+/.test(from)) return 'enum'
  if (/\b(?:flag|whether|yes or no|true or false|yes\/no)\b/.test(from)) return 'bool'
  if (/\b(?:summari[sz]e|describe|explain|write)\b/.test(from)) return 'text'
  return 'number'
}

function detectEnumValues(from: string): string[] | null {
  const tail = from.match(/\b(?:as|into|between)\s+(.+?)(?:[.;!?]|$)/)?.[1]
  if (!tail) return null
  const values = tail
    .split(/\s*(?:,|\/|\bor\b|\band\b)\s*/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0 && value.length <= 24 && value.split(/\s+/).length <= 3)
  const unique = [...new Set(values)]
  return unique.length >= 2 && unique.length <= 8 ? unique : null
}

function columnName(subject: string, valueType: AiColumnValueType): string {
  const words = subject
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word && !COLUMN_STOP_WORDS.has(word))
    .slice(0, 4)
  let base = words.join('_').replace(/^[^a-z]+/, '')
  if (base && valueType === 'number' && !/(?:score|rating|rank|index|estimate|count)$/.test(base)) base = `${base}_score`
  if (base && valueType === 'bool' && !base.startsWith('is_') && !base.endsWith('_flag')) base = `${base}_flag`
  base = base.slice(0, 48)
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(base) || base.startsWith('overture_')) return defaultColumn(valueType)
  return base
}

function defaultColumn(valueType: AiColumnValueType): string {
  return { number: 'agent_score', enum: 'agent_label', bool: 'agent_flag', text: 'agent_note' }[valueType]
}

function defaultSourceFields(dataset: AgentIntent['dataset']): string[] {
  if (dataset === 'buildings') return ['building', 'building_class', 'height', 'floors', 'roof_shape', 'roof_material']
  if (dataset === 'addresses') return ['address', 'locality', 'postcode']
  return ['name', 'category', 'address', 'confidence', 'operating_status', 'phones', 'websites']
}

function withHailSourceFields(intent: AgentIntent) {
  if (intent.hail_days == null || !intent.ai_column) return
  const fields = new Set(intent.ai_column.source_fields)
  fields.add('hail_mm_max')
  fields.add('hail_days')
  intent.ai_column.source_fields = [...fields].slice(0, 20)
}

// ---------- model ----------

async function modelIntent(
  input: PlanInput,
  heuristic: AgentIntent,
  locality: string | null,
): Promise<{ intent: AgentIntent; reply: string; placeHint: LatLng | null } | null> {
  const context = {
    selected_hex_count: input.selection.length,
    selected_hexes: input.selection.slice(0, 40),
    prompt_hexes: input.promptCells.slice(0, 40),
    polygon_attached: Boolean(input.polygon),
    map: input.view
      ? {
          center: input.view.center,
          zoom: Math.round(input.view.zoom * 10) / 10,
          looking_at: locality,
        }
      : null,
    weather_toggle: input.weather,
    previous: input.previous
      ? {
          intent: input.previous.intent,
          region: { kind: input.previous.region.kind, label: input.previous.region.label, radius_km: input.previous.region.radius_km },
          hexes: input.previous.h3_cells.length,
        }
      : null,
  }
  const parsed = await openAiJson(planSystemPrompt(), { request: input.prompt, context })
  if (!parsed) return null
  const intent = sanitizeIntent(parsed, heuristic)
  const modelPlace = intent.region.kind === 'place' ? intent.region.place : null
  const namedInPrompt = Boolean(modelPlace && placeMentionedInPrompt(modelPlace, input.prompt))
  if (input.promptCells.length > 0) {
    intent.region = { kind: 'selection', place: null, radius_km: null }
  } else if (namesSelection(input.prompt) && !namedInPrompt) {
    intent.region = { kind: 'selection', place: null, radius_km: null }
  } else if (heuristic.region.kind === 'place' && heuristic.region.place) {
    intent.region.kind = 'place'
    intent.region.place = pickBetterPlace(intent.region.place, heuristic.region.place)
  } else if (intent.region.kind === 'place' && modelPlace && !namedInPrompt) {
    intent.region = heuristic.region
  }
  if (intent.region.kind === 'polygon' && !input.polygon) intent.region.kind = heuristic.region.kind
  if (intent.region.kind === 'previous' && !input.previous) intent.region.kind = heuristic.region.kind
  const region = isRecord(parsed.region) ? parsed.region : {}
  return {
    intent,
    reply: cleanText(parsed.reply, 400) ?? '',
    placeHint: latLng(region.lat, region.lng),
  }
}

function planSystemPrompt(): string {
  return [
    'You are the planning agent for WorldPulse. Turn one user request into a structured data plan. Return only JSON.',
    agentCapabilityBrief(maxNewHexes()),
    'JSON shape: {"reply": string, "region": {"kind": "selection|view|place|point|polygon|previous", "place": string|null, "radius_km": number|null, "lat": number|null, "lng": number|null}, "dataset": "places|buildings|addresses|all", "category_terms": string[], "search": string|null, "confidence_min": 0.5|0.7|0.9|null, "open_only": boolean, "require": ("phone"|"email"|"socials"|"official_id")[], "geofence_keep": "inside"|"outside"|null, "hail_days": number|null, "ai_column": {"column": string, "value_type": "bool|enum|number|text", "prompt": string, "source_fields": string[], "enum_values": string[]}|null, "workflow_name": string}',
    'Rules:',
    '- reply: one or two short first-person sentences that say what you will build. No markdown.',
    '- region.kind: "selection" only when context.prompt_hexes is not empty or the user refers to selected hexes, and they did not name a new area. Use the hex ids from context; never invent hex ids. "place" whenever they name a landmark, address, street, neighborhood, or city (put a Nominatim-searchable name with city and state in place). Expand short names using context.map.looking_at, for example "the capitol" while looking at Austin becomes "Texas State Capitol, Austin, TX". Do not invent a place that is not in the request. "polygon" when a polygon is attached and no other area is named. "view" for the visible map. "point" for "here" or the map center. "previous" for follow-ups that refine the last plan without naming a new area. Prefer a named place over leftover selected hexes or the previous run.',
    '- For follow-ups, start from context.previous.intent and change only what the user asks.',
    '- dataset: places for businesses or points of interest; buildings for structures or roofs; addresses for address points; all when the user wants everything.',
    '- category_terms: short lowercase singular words for the kinds of places wanted, for example ["coffee", "cafe"]. Empty when no kind is named.',
    `- hail_days: set only when the user asks for hail, storms, weather, or hail risk, or when context.weather_toggle is true (default ${AGENT_DEFAULT_HAIL_DAYS}).`,
    '- ai_column: set only when the user asks to score, rank, rate, classify, label, flag, or assess rows. Use a snake_case column. Write the prompt as an instruction for one row.',
    '- geofence_keep: "outside" only when the user wants rows outside the area; otherwise null.',
    '- workflow_name: at most 60 characters, for example "Coffee near the Texas Capitol".',
  ].join('\n')
}

async function chooseCategories(
  prompt: string,
  terms: readonly string[],
  counts: ReadonlyMap<string, number>,
): Promise<{ values: string[]; used_model: boolean }> {
  const heuristic = matchTerms(terms, counts).map((pick) => pick.value)
  const observed = [...counts.entries()].sort((left, right) => right[1] - left[1]).slice(0, 150)
  if (observed.length === 0) return { values: [], used_model: false }
  const parsed = await openAiJson(
    'You pick Overture place categories for a data request. Return only JSON: {"categories": string[]}. Choose only from the observed list. Pick every category that fits the request and none that do not. Return an empty list when nothing fits.',
    { request: prompt, terms, observed: observed.map(([value, count]) => ({ value, count })) },
  )
  if (!parsed || !Array.isArray(parsed.categories)) return { values: heuristic, used_model: false }
  const allowed = new Set(observed.map(([value]) => value))
  const values = [...new Set(parsed.categories.filter((value): value is string => typeof value === 'string' && allowed.has(value)))]
  return { values: (values.length > 0 ? values : heuristic).slice(0, 16), used_model: true }
}

async function openAiJson(system: string, user: unknown): Promise<Record<string, unknown> | null> {
  const key = serverEnv('OPENAI_AGENT_API_KEY') || serverEnv('OPENAI_API_KEY')
  if (!key) return null
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: AbortSignal.timeout(15_000),
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: serverEnv('OPENAI_AGENT_MODEL') || serverEnv('OPENAI_MODEL') || 'gpt-4o-mini',
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: JSON.stringify(user) },
        ],
      }),
    })
    if (!response.ok) return null
    const json = (await response.json()) as unknown
    const choices = isRecord(json) && Array.isArray(json.choices) ? json.choices : []
    const message = isRecord(choices[0]) && isRecord(choices[0].message) ? choices[0].message : null
    if (!message || typeof message.content !== 'string') return null
    const parsed = JSON.parse(message.content) as unknown
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

// ---------- regions ----------

async function resolveRegion(
  intent: AgentIntent,
  input: PlanInput,
  hint: LatLng | null,
  notes: string[],
  locality: string | null,
): Promise<ResolvedRegion | ApiError> {
  let kind = intent.region.kind
  if (kind === 'previous' && !input.previous) kind = input.selection.length > 0 ? 'selection' : 'point'
  if (kind === 'place' && !intent.region.place) kind = input.selection.length > 0 ? 'selection' : 'point'
  const listed = input.promptCells
  const selected = listed.length > 0 ? listed : input.selection
  if (kind === 'selection' && selected.length === 0) {
    if (input.previous) kind = 'previous'
    else {
      kind = 'point'
      notes.push('No hexes are selected, so I started from the map center.')
    }
  }
  intent.region.kind = kind
  if (kind === 'polygon') {
    if (!input.polygon) return { error: 'Attach a polygon first: upload a file, paste GeoJSON or WKT, or draw one.', status: 400 }
    return polygonRegion(input.polygon)
  }
  if (kind === 'selection') {
    if (listed.length > 0) {
      notes.push(
        listed.length === 1
          ? 'Using the hex you listed in the request.'
          : `Using the ${listed.length} hexes you listed in the request.`,
      )
    } else {
      notes.push(
        selected.length === 1 ? 'Using your selected hex.' : `Using your ${selected.length} selected hexes.`,
      )
    }
    return selectionRegion(selected, listed.length > 0 ? 'listed' : 'selected')
  }
  if (kind === 'previous' && input.previous) return previousRegion(input.previous, intent.region.radius_km, notes)
  if (kind === 'place' && intent.region.place) {
    return placeRegion(intent.region.place, intent.region.radius_km, hint, notes, input.view, locality)
  }
  if (kind === 'view') return viewRegion(input.view, notes)
  return pointRegion(input.view, intent.region.radius_km, notes)
}

function selectionRegion(cells: readonly string[], source: 'selected' | 'listed' = 'selected'): ResolvedRegion {
  const center = centroid(cells.map((cell) => cellCenter(cell)))
  const noun = cells.length === 1 ? 'hex' : 'hexes'
  return {
    region: {
      kind: 'selection',
      label: source === 'listed' ? `${cells.length} listed ${noun}` : `${cells.length} selected ${noun}`,
      center,
      radius_km: null,
      polygon: null,
    },
    cells: byDistance(cells, center),
  }
}

function polygonRegion(polygon: GeofencePolygon): ResolvedRegion | ApiError {
  const ring = polygon.coordinates[0]
  const area = ringBboxAreaKm2(ring)
  if (area > MAX_POLYGON_KM2) {
    return { error: `That polygon spans about ${Math.round(area)} km². Keep it under ${MAX_POLYGON_KM2} km².`, status: 400 }
  }
  const center = centroid(ring.slice(0, -1).map(([lng, lat]) => ({ lat, lng })))
  return {
    region: { kind: 'polygon', label: 'Custom polygon', center, radius_km: null, polygon },
    cells: byDistance(cellsForPolygon(polygon), center),
  }
}

function previousRegion(previous: AgentPrevious, radius: number | null, notes: string[]): ResolvedRegion {
  const region = previous.region
  if (radius != null && (region.kind === 'place' || region.kind === 'point')) {
    const km = limitRadius(radius, notes)
    if (km !== region.radius_km) return circleRegion(region.kind, region.label, region.center, km)
  }
  return { region, cells: [...previous.h3_cells] }
}

async function placeRegion(
  place: string,
  radius: number | null,
  hint: LatLng | null,
  notes: string[],
  view: AgentViewContext | null,
  locality: string | null,
): Promise<ResolvedRegion | ApiError> {
  const bias = mapBias(view, locality)
  const hit = await geocodePlace(place, bias)
  let center = hit ? { lat: hit.lat, lng: hit.lng } : null
  if (hit && hint && metersBetween({ lat: hit.lat, lng: hit.lng }, hint) / 1000 > GEOCODE_HINT_KM) {
    notes.push(`I geocoded “${place}” to ${hit.label} instead of the model's coordinates.`)
  } else if (!hit && hint) {
    center = hint
    notes.push(`The geocoder had no match for “${place}”, so I used the model's coordinates.`)
  }
  if (!center) {
    return { error: `I couldn't find “${place}”. Add the city, or select hexes on the map.`, status: 422 }
  }
  const label = hit?.label || place
  if (radius != null) return circleRegion('place', label, center, limitRadius(radius, notes))
  if (hit && hit.spanKm != null && hit.spanKm > LARGE_PLACE_SPAN_KM && hit.bbox && view && pointInBbox(view.center, hit.bbox)) {
    const km = radiusAroundView(view)
    notes.push(
      `${label} is a large area, so I used ${km} km around the map${locality ? ` (near ${locality})` : ''}. Name a neighborhood or give a radius to change it.`,
    )
    return circleRegion('place', label, view.center, km)
  }
  let km = AGENT_DEFAULT_RADIUS_KM
  if (hit?.spanKm != null) {
    const wanted = hit.spanKm * 0.8
    km = round1(Math.min(AGENT_MAX_RADIUS_KM, Math.max(0.8, wanted)))
    if (wanted > AGENT_MAX_RADIUS_KM) {
      notes.push(`${label} is large, so I focused on ${km} km around its center. Give a radius to widen it.`)
    }
  }
  if (hit && isNeighborhoodHit(hit) && km < AGENT_NEIGHBORHOOD_RADIUS_KM) {
    km = AGENT_NEIGHBORHOOD_RADIUS_KM
    notes.push(`I used ${km} km around ${label} to cover the neighborhood. Give a radius to change it.`)
  }
  return circleRegion('place', label, center, km)
}

function isNeighborhoodHit(hit: GeoHit): boolean {
  if (NEIGHBORHOOD_HIT_TYPES.has(hit.type)) return true
  return hit.category === 'landuse' || hit.category === 'place' || hit.category === 'boundary'
}

function radiusAroundView(view: AgentViewContext): number {
  if (!view.bounds) return AGENT_DEFAULT_RADIUS_KM
  const { west, south, east, north } = view.bounds
  const mid = (south + north) / 2
  const width = metersBetween({ lat: mid, lng: west }, { lat: mid, lng: east }) / 2000
  const height = metersBetween({ lat: south, lng: west }, { lat: north, lng: west }) / 2000
  return limitRadius(Math.max(width, height, AGENT_DEFAULT_RADIUS_KM), [])
}

function pointInBbox(point: LatLng, bbox: GeoBbox): boolean {
  return point.lat >= bbox.south && point.lat <= bbox.north && point.lng >= bbox.west && point.lng <= bbox.east
}

function mapBias(view: AgentViewContext | null, locality: string | null): MapBias | null {
  if (!view && !locality) return null
  return {
    center: view?.center ?? null,
    bounds: view?.bounds ?? null,
    zoom: view?.zoom ?? 0,
    locality,
  }
}

function viewRegion(view: AgentViewContext | null, notes: string[]): ResolvedRegion | ApiError {
  if (!view) return { error: 'Open the map so I can read the view.', status: 400 }
  if (view.zoom < MIN_VIEWPORT_ZOOM) return { error: 'Zoom in on an area first, or name a place.', status: 400 }
  if (!view.bounds) return circleRegion('point', 'Map center', view.center, VIEW_FALLBACK_RADIUS_KM)
  const { west, south, east, north } = view.bounds
  const area = bboxAreaKm2(west, south, east, north)
  if (area > WIDE_VIEW_KM2) {
    notes.push(`The view covers about ${Math.round(area)} km², so I used ${VIEW_FALLBACK_RADIUS_KM} km around its center.`)
    return circleRegion('point', 'Map center', view.center, VIEW_FALLBACK_RADIUS_KM)
  }
  const ring: GeoJsonPosition[] = [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ]
  const cells = polygonToCells([ring], H3_RESOLUTION, true)
  return {
    region: { kind: 'view', label: 'Map view', center: view.center, radius_km: null, polygon: null },
    cells: cells.length > 0 ? byDistance(cells, view.center) : [latLngToCell(view.center.lat, view.center.lng, H3_RESOLUTION)],
  }
}

function pointRegion(view: AgentViewContext | null, radius: number | null, notes: string[]): ResolvedRegion | ApiError {
  if (!view) return { error: 'Name a place, select hexes, or open the map first.', status: 400 }
  if (view.zoom < MIN_VIEWPORT_ZOOM) {
    return { error: 'The map is zoomed out too far to pick a center. Name a place or zoom in.', status: 400 }
  }
  const km = radius != null ? limitRadius(radius, notes) : AGENT_DEFAULT_RADIUS_KM
  return circleRegion('point', 'Map center', view.center, km)
}

function circleRegion(kind: 'place' | 'point', label: string, center: LatLng, km: number): ResolvedRegion {
  return {
    region: { kind, label, center, radius_km: km, polygon: circlePolygon(center, km) },
    cells: cellsNear(center, km),
  }
}

function circlePolygon(center: LatLng, km: number): GeofencePolygon {
  const ring: GeoJsonPosition[] = []
  const lngKm = 111.32 * Math.cos((center.lat * Math.PI) / 180)
  for (let index = 0; index < CIRCLE_VERTICES; index += 1) {
    const angle = (index / CIRCLE_VERTICES) * 2 * Math.PI
    ring.push([round6(center.lng + (km / lngKm) * Math.cos(angle)), round6(center.lat + (km / 110.574) * Math.sin(angle))])
  }
  ring.push([ring[0][0], ring[0][1]])
  return { type: 'Polygon', coordinates: [ring] }
}

/** Hexes that touch a circle: centers within radius plus one hex circumradius. */
function cellsNear(center: LatLng, km: number): string[] {
  const origin = latLngToCell(center.lat, center.lng, H3_RESOLUTION)
  const reach = km + HEX_RADIUS_KM
  const rings = Math.ceil(reach / HEX_SPACING_KM) + 1
  return gridDisk(origin, rings)
    .map((cell) => ({ cell, km: metersBetween(center, cellCenter(cell)) / 1000 }))
    .filter((entry) => entry.km <= reach)
    .sort((left, right) => left.km - right.km)
    .map((entry) => entry.cell)
}

/** Interior cells plus every cell the boundary crosses, so thin shapes still get hexes. */
function cellsForPolygon(polygon: GeofencePolygon): string[] {
  const cells = new Set(polygonToCells(polygon.coordinates, H3_RESOLUTION, true))
  const ring = polygon.coordinates[0]
  for (let index = 1; index < ring.length; index += 1) {
    const [lng1, lat1] = ring[index - 1]
    const [lng2, lat2] = ring[index]
    const km = metersBetween({ lat: lat1, lng: lng1 }, { lat: lat2, lng: lng2 }) / 1000
    const steps = Math.max(1, Math.ceil(km / 0.25))
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps
      cells.add(latLngToCell(lat1 + (lat2 - lat1) * t, lng1 + (lng2 - lng1) * t, H3_RESOLUTION))
    }
  }
  return [...cells]
}

function limitRadius(radius: number, notes: string[]): number {
  if (radius > AGENT_MAX_RADIUS_KM) {
    notes.push(`Capped the radius at ${AGENT_MAX_RADIUS_KM} km to keep the run quick.`)
    return AGENT_MAX_RADIUS_KM
  }
  return Math.max(MIN_RADIUS_KM, round1(radius))
}

type GeoBbox = { south: number; north: number; west: number; east: number }
type MapBias = {
  center: LatLng | null
  bounds: AgentViewContext['bounds']
  zoom: number
  locality: string | null
}
type GeoHit = {
  lat: number
  lng: number
  label: string
  displayName: string
  spanKm: number | null
  type: string
  category: string
  importance: number
  bbox: GeoBbox | null
}
const geocodeCache = new Map<string, GeoHit | null>()
const localityCache = new Map<string, string | null>()
const GEOCODER_HEADERS = { accept: 'application/json', 'user-agent': 'WorldPulse-agent/0.1 (hackathon demo data exchange)' }

function geocoderOff(): boolean {
  return serverEnv('AGENT_GEOCODER') === 'off'
}

function searchUrl(): URL {
  return new URL(serverEnv('AGENT_GEOCODER_URL') || 'https://nominatim.openstreetmap.org/search')
}

function reverseUrl(): URL {
  const search = searchUrl().toString()
  return new URL(search.includes('/search') ? search.replace(/\/search\/?(\?.*)?$/, '/reverse') : 'https://nominatim.openstreetmap.org/reverse')
}

async function mapLocality(view: AgentViewContext | null): Promise<string | null> {
  if (!view || geocoderOff()) return null
  const key = `${view.center.lat.toFixed(2)},${view.center.lng.toFixed(2)}`
  if (localityCache.has(key)) return localityCache.get(key) ?? null
  try {
    const url = reverseUrl()
    url.searchParams.set('format', 'jsonv2')
    url.searchParams.set('lat', String(view.center.lat))
    url.searchParams.set('lon', String(view.center.lng))
    url.searchParams.set('zoom', '10')
    const response = await fetch(url, { signal: AbortSignal.timeout(6_000), headers: GEOCODER_HEADERS })
    if (!response.ok) return null
    const row = (await response.json()) as unknown
    if (!isRecord(row)) return null
    const address = isRecord(row.address) ? row.address : {}
    const city =
      stringField(address.city) ??
      stringField(address.town) ??
      stringField(address.village) ??
      stringField(address.municipality) ??
      stringField(address.county)
    const state = stringField(address.state) ?? stringField(address.state_code)
    const label = [city, state].filter(Boolean).join(', ') || null
    if (localityCache.size > 200) localityCache.clear()
    localityCache.set(key, label)
    return label
  } catch {
    return null
  }
}

async function geocodePlace(query: string, bias: MapBias | null): Promise<GeoHit | null> {
  if (geocoderOff()) return null
  const qualified = qualifyPlaceQuery(query, bias)
  const cacheKey = `${qualified.toLowerCase()}|${bias?.locality ?? ''}|${bias?.center ? `${bias.center.lat.toFixed(2)},${bias.center.lng.toFixed(2)}` : ''}`
  if (geocodeCache.has(cacheKey)) return geocodeCache.get(cacheKey) ?? null
  const primary = await nominatimSearch(qualified, bias)
  let hit = pickBestHit(primary, query, bias)
  if ((!hit || scoreHit(hit, query, bias) < 3) && qualified !== query) {
    const bare = await nominatimSearch(query, bias)
    hit = pickBestHit([...primary, ...bare], query, bias)
  }
  if (geocodeCache.size > 200) geocodeCache.clear()
  geocodeCache.set(cacheKey, hit)
  return hit
}

function qualifyPlaceQuery(query: string, bias: MapBias | null): string {
  if (!bias?.locality) return query
  const lower = query.toLowerCase()
  const localityTokens = bias.locality.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 3)
  if (localityTokens.some((token) => lower.includes(token))) return query
  return `${query}, ${bias.locality}`
}

async function nominatimSearch(query: string, bias: MapBias | null): Promise<GeoHit[]> {
  try {
    const url = searchUrl()
    url.searchParams.set('format', 'jsonv2')
    url.searchParams.set('limit', '5')
    url.searchParams.set('addressdetails', '1')
    url.searchParams.set('q', query)
    const box = viewboxFor(bias)
    if (box) {
      url.searchParams.set('viewbox', `${box.west},${box.north},${box.east},${box.south}`)
      url.searchParams.set('bounded', '0')
    }
    const response = await fetch(url, { signal: AbortSignal.timeout(6_000), headers: GEOCODER_HEADERS })
    if (!response.ok) return []
    const rows = (await response.json()) as unknown
    if (!Array.isArray(rows)) return []
    return rows.flatMap((row) => {
      const hit = parseGeoHit(row, query)
      return hit ? [hit] : []
    })
  } catch {
    return []
  }
}

function parseGeoHit(row: unknown, query: string): GeoHit | null {
  if (!isRecord(row)) return null
  const center = latLng(row.lat, row.lon)
  if (!center) return null
  let bbox: GeoBbox | null = null
  let spanKm: number | null = null
  if (Array.isArray(row.boundingbox) && row.boundingbox.length === 4) {
    const [south, north, west, east] = row.boundingbox.map(Number)
    if ([south, north, west, east].every(Number.isFinite)) {
      bbox = { south, north, west, east }
      spanKm = metersBetween({ lat: south, lng: west }, { lat: north, lng: east }) / 2000
    }
  }
  const displayName = typeof row.display_name === 'string' ? row.display_name : query
  const label =
    displayName
      .split(',')
      .slice(0, 3)
      .map((part) => part.trim())
      .filter(Boolean)
      .join(', ') || query
  return {
    ...center,
    label,
    displayName,
    spanKm,
    type: typeof row.type === 'string' ? row.type : typeof row.addresstype === 'string' ? row.addresstype : '',
    category: typeof row.category === 'string' ? row.category : typeof row.class === 'string' ? row.class : '',
    importance: typeof row.importance === 'number' ? row.importance : 0,
    bbox,
  }
}

function pickBestHit(hits: readonly GeoHit[], query: string, bias: MapBias | null): GeoHit | null {
  if (hits.length === 0) return null
  return [...hits].sort((left, right) => scoreHit(right, query, bias) - scoreHit(left, query, bias))[0] ?? null
}

function scoreHit(hit: GeoHit, query: string, bias: MapBias | null): number {
  const queryTokens = query.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 2)
  const name = hit.displayName.toLowerCase()
  const overlap = queryTokens.filter((token) => name.includes(token)).length / Math.max(1, queryTokens.length)
  let score = overlap * 4
  if (bias?.center) {
    const km = metersBetween(bias.center, hit) / 1000
    if (bias.zoom >= 8) {
      if (km < 8) score += 3
      else if (km < 25) score += 1.5
      else if (km < 80) score += 0.4
      else score -= 2
    } else if (km < 80) score += 0.8
  }
  if (bias?.locality) {
    const locTokens = bias.locality.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 3)
    if (locTokens.some((token) => name.includes(token))) score += 2
  }
  if (['neighbourhood', 'suburb', 'quarter', 'city_block', 'pedestrian', 'retail', 'hamlet'].includes(hit.type)) score += 1.5
  else if (['attraction', 'monument', 'yes', 'building', 'park', 'university', 'museum', 'residential'].includes(hit.type)) {
    score += 1.2
  } else if (['city', 'town', 'village', 'municipality'].includes(hit.type)) score += 0.8
  else if (['state', 'administrative', 'country'].includes(hit.type) && (hit.spanKm ?? 0) > 30) score -= 3
  return score + Math.min(1, hit.importance)
}

function viewboxFor(bias: MapBias | null): GeoBbox | null {
  if (!bias?.center) return bias?.bounds ?? null
  return {
    west: bias.center.lng - CITY_VIEWBOX_PAD_DEG,
    east: bias.center.lng + CITY_VIEWBOX_PAD_DEG,
    south: bias.center.lat - CITY_VIEWBOX_PAD_DEG,
    north: bias.center.lat + CITY_VIEWBOX_PAD_DEG,
  }
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

// ---------- query building ----------

function countValues(
  rows: readonly FeatureRow[],
  field: 'category' | 'building_class' | 'operating_status',
): Map<string, number> {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const value = row[field]
    if (!value || value === INSPECT_NULL) continue
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return counts
}

function matchTerms(terms: readonly string[], counts: ReadonlyMap<string, number>): AgentCategoryPick[] {
  const wanted = expandTerms(terms)
  const picks: AgentCategoryPick[] = []
  for (const [value, count] of counts) {
    const lower = value.toLowerCase()
    const tokens = lower.split(/[^a-z0-9]+/).filter(Boolean)
    const hit = wanted.some((term) => {
      if (term.endsWith('*')) return tokens.some((token) => token.startsWith(term.slice(0, -1)))
      if (term.includes(' ') || term.includes('_')) return lower.includes(term.replace(/\s+/g, '_'))
      return tokens.some((token) => token === term || singular(token) === term)
    })
    if (hit) picks.push({ value, count })
  }
  return picks.sort((left, right) => right.count - left.count).slice(0, 16)
}

function expandTerms(terms: readonly string[]): string[] {
  const out = new Set<string>()
  for (const raw of terms) {
    const term = raw.trim().toLowerCase()
    if (!term) continue
    const key = CATEGORY_SYNONYMS[term] ? term : singular(term)
    out.add(key)
    for (const synonym of CATEGORY_SYNONYMS[key] ?? []) out.add(synonym)
  }
  return [...out]
}

function singular(word: string): string {
  if (word.length <= 3) return word
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`
  if (/(?:ch|sh|x|ss)es$/.test(word)) return word.slice(0, -2)
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1)
  return word
}

function presenceFilterKey(field: AgentPresenceField): 'hasPhone' | 'hasEmail' | 'hasSocials' | 'hasOfficialId' {
  if (field === 'phone') return 'hasPhone'
  if (field === 'email') return 'hasEmail'
  if (field === 'socials') return 'hasSocials'
  return 'hasOfficialId'
}

function agentEnrichments(intent: AgentIntent, region: AgentRegion): WorkflowEnrichment[] {
  const steps: unknown[] = []
  if (region.polygon) steps.push({ id: 'geofence', kind: 'geofence', keep: intent.geofence_keep ?? 'inside', polygon: region.polygon })
  if (intent.hail_days != null) {
    const end = new Date().toISOString().slice(0, 10)
    const start = addDay(end, -(Math.min(MAX_HAIL_DAYS, intent.hail_days) - 1))
    steps.push({ id: 'hail_history', kind: 'hail_history', start_date: start < HAIL_MESH_START ? HAIL_MESH_START : start, end_date: end })
  }
  if (intent.ai_column) steps.push({ id: 'ai_column', kind: 'ai_column', ...intent.ai_column })
  return steps.flatMap((step) => {
    const valid = asEnrichment(step)
    return valid ? [valid] : []
  })
}

function sampleRows(rows: readonly FeatureRow[]): FeatureRow[] {
  return [...rows]
    .sort((left, right) => Number(Boolean(right.name)) - Number(Boolean(left.name)) || (right.confidence ?? 0) - (left.confidence ?? 0))
    .slice(0, SAMPLE_ROWS)
}

function intentSubject(intent: AgentIntent): string {
  const terms = intent.category_terms.slice(0, 2).join(' & ')
  if (intent.dataset === 'buildings') return terms ? `${terms} buildings` : 'buildings'
  if (intent.dataset === 'addresses') return 'addresses'
  if (terms) return `${terms} places`
  if (intent.search) return `places matching “${intent.search}”`
  return intent.dataset === 'places' ? 'places' : 'every row'
}

function regionPhrase(region: AgentRegion): string {
  if (region.kind === 'selection') return `your ${region.label}`
  if (region.kind === 'place') return `${region.radius_km} km around ${region.label}`
  if (region.kind === 'point') return `${region.radius_km} km around the map center`
  if (region.kind === 'view') return 'the current map view'
  return 'your polygon'
}

function describePlan(intent: AgentIntent, region: AgentRegion, missing: number): string {
  const steps: string[] = []
  if (missing > 0) steps.push(`process ${missing} new hex${missing === 1 ? '' : 'es'}`)
  if (intent.hail_days != null) steps.push(`add ${intent.hail_days} days of hail history`)
  if (intent.ai_column) steps.push(`score every row into \`${intent.ai_column.column}\``)
  const head = `I'll find ${intentSubject(intent)} in ${regionPhrase(region)}`
  if (steps.length === 0) return `${head}.`
  if (steps.length === 1) return `${head}, then ${steps[0]}.`
  return `${head}, then ${steps.slice(0, -1).join(', ')}, and ${steps[steps.length - 1]}.`
}

function defaultWorkflowName(intent: AgentIntent, region: AgentRegion): string {
  const subject = intentSubject(intent)
  const where = region.kind === 'place' ? region.label : region.kind === 'selection' ? region.label : region.label.toLowerCase()
  return `${subject[0].toUpperCase()}${subject.slice(1)} · ${where}`.slice(0, 60)
}

// ---------- small helpers ----------

function maxNewHexes(): number {
  const raw = Number.parseInt(serverEnv('AGENT_MAX_NEW_HEXES'), 10)
  return Number.isFinite(raw) && raw > 0 ? Math.min(AGENT_MAX_NEW_HEXES, raw) : AGENT_MAX_NEW_HEXES
}

function cellCenter(cell: string): LatLng {
  const [lat, lng] = cellToLatLng(cell)
  return { lat, lng }
}

function byDistance(cells: readonly string[], center: LatLng): string[] {
  return cells
    .map((cell) => ({ cell, distance: metersBetween(center, cellCenter(cell)) }))
    .sort((left, right) => left.distance - right.distance)
    .map((entry) => entry.cell)
}

function centroid(points: readonly LatLng[]): LatLng {
  if (points.length === 0) return { lat: 0, lng: 0 }
  const sum = points.reduce((total, point) => ({ lat: total.lat + point.lat, lng: total.lng + point.lng }), { lat: 0, lng: 0 })
  return { lat: sum.lat / points.length, lng: sum.lng / points.length }
}

function bboxAreaKm2(west: number, south: number, east: number, north: number): number {
  const mid = (south + north) / 2
  const width = metersBetween({ lat: mid, lng: west }, { lat: mid, lng: east }) / 1000
  const height = metersBetween({ lat: south, lng: west }, { lat: north, lng: west }) / 1000
  return width * height
}

function ringBboxAreaKm2(ring: readonly GeoJsonPosition[]): number {
  const lngs = ring.map((point) => point[0])
  const lats = ring.map((point) => point[1])
  return bboxAreaKm2(Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats))
}

function latLng(latValue: unknown, lngValue: unknown): LatLng | null {
  const lat = Number(latValue)
  const lng = Number(lngValue)
  if (latValue == null || lngValue == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null
  return { lat, lng }
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length >= 2 ? text.slice(0, max) : null
}

function cleanRadius(value: unknown): number | null {
  if (value == null) return null
  const km = Number(value)
  if (!Number.isFinite(km) || km <= 0) return null
  return Math.min(50, Math.max(MIN_RADIUS_KM, round1(km)))
}

function cleanConfidence(value: unknown): number | null {
  if (value == null) return null
  const raw = Number(value)
  if (!Number.isFinite(raw) || raw <= 0) return null
  const ratio = raw > 1 ? raw / 100 : raw
  if (ratio >= 0.85) return 0.9
  if (ratio >= 0.65) return 0.7
  return 0.5
}

function cleanDays(value: unknown): number | null {
  if (value == null) return null
  const days = Math.round(Number(value))
  if (!Number.isFinite(days) || days <= 0) return null
  return Math.min(MAX_HAIL_DAYS, days)
}

function isPresenceField(value: unknown): value is AgentPresenceField {
  return typeof value === 'string' && (AGENT_PRESENCE_FIELDS as readonly string[]).includes(value)
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
