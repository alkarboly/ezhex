import { areNeighborCells, cellToChildren, cellToParent, getResolution, gridDisk, isValidCell, latLngToCell } from 'h3-js'
import {
  AUSTIN_CENTER,
  cellPolygon,
  cellsInView,
  diveHexCells,
  diveResolutionForZoom,
  earthFocusCell,
  earthHexCells,
  readyCellsInParents,
  snapshotForDisplayCell,
} from '../src/lib/h3.ts'
import { associateFeatures } from '../src/lib/associate.ts'
import {
  HEX_DROP_DURATION_MS,
  HEX_DROP_HEIGHT_M,
  HEX_DROP_WAVE_MS,
  buildHexDropMesh,
  hexDropElevation,
} from '../src/lib/hex-drop.ts'
import { HEX_LIFT_HEIGHT_M, hexLiftElevation } from '../src/lib/hex-lift.ts'
import { appearDelayMs, appearIsQuiet, appearKind, introDelayMs, shouldFadeOutgoing } from '../src/lib/hex-appear.ts'
import { applyGeofence, applyEnrichments } from '../src/lib/enrichments.ts'
import { defaultInspectFilters, filterFeatureRows, mergeFeatureRows, observedValues } from '../src/lib/feature-rows.ts'
import { hailSummariesByHex, mockHailStats, summarizeHail } from '../src/lib/hail-mesh.ts'
import { compileInspectSql, validateInspectSql } from '../src/lib/inspect-sql.ts'
import { featureRowsToCsv } from '../src/lib/csv.ts'
import { snapshotDate } from '../src/lib/overture-release.ts'
import { parseTaxonomyLabel } from '../src/lib/taxonomy.ts'
import { pointGeometry, simplifyGeometry, squarePolygon } from '../src/lib/geojson.ts'
import { addressLevels, cellForPoint } from '../src/lib/overture.ts'
import { H3_RESOLUTION, MAX_AGENT_HEX_BATCH } from '../src/lib/limits.ts'
import { balancedHexBatches, connectedHexBatches } from '../src/lib/hex-batches.ts'
import { extractHexCells } from '../src/lib/hex-ids.ts'
import { AGENT_SUGGESTIONS } from '../src/lib/agent-capabilities.ts'
import { extractPlace, extractSpan, lookupKnownCity, namesCorridor, namesSelection, placeMentionedInPrompt } from '../src/lib/agent-place.ts'
import { parsePolygonText } from '../src/lib/polygon-input.ts'
import { buildQuerySpec } from '../src/lib/query-builder.ts'
import { buildMockDatabase } from '../src/services/mock/database.ts'
import { mockProvider, resetMockDatabaseForTests } from '../src/services/mock-provider.ts'
import type { AgentPlan, AgentQueryResponse } from '../src/types/agents.ts'
import { defaultAddressesForm, defaultBuildingsForm, defaultPlacesForm } from '../src/types/queries.ts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const first = buildMockDatabase()
const second = buildMockDatabase()
assert(first.cells.length > 200, `expected a city-sized grid, got ${first.cells.length}`)
assert(first.cells.length < 2500, `coverage is too large: ${first.cells.length}`)
assert(first.totals.places === second.totals.places, 'place generation is not stable')
assert(first.totals.buildings === second.totals.buildings, 'building generation is not stable')
assert(first.totals.addresses === second.totals.addresses, 'address generation is not stable')

const capitol = latLngToCell(AUSTIN_CENTER.lat, AUSTIN_CENTER.lng, H3_RESOLUTION)
assert(isValidCell(capitol), 'capitol cell is invalid')
assert(getResolution(capitol) === H3_RESOLUTION, 'capitol cell is not resolution 8')
assert(first.cells.includes(capitol), 'Austin center is outside the mock coverage')
assert(cellForPoint(AUSTIN_CENTER.lat, AUSTIN_CENTER.lng) === capitol, 'Overture point-to-hex drifted')
assert(addressLevels([{ value: 'TX' }, { value: 'Austin' }]).locality === 'Austin', 'address_levels mapping drifted')

const ring = cellPolygon(capitol).coordinates[0]
assert(ring.length >= 4, 'cell ring is too short')
assert(ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1], 'cell ring is not closed')
assert(Math.abs(ring[0][0]) > 90, 'cell boundary is not in longitude-first GeoJSON order')
assert(ring[0][1] > 25 && ring[0][1] < 35, 'cell boundary is not in Austin')

const placeCounts = first.cells.map((cell) => first.places.get(cell)?.length ?? 0)
assert(Math.max(...placeCounts) > Math.min(...placeCounts), 'place counts are flat')

let nullHeight = 0
let tall = 0
let nullSubtype = 0
let nullConfidence = 0
let closed = 0
for (const records of first.buildings.values()) {
  for (const building of records) {
    if (building.height == null) nullHeight += 1
    if (building.height != null && building.height >= 10) tall += 1
    if (building.subtype == null) nullSubtype += 1
  }
}
for (const records of first.places.values()) {
  for (const place of records) {
    assert(latLngToCell(place.lat, place.lng, H3_RESOLUTION) === place.h3, `place ${place.id} left its cell`)
    assert(place.operating_status !== 'permanently_closed' || place.confidence === 0, 'closed place must have confidence 0')
    if (place.confidence == null) nullConfidence += 1
    if (place.operating_status === 'permanently_closed') closed += 1
  }
}
const capitolPlace = first.places.get(capitol)?.[0]
const capitolBuilding = first.buildings.get(capitol)?.[0]
const capitolAddress = first.addresses.get(capitol)?.[0]
assert(capitolPlace?.geometry?.type === 'Point', 'mock place is missing point geometry')
assert(capitolBuilding?.geometry?.type === 'Polygon', 'mock building is missing footprint geometry')
assert(capitolAddress?.geometry?.type === 'Point', 'mock address is missing point geometry')
assert(capitolPlace?.building_id, 'mock place was not linked to a building')
assert(capitolPlace?.address_id, 'mock place was not linked to an address')
assert(capitolBuilding?.address_id, 'mock building was not linked to an address')

const linked = associateFeatures({
  buildings: [{ id: 'b1', lat: 30.2672, lng: -97.7431, geometry: squarePolygon(-97.7431, 30.2672, 0.0003) }],
  addresses: [{ id: 'a1', lat: 30.2672, lng: -97.7431, number: '100', street: 'Congress Ave', postcode: '78701', country: 'US' }],
  places: [
    {
      id: 'p1',
      lat: 30.2672,
      lng: -97.7431,
      place_addresses: [{ number: '100', street: 'Congress Ave', postcode: '78701', country: 'US' }],
    },
  ],
})
assert(linked.places.get('p1')?.building_id === 'b1', 'point-in-polygon building link failed')
assert(linked.places.get('p1')?.address_id === 'a1', 'nested address match failed')
assert(pointGeometry(-97.74, 30.26).type === 'Point', 'point helper drifted')
const fat = squarePolygon(-97.74, 30.26, 0.01)
const slim = simplifyGeometry(fat, 8)
assert(slim?.type === 'Polygon' && slim.coordinates[0].length <= 8, 'geometry simplify did not shrink a ring')

assert(nullHeight > 0 && tall > 0, 'height filters have nothing to distinguish')
assert(nullSubtype > 0, 'subtype presence filter has nothing to distinguish')
assert(nullConfidence > 0 && closed > 0, 'confidence and operating status are not varied')

const sampleCells = first.cells.slice(0, 12)
const cafeExpected = sampleCells.reduce(
  (sum, cell) => sum + (first.places.get(cell) ?? []).filter((place) => place.basic_category === 'cafe').length,
  0,
)
const allExpected = sampleCells.reduce((sum, cell) => sum + (first.places.get(cell)?.length ?? 0), 0)

