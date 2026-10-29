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
export const MAX_ENRICHMENTS = 4
export const MAX_GEOFENCE_VERTICES = 64
/** NOAA MRMS MESH_Max_1440min is usable from this day on. */
export const HAIL_MESH_START = '2020-11-01'
/** One 12Z file per day. Cap the range so Render does not pull a multi-year grid. */
export const MAX_HAIL_DAYS = 366
/** Process-agent job size. Each ingest job is one hex. */
export const MAX_AGENT_HEX_BATCH = 1
/** New (unprocessed) hexes one agent run may process. `AGENT_MAX_NEW_HEXES` can lower it. */
export const AGENT_MAX_NEW_HEXES = 36
export const AGENT_DEFAULT_RADIUS_KM = 1
export const AGENT_MAX_RADIUS_KM = 3
export const AGENT_DEFAULT_HAIL_DAYS = 30
