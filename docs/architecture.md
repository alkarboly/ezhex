# Architecture

The explorer reads Overture rows from Supabase. Process downloads the public Overture Maps release for the selected hex bbox and writes those rows. Mock data is only used when `DATA_MODE=mock` (local verify).

```
Browser
  → Explorer map requests viewport counts: POST /api/cell-counts
  → Hex hover / Jobs page:
       POST /api/hex-status
       POST /api/workflow-ingestion/jobs
       GET  /api/workflow-ingestion/jobs
  → Node server
       validateQuery() whitelist
       DuckDB reads s3://overturemaps-us-west-2/release/<version>/theme=...
       SECURITY DEFINER ingest RPCs write overture_* tables
       supabase provider reads those tables
  → JSON back to the map, hover actions, and Jobs UI
```

The browser does not import the dataset or the Supabase client. It still uses `h3-js` to draw cell shapes. Filtering and counts run in Node, from the libraries in `node_modules`, so the server can take on packages that do not belong in a page bundle. There is no auth hop. Mock records are not user-scoped because they are not stored. The nav rail shows the mode the server reports. On phones it is in the menu.

The Node API also exposes workflow-ingestion planning and job endpoints:

- `GET /api/workflow-ingestion/limits`
- `POST /api/workflow-ingestion/plan`
- `POST /api/workflow-ingestion/jobs`
- `GET /api/workflow-ingestion/jobs`
- `GET /api/workflow-ingestion/jobs/:id`
- `POST /api/workflow-ingestion/jobs/:id/run`
- `POST /api/hex-status`
- `GET /api/query-schemas`
- `POST /api/query` (used when a ready hex opens the inspect table)

The planning route validates selected hexes, enforces connectedness, computes bbox, and applies hard caps. Creating a job runs that planner, then Node downloads Overture parquet for that bbox only, keeps rows whose H3 resolution-8 cell is in the selection, and upserts them into Supabase. `POST /api/workflow-ingestion/jobs/:id/run` starts the same download. The default release is `2026-10-21.0` (`OVERTURE_RELEASE`). Jobs themselves stay in the Node process. Feature rows persist in Supabase.

Each `IngestionJob` carries `logs`: timestamped `info` / `warn` / `error` lines from create, DuckDB S3 reads, bbox vs hex filter counts, RPC write batches, and the final row totals. The store keeps the newest 200 lines per job. `/jobs` shows that stream under each job and polls every 1.2s while any job is queued or running.

`POST /api/hex-status` returns `ready`, `missing`, or `processing`, plus `snapshot` (`current` | `stale` | null) and `release_version`. Ready means those tables already have rows for the hex, or a succeeded in-memory job. `current` means the newest stored release is at least `OVERTURE_RELEASE` (`2026-10-21.0` by default). `stale` means the hex has rows from an older release. Processing means a download is running.

`/workflows` still builds and downloads plan JSON. `/jobs` creates and lists ingestion jobs from the current map selection, with a live log pane per job. Process always loads places, buildings, and addresses together. The explorer is hex-first: hover a cell for status and Process, or click a ready hex to inspect. Inspect is a draggable window. Close on the title bar ends inspect and does not reopen the hex under the pointer. It fetches all three themes with no form filters, then left-joins each place to its linked address and building. Unmatched places stay in the table with null address or building. Unmatched addresses and buildings are appended. The Building column is `names.primary`, else `subtype` or `class`. Height and floors come from the linked building when those Overture fields are present; they are often null. Inspect dropdowns list values seen in those loaded rows, not a preset catalog. Wheel events stay in the window so they do not zoom the map.

## Map