resetMockDatabaseForTests()
const base = {
  sort: { field: 'names.primary', direction: 'asc' as const },
  limit: 50,
  offset: 0,
}
const allPlaces = await mockProvider.runQuery({
  dataset: 'places',
  h3_cells: sampleCells,
  filters: [],
  ...base,
})
const cafes = await mockProvider.runQuery({
  dataset: 'places',
  h3_cells: sampleCells,
  filters: [{ field: 'basic_category', operator: 'eq', value: 'cafe' }],
  ...base,
})
assert(allPlaces.total === allExpected, `unfiltered total ${allPlaces.total} != ${allExpected}`)
assert(cafes.total === cafeExpected, `cafe total ${cafes.total} != ${cafeExpected}`)
assert(cafes.total < allPlaces.total, 'cafe filter did not reduce the result')
assert(cafes.rows.every((row) => row.values.basic_category === 'cafe'), 'non-cafe row leaked')
assert(cafes.rows.every((row) => row.geometry?.type === 'Point'), 'place query dropped geometry')
const merged = mergeFeatureRows(allPlaces.rows, [], [])
assert(merged.length === allPlaces.rows.length, 'inspect merge dropped place rows')
assert(merged.some((row) => row.kind === 'places'), 'inspect merge lost places')
assert(
  allPlaces.rows.every((row) => typeof row.values.sources === 'string' && String(row.values.sources).length > 0),
  'query rows dropped sources',
)
assert(
  allPlaces.rows.every((row) => typeof row.values.attribution === 'string' && String(row.values.attribution).length > 0),
  'query rows dropped attribution',
)
assert(
  merged.every((row) => row.snapshot.length > 0 && row.sources && row.attribution && row.snapshot_date),
  'inspect merge dropped snapshot, sources, or attribution',
)
assert(snapshotDate('2026-10-21.0') === '2026-10-21', 'snapshot date was not extracted from the release id')
assert(parseTaxonomyLabel('eat_and_drink < restaurant').main === 'eat_and_drink', 'taxonomy main category is not left of <')
assert(parseTaxonomyLabel('eat_and_drink < restaurant').category === 'restaurant', 'taxonomy category is not right of <')
const splitTaxonomy = mergeFeatureRows(
  [
    {
      id: 'p-tax',
      h3: capitol,
      lat: 30.2672,
      lng: -97.7431,
      geometry: pointGeometry(-97.7431, 30.2672),
      release_version: '2026-10-21.0',
      values: { 'names.primary': 'Split Cafe', basic_category: 'cafe', 'taxonomy.primary': 'eat_and_drink < cafe' },
    },
  ],
  [],
  [],
)
assert(splitTaxonomy[0]?.main_category === 'eat_and_drink', 'inspect merge dropped main category')
assert(splitTaxonomy[0]?.category === 'cafe', 'inspect merge dropped taxonomy category')
assert(splitTaxonomy[0]?.snapshot_date === '2026-10-21', 'inspect merge dropped snapshot date')
assert(
  filterFeatureRows(splitTaxonomy, {
    kind: 'all',
    search: '',
    categories: ['cafe'],
    mainCategories: ['eat_and_drink'],
    snapshotDates: ['2026-10-21'],
    statuses: [],
    buildingClasses: [],
    confidenceMin: null,
    confidenceMax: null,
    confidencePresence: 'any',
    underground: 'any',
    hasPhone: 'any',
    hasEmail: 'any',
    hasSocials: 'any',
    hasOfficialId: 'any',
  }).length === 1,
  'inspect filters dropped a matching taxonomy row',
)
assert(
  filterFeatureRows(splitTaxonomy, {
    kind: 'all',
    search: '',
    categories: ['restaurant'],
    mainCategories: [],
    snapshotDates: [],
    statuses: [],
    buildingClasses: [],
    confidenceMin: null,
    confidenceMax: null,
    confidencePresence: 'any',
    underground: 'any',
    hasPhone: 'any',
    hasEmail: 'any',
    hasSocials: 'any',
    hasOfficialId: 'any',
  }).length === 0,
  'inspect category filter leaked a non-matching row',
)
assert(
  filterFeatureRows(splitTaxonomy, { ...defaultInspectFilters, categories: ['null'] }).every((row) => row.category == null),
  'inspect null category filter kept a labeled row',
)
assert(
  filterFeatureRows(splitTaxonomy, { ...defaultInspectFilters, columnFilters: { name: ['not_null'] } }).every(
    (row) => row.name != null && row.name !== '',
  ),
  'inspect column remove-blanks kept an empty name',
)
assert(
  filterFeatureRows(splitTaxonomy, { ...defaultInspectFilters, columnFilters: { category: ['cafe'] } }).every(
    (row) => row.category === 'cafe',
  ),
  'inspect column value filter leaked a non-matching row',
)
assert(
  filterFeatureRows(
    [{ ...splitTaxonomy[0]!, confidence: null }, { ...splitTaxonomy[0]!, id: 'scored', confidence: 0.8 }],
    { ...defaultInspectFilters, confidenceMin: 0.5 },
  ).every((row) => row.confidence != null && row.confidence >= 0.5),
  'inspect confidence floor kept a missing score',
)
const unmatchedPlace = {
  id: 'p-orphan',
  h3: capitol,
  lat: 30.2672,
  lng: -97.7431,
  geometry: pointGeometry(-97.7431, 30.2672),
  release_version: '2026-10-21.0',
  values: { 'names.primary': 'Lone Place', basic_category: 'cafe' },
}
const unmatchedAddress = {
  id: 'a-orphan',
  h3: capitol,
  lat: 30.2673,
  lng: -97.7432,
  geometry: pointGeometry(-97.7432, 30.2673),
  release_version: '2026-10-21.0',
  values: { address: '1 Main St' },
}
const unmatchedBuilding = {
  id: 'b-orphan',
  h3: capitol,
  lat: 30.2674,
  lng: -97.7433,
  geometry: squarePolygon(-97.7433, 30.2674, 0.0002),
  release_version: '2026-10-21.0',
  values: { subtype: 'commercial', 'names.primary': 'Lone Building' },
}
const joined = mergeFeatureRows([unmatchedPlace], [unmatchedBuilding], [unmatchedAddress])
assert(joined.length === 3, 'unmatched place, address, or building was dropped')
assert(joined[0]?.address === null && joined[0]?.building === null, 'unmatched place should keep null links')
assert(joined.some((row) => row.kind === 'addresses' && row.name === null), 'orphan address was dropped')
assert(joined.some((row) => row.kind === 'buildings' && row.address === null), 'orphan building was dropped')
const placeWithBuilding = mergeFeatureRows(
  [{ ...unmatchedPlace, id: 'p-linked', building_id: 'b-orphan', values: { 'names.primary': 'Linked Cafe', basic_category: 'cafe' } }],
  [{ ...unmatchedBuilding, values: { ...unmatchedBuilding.values, height: 12.5, num_floors: 3 } }],
  [],
)
assert(placeWithBuilding.length === 1 && placeWithBuilding[0]?.building === 'Lone Building', 'place did not keep the linked building name')
assert(placeWithBuilding[0]?.height === 12.5 && placeWithBuilding[0]?.floors === 3, 'linked building height or floors were dropped')
assert(observedValues(joined, 'category').join(',') === 'null,cafe,commercial', 'observed categories invented a value')
assert(!observedValues(joined, 'category').includes('restaurant'), 'observed categories leaked a preset')
assert(
  cafes.byCell.reduce((sum, cell) => sum + cell.count, 0) === cafes.total,
  'per-cell counts do not add up',
)

const counts = await mockProvider.getCellCounts({
  dataset: 'places',
  h3_cells: sampleCells,
  filters: [{ field: 'basic_category', operator: 'in', value: ['restaurant', 'cafe'] }],
})
const foodTotal = counts.reduce((sum, cell) => sum + cell.count, 0)
assert(foodTotal > cafes.total, 'restaurant + cafe should exceed cafes alone')
assert(foodTotal < allPlaces.total, 'food filter should not match every place')

const restaurant = [...first.places.values()].flat().find((place) => place.basic_category === 'restaurant')
assert(restaurant, 'missing a restaurant')
const excluded = await mockProvider.runQuery({
  dataset: 'places',
  h3_cells: [restaurant.h3],
  filters: [
    { field: 'basic_category', operator: 'eq', value: 'cafe' },
    { field: 'names.primary', operator: 'contains', value: restaurant.names.primary },
  ],
  ...base,
})
assert(!excluded.rows.some((row) => row.id === restaurant.id), 'AND filter kept a restaurant')

const named = await mockProvider.runQuery({
  dataset: 'places',
  h3_cells: [restaurant.h3],
  filters: [{ field: 'names.primary', operator: 'contains', value: restaurant.names.primary.slice(0, 4).toLowerCase() }],
  ...base,
})
assert(named.rows.some((row) => row.id === restaurant.id), 'name search missed its own place')

const confident = await mockProvider.getCellCounts({
  dataset: 'places',
  h3_cells: sampleCells,
  filters: [{ field: 'confidence', operator: 'gte', value: 0.8 }],
})
const confidentExpected = sampleCells.reduce(
  (sum, cell) =>
    sum +
    (first.places.get(cell) ?? []).filter((place) => place.confidence != null && place.confidence >= 0.8).length,
  0,
)
assert(
  confident.reduce((sum, cell) => sum + cell.count, 0) === confidentExpected,
  'confidence filter does not match raw records',
)

const tallCounts = await mockProvider.getCellCounts({
  dataset: 'buildings',
  h3_cells: sampleCells,
  filters: [{ field: 'height', operator: 'gte', value: 10 }],
})
const tallExpected = sampleCells.reduce(
  (sum, cell) =>
    sum + (first.buildings.get(cell) ?? []).filter((building) => building.height != null && building.height >= 10).length,
  0,
)
const missingHeight = await mockProvider.getCellCounts({
  dataset: 'buildings',
  h3_cells: sampleCells,
  filters: [{ field: 'height', operator: 'is_null' }],
})
const missingExpected = sampleCells.reduce(
  (sum, cell) => sum + (first.buildings.get(cell) ?? []).filter((building) => building.height == null).length,
  0,
)
assert(tallCounts.reduce((sum, cell) => sum + cell.count, 0) === tallExpected, 'height filter drifted')
assert(missingHeight.reduce((sum, cell) => sum + cell.count, 0) === missingExpected, 'missing height filter drifted')

