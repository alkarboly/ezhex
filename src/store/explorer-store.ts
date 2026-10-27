import { gridDisk, latLngToCell } from 'h3-js'
import { create } from 'zustand'
import { AUSTIN_CENTER, type ViewportStatus } from '../lib/h3'
import { DEFAULT_QUERY_LIMIT, H3_RESOLUTION, MAX_SELECTED_CELLS } from '../lib/limits'
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
export type FitRequest = { nonce: number; zoomIn: boolean }
export type MobileTab = 'query' | 'results'

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
  viewportStatus: ViewportStatus
  /** Drawn cell at the middle of the unobstructed map area (under the reticle on touch). */
  centerCell: string | null
  focus: { h3: string; nonce: number } | null
  /** Request to frame the selection. Without zoomIn the camera only pans, or zooms out to fit. */
  fit: FitRequest
  notice: string | null
  inspectOpen: boolean
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
  setViewportCells: (viewportCellIds: string[], viewportStatus: ViewportStatus) => void
  setCenterCell: (centerCell: string | null) => void
  focusCell: (h3: string) => void
  zoomToSelected: () => void
  applyExample: (example: ExampleId) => void
  dismissNotice: () => void
  setNotice: (notice: string | null) => void
  setInspectOpen: (inspectOpen: boolean) => void
}

const initialSort = defaultSort('places')

export const useExplorer = create<ExplorerState>((set, get) => ({
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
  viewportStatus: 'idle',
  centerCell: null,
  focus: null,
  fit: { nonce: 0, zoomIn: true },
  notice: null,
  inspectOpen: false,
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
    const next = state.viewportCellIds.slice(0, MAX_SELECTED_CELLS)
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
  setViewportCells: (viewportCellIds, viewportStatus) => {
    const current = get()
    if (
      current.viewportStatus === viewportStatus &&
      current.viewportCellIds.length === viewportCellIds.length &&
      current.viewportCellIds.every((cell, index) => cell === viewportCellIds[index])
    ) {
      return
    }
    set({ viewportCellIds, viewportStatus })
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
  setInspectOpen: (inspectOpen) => set({ inspectOpen }),
}))
