import { getResolution, isValidCell, latLngToCell } from 'h3-js'
import { AUSTIN_CENTER, cellPolygon, cellsInView } from '../src/lib/h3.ts'
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

const view = cellsInView({ west: -97.76, south: 30.25, east: -97.72, north: 30.29 }, 13)
assert(view.status === 'ready' && view.ids.length > 0, 'viewport cell lookup failed')
assert(cellsInView({ west: -97.9, south: 30.1, east: -97.6, north: 30.5 }, 8).status === 'zoom-in', 'low zoom should not draw the grid')

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

console.log(
  `verify ok · ${first.cells.length} cells · ${first.totals.places} places · ${first.totals.buildings} buildings · ${first.totals.addresses} addresses`,
)