const zip = '78701'
const zipCells = first.cells.filter((cell) => (first.addresses.get(cell) ?? []).some((row) => row.postcode === zip)).slice(0, 8)
assert(zipCells.length > 0, 'no 78701 addresses were generated')
const zips = await mockProvider.runQuery({
  dataset: 'addresses',
  h3_cells: zipCells,
  filters: [{ field: 'postcode', operator: 'eq', value: zip }],
  sort: { field: 'street', direction: 'asc' },
  limit: 20,
  offset: 0,
})
assert(zips.total > 0, 'postal code query returned nothing')
assert(zips.rows.every((row) => row.values.postcode === zip), 'postal code filter leaked another code')

const page = await mockProvider.runQuery({
  dataset: 'places',
  h3_cells: sampleCells,
  filters: [],
  sort: { field: 'names.primary', direction: 'asc' },
  limit: 1,
  offset: 0,
})
const nextPage = await mockProvider.runQuery({
  dataset: 'places',
  h3_cells: sampleCells,
  filters: [],
  sort: { field: 'names.primary', direction: 'asc' },
  limit: 1,
  offset: 1,
})
assert(page.rows[0] && nextPage.rows[0] && page.rows[0].id !== nextPage.rows[0].id, 'pagination returned the same row')
assert(page.total === nextPage.total && page.total > 1, 'pagination lost the total')

let failed = false
try {
  await mockProvider.runQuery({
    dataset: 'places',
    h3_cells: sampleCells,
    filters: [{ field: 'not_a_field', operator: 'eq', value: 'x' }],
    ...base,
  })
} catch {
  failed = true
}
assert(failed, 'unknown field was accepted')

assert(appearKind(new Set(), ['a', 'b']) === 'lay', 'empty previous should lay the first grid')
assert(appearKind(new Set(['a', 'b', 'c']), ['d', 'e', 'f']) === 'swap', 'disjoint hex sets should swap')
assert(appearKind(new Set(['a', 'b', 'c']), ['a', 'b', 'd']) === 'pan', 'mostly overlapping hexes should pan')
assert(appearDelayMs(0, 40, 'lay') === 0, 'center hex should not wait')
assert(appearDelayMs(200, 40, 'lay') === 350, 'five rings at 70ms should delay 350ms')
assert(shouldFadeOutgoing('swap', 1), 'resolution swaps should fade the last grid')
assert(shouldFadeOutgoing('pan', 8), 'enough leaving cells should fade out')
assert(!shouldFadeOutgoing('pan', 2), 'a couple of edge cells should not start a fade')
assert(earthHexCells().length === 842, 'earth mesh should be every resolution-1 cell')
assert(introDelayMs(90) === 0, 'north pole should start the globe wave')
assert(introDelayMs(-90) === 1800, 'south pole should land last on the globe wave')
assert(appearIsQuiet([capitol]), 'city hexes should stay still')
assert(hexDropElevation(0, 90) === HEX_DROP_HEIGHT_M, 'north hexes should start above the sphere')
assert(hexDropElevation(HEX_DROP_DURATION_MS, 90) === 0, 'north hexes should land after their drop')
assert(hexDropElevation(HEX_DROP_WAVE_MS, -90) === HEX_DROP_HEIGHT_M, 'south hexes should still be up when the north wave ends')
assert(hexDropElevation(HEX_DROP_WAVE_MS + HEX_DROP_DURATION_MS, -90) === 0, 'south hexes should land last')
assert(buildHexDropMesh().fillCount > 0, 'drop mesh should triangulate the earth hexes')
assert(diveResolutionForZoom(1.5) === 1, 'orbit zoom should stay on the earth mesh')
assert(diveResolutionForZoom(12.4) === 8, 'city dive should land on resolution 8')
assert(earthFocusCell(AUSTIN_CENTER.lat, AUSTIN_CENTER.lng) === cellToParent(capitol, 1), 'Austin earth hex should be the res-1 parent')
assert(diveHexCells(AUSTIN_CENTER.lat, AUSTIN_CENTER.lng, 1.5).length === 842, 'early dive should keep the earth mesh')
assert(diveHexCells(AUSTIN_CENTER.lat, AUSTIN_CENTER.lng, 12.4).includes(capitol), 'late dive should include the city hex')
assert(hexLiftElevation(0) === 0, 'a city hex should sit on the ground before hover')
assert(hexLiftElevation(1) === HEX_LIFT_HEIGHT_M, 'a hovered city hex should lift off the ground')

const view = cellsInView({ west: -97.76, south: 30.25, east: -97.72, north: 30.29 }, 13)
assert(view.status === 'ready' && view.ids.length > 0, 'viewport cell lookup failed')
assert(view.resolution === 8, 'city zoom should draw resolution 8')
const pulledBack = cellsInView({ west: -97.9, south: 30.1, east: -97.6, north: 30.5 }, 8)
assert(pulledBack.status === 'ready' && pulledBack.ids.length > 0, 'zoomed-out view should still draw hexes')
assert(pulledBack.resolution < 8, 'zoomed-out view should step to a coarser resolution')
const stayed = cellsInView({ west: -97.76, south: 30.25, east: -97.72, north: 30.29 }, 11.1, 8)
assert(stayed.resolution === 8, 'zoom hysteresis should keep resolution 8 across the band edge')
const earth = cellsInView({ west: -120, south: 10, east: -70, north: 50 }, 2)
assert(earth.status === 'zoom-in' && earth.ids.length === 0, 'below the hex floor should be globe, not a coarse grid')
const wide = cellsInView({ west: -130, south: 10, east: -70, north: 50 }, 7)
assert(wide.status === 'zoom-in' && wide.ids.length === 0, 'a continent-sized bounds should not draw parent hexes')
const parent = cellToParent(capitol, 4)
assert(snapshotForDisplayCell(parent, new Map([[capitol, { h3: capitol, status: 'ready', snapshot: 'current', release_version: '2026-10-21.0', job_id: null }]])) === null, 'parent hexes must not inherit a child snapshot')
assert(
  readyCellsInParents([parent], new Map([[capitol, { h3: capitol, status: 'ready', snapshot: 'current', release_version: '2026-10-21.0', job_id: null }]])).includes(capitol),
  'ready res-8 cells under a parent should still be drawn',
)

const compiled = buildQuerySpec({
  dataset: 'places',
  selectedCells: sampleCells.slice(0, 5),
  places: { ...defaultPlacesForm, basicCategories: ['restaurant', 'cafe'] },
  buildings: defaultBuildingsForm,
  addresses: defaultAddressesForm,
  sortField: 'names.primary',
  sortDirection: 'asc',
  limit: 100,
  page: 0,
  resultsSearch: '',
})
assert(compiled.errors.length === 0, compiled.errors.join(' '))
assert(compiled.spec.filters[0]?.field === 'basic_category', 'query spec lost the category filter')
assert(compiled.spec.filters[0]?.operator === 'in', 'category filter should use in')
assert(compiled.spec.dataset === 'places', 'query spec dataset drifted')

process.env.DATA_MODE = 'mock'
const { routeApi } = await import('../src/server/api.ts')
const health = await routeApi('GET', '/api/health', undefined)
assert(health.status === 200 && isRecord(health.body) && health.body.ok === true, 'health check failed')
const authSession = await routeApi('GET', '/api/auth/session', undefined)
assert(authSession.status === 200 && isRecord(authSession.body), 'auth session failed')
assert(authSession.body.user === null, 'verify should start signed out')
assert(typeof authSession.body.configured === 'boolean', 'auth configured flag is missing')
const badSignup = await routeApi('POST', '/api/auth/signup', { email: 'nope', password: 'short' })
assert(badSignup.status === 400, 'auth accepted a weak signup')
const deleteAnon = await routeApi('POST', '/api/auth/delete', { password: 'password1', confirm: 'DELETE' })
assert(deleteAnon.status === 401 || deleteAnon.status === 503, 'anon delete should not succeed')
const servedCounts = await routeApi('POST', '/api/cell-counts', {
  dataset: 'places',
  h3_cells: sampleCells,
  filters: [],
})
assert(servedCounts.status === 200 && Array.isArray(servedCounts.body), 'server cell counts failed')
assert(servedCounts.body.length === sampleCells.length, 'server cell counts drifted')
const rejected = await routeApi('POST', '/api/query', { dataset: 'places' })
assert(rejected.status === 400, 'server accepted a partial query')
const schemas = await routeApi('GET', '/api/query-schemas', undefined)
assert(schemas.status === 200 && isRecord(schemas.body), 'query schema route failed')
assert(Array.isArray(schemas.body.datasets) && schemas.body.datasets.length >= 3, 'query schemas are missing datasets')
assert(typeof schemas.body.query_enabled === 'boolean', 'query schema capabilities are missing')
const placesSchema = Array.isArray(schemas.body.datasets)
  ? schemas.body.datasets.find((dataset) => isRecord(dataset) && dataset.id === 'places')
  : null
