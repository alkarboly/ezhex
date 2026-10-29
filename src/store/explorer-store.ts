import { getResolution, gridDisk, latLngToCell } from 'h3-js'
import { create } from 'zustand'
import { closedRing } from '../lib/enrichments'
import { defaultInspectFilters, type InspectFilters } from '../lib/feature-rows'
import type { GeoJsonPosition } from '../lib/geojson'
import { AUSTIN_CENTER, type ViewportStatus } from '../lib/h3'
import { DEFAULT_QUERY_LIMIT, H3_RESOLUTION, MAX_GEOFENCE_VERTICES, MAX_SELECTED_CELLS } from '../lib/limits'
import type { GeofenceKeep, HailHexSummary, WorkflowEnrichment } from '../types/enrichments'
import { defaultSort, type DatasetId } from '../types/datasets'
import {
  defaultAddressesForm,
  defaultBuildingsForm,
  defaultPlacesForm,
  type AddressesForm,
  type BuildingsForm,
  type PlacesForm,
} from '../types/queries'

export type BasemapId = 'streets' | 'satellite'
export type ExampleId = 'places-food' | 'buildings-tall' | 'addresses-postcode'
/** lens: cells appear around the cursor (or map center on touch). grid: every cell in view. */
export type HexMode = 'lens' | 'grid' | 'off'
export type SheetSnap = 'peek' | 'half' | 'full'
/** `cells` frames those hexes instead of the selection. */
export type FitRequest = { nonce: number; zoomIn: boolean; cells?: readonly string[] }
export type MobileTab = 'query' | 'results'
export type DrawMode = 'off' | 'geofence'
export type InspectReplay = {
  nonce: number
  workflowId: string | null
  workflowName: string | null
  filters: InspectFilters
  sql: string
  customSql: boolean
  releaseVersion: string | null
}

type ExplorerState = {
  dataset: DatasetId
  selectedCells: string[]
  selectionMode: boolean
  hexMode: HexMode
  basemap: BasemapId
  sheetSnap: SheetSnap
  mobileTab: MobileTab
  filtersByDataset: {
    places: PlacesForm
    buildings: BuildingsForm
    addresses: AddressesForm
  }
  sortField: string
  sortDirection: 'asc' | 'desc'
  limit: number
  page: number
  resultsSearch: string
  resultsOpen: boolean
  resultsHeight: number
  filtersOpen: boolean
  viewportCellIds: string[]
  viewportResolution: number
  viewportStatus: ViewportStatus
  /** Drawn cell at the middle of the unobstructed map area (under the reticle on touch). */
  centerCell: string | null
  focus: { h3: string; nonce: number } | null
  /** Request to frame the selection. Without zoomIn the camera only pans, or zooms out to fit. */
  fit: FitRequest
  notice: string | null
  inspectOpen: boolean
  inspectFilters: InspectFilters
  /** Query setting: frame every included hex so the map shows coverage. */
  queryHexPreview: boolean
  inspectPosition: { x: number; y: number }
  inspectReplay: InspectReplay | null
  draftEnrichments: WorkflowEnrichment[]
  drawMode: DrawMode
  geofenceDraft: GeoJsonPosition[]
  enrichOpen: boolean
  hailSummaries: HailHexSummary[]
  inspectRelease: string | null
  setDataset: (dataset: DatasetId) => void
  toggleCell: (h3: string, shiftKey: boolean) => void
  clearSelection: () => void
  selectVisible: () => void
  setSelectionMode: (selectionMode: boolean) => void
  setHexMode: (hexMode: HexMode) => void
  setBasemap: (basemap: BasemapId) => void
  setSheetSnap: (sheetSnap: SheetSnap) => void
  setMobileTab: (mobileTab: MobileTab) => void
  resetFilters: () => void
  patchPlaces: (patch: Partial<PlacesForm>) => void
  patchBuildings: (patch: Partial<BuildingsForm>) => void
  patchAddresses: (patch: Partial<AddressesForm>) => void
  toggleBasicCategory: (category: string) => void
  toggleSubtype: (subtype: string) => void
  setSort: (field: string) => void
  setLimit: (limit: number) => void
  setPage: (page: number) => void
  setResultsSearch: (resultsSearch: string) => void
  setResultsOpen: (resultsOpen: boolean) => void
  setResultsHeight: (resultsHeight: number) => void
  setFiltersOpen: (filtersOpen: boolean) => void
  setViewportCells: (viewportCellIds: string[], viewportStatus: ViewportStatus, viewportResolution: number) => void
  setCenterCell: (centerCell: string | null) => void
  focusCell: (h3: string) => void
  zoomToSelected: () => void
  applyExample: (example: ExampleId) => void
  dismissNotice: () => void
  setNotice: (notice: string | null) => void
  setInspectOpen: (inspectOpen: boolean) => void
  setInspectFilters: (inspectFilters: InspectFilters) => void
  patchInspectFilters: (patch: Partial<InspectFilters>) => void
  setQueryHexPreview: (queryHexPreview: boolean) => void
  previewQueryHexes: () => void
  exitQuery: () => void
  setInspectPosition: (inspectPosition: { x: number; y: number }) => void
  previewWorkflow: (input: {
    id: string
    name: string
    h3_cells: readonly string[]
    filters: InspectFilters
    sql: string
    custom_sql: boolean
    enrichments?: WorkflowEnrichment[]
    release_version?: string | null
  }) => void
  setInspectRelease: (inspectRelease: string | null) => void
  clearWorkflowPreview: () => void
  setDraftEnrichments: (draftEnrichments: WorkflowEnrichment[]) => void
  upsertDraftEnrichment: (enrichment: WorkflowEnrichment) => void
  removeDraftEnrichment: (id: string) => void
  setDrawMode: (drawMode: DrawMode) => void
  addGeofenceVertex: (lng: number, lat: number) => void
  undoGeofenceVertex: () => void
  closeGeofence: (keep: GeofenceKeep) => void
  clearGeofenceDraft: () => void
  setEnrichOpen: (enrichOpen: boolean) => void
  setHailSummaries: (hailSummaries: HailHexSummary[]) => void
  applyAgentQuery: (input: {
    h3_cells: readonly string[]
    filters: InspectFilters
    sql: string
    enrichments: WorkflowEnrichment[]
    notes?: readonly string[]
    workflowName?: string
    openInspect?: boolean
    openEnrich?: boolean
    fit?: boolean
    notice?: string | null
  }) => void
  /** Agent selection without a notice, so the map can fill in hex by hex. */
  revealCells: (cells: readonly string[]) => void
  fitToCells: (cells: readonly string[]) => void
}