The map draws H3 cells that intersect the current viewport at a display resolution that follows zoom: resolution 8 in the city, then 7, 6, 5, and 4 as the camera pulls back. It pads the view by 1.25 edge lengths of that resolution before calling `polygonToCells`, so cells along the edges stay whole. If a step would exceed 900 cells, it drops one resolution instead of hiding the grid. Query, Process, and selection stay on resolution 8. Parent hexes stay empty: they do not inherit snapshot color from a child. Ready resolution-8 cells stay drawn at their true size on top of the parent grid. Below zoom 5.4 the grid hides and the camera eases to an earth-scroll globe over the last hex center; zooming in from that globe eases back to the coarsest hex view (zoom 6.8). Continent-sized bounds do not draw a grid. A resize recomputes the viewport cells. Selected resolution-8 cells are always drawn. Boundaries come from `h3-js` `cellToBoundary` in GeoJSON `[lng, lat]` order.

The MapLibre container fills the map slot with absolute positioning. MapLibre's stylesheet sets `.maplibregl-map` to `position: relative`, which collapses that slot and clips the canvas, so the app overrides it. The worker URL is set with `setWorkerUrl` because Vite's prebundle does not sit next to `maplibre-gl-worker.mjs`.

The projection is a globe. On each style load the map sets that projection and a sky in the page background (`#05080c`) with a mint horizon. The atmosphere fades out by zoom 8, so the city view stays flat enough to read the cells. The globe uses the selected basemap. On the dark streets style, land and water are shifted into that same palette below zoom 7 so the continents stay readable, then those paints return to the basemap colors. The camera starts over Africa, turns across the Atlantic onto North America, then flies down to Austin. Viewport cells are not requested until that flight ends, or until the user presses the map, which skips the rest of the flight. `prefers-reduced-motion` skips it and opens on Austin. A basemap change during the flight is applied when the flight ends, and it does not replay.

Zoom buttons ease 0.55 steps over 1180ms with an ease-in-out curve, centered on the unobstructed map area. Wheel zoom is slower so the globe does not jump. The grid updates during the move, and resolution bands have 0.35 zoom of hysteresis so they do not flicker. Fit and reset use the same curve. `prefers-reduced-motion` jumps instead.

Cell fill is snapshot freshness, not record count. Empty hexes have no fill. Green (`#2ee6a6`) is the current Overture release. Yellow (`#f5c451`) is an older stored release. Those populated fills stay visible without hover. Outlines match that fill; hover and selection use white.

### Cell display

**Map layers** picks one of three modes:

- **Lens** (default). Empty hex outlines fade in near the pointer. Hexes with current or stale data stay filled and outlined even when the pointer is elsewhere. The first grid after the globe (or a style reload) lays in as a center-out ripple: each cell’s `appear` feature-state goes 0→1 with delay by distance from the view center, about 70 ms per hex ring. Zooming in or out keeps the last grid on a second source (`h3-out`) and fades it while the next cells appear, so resolution swaps do not pop. `prefers-reduced-motion` skips the stagger. The hovered cell pins a tooltip to the hex centroid (it does not follow the pointer) with Process and Inspect. Click a ready hex to open Inspect. Shift-click still selects. Inspect opens a draggable window, not the tooltip. Process queues an ingestion job. Workflow uses the hovered hex, or the whole selection if that hex is already selected. The radius scales with zoom. Each frame sets MapLibre feature state (`lens`, `hover`, `appear`) on the affected cells, so pointer moves never rebuild the GeoJSON source.
- **Grid** also paints empty-cell outlines across the view.
- **Hidden** hides the H3 layers.

The fill sits under the basemap's roads and buildings, so streets cut through the color. Outlines sit above roads, where they stay unbroken, and under the place labels.

Switching basemaps calls `setStyle(style, { diff: false })`. That reloads the style and fires `style.load`, which re-adds the H3 source and layers. A diffed update drops them without an event. Box zoom is off because it claims every shift-press and swallows shift-click.

### Layout

Desktop keeps a minimal chrome: nav rail, map controls, status pill, and a selection dock with Query and Process. Workflows and Jobs stay in the side nav. At 767 px and below, the explorer switches to a top bar with menu and map controls, and the same dock sits at the bottom. The snapshot legend is Empty → No Data, current green, and stale yellow labeled Old snapshot.

Touch input is detected with `(hover: none), (pointer: coarse)`. On touch screens the lens stays under a reticle at the map center. Taps add to the selection instead of replacing it. Query on the dock opens the inspect window. Process still opens from the dock.

