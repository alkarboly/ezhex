import { cellToParent, getResolution, isValidCell, latLngToCell } from 'h3-js'
import {
  AUSTIN_CENTER,
  cellPolygon,
  cellsInView,
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
import { appearDelayMs, appearIsQuiet, appearKind, introDelayMs, shouldFadeOutgoing } from '../src/lib/hex-appear.ts'
import { mergeFeatureRows, observedValues } from '../src/lib/feature-rows.ts'
import { pointGeometry, simplifyGeometry, squarePolygon } from '../src/lib/geojson.ts'
import { addressLevels, cellForPoint } from '../src/lib/overture.ts'
import { H3_RESOLUTION } from '../src/lib/limits.ts'
import { buildQuerySpec } from '../src/lib/query-builder.ts'
import { buildMockDatabase } from '../src/services/mock/database.ts'
import { mockProvider, resetMockDatabaseForTests } from '../src/services/mock-provider.ts'
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
const unmatchedPlace = {
  id: 'p-orphan',
  h3: capitol,
  lat: 30.2672,
  lng: -97.7431,
  geometry: pointGeometry(-97.7431, 30.2672),
  values: { 'names.primary': 'Lone Place', basic_category: 'cafe' },
}
const unmatchedAddress = {
  id: 'a-orphan',
  h3: capitol,
  lat: 30.2673,
  lng: -97.7432,
  geometry: pointGeometry(-97.7432, 30.2673),
  values: { address: '1 Main St' },
}
const unmatchedBuilding = {
  id: 'b-orphan',
  h3: capitol,
  lat: 30.2674,
  lng: -97.7433,
  geometry: squarePolygon(-97.7433, 30.2674, 0.0002),
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
assert(observedValues(joined, 'category').join(',') === 'cafe,commercial', 'observed categories invented a value')
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

console.log(
  `verify ok · ${first.cells.length} cells · ${first.totals.places} places · ${first.totals.buildings} buildings · ${first.totals.addresses} addresses`,
)