const initialSort = defaultSort('places')

function createExplorerStore() {
  return create<ExplorerState>((set, get) => ({
  dataset: 'places',
  selectedCells: [],
  selectionMode: false,
  hexMode: 'lens',
  basemap: 'streets',
  sheetSnap: 'peek',
  mobileTab: 'query',
  filtersByDataset: {
    places: defaultPlacesForm,
    buildings: defaultBuildingsForm,
    addresses: defaultAddressesForm,
  },
  sortField: initialSort.field,
  sortDirection: initialSort.direction,
  limit: DEFAULT_QUERY_LIMIT,
  page: 0,
  resultsSearch: '',
  resultsOpen: true,
  resultsHeight: 320,
  filtersOpen: true,
  viewportCellIds: [],
  viewportResolution: H3_RESOLUTION,
  viewportStatus: 'idle',
  centerCell: null,
  focus: null,
  fit: { nonce: 0, zoomIn: true },
  notice: null,
  inspectOpen: false,
  inspectFilters: defaultInspectFilters,
  queryHexPreview: false,
  inspectPosition: { x: 420, y: 72 },
  inspectReplay: null,
  draftEnrichments: [],
  drawMode: 'off',
  geofenceDraft: [],
  enrichOpen: false,
  hailSummaries: [],
  inspectRelease: null,
  setDataset: (dataset) => {
    const sort = defaultSort(dataset)
    set({
      dataset,
      page: 0,
      resultsSearch: '',
      sortField: sort.field,
      sortDirection: sort.direction,
      notice: null,
    })
  },
  toggleCell: (h3, shiftKey) => {
    const state = get()
    const additive = shiftKey || state.selectionMode
    if (!additive) {
      set({ selectedCells: [h3], page: 0, notice: null })
      return
    }
    if (state.selectedCells.includes(h3)) {
      set({
        selectedCells: state.selectedCells.filter((cell) => cell !== h3),
        page: 0,
      })
      return
    }
    if (state.selectedCells.length >= MAX_SELECTED_CELLS) {
      set({ notice: `Selection is limited to ${MAX_SELECTED_CELLS} cells.` })
      return
    }
    set({ selectedCells: [...state.selectedCells, h3], page: 0, notice: null })
  },
  clearSelection: () => set({ selectedCells: [], page: 0, notice: null }),
  selectVisible: () => {
    const state = get()
    if (state.viewportStatus !== 'ready' || state.viewportCellIds.length === 0) {
      set({ notice: 'Zoom in until H3 cells are on the map.' })
      return
    }
    const visible = state.viewportCellIds.filter((cell) => {
      try {
        return getResolution(cell) === H3_RESOLUTION
      } catch {
        return false
      }
    })
    if (visible.length === 0) {
      set({ notice: 'Zoom in to select individual resolution-8 hexes.' })
      return
    }
    const next = visible.slice(0, MAX_SELECTED_CELLS)
    set({
      selectedCells: next,
      page: 0,
      notice:
        state.viewportCellIds.length > next.length
          ? `Selected ${next.length} of ${state.viewportCellIds.length} visible cells.`
          : `Selected ${next.length} visible cells.`,
    })
  },
  setSelectionMode: (selectionMode) => set({ selectionMode }),
  setHexMode: (hexMode) => set({ hexMode }),
  setBasemap: (basemap) => set({ basemap }),
  setSheetSnap: (sheetSnap) => set({ sheetSnap }),
  setMobileTab: (mobileTab) => set({ mobileTab }),
  resetFilters: () =>
    set((state) => ({
      page: 0,
      resultsSearch: '',
      filtersByDataset: {
        ...state.filtersByDataset,
        [state.dataset]:
          state.dataset === 'places'
            ? defaultPlacesForm
            : state.dataset === 'buildings'
              ? defaultBuildingsForm
              : defaultAddressesForm,
      },
    })),
  patchPlaces: (patch) =>
    set((state) => ({
      page: 0,
      filtersByDataset: {
        ...state.filtersByDataset,
        places: { ...state.filtersByDataset.places, ...patch },
      },
    })),
  patchBuildings: (patch) =>
    set((state) => ({
      page: 0,
      filtersByDataset: {
        ...state.filtersByDataset,
        buildings: { ...state.filtersByDataset.buildings, ...patch },
      },
    })),
  patchAddresses: (patch) =>
    set((state) => ({
      page: 0,
      filtersByDataset: {
        ...state.filtersByDataset,
        addresses: { ...state.filtersByDataset.addresses, ...patch },
      },
    })),
  toggleBasicCategory: (category) =>
    set((state) => {
      const current = state.filtersByDataset.places.basicCategories
      const basicCategories = current.includes(category)
        ? current.filter((entry) => entry !== category)
        : [...current, category]
      return {
        page: 0,
        filtersByDataset: {
          ...state.filtersByDataset,
          places: { ...state.filtersByDataset.places, basicCategories },
        },
      }
    }),
  toggleSubtype: (subtype) =>
    set((state) => {
      const current = state.filtersByDataset.buildings.subtypes
      const subtypes = current.includes(subtype)
        ? current.filter((entry) => entry !== subtype)
        : [...current, subtype]
      return {
        page: 0,
        filtersByDataset: {
          ...state.filtersByDataset,
          buildings: { ...state.filtersByDataset.buildings, subtypes },
        },
      }
    }),
  setSort: (field) =>
    set((state) => {
      if (state.sortField === field) {
        return { sortDirection: state.sortDirection === 'asc' ? 'desc' : 'asc', page: 0 }
      }
      const numeric = field === 'height' || field === 'num_floors' || field === 'confidence'
      return { sortField: field, sortDirection: numeric ? 'desc' : 'asc', page: 0 }
    }),
  setLimit: (limit) => set({ limit, page: 0 }),
  setPage: (page) => set({ page }),
  setResultsSearch: (resultsSearch) => set({ resultsSearch, page: 0 }),
  setResultsOpen: (resultsOpen) => set({ resultsOpen }),
  setResultsHeight: (resultsHeight) => set({ resultsHeight }),
  setFiltersOpen: (filtersOpen) => set({ filtersOpen }),
  setViewportCells: (viewportCellIds, viewportStatus, viewportResolution) => {
    const current = get()
    if (
      current.viewportStatus === viewportStatus &&
      current.viewportResolution === viewportResolution &&
      current.viewportCellIds.length === viewportCellIds.length &&
      current.viewportCellIds.every((cell, index) => cell === viewportCellIds[index])
    ) {
      return
    }
    set({ viewportCellIds, viewportStatus, viewportResolution })
  },
  setCenterCell: (centerCell) => set({ centerCell }),
  focusCell: (h3) =>
    set((state) => ({ focus: { h3, nonce: (state.focus?.nonce ?? 0) + 1 } })),
  zoomToSelected: () => {
    if (get().selectedCells.length === 0) {
      set({ notice: 'Select at least one H3 cell to zoom.' })
      return
    }
    set((state) => ({ fit: { nonce: state.fit.nonce + 1, zoomIn: true } }))
  },
  applyExample: (example) => {
    const state = get()
    // 78701 is downtown Austin, so that example goes there instead of using the current view.
    const downtown = example === 'addresses-postcode'
    const anchor = downtown
      ? latLngToCell(AUSTIN_CENTER.lat, AUSTIN_CENTER.lng, H3_RESOLUTION)
      : state.viewportStatus === 'ready'
        ? state.centerCell
        : null
    const cells = anchor ? gridDisk(anchor, 1) : []
    const dataset: DatasetId =
      example === 'places-food' ? 'places' : example === 'buildings-tall' ? 'buildings' : 'addresses'
    const sort = defaultSort(dataset)
    set({
      dataset,
      selectedCells: cells,
      page: 0,
      resultsSearch: '',
      sortField: sort.field,
      sortDirection: sort.direction,
      // Opening results can cover the new cells, so re-center them; only the downtown jump zooms in.
      fit: cells.length > 0 ? { nonce: state.fit.nonce + 1, zoomIn: downtown } : state.fit,
      notice:
        cells.length === 0
          ? 'Filters applied. Zoom in and select H3 cells to see results.'
          : downtown
            ? `Example loaded in ${cells.length} cells in downtown Austin.`
            : `Example loaded in ${cells.length} cells at the map center.`,
      filtersByDataset: {
        ...state.filtersByDataset,
        ...(example === 'places-food'
          ? { places: { ...defaultPlacesForm, basicCategories: ['restaurant', 'cafe'] } }
          : example === 'buildings-tall'
            ? { buildings: { ...defaultBuildingsForm, heightMin: '10' } }
            : { addresses: { ...defaultAddressesForm, postcode: '78701' } }),
      },
    })
  },
  dismissNotice: () => set({ notice: null }),
  setNotice: (notice) => set({ notice }),
  setInspectOpen: (inspectOpen) =>
    set(
      inspectOpen
        ? { inspectOpen }
        : { inspectOpen, queryHexPreview: false, inspectFilters: defaultInspectFilters },
    ),
  setInspectFilters: (inspectFilters) => set({ inspectFilters, page: 0 }),
  patchInspectFilters: (patch) =>
    set((state) => ({ inspectFilters: { ...state.inspectFilters, ...patch }, page: 0 })),
  setQueryHexPreview: (queryHexPreview) => set({ queryHexPreview }),
  previewQueryHexes: () => {
    const cells = get().selectedCells
    if (cells.length === 0) {
      set({ notice: 'This query has no hexes.' })
      return
    }
    set((state) => ({
      queryHexPreview: true,
      inspectOpen: true,
      fit: { nonce: state.fit.nonce + 1, zoomIn: true },
      notice: cells.length === 1 ? 'Preview · 1 hex in this query' : `Preview · ${cells.length} hexes in this query`,
    }))
  },
  exitQuery: () =>
    set({
      inspectOpen: false,
      queryHexPreview: false,
      inspectReplay: null,
      inspectRelease: null,
      inspectFilters: defaultInspectFilters,
    }),
  setInspectPosition: (inspectPosition) => set({ inspectPosition }),
  previewWorkflow: (input) => {
    const cells = [...new Set(input.h3_cells)].slice(0, MAX_SELECTED_CELLS)
    set((state) => ({
      selectedCells: cells,
      page: 0,
      resultsSearch: '',
      inspectOpen: true,
      inspectFilters: input.filters,
      inspectReplay: {
        nonce: (state.inspectReplay?.nonce ?? 0) + 1,
        workflowId: input.id,
        workflowName: input.name,
        filters: input.filters,
        sql: input.sql,
        customSql: input.custom_sql,
        releaseVersion: input.release_version ?? null,
      },
      inspectRelease: input.release_version ?? null,
      draftEnrichments: input.enrichments ?? state.draftEnrichments,
      fit: cells.length > 0 ? { nonce: state.fit.nonce + 1, zoomIn: true } : state.fit,
      notice:
        cells.length === 0
          ? 'That workflow has no hexes.'
          : `Workflow “${input.name}” · ${cells.length} hexes on the map`,
    }))
  },
  clearWorkflowPreview: () =>
    set({
      inspectReplay: null,
      inspectOpen: false,
      queryHexPreview: false,
      inspectRelease: null,
      inspectFilters: defaultInspectFilters,
    }),
  setInspectRelease: (inspectRelease) => set({ inspectRelease, page: 0 }),
  setDraftEnrichments: (draftEnrichments) => set({ draftEnrichments }),
  upsertDraftEnrichment: (enrichment) =>
    set((state) => {
      const withoutSameKind = state.draftEnrichments.filter((step) => step.kind !== enrichment.kind)
      return { draftEnrichments: [...withoutSameKind, enrichment] }
    }),
  removeDraftEnrichment: (id) =>
    set((state) => ({ draftEnrichments: state.draftEnrichments.filter((step) => step.id !== id) })),
  setDrawMode: (drawMode) => set({ drawMode, geofenceDraft: drawMode === 'geofence' ? [] : get().geofenceDraft }),
  addGeofenceVertex: (lng, lat) =>
    set((state) => {
      if (state.geofenceDraft.length >= MAX_GEOFENCE_VERTICES) {
        return { notice: `A fence can have ${MAX_GEOFENCE_VERTICES} vertices.` }
      }
      return { geofenceDraft: [...state.geofenceDraft, [lng, lat]], notice: null }
    }),
  undoGeofenceVertex: () => set((state) => ({ geofenceDraft: state.geofenceDraft.slice(0, -1) })),
  closeGeofence: (keep) => {
    const ring = closedRing(get().geofenceDraft)
    if (!ring) {
      set({ notice: 'A fence needs at least three points.' })
      return
    }
    get().upsertDraftEnrichment({
      id: 'geofence',
      kind: 'geofence',
      keep,
      polygon: { type: 'Polygon', coordinates: [ring] },
    })
    set({ drawMode: 'off', geofenceDraft: [], notice: `Geofence saved · keep ${keep}` })
  },
  clearGeofenceDraft: () => set({ geofenceDraft: [], drawMode: 'off' }),
  setEnrichOpen: (enrichOpen) => set({ enrichOpen }),
  setHailSummaries: (hailSummaries) => set({ hailSummaries }),
  applyAgentQuery: (input) => {
    const cells = [...new Set(input.h3_cells)].slice(0, MAX_SELECTED_CELLS)
    set((state) => ({
      selectedCells: cells,
      page: 0,
      inspectOpen: input.openInspect ?? true,
      enrichOpen: input.openEnrich ?? true,
      queryHexPreview: false,
      inspectFilters: input.filters,
      draftEnrichments: input.enrichments,
      inspectRelease: null,
      inspectReplay: {
        nonce: (state.inspectReplay?.nonce ?? 0) + 1,
        workflowId: null,
        workflowName: input.workflowName ?? 'Agent query',
        filters: input.filters,
        sql: input.sql,
        customSql: false,
        releaseVersion: null,
      },
      fit: cells.length > 0 && input.fit !== false ? { nonce: state.fit.nonce + 1, zoomIn: true } : state.fit,
      notice:
        input.notice !== undefined
          ? input.notice
          : (input.notes?.[0] ?? `Agent query · ${cells.length} hexes. Edit the inspect controls or enrichments, then save.`),
    }))
  },
  revealCells: (cells) =>
    set({ selectedCells: [...new Set(cells)].slice(0, MAX_SELECTED_CELLS), page: 0, queryHexPreview: false }),
  fitToCells: (cells) => {
    if (cells.length === 0) return
    set((state) => ({ fit: { nonce: state.fit.nonce + 1, zoomIn: true, cells: [...cells] } }))
  },
}))
}

type ExplorerStoreApi = ReturnType<typeof createExplorerStore>

declare global {
  var __worldpulseExplorer: ExplorerStoreApi | undefined
}

const existing = globalThis.__worldpulseExplorer
export const useExplorer =
  existing &&
  'inspectFilters' in existing.getState() &&
  'patchInspectFilters' in existing.getState() &&
  'applyAgentQuery' in existing.getState() &&
  'revealCells' in existing.getState()
    ? existing
    : createExplorerStore()
globalThis.__worldpulseExplorer = useExplorer