Hexes start as missing until Process finishes. Query unlocks when rows exist in Supabase.

## Overture ingest

Process uses DuckDB `httpfs` and `spatial` against the public Overture S3 bucket. It always reads places, buildings, and addresses. DuckDB is capped at 160MB and one thread, reads 200-row pages, and is closed when the job ends. Places and addresses store a Point from `ST_X`/`ST_Y`. Building footprints are simplified (`ST_SimplifyPreserveTopology`, then at most 24 ring vertices). H3 comes from the geometry point or footprint centroid. Only rows in the selected hexes stay in memory. Node then associates place→building (point-in-polygon, else nearest within 40 m), place→address (nested `addresses[]` match, else nearest), and building→address (nearest). Map count queries load only `h3_res8` when there are no filters, and never load geometry. Anon can SELECT those tables. Direct INSERT is denied. Queries select `phones` and the other feature columns. If those are missing, run `supabase/migrations/20261027_overture_features.sql` (or re-run the base Overture file, which now adds the same columns) and reload the PostgREST schema, then reprocess existing hexes. The Node reader falls back to the original columns so Inspect still lists rows.

The Austin mock generator remains behind `DATA_MODE=mock` for `npm run verify` only.

## Supabase and Spark workflow scaffold

Supabase migration `supabase/migrations/20261027_workflows.sql` adds workflow persistence with owner-based RLS:

- `workflows`: selected hexes (1-20), release version, filters, and status
- `workflow_subscriptions`: manual/scheduled/release triggers
- `workflow_runs`: run status, storage prefixes, and enforced row caps
- `workflow_hex_metrics`: per-hex counts and quality-rate fields

Safety constraints are enforced in both API and schema:

- selected hexes must be res-8, unique, and <= 20
- bbox area is capped at 220 km2
- per-dataset and total row caps are bounded

Spark job scaffold is under `pipelines/spark/workflow_ingest.py`. It reads a plan from `/api/workflow-ingestion/plan`, applies bbox prefilter + exact `h3_res8` filtering, enforces row caps again, and writes segmented outputs plus per-hex metrics.

Explorer queries read `overture_places`, `overture_buildings`, and `overture_addresses`. Run `supabase/migrations/20261027_overture.sql` after the workflow migration.

The Node server may use the anon key only. The service-role key stays out of the environment and out of the repo. The browser never receives the key.

## Deploy

```
Browser
  → Render web service (Node, port from PORT)
       /api/* runs the query libraries
       every other path serves dist/
  → MapLibre loads tiles from OpenFreeMap and Esri
```

`render.yaml` is a Node web service on `main`, built with Node 22.16.0. The build writes the browser assets to `dist/` and the server bundle to `dist-server/`. Render's free instance is 512MB. The blueprint build uses `NODE_OPTIONS=--max-old-space-size=384 npm run build:web` (Vite only, no `tsc`) so the compile does not OOM. The start command is `NODE_OPTIONS=--max-old-space-size=256 node dist-server/index.js`. Do not set `NODE_OPTIONS` in the Render dashboard: that env applies to the build as well. Ingest caps stay 8,000 rows per theme / 20,000 total. `node dist-server/index.js` listens on `0.0.0.0` and `PORT`. Render's health check is `GET /api/health`.

`DATA_MODE=supabase` is the default. Changing it still needs a restart, which a Render env change does by redeploying. Paths with no file, such as `/settings`, receive `index.html`. A missing file that has an extension returns 404, so a broken script is not replaced with HTML. Hashed files under `/assets/` are cached for a year.

The anon key is not in the blueprint. Add `SUPABASE_URL` and `SUPABASE_ANON_KEY` in the Render dashboard only, and never add the service-role key. The free instance sleeps after a stretch of no requests and wakes on the next one. If `WORKFLOW_MAX_ROWS_PER_DATASET` was set higher in the Render dashboard, lower it to 8000 or remove it so the blueprint value applies. If `NODE_OPTIONS` is set in the dashboard, delete it so only the start command caps the runtime heap.