assert(
  isRecord(placesSchema) &&
    Array.isArray(placesSchema.fields) &&
    placesSchema.fields.some((field) => isRecord(field) && field.field === 'release_version') &&
    placesSchema.fields.some((field) => isRecord(field) && field.field === 'snapshot_date') &&
    placesSchema.fields.some((field) => isRecord(field) && field.field === 'main_category') &&
    placesSchema.fields.some((field) => isRecord(field) && field.field === 'sources') &&
    placesSchema.fields.some((field) => isRecord(field) && field.field === 'attribution'),
  'places schema is missing snapshot, sources, or attribution',
)
const ingestLimits = await routeApi('GET', '/api/workflow-ingestion/limits', undefined)
assert(ingestLimits.status === 200 && isRecord(ingestLimits.body), 'workflow ingestion limits failed')
assert(ingestLimits.body.max_hexes === 20, 'workflow max hex cap drifted')
assert(ingestLimits.body.max_rows_per_dataset === 8000, 'ingest row cap should stay small for the web process')
assert(ingestLimits.body.max_total_rows === 20000, 'ingest total cap should stay small for the web process')
assert(typeof ingestLimits.body.default_release_version === 'string', 'default Overture release is missing')
const ingestPlan = await routeApi('POST', '/api/workflow-ingestion/plan', {
  release_version: '2026-09-24.0',
  h3_cells: [sampleCells[0]],
})
assert(ingestPlan.status === 200 && isRecord(ingestPlan.body), 'workflow ingestion plan failed')
assert(Array.isArray(ingestPlan.body.h3_cells) && ingestPlan.body.h3_cells.length === 1, 'workflow plan lost hexes')
assert(
  isRecord(ingestPlan.body.bbox) && typeof ingestPlan.body.bbox.area_km2 === 'number',
  'workflow plan bbox is missing',
)
const createdJob = await routeApi('POST', '/api/workflow-ingestion/jobs', {
  release_version: '2026-09-24.0',
  h3_cells: [sampleCells[0]],
})
assert(createdJob.status === 200 && isRecord(createdJob.body), 'ingestion job create failed')
assert(createdJob.body.status === 'succeeded', 'mock-covered hexes should resolve as ready')
assert(typeof createdJob.body.id === 'string', 'ingestion job id is missing')
const fetchedJob = await routeApi('GET', `/api/workflow-ingestion/jobs/${createdJob.body.id}`)
assert(
  fetchedJob.status === 200 && isRecord(fetchedJob.body) && fetchedJob.body.id === createdJob.body.id,
  'created ingestion job was missing on GET',
)
assert(Array.isArray(createdJob.body.logs) && createdJob.body.logs.length > 0, 'ready job has no logs')
assert(
  createdJob.body.logs.every(
    (line) =>
      isRecord(line) &&
      typeof line.at === 'string' &&
      (line.level === 'info' || line.level === 'warn' || line.level === 'error') &&
      typeof line.message === 'string',
  ),
  'job log shape drifted',
)
assert(
  createdJob.body.logs.some((line) => isRecord(line) && String(line.message).includes('Created')),
  'create log missing',
)
const createdAgain = await routeApi('POST', '/api/workflow-ingestion/jobs', {
  release_version: '2026-09-24.0',
  h3_cells: [sampleCells[0]],
})
assert(createdAgain.status === 200 && isRecord(createdAgain.body), 'ingestion job idempotence failed')
assert(createdAgain.body.id === createdJob.body.id, 'duplicate jobs were created for the same hex set')
const listedJobs = await routeApi('GET', '/api/workflow-ingestion/jobs', undefined)
assert(listedJobs.status === 200 && Array.isArray(listedJobs.body), 'ingestion job list failed')
assert(listedJobs.body.some((job) => isRecord(job) && job.id === createdJob.body.id), 'created job is missing from the list')
const hexStatus = await routeApi('POST', '/api/hex-status', { h3_cells: [sampleCells[0]] })
assert(hexStatus.status === 200 && isRecord(hexStatus.body), 'hex status failed')
assert(hexStatus.body.ready_count === 1, 'capitol hex should be ready in mock mode')
assert(hexStatus.body.current_count === 1, 'capitol hex should be on the current snapshot')
assert(typeof hexStatus.body.current_release_version === 'string', 'current release is missing')
assert(
  Array.isArray(hexStatus.body.cells) &&
    isRecord(hexStatus.body.cells[0]) &&
    hexStatus.body.cells[0].snapshot === 'current',
  'capitol hex snapshot drifted',
)
const outside = latLngToCell(31.2, -97.74, H3_RESOLUTION)
assert(!first.cells.includes(outside), 'outside cell leaked into Austin coverage')
const outsideJob = await routeApi('POST', '/api/workflow-ingestion/jobs', {
  release_version: '2026-09-24.0',
  h3_cells: [outside],
})
assert(outsideJob.status === 200 && isRecord(outsideJob.body), 'outside hex job failed')
assert(outsideJob.body.status === 'succeeded', 'local mock ingest should run without Spark')
assert(typeof outsideJob.body.rows_total === 'number' && outsideJob.body.rows_total > 0, 'local ingest wrote no rows')
assert(
  Array.isArray(outsideJob.body.logs) &&
    outsideJob.body.logs.some((line) => isRecord(line) && String(line.message).includes('Mock ingest')),
  'outside job missing mock ingest log',
)
const ranAgain = await routeApi('POST', `/api/workflow-ingestion/jobs/${outsideJob.body.id}/run`, {})
assert(ranAgain.status === 200 && isRecord(ranAgain.body) && ranAgain.body.status === 'succeeded', 'job rerun failed')
const outsideStatus = await routeApi('POST', '/api/hex-status', { h3_cells: [outside] })
assert(outsideStatus.status === 200 && isRecord(outsideStatus.body), 'outside hex status failed')
assert(outsideStatus.body.ready_count === 1, 'ingested hex should be ready')
assert(outsideStatus.body.stale_count === 1, 'older-release ingest should be a stale snapshot')
assert(
  Array.isArray(outsideStatus.body.cells) &&
    isRecord(outsideStatus.body.cells[0]) &&
    outsideStatus.body.cells[0].snapshot === 'stale',
  'outside hex should be stale against the current Overture release',
)
const outsideCounts = await routeApi('POST', '/api/cell-counts', {
  dataset: 'places',
  h3_cells: [outside],
  filters: [],
})
assert(outsideCounts.status === 200 && Array.isArray(outsideCounts.body), 'ingested hex counts failed')
assert(
  isRecord(outsideCounts.body[0]) && typeof outsideCounts.body[0].count === 'number' && outsideCounts.body[0].count > 0,
  'ingested hex has no mock places',
)
const currentQuery = await routeApi('POST', '/api/query', {
  dataset: 'places',
  h3_cells: [sampleCells[0]],
  filters: [],
  sort: { field: 'names.primary', direction: 'asc' },
  limit: 10,
  offset: 0,
})
assert(currentQuery.status === 200 && isRecord(currentQuery.body), 'current release query failed')
assert(typeof currentQuery.body.total === 'number' && currentQuery.body.total > 0, 'current release query returned no rows')
assert(
  Array.isArray(currentQuery.body.rows) &&
    isRecord(currentQuery.body.rows[0]) &&
    currentQuery.body.rows[0].release_version === hexStatus.body.current_release_version,
  'query rows are missing release_version',
)
const staleCapitol = await routeApi('POST', '/api/query', {
  dataset: 'places',
  h3_cells: [sampleCells[0]],
  filters: [],
  sort: { field: 'names.primary', direction: 'asc' },
  limit: 10,
  offset: 0,
  release_version: '2026-09-24.0',
})
assert(staleCapitol.status === 200 && isRecord(staleCapitol.body) && staleCapitol.body.total === 0, 'capitol should not have the older release')
const staleOutside = await routeApi('POST', '/api/query', {
  dataset: 'places',
  h3_cells: [outside],
  filters: [],
  sort: { field: 'names.primary', direction: 'asc' },
  limit: 10,
  offset: 0,
  release_version: '2026-09-24.0',
})
assert(staleOutside.status === 200 && isRecord(staleOutside.body) && staleOutside.body.total > 0, 'historical query missed the older snapshot')
const releases = await routeApi('GET', '/api/releases', undefined)
assert(releases.status === 200 && isRecord(releases.body) && Array.isArray(releases.body.snapshots), 'release catalog failed')
assert(
  releases.body.snapshots.some((row) => isRecord(row) && row.release_version === hexStatus.body.current_release_version && row.current === true),
  'current snapshot is missing from metadata',
)
assert(
  releases.body.snapshots.some((row) => isRecord(row) && row.release_version === '2026-09-24.0' && row.current === false),
  'older processed snapshot is missing from metadata',
)

const generatedSql = compileInspectSql([capitol, sampleCells[1] ?? capitol], {
  ...defaultInspectFilters,
  categories: ['cafe'],
  mainCategories: ['eat_and_drink'],
  confidenceMin: 0.2,
})
assert(generatedSql.includes('SELECT'), 'inspect SQL is not a SELECT')
assert(generatedSql.includes(capitol), 'inspect SQL dropped the hex')
assert(generatedSql.includes("'cafe'"), 'inspect SQL dropped the category filter')
assert(generatedSql.includes('eat_and_drink'), 'inspect SQL dropped the main category filter')
assert(generatedSql.includes('places.confidence >= 0.2'), 'inspect SQL dropped the confidence floor')
assert(!generatedSql.includes('OR places.confidence IS NULL'), 'inspect SQL floor still kept missing scores')
assert(validateInspectSql(generatedSql.replace(/^--.*$/gm, '').trim()) === null, 'generated inspect SQL should be valid once comments are removed')
assert(validateInspectSql('INSERT INTO overture_places (id) VALUES (1)') !== null, 'inspect SQL accepted a write')
assert(validateInspectSql('SELECT * FROM profiles') !== null, 'inspect SQL accepted a non-overture table')
const csv = featureRowsToCsv(splitTaxonomy)
assert(csv.includes('Main category'), 'inspect CSV dropped the main category column')
assert(csv.includes('Split Cafe'), 'inspect CSV dropped the place name')

