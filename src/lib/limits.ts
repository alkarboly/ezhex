export const H3_RESOLUTION = 8
/** Coarsest hex drawn on the map. Below this zoom the globe has no grid. */
export const MIN_DISPLAY_RESOLUTION = 4
export const MAX_VIEWPORT_CELLS = 900
/** Zoom floor for the hex grid. Lower zooms are the earth view. */
export const MIN_VIEWPORT_ZOOM = 5.4
export const MAX_SELECTED_CELLS = 300
export const MAX_QUERY_LIMIT = 2000
export const DEFAULT_QUERY_LIMIT = 50
export const PAGE_SIZES = [25, 50, 100, 250] as const
/** Saved inspect / query workflows per account. Nationwide hexes are allowed. */
export const MAX_QUERY_WORKFLOWS = 5
export const MAX_INSPECT_SQL_LENGTH = 20_000
