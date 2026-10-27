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

`/workflows` still builds and downloads plan JSON. `/jobs` creates and lists ingestion jobs from the current map selection, with a live log pane per job. The explorer is hex-first: hover a cell to inspect its rows (if ready), request processing (if missing), or start a workflow from that hex or the current selection.

## Map

The map loads H3 resolution 8 cells that intersect the current viewport. It pads the view by 1.25 edge lengths before calling `polygonToCells`, so cells along the edges are drawn whole. Below zoom 11, or above 800 cells, the grid is not drawn. Selected cells are always drawn. Boundaries come from `h3-js` `cellToBoundary` in GeoJSON `[lng, lat]` order. The app does not draw a world-wide grid.

The MapLibre container fills the map slot with absolute positioning. MapLibre's stylesheet sets `.maplibregl-map` to `position: relative`, which collapses that slot and clips the canvas, so the app overrides it. The worker URL is set with `setWorkerUrl` because Vite's prebundle does not sit next to `maplibre-gl-worker.mjs`.

The projection is a globe. On each style load the map sets that projection and a sky in the page background (`#05080c`) with a mint horizon. The atmosphere fades out by zoom 8, so the city view stays flat enough to read the cells. The globe uses the selected basemap. On the dark streets style, land and water are shifted into that same palette below zoom 7 so the continents stay readable, then those paints return to the basemap colors. The camera starts over Africa, turns across the Atlantic onto North America, then flies down to Austin. Viewport cells are not requested until that flight ends, or until the user presses the map, which skips the rest of the flight. `prefers-reduced-motion` skips it and opens on Austin. A basemap change during the flight is applied when the flight ends, and it does not replay.

Zoom buttons ease 0.85 steps over 820ms with an ease-in-out curve, centered on the unobstructed map area. Wheel zoom is slowed so the globe does not jump. Fit and reset use the same curve. `prefers-reduced-motion` jumps instead.

Cell fill is snapshot freshness, not record count. Empty hexes have no fill. Green (`#2ee6a6`) is the current Overture release. Yellow (`#f5c451`) is an older stored release. Outlines match that fill; hover and selection use white.

### Cell display

**Map layers** picks one of three modes:

- **Lens** (default). Cells near the pointer fade in with a smooth falloff, and the hovered cell shows a floating tooltip next to the cursor. The tooltip stays under the pointer long enough to reach: it does not dismiss on map `mouseout` while the pointer is on the widget, and Inspect pins it. Inspect expands that same widget into a row table with per-column filters (`POST /api/query`). Process and Workflow stay on the tooltip. Inspect opens only when that hex is `ready`. Process queues an ingestion job. Workflow uses the hovered hex, or the whole selection if that hex is already selected. The radius scales with zoom. Each frame sets MapLibre feature state (`lens`, `hover`) on the affected cells, so pointer moves never rebuild the GeoJSON source. Before the pointer first reaches the map, the lens rests at the center of the unobstructed map area.
- **Grid** colors every drawn cell.
- **Hidden** hides the H3 layers.

The fill sits under the basemap's roads and buildings, so streets cut through the color. Outlines sit above roads, where they stay unbroken, and under the place labels.

Switching basemaps calls `setStyle(style, { diff: false })`. That reloads the style and fires `style.load`, which re-adds the H3 source and layers. A diffed update drops them without an event. Box zoom is off because it claims every shift-press and swallows shift-click.

### Layout

Desktop keeps a minimal chrome: nav rail, map controls, status pill, and a selection dock with Query, Process, Workflow, and Jobs. At 767 px and below, the explorer switches to a top bar with menu and map controls, and the same dock sits at the bottom.

Touch input is detected with `(hover: none), (pointer: coarse)`. On touch screens the lens stays under a reticle at the map center. Taps add to the selection instead of replacing it. Query on the dock pins the same inspect table. Process and Workflow still open from the dock.

Hexes start as missing until Process finishes. Query unlocks when rows exist in Supabase.

## Overture ingest

Process uses DuckDB `httpfs` against the public Overture S3 bucket. It filters by the selection bbox, then by exact H3 resolution-8 indexes, then upserts through `ingest_overture_places`, `ingest_overture_buildings`, and `ingest_overture_addresses`. Anon can SELECT those tables. Direct INSERT is denied.

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

`render.yaml` is a Node web service on `main`, built with Node 22.16.0. The build writes the browser assets to `dist/` and the server bundle to `dist-server/`. `node dist-server/index.js` listens on `0.0.0.0` and `PORT`. Render's health check is `GET /api/health`.

`DATA_MODE=supabase` is the default. Changing it still needs a restart, which a Render env change does by redeploying. Paths with no file, such as `/settings`, receive `index.html`. A missing file that has an extension returns 404, so a broken script is not replaced with HTML. Hashed files under `/assets/` are cached for a year.

The anon key is not in the blueprint. Add `SUPABASE_URL` and `SUPABASE_ANON_KEY` in the Render dashboard only, and never add the service-role key. The free instance sleeps after a stretch of no requests and wakes on the next one.