const emptyWorkflows = await routeApi('GET', '/api/query-workflows', undefined)
assert(emptyWorkflows.status === 200 && isRecord(emptyWorkflows.body) && Array.isArray(emptyWorkflows.body.workflows), 'query workflow list failed')
assert(emptyWorkflows.body.limit === 5, 'query workflow cap is not 5')
for (let index = 0; index < 5; index += 1) {
  const created = await routeApi('POST', '/api/query-workflows', {
    name: `Inspect ${index + 1}`,
    sql: generatedSql,
    custom_sql: false,
    h3_cells: [capitol, sampleCells[1] ?? capitol],
    filters: { ...defaultInspectFilters, categories: ['cafe'] },
  })
  assert(created.status === 200 && isRecord(created.body) && typeof created.body.id === 'string', `query workflow ${index + 1} failed to save`)
}
const sixth = await routeApi('POST', '/api/query-workflows', {
  name: 'Inspect 6',
  sql: generatedSql,
  custom_sql: false,
  h3_cells: [capitol],
  filters: defaultInspectFilters,
})
assert(sixth.status === 400 && isRecord(sixth.body) && sixth.body.error === 'Workflow limit is 5.', 'query workflow cap leaked a sixth save')
const listedWorkflows = await routeApi('GET', '/api/query-workflows', undefined)
assert(
  listedWorkflows.status === 200 &&
    isRecord(listedWorkflows.body) &&
    Array.isArray(listedWorkflows.body.workflows) &&
    listedWorkflows.body.workflows.length === 5 &&
    listedWorkflows.body.remaining === 0,
  'query workflow list did not stay at 5',
)
const firstSaved = listedWorkflows.body.workflows[0]
assert(isRecord(firstSaved) && Array.isArray(firstSaved.h3_cells) && firstSaved.h3_cells.includes(capitol), 'saved workflow dropped nationwide hexes')
const opened = await routeApi('GET', `/api/query-workflows/${firstSaved.id}`, undefined)
assert(opened.status === 200 && isRecord(opened.body) && opened.body.id === firstSaved.id, 'saved workflow could not be reopened')
const removed = await routeApi('DELETE', `/api/query-workflows/${firstSaved.id}`, undefined)
assert(removed.status === 200, 'saved workflow could not be deleted')
const afterDelete = await routeApi('GET', '/api/query-workflows', undefined)
assert(
  afterDelete.status === 200 && isRecord(afterDelete.body) && Array.isArray(afterDelete.body.workflows) && afterDelete.body.workflows.length === 4,
  'deleted workflow is still listed',
)

const fence = squarePolygon(AUSTIN_CENTER.lng, AUSTIN_CENTER.lat, 0.02)
assert(fence.type === 'Polygon', 'geofence fixture is not a polygon')
const insideRow = splitTaxonomy[0]
assert(insideRow, 'taxonomy fixture missing')
const fencedOut = applyGeofence([insideRow], {
  id: 'geofence',
  kind: 'geofence',
  keep: 'outside',
  polygon: fence,
})
assert(fencedOut.length === 0, 'geofence keep-outside leaked an inside point')
const fencedIn = applyGeofence([insideRow], {
  id: 'geofence',
  kind: 'geofence',
  keep: 'inside',
  polygon: fence,
})
assert(fencedIn.length === 1, 'geofence keep-inside dropped an inside point')
const hailStats = mockHailStats([capitol], '2024-05-01', '2024-05-03')
assert(hailStats.length === 3, 'mock hail did not emit one 12Z day row per day')
assert(hailStats.every((row) => row.source_key?.includes('120000')), 'mock hail used a non-12Z key')
const hailSummary = summarizeHail(hailStats)
assert(hailSummary[0]?.h3 === capitol, 'hail summary dropped the hex')
const hailed = applyEnrichments(splitTaxonomy, [{ id: 'hail_history', kind: 'hail_history', start_date: '2024-05-01', end_date: '2024-05-03' }], hailSummariesByHex(hailSummary))
assert(hailed[0] && typeof hailed[0].hail_days === 'number', 'hail enrichment did not attach hail_days')

const hailApi = await routeApi('POST', '/api/enrichments/hail', {
  h3_cells: [capitol],
  start_date: '2026-10-21',
  end_date: '2026-10-23',
})
assert(hailApi.status === 200 && isRecord(hailApi.body) && Array.isArray(hailApi.body.cells), 'hail enrich API failed')
assert(hailApi.body.source === 'NOAA MRMS MESH_Max_1440min', 'hail enrich API lost the MESH source')
assert(hailApi.body.days === 3, 'hail enrich API did not keep one file per day')

const remaining = afterDelete.body.workflows[0]
assert(isRecord(remaining) && typeof remaining.id === 'string', 'remaining workflow is missing')
const patched = await routeApi('PATCH', `/api/query-workflows/${remaining.id}`, {
  enrichments: [
    { id: 'geofence', kind: 'geofence', keep: 'inside', polygon: fence },
    { id: 'hail_history', kind: 'hail_history', start_date: '2024-05-01', end_date: '2024-05-03' },
    {
      id: 'ai_column',
      kind: 'ai_column',
      column: 'broker_flag',
      value_type: 'bool',
      prompt: 'Is this row likely useful for lead brokering?',
      source_fields: ['name', 'category', 'address'],
    },
  ],
})
assert(patched.status === 200 && isRecord(patched.body) && Array.isArray(patched.body.enrichments) && patched.body.enrichments.length === 3, 'workflow enrichments did not save')
const renamed = await routeApi('PATCH', `/api/query-workflows/${remaining.id}`, { name: 'Capitol inspect' })
assert(renamed.status === 200 && isRecord(renamed.body) && renamed.body.name === 'Capitol inspect', 'workflow name did not save')
const subscribed = await routeApi('PATCH', `/api/query-workflows/${remaining.id}`, { subscribe_new_data: true })
assert(subscribed.status === 200 && isRecord(subscribed.body) && subscribed.body.subscribe_new_data === true, 'workflow subscribe flag did not save')
const sqlPatched = await routeApi('PATCH', `/api/query-workflows/${remaining.id}`, {
  sql: generatedSql,
  custom_sql: true,
})
assert(sqlPatched.status === 200 && isRecord(sqlPatched.body) && sqlPatched.body.custom_sql === true, 'workflow SQL did not save')
const emptyPatch = await routeApi('PATCH', `/api/query-workflows/${remaining.id}`, {})
assert(emptyPatch.status === 400, 'empty workflow patch was accepted')
const checkedNew = await routeApi('POST', `/api/query-workflows/${remaining.id}/check-new-data`, {})
assert(
  checkedNew.status === 200 &&
    isRecord(checkedNew.body) &&
    checkedNew.body.subscribe_new_data === true &&
    typeof checkedNew.body.message === 'string' &&
    checkedNew.body.message.includes('Checked'),
  'workflow new-data check failed',
)
const quoted = await routeApi('POST', `/api/query-workflows/${remaining.id}/quote`, {})
assert(quoted.status === 200 && isRecord(quoted.body), 'workflow quote failed')
assert(Array.isArray(quoted.body.lines) && quoted.body.lines.length >= 2, 'workflow quote returned no lines')
const assistDraft = await routeApi('POST', '/api/agent-assist/draft', {
  h3_cells: [capitol, sampleCells[1] ?? capitol],
  enrichments: [],
  prompt: 'Use buildings only, keep outside the geofence, use 90 day hail history, and add a numeric ai score column',
})
assert(assistDraft.status === 200 && isRecord(assistDraft.body), 'agent assist draft failed')
assert(Array.isArray(assistDraft.body.enrichments) && assistDraft.body.enrichments.length >= 3, 'agent assist did not populate enrichments')
assert(isRecord(assistDraft.body.filters) && assistDraft.body.filters.kind === 'buildings', 'agent assist prompt did not configure dataset')
assert(typeof assistDraft.body.sql === 'string' && assistDraft.body.sql.includes('SELECT'), 'agent assist did not build inspect SQL')
const promptGeofence = Array.isArray(assistDraft.body.enrichments)
  ? assistDraft.body.enrichments.find((step) => isRecord(step) && step.kind === 'geofence')
  : null
assert(isRecord(promptGeofence) && promptGeofence.keep === 'outside', 'agent assist prompt did not set geofence keep outside')
const promptAi = Array.isArray(assistDraft.body.enrichments)
  ? assistDraft.body.enrichments.find((step) => isRecord(step) && step.kind === 'ai_column')
  : null
assert(isRecord(promptAi) && promptAi.value_type === 'number', 'agent assist prompt did not set a numeric ai column')
const addonsOff = await routeApi('POST', '/api/agent-assist/draft', {
  h3_cells: [capitol],
  enrichments: [],
  prompt: 'Coffee shops in these hexes',
})
assert(addonsOff.status === 200 && isRecord(addonsOff.body) && Array.isArray(addonsOff.body.enrichments), 'agent assist draft without add-ons failed')
assert(
  !addonsOff.body.enrichments.some((step) => isRecord(step) && step.kind === 'hail_history'),
  'agent assist added hail when it was not requested',
)
assert(
  !addonsOff.body.enrichments.some((step) => isRecord(step) && step.kind === 'ai_column'),
  'agent assist added AI enhance when it was not requested',
)
const assistQuote = await routeApi('POST', '/api/agent-assist/quote', {
  h3_cells: [capitol],
  enrichments: assistDraft.body.enrichments,
})
assert(assistQuote.status === 200 && isRecord(assistQuote.body), 'agent assist quote failed')
assert(Array.isArray(assistQuote.body.lines) && assistQuote.body.lines.length > 0, 'agent assist quote has no lines')
const ran = await routeApi('POST', `/api/query-workflows/${remaining.id}/run`, {})
assert(ran.status === 200 && isRecord(ran.body) && ran.body.status === 'succeeded', 'workflow run failed')
assert(typeof ran.body.row_count === 'number', 'workflow run dropped the row count')
assert(ran.body.snapshot_status === 'current', 'capitol workflow should already have the latest snapshot')
assert(
  Array.isArray(ran.body.logs) &&
    ran.body.logs.some((line) => isRecord(line) && String(line.message).includes('agent quote')),
  'workflow run did not include agent quote logs',
)
assert(Array.isArray(ran.body.rows), 'workflow run rows payload is missing')
if (ran.body.rows.length > 0) {
  assert(
    isRecord(ran.body.rows[0]) &&
      isRecord(ran.body.rows[0].ai_columns) &&
      'broker_flag' in ran.body.rows[0].ai_columns,
    'workflow run did not include ai_column values',
  )
}
const ledger = await routeApi('GET', '/api/ledger', undefined)
assert(ledger.status === 200 && isRecord(ledger.body), 'ledger route failed')
assert(Array.isArray(ledger.body.entries) && ledger.body.entries.length > 0, 'ledger has no entries after workflow run')

const capitolCheck = await routeApi('POST', '/api/hex-snapshots/check', { h3_cells: [capitol] })
assert(capitolCheck.status === 200 && isRecord(capitolCheck.body), 'hex snapshot check failed')
assert(capitolCheck.body.processed_count === 1 && capitolCheck.body.current_count === 1, 'capitol snapshot check lost first process')
assert(
  Array.isArray(capitolCheck.body.cells) &&
    isRecord(capitolCheck.body.cells[0]) &&
    capitolCheck.body.cells[0].first_release_version === hexStatus.body.current_release_version,
  'capitol first snapshot is not the seed release',
)
const outsideCheck = await routeApi('POST', '/api/hex-snapshots/check', { h3_cells: [outside] })
assert(outsideCheck.status === 200 && isRecord(outsideCheck.body) && outsideCheck.body.stale_count === 1, 'outside hex should be stale before a workflow run')
const fresh = latLngToCell(40.7128, -74.006, H3_RESOLUTION)
const freshCheck = await routeApi('POST', '/api/hex-snapshots/check', { h3_cells: [fresh] })
assert(freshCheck.status === 200 && isRecord(freshCheck.body) && freshCheck.body.missing_count === 1, 'unprocessed hex should have no snapshot')

const staleWorkflow = await routeApi('POST', '/api/query-workflows', {
  name: 'Historize outside',
  sql: generatedSql,
  custom_sql: false,
  h3_cells: [outside],
  filters: defaultInspectFilters,
})
assert(staleWorkflow.status === 200 && isRecord(staleWorkflow.body) && typeof staleWorkflow.body.id === 'string', 'stale hex workflow failed to save')
const historized = await routeApi('POST', `/api/query-workflows/${staleWorkflow.body.id}/run`, {})
assert(historized.status === 200 && isRecord(historized.body) && historized.body.status === 'succeeded', 'historize run failed')
assert(historized.body.snapshot_status === 'current', 'workflow run did not save the latest snapshot')
assert(Array.isArray(historized.body.historized_hexes) && historized.body.historized_hexes.includes(outside), 'workflow run did not historize the processed hex')
const outsideAfter = await routeApi('POST', '/api/hex-snapshots/check', { h3_cells: [outside] })
assert(outsideAfter.status === 200 && isRecord(outsideAfter.body) && outsideAfter.body.current_count === 1, 'historize did not record the latest snapshot')
const historicalStill = await routeApi('POST', '/api/query', {
  dataset: 'places',
  h3_cells: [outside],
  filters: [],
  sort: { field: 'names.primary', direction: 'asc' },
  limit: 10,
  offset: 0,
  release_version: '2026-09-24.0',
})
assert(historicalStill.status === 200 && isRecord(historicalStill.body) && historicalStill.body.total > 0, 'historize overwrote the first snapshot')

const pinned = await routeApi('PATCH', `/api/query-workflows/${staleWorkflow.body.id}`, { release_version: '2026-09-24.0' })
assert(pinned.status === 200 && isRecord(pinned.body) && pinned.body.release_version === '2026-09-24.0', 'historical pin did not save')
const historicalRun = await routeApi('POST', `/api/query-workflows/${staleWorkflow.body.id}/run`, {})
assert(historicalRun.status === 200 && isRecord(historicalRun.body) && historicalRun.body.snapshot_status === 'historical', 'historical workflow run missed the pin')

const tooOld = await routeApi('PATCH', `/api/query-workflows/${remaining.id}`, { release_version: '2026-09-24.0' })
assert(tooOld.status === 200, 'capitol historical pin failed to save')
const tooOldRun = await routeApi('POST', `/api/query-workflows/${remaining.id}/run`, {})
assert(tooOldRun.status === 400 && isRecord(tooOldRun.body), 'capitol accepted a snapshot from before first process')

await routeApi('DELETE', `/api/query-workflows/${staleWorkflow.body.id}`, undefined)
const unprocessedWorkflow = await routeApi('POST', '/api/query-workflows', {
  name: 'Unprocessed hex',
  sql: generatedSql,
  custom_sql: false,
  h3_cells: [fresh],
  filters: defaultInspectFilters,
})
assert(unprocessedWorkflow.status === 200 && isRecord(unprocessedWorkflow.body), 'unprocessed hex workflow failed to save')
const unprocessedRun = await routeApi('POST', `/api/query-workflows/${unprocessedWorkflow.body.id}/run`, {})
assert(
  unprocessedRun.status === 200 && isRecord(unprocessedRun.body) && unprocessedRun.body.status === 'succeeded',
  'unprocessed hex workflow run should auto-process and succeed',
)
assert(
  Array.isArray(unprocessedRun.body.logs) &&
    unprocessedRun.body.logs.some((line) => isRecord(line) && String(line.message).includes('agent run process')),
  'workflow run logs did not include process-agent lines',
)

const disk = gridDisk(capitol, 2)
const diskBatches = balancedHexBatches(disk, MAX_AGENT_HEX_BATCH)
assert(diskBatches.length === disk.length, `19 hexes should split into 19 agent jobs, got ${diskBatches.length}`)
assert(diskBatches.every((batch) => batch.length === 1), 'agent job processed more than one hex')
assert(diskBatches.flat().length === disk.length && new Set(diskBatches.flat()).size === disk.length, 'agent batches lost hexes')
assert(
  diskBatches.every((batch) => batch.length === 1 || batch.every((cell) => batch.some((other) => areNeighborCells(cell, other)))),
  'agent batch is not contiguous',
)
assert(connectedHexBatches([], MAX_AGENT_HEX_BATCH).length === 0, 'empty agent batch input produced batches')
assert(parsePolygonText('POLYGON((-97.745 30.265, -97.735 30.265, -97.735 30.275, -97.745 30.265))')?.type === 'Polygon', 'WKT polygon did not parse')
assert(parsePolygonText('[[-97.745,30.265],[-97.735,30.265],[-97.735,30.275]]')?.coordinates[0].length === 4, 'bare ring did not close')

const savedOpenAiKeys = { OPENAI_API_KEY: process.env.OPENAI_API_KEY, OPENAI_AGENT_API_KEY: process.env.OPENAI_AGENT_API_KEY }
process.env.OPENAI_API_KEY = ''
process.env.OPENAI_AGENT_API_KEY = ''
process.env.AGENT_GEOCODER = 'off'
const cafeCells = first.cells
  .filter((cell) => (first.places.get(cell) ?? []).some((place) => place.basic_category === 'cafe'))
  .slice(0, 4)
const { loadInspectRows } = await import('../src/server/workflow-runs.ts')
const cafeRows = await loadInspectRows(cafeCells, null)
assert(cafeRows.some((row) => row.kind === 'places' && row.category === 'cafe'), 'workflow inspect rows mixed up the themes')
assert(cafeRows.some((row) => row.kind === 'buildings' && row.building_class !== null), 'workflow inspect rows lost building classes')
const coffeePrompt = 'Coffee shops in my selected hexes with 30 days of hail history'
const selectionPlan = await routeApi('POST', '/api/agent/plan', { prompt: coffeePrompt, selection: cafeCells })
assert(selectionPlan.status === 200 && isRecord(selectionPlan.body), `agent selection plan failed: ${JSON.stringify(selectionPlan.body)}`)
const coffeePlan = selectionPlan.body as unknown as AgentPlan
assert(coffeePlan.region.kind === 'selection' && coffeePlan.h3_cells.length === cafeCells.length, 'agent plan drifted from the selection')
assert(coffeePlan.intent.dataset === 'places' && coffeePlan.intent.category_terms.length > 0, 'agent plan missed the coffee ask')
assert(coffeePlan.intent.hail_days === 30, 'agent plan missed the hail window')
assert(coffeePlan.missing.length === 0 && coffeePlan.batches.length === 0, 'covered hexes should not need processing')
const noHailPlan = await routeApi('POST', '/api/agent/plan', {
  prompt: 'Coffee shops in my selected hexes',
  selection: cafeCells,
  weather: false,
})
assert(noHailPlan.status === 200 && isRecord(noHailPlan.body), `agent plan without weather failed: ${JSON.stringify(noHailPlan.body)}`)
assert((noHailPlan.body as unknown as AgentPlan).intent.hail_days == null, 'agent plan added hail when it was not requested')
const spanPlanRes = await routeApi('POST', '/api/agent/plan', {
  prompt: 'Help me find commercial properties along I-35 between Austin and Buda, Texas',
  view: { center: { lat: 30.2672, lng: -97.7431 }, bounds: null, zoom: 11 },
})
assert(spanPlanRes.status === 200 && isRecord(spanPlanRes.body), `I-35 Austin–Buda plan failed: ${JSON.stringify(spanPlanRes.body)}`)
const spanPlan = spanPlanRes.body as unknown as AgentPlan
assert(spanPlan.region.kind === 'place' && spanPlan.region.label.includes('Interstate 35'), 'I-35 Austin–Buda plan missed the span')
assert(spanPlan.h3_cells.length > 20, `I-35 Austin–Buda plan kept too few hexes: ${spanPlan.h3_cells.length}`)
assert(lookupKnownCity('Austin')?.name === 'Austin, TX', 'known city pin missed Austin')
assert(lookupKnownCity('Dallas')?.name === 'Dallas, TX', 'known city pin missed Dallas')
assert(lookupKnownCity('Houston')?.name === 'Houston, TX', 'known city pin missed Houston')
assert(lookupKnownCity('Buda, Texas')?.name === 'Buda, TX', 'known city pin missed Buda')
assert(lookupKnownCity('Dallas before Austin')?.name === 'Dallas, TX', 'known city pin preferred the first city in the text')
const dallasPlanRes = await routeApi('POST', '/api/agent/plan', {
  prompt: 'find hexes in Dallas',
  view: { center: { lat: 30.2672, lng: -97.7431 }, bounds: null, zoom: 14 },
})
assert(dallasPlanRes.status === 200 && isRecord(dallasPlanRes.body), `Dallas plan failed: ${JSON.stringify(dallasPlanRes.body)}`)
const dallasPlan = dallasPlanRes.body as unknown as AgentPlan
assert(
  Math.abs(dallasPlan.region.center.lat - 32.7767) < 0.3 && Math.abs(dallasPlan.region.center.lng + 96.797) < 0.3,
  `Dallas plan stayed in Austin: ${JSON.stringify(dallasPlan.region)}`,
)
const houstonPlanRes = await routeApi('POST', '/api/agent/plan', {
  prompt: 'find hexes in Houston',
  view: { center: { lat: 30.2672, lng: -97.7431 }, bounds: null, zoom: 14 },
})
assert(houstonPlanRes.status === 200 && isRecord(houstonPlanRes.body), `Houston plan failed: ${JSON.stringify(houstonPlanRes.body)}`)
const houstonPlan = houstonPlanRes.body as unknown as AgentPlan
assert(
  Math.abs(houstonPlan.region.center.lat - 29.7604) < 0.3 && Math.abs(houstonPlan.region.center.lng + 95.3698) < 0.3,
  `Houston plan stayed in Austin: ${JSON.stringify(houstonPlan.region)}`,
)
const trailPlanRes = await routeApi('POST', '/api/agent/plan', {
  prompt: 'find hexes along tiffany trail in richardson texas',
  view: { center: { lat: 30.2672, lng: -97.7431 }, bounds: null, zoom: 14 },
})
assert(
  trailPlanRes.status === 422,
  `named city corridor should not fall back to Austin when the geocoder is off: ${JSON.stringify(trailPlanRes.body)}`,
)
process.env.AGENT_GEOCODER = ''
const liveTrailRes = await routeApi('POST', '/api/agent/plan', {
  prompt: 'find hexes along tiffany trail in richardson texas',
  view: { center: { lat: 30.2672, lng: -97.7431 }, bounds: null, zoom: 14 },
})
process.env.AGENT_GEOCODER = 'off'
if (liveTrailRes.status === 200 && isRecord(liveTrailRes.body)) {
  const liveTrail = liveTrailRes.body as unknown as AgentPlan
  assert(
    Math.abs(liveTrail.region.center.lat - 32.95) < 0.4 && Math.abs(liveTrail.region.center.lng + 96.73) < 0.5,
    `Tiffany Trail corridor stayed in Austin: ${JSON.stringify(liveTrail.region)}`,
  )
} else {
  assert(
    liveTrailRes.status === 422,
    `named city corridor should miss closed, not land in Austin: ${JSON.stringify(liveTrailRes.body)}`,
  )
}

const listedHex = cafeCells[0] ?? capitol
const listedNeighbor = cafeCells[1] ?? gridDisk(listedHex, 1)[1]
assert(extractHexCells(`use ${listedHex.toUpperCase()} and 0x${listedNeighbor}`).includes(listedHex), 'hex list parser missed a pasted id')
assert(extractPlace('Coffee shops downtown Austin') === 'Downtown Austin, TX', 'place parser missed downtown Austin')
assert(extractPlace('hail risk near the capitol') === 'Texas State Capitol, Austin, TX', 'place parser missed the capitol')
assert(extractPlace('restaurants around South Congress') === 'South Congress Avenue, Austin, TX', 'place parser missed South Congress')
assert(extractPlace('coffee shops westgate') === 'Westgate, Austin, TX', 'place parser missed Westgate')
assert(extractPlace('Coffee shops in Westgate') === 'Westgate, Austin, TX', 'place parser missed in Westgate')
assert(
  extractPlace('Help me search for commercial properties in the westgate neighborhood in austin tx') ===
    'Westgate, Austin, TX',
  'place parser missed conversational Westgate',
)
assert(extractPlace('help me find coffee along south lamar') === 'South Lamar Boulevard, Austin, TX', 'place parser missed along South Lamar')
assert(namesCorridor('Help me find coffee shops along South Lamar'), 'along South Lamar should be a corridor')
assert(namesCorridor('find hexes on South Lamar'), 'on South Lamar should be a corridor')
assert(namesCorridor('highlight Mopac'), 'naming Mopac should be a corridor')
assert(namesCorridor('coffee on South Congress'), 'on South Congress should be a corridor')
assert(!namesCorridor('Help me search for commercial properties in the westgate neighborhood in austin tx'), 'Westgate should not be a corridor')
assert(extractPlace('find restaurants along I-35') === 'Interstate 35, Austin, TX', 'place parser missed along I-35')
assert(extractPlace('find hexes in Dallas') === 'Dallas', 'place parser missed Dallas')
assert(extractPlace('find hexes in Houston') === 'Houston', 'place parser missed Houston')
assert(
  extractPlace('find hexes along tiffany trail in richardson texas') === 'tiffany trail, richardson texas',
  'place parser dropped the named city from a corridor',
)
assert(
  extractPlace('coffee along South Lamar in Houston, TX') === 'South Lamar Boulevard, Houston, TX',
  'known Austin road overrode a named city',
)
assert(
  extractPlace('I-35 between Austin and Buda, Texas') === 'Interstate 35 between Austin and Buda, Texas',
  'place parser missed I-35 between Austin and Buda',
)
assert(extractSpan('I-35 between Austin and Buda, Texas')?.road === 'Interstate 35', 'span parser missed the I-35 road')
assert(extractSpan('I-35 between Austin and Buda, Texas')?.from === 'Austin', 'span parser missed Austin')
assert(extractSpan('I-35 between Austin and Buda, Texas')?.to === 'Buda, Texas', 'span parser missed Buda')
assert(extractSpan('score each as a lead from 0 to 100') == null, 'span parser treated a score range as a place')
assert(AGENT_SUGGESTIONS.length === 3, 'agent examples must stay at 3')
assert(AGENT_SUGGESTIONS[0].includes('Westgate'), 'first example should be the Westgate neighborhood')
assert(AGENT_SUGGESTIONS[1].includes('South Lamar'), 'second example should be along South Lamar')
assert(AGENT_SUGGESTIONS[2].includes('I-35'), 'third example should be I-35 between Austin and Buda')
assert(extractSpan('between Austin and Buda')?.road == null, 'span parser invented a road for a loose area')
assert(extractSpan('between Austin and Buda')?.from === 'Austin', 'span parser missed a loose area from')
assert(extractSpan('between Austin and Buda')?.to === 'Buda', 'span parser missed a loose area to')
assert(extractPlace('Coffee shops in my selected hexes') === null, 'place parser treated selected hexes as a place')
assert(namesSelection('Coffee shops in my selected hexes'), 'selection phrase was not detected')
assert(placeMentionedInPrompt('Texas State Capitol, Austin, TX', 'coffee near the capitol'), 'capitol mention was not recognized')
assert(!placeMentionedInPrompt('Austin, Texas', 'coffee shops'), 'unmentioned city should not count as a place')
const listedPlanRes = await routeApi('POST', '/api/agent/plan', {
  prompt: `Coffee shops in ${listedHex} ${listedNeighbor}`,
})
assert(listedPlanRes.status === 200 && isRecord(listedPlanRes.body), `agent listed-hex plan failed: ${JSON.stringify(listedPlanRes.body)}`)
const listedPlan = listedPlanRes.body as unknown as AgentPlan
assert(listedPlan.region.kind === 'selection', 'agent did not treat pasted hexes as a selection')
assert(
  listedPlan.h3_cells.includes(listedHex) && listedPlan.h3_cells.includes(listedNeighbor) && listedPlan.h3_cells.length === 2,
  'agent drifted from the pasted hex list',
)
const child = cellToChildren(listedHex, H3_RESOLUTION + 1)[0]
const childPlanRes = await routeApi('POST', '/api/agent/plan', { prompt: `Buildings in ${child}` })
assert(childPlanRes.status === 200 && isRecord(childPlanRes.body), `agent child-hex plan failed: ${JSON.stringify(childPlanRes.body)}`)
const childPlan = childPlanRes.body as unknown as AgentPlan
assert(childPlan.h3_cells.length === 1 && childPlan.h3_cells[0] === listedHex, 'finer pasted hex did not snap to resolution 8')

const namedOverSel = await routeApi('POST', '/api/agent/plan', {
  prompt: 'Coffee shops downtown Austin',
  selection: cafeCells,
})
assert(namedOverSel.status === 200 && isRecord(namedOverSel.body), `named Austin place failed: ${JSON.stringify(namedOverSel.body)}`)
const namedPlan = namedOverSel.body as unknown as AgentPlan
assert(namedPlan.region.kind === 'place' && /austin/i.test(namedPlan.region.label), 'named place did not stay on Austin')
assert(
  namedPlan.h3_cells.length !== cafeCells.length || cafeCells.some((cell) => !namedPlan.h3_cells.includes(cell)),
  'named place reused leftover selected hexes',
)

const draftAi = {
  id: 'ai_column',
  kind: 'ai_column',
  column: 'broker_flag',
  value_type: 'bool',
  prompt: 'Is this a broker lead?',
  source_fields: ['name', 'category'],
}
const draftAiPlanRes = await routeApi('POST', '/api/agent/plan', {
  prompt: 'Coffee shops',
  selection: cafeCells,
  enrichments: [draftAi],
})
assert(draftAiPlanRes.status === 200 && isRecord(draftAiPlanRes.body), `agent did not keep the Add-ons AI column: ${JSON.stringify(draftAiPlanRes.body)}`)
const draftAiPlan = draftAiPlanRes.body as unknown as AgentPlan
assert(draftAiPlan.intent.ai_column?.column === 'broker_flag', 'Add-ons AI column was dropped from the plan')
assert(/broker_flag/.test(draftAiPlan.reply), 'plan reply did not mention the Add-ons AI column')
const skipAiPlanRes = await routeApi('POST', '/api/agent/plan', {
  prompt: 'Coffee shops without scoring',
  selection: cafeCells,
  enrichments: [draftAi],
})
assert(skipAiPlanRes.status === 200 && isRecord(skipAiPlanRes.body), `agent skip-AI plan failed: ${JSON.stringify(skipAiPlanRes.body)}`)
assert((skipAiPlanRes.body as unknown as AgentPlan).intent.ai_column == null, 'agent kept the AI column after the prompt dropped it')
const implicitSel = await routeApi('POST', '/api/agent/plan', { prompt: 'Coffee shops', selection: cafeCells })
assert(implicitSel.status === 200 && isRecord(implicitSel.body), `agent implicit selection plan failed: ${JSON.stringify(implicitSel.body)}`)
const implicitPlan = implicitSel.body as unknown as AgentPlan
assert(
  implicitPlan.region.kind === 'selection' && implicitPlan.h3_cells.length === cafeCells.length,
  'agent ignored the current map selection when no area was named',
)

const square = squarePolygon(AUSTIN_CENTER.lng, AUSTIN_CENTER.lat, 0.008)
const polygonPlanRes = await routeApi('POST', '/api/agent/plan', { prompt: 'Restaurants inside my polygon with high confidence', polygon: square })
assert(polygonPlanRes.status === 200 && isRecord(polygonPlanRes.body), `agent polygon plan failed: ${JSON.stringify(polygonPlanRes.body)}`)
const polygonPlan = polygonPlanRes.body as unknown as AgentPlan
const fenceQueryRes = await routeApi('POST', '/api/agent/query', {
  prompt: 'Coffee shops',
  h3_cells: implicitPlan.h3_cells,
  intent: implicitPlan.intent,
  region: implicitPlan.region,
  enrichments: [{ id: 'geofence', kind: 'geofence', keep: 'inside', polygon: square }],
})
assert(fenceQueryRes.status === 200 && isRecord(fenceQueryRes.body), `agent query dropped the Add-ons polygon: ${JSON.stringify(fenceQueryRes.body)}`)
assert(
  (fenceQueryRes.body as unknown as AgentQueryResponse).enrichments.some((step) => step.kind === 'geofence'),
  'selection query did not keep the Add-ons geofence',
)
assert(polygonPlan.region.kind === 'polygon' && polygonPlan.region.polygon, 'agent polygon plan lost the polygon')
assert(polygonPlan.h3_cells.length > 1 && polygonPlan.h3_cells.includes(capitol), 'agent did not derive hexes from the polygon')
assert((polygonPlan.intent.confidence_min ?? 0) >= 0.5, 'agent polygon plan missed the confidence ask')

const pointPlanRes = await routeApi('POST', '/api/agent/plan', {
  prompt: 'Hotels around the map center',
  view: { center: { lat: 31.2, lng: -97.74 }, bounds: null, zoom: 14 },
})
assert(pointPlanRes.status === 200 && isRecord(pointPlanRes.body), `agent point plan failed: ${JSON.stringify(pointPlanRes.body)}`)
const pointPlan = pointPlanRes.body as unknown as AgentPlan
assert(pointPlan.region.kind === 'point' && pointPlan.h3_cells.length > 1, 'agent point plan did not build a circle of hexes')
assert(pointPlan.missing.length > 0, 'hexes outside coverage should be missing')
assert(
  pointPlan.batches.every((batch) => batch.length <= MAX_AGENT_HEX_BATCH) && pointPlan.batches.flat().length === pointPlan.missing.length,
  'agent point plan batches drifted from the missing hexes',
)

const agentQueryRes = await routeApi('POST', '/api/agent/query', {
  prompt: coffeePrompt,
  h3_cells: coffeePlan.h3_cells,
  intent: coffeePlan.intent,
  region: coffeePlan.region,
})
assert(agentQueryRes.status === 200 && isRecord(agentQueryRes.body), `agent query failed: ${JSON.stringify(agentQueryRes.body)}`)
const coffeeQuery = agentQueryRes.body as unknown as AgentQueryResponse
assert(
  coffeeQuery.categories.some((pick) => pick.value === 'cafe' && pick.count > 0),
  `agent query did not pick the cafe category: ${JSON.stringify({ terms: coffeePlan.intent.category_terms, picked: coffeeQuery.categories, notes: coffeeQuery.notes, filters: coffeeQuery.filters })}`,
)
assert(coffeeQuery.matched_rows > 0 && coffeeQuery.matched_rows < coffeeQuery.total_rows, 'agent query did not narrow the rows')
assert(validateInspectSql(coffeeQuery.sql.replace(/^--.*$/gm, '').trim()) === null, 'agent query SQL is invalid')
assert(coffeeQuery.enrichments.some((enrichment) => enrichment.kind === 'hail_history'), 'agent query dropped hail history')
assert(coffeeQuery.hail_window !== null && coffeeQuery.quote.total_usd_cents > 0, 'agent query is missing the hail window or quote')
const badAgentQuery = await routeApi('POST', '/api/agent/query', { prompt: 'x', h3_cells: [], intent: {}, region: {} })
assert(badAgentQuery.status === 400, 'agent query accepted an empty request')
for (const [name, value] of Object.entries(savedOpenAiKeys)) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

console.log(
  `verify ok · ${first.cells.length} cells · ${first.totals.places} places · ${first.totals.buildings} buildings · ${first.totals.addresses} addresses`,
)
