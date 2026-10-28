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

The browser does not import the dataset or the Supabase client. It still uses `h3-js` to draw cell shapes. Filtering and counts run in Node, from the libraries in `node_modules`, so the server can take on packages that do not belong in a page bundle. Accounts are optional. The public map, Process, Inspect, and Jobs stay open without a login. Sign-up, sign-in, sign-out, and account delete run on Node (`/api/auth/*`) with httpOnly `wp_access` / `wp_refresh` cookies. The browser never receives the anon key or a JWT. Mock records are not user-scoped because they are not stored. The nav rail shows the mode the server reports, and a sign-in or email chip that opens Settings. On phones that line is in the menu.

The Node API also exposes workflow-ingestion planning and job endpoints:

- `GET /api/workflow-ingestion/limits`
- `POST /api/workflow-ingestion/plan`
- `POST /api/workflow-ingestion/jobs`
- `GET /api/workflow-ingestion/jobs`
- `GET /api/workflow-ingestion/jobs/:id`
- `POST /api/workflow-ingestion/jobs/:id/run`
- `POST /api/hex-status`
- `POST /api/hex-snapshots/check`
- `GET /api/query-schemas`
- `GET /api/releases`
- `GET /api/auth/session`
- `POST /api/auth/signup`
- `POST /api/auth/signin`
- `POST /api/auth/signout`
- `POST /api/auth/delete`
- `GET /api/query-workflows`
- `POST /api/query-workflows`
- `GET /api/query-workflows/:id`
- `PATCH /api/query-workflows/:id`
- `DELETE /api/query-workflows/:id`
- `POST /api/query-workflows/:id/quote`
- `POST /api/query-workflows/:id/run`
- `GET /api/query-workflows/:id/runs`
- `GET /api/ledger`
- `POST /api/agent-assist/draft`
- `POST /api/agent-assist/quote`
- `POST /api/enrichments/hail`
- `POST /api/query` (used when a ready hex opens the inspect table)

The planning route validates selected hexes, enforces connectedness, computes bbox, and applies hard caps. Creating a job runs that planner, then Node downloads Overture parquet for that bbox only, keeps rows whose H3 resolution-8 cell is in the selection, and upserts them into Supabase. `POST /api/workflow-ingestion/jobs/:id/run` starts the same download. The default release is `2026-10-21.0` (`OVERTURE_RELEASE`). Jobs themselves stay in the Node process. Feature rows persist in Supabase.

Each `IngestionJob` carries `logs`: timestamped `info` / `warn` / `error` lines from create, DuckDB S3 reads, bbox vs hex filter counts, RPC write batches, and the final row totals. The store keeps the newest 200 lines per job. `/jobs` keeps that stream collapsed until Logs is pressed, and polls every 1.2s while any job is queued or running.

`POST /api/hex-status` returns `ready`, `missing`, or `processing`, plus `snapshot` (`current` | `stale` | null) and `release_version`. Ready means `overture_hex_snapshots` has a row for the hex (or a succeeded in-memory job). `current` means the newest stored release is at least `OVERTURE_RELEASE` (`2026-10-21.0` by default). `stale` means the hex has rows from an older release. Processing means a download is running. `POST /api/hex-snapshots/check` is the table check: per hex, `processed`, `first_release_version`, `latest_release_version`, `has_current`, and `releases`. History starts at first Process. Later cuts are written only on a workflow run. `GET /api/releases` lists ingested snapshot metadata (`release_version`, hex and theme counts, source datasets). Feature rows keep `(id, release_version)`, so a later process of a newer release does not overwrite an older cut. Queries may send `release_version` to pin one stored snapshot. Omitted queries use the newest stored release in each hex. A pin older than first process is rejected.

`/workflows` lists saved query workflows and still builds an ingest plan JSON in a secondary panel. A query workflow is inspect SQL plus the selected hex set plus private enrichments. Hexes may be nationwide and disconnected. The cap is 5 per account (`MAX_QUERY_WORKFLOWS`). Create from Inspect; sign-in is required when Supabase accounts are configured. Mock mode stores the same shape in memory. Selecting a workflow sets the explorer selection, fits the map to every hex, opens Inspect, and reapplies the stored filters, SQL, and enrichments. The selection dock **Enrich** button opens geofence draw, hail history, and `ai_column`. Workflow runs now include `POST /api/query-workflows/:id/quote` for the orchestrator/specialist quote and auto-process missing hexes in batches smaller than 10 before querying. Debits and agent tips are written to the simulated ledger and shown on `/ledger`. `/jobs` creates and lists ingestion jobs from the current map selection. Each job has a log pane, hidden until opened. Process always loads places, buildings, and addresses together. The explorer is hex-first: click a ready hex to inspect. There is no Query button and no hover card. Inspect is a fitted panel that stays on screen and leaves the map clickable. While it is open, clicking another ready hex adds that cell to the query. The title hex chip is highlighted; click it to list every H3 in the query. Preview hexes is a query setting: it collapses the table and frames the camera equally around every included hex so coverage is visible. Back to inspect returns to the table. Exit query (or Escape) closes inspect and does not reopen the hex under the pointer. The SQL editor starts collapsed. It fetches all three themes with no form filters, then left-joins each place to its linked address and building. Unmatched places stay in the table with null address or building. Unmatched addresses and buildings are appended. Taxonomy `primary_category < category` splits into `main_category` and `category`. Snapshot stays `release_version`; `snapshot_date` is the date prefix. The table also includes Overture `sources`, derived `attribution`, contact fields, building extras, address extras, and ids. Inspect filters those loaded rows: category, main category, snapshot date, status, building class (each includes `null`), confidence as Any / Has a score / Missing / ≥ 0.5 / ≥ 0.7 / ≥ 0.9 (a floor excludes empty scores), and any/has/no/null for underground, phone, email, socials, and official id. Those filters live on the explorer store so the map follows the open query: inspect-features draws only matching rows, and after the inspect load settles, selected query hexes with 0 matching rows stay unfilled. Unselected hexes keep snapshot color. The same filters compile to SELECT SQL, collapsed until Show. Copy SQL and download CSV export the current table. Custom SQL must be a single SELECT on `overture_*` tables; execution still uses this JSON query contract plus the stored filters. The Building column is `names.primary`, else `subtype` or `class`. Height and floors come from the linked building when those Overture fields are present; they are often null. Wheel events stay in the window so they do not zoom the map.

## Map

The map draws H3 cells that intersect the current viewport at a display resolution that follows zoom: resolution 8 in the city, then 7, 6, 5, and 4 as the camera pulls back. It pads the view by 1.25 edge lengths of that resolution before calling `polygonToCells`, so cells along the edges stay whole. If a step would exceed 900 cells, it drops one resolution instead of hiding the grid. Query, Process, and selection stay on resolution 8. Parent hexes stay empty: they do not inherit snapshot color from a child. Ready resolution-8 cells stay drawn at their true size on top of the parent grid. Below zoom 5.4 the city grid hides and the camera eases to an earth-scroll globe over the last hex center. That globe does not keep a hex mesh; the honeycomb is a city-scale view. Zooming in from that globe eases back to the coarsest hex view (zoom 6.8). Continent-sized bounds do not draw a city grid. A resize recomputes the viewport cells. Selected resolution-8 cells are always drawn. Boundaries come from `h3-js` `cellToBoundary` in GeoJSON `[lng, lat]` order.

The MapLibre container fills the map slot with absolute positioning. MapLibre's stylesheet sets `.maplibregl-map` to `position: relative`, which collapses that slot and clips the canvas, so the app overrides it. The worker URL is set with `setWorkerUrl` because Vite's prebundle does not sit next to `maplibre-gl-worker.mjs`.

The projection is a globe. On each style load the map sets that projection and a sky in the page background (`#05080c`) with a mint horizon. The atmosphere fades out by zoom 8, so the city view stays flat enough to read the cells. The globe uses the selected basemap. On the dark streets style, land and water are shifted into that same palette below zoom 7 so the continents stay readable, then those paints return to the basemap colors. The camera starts over Africa and turns, then flies down to Austin. The opening load hides the basemap (streets, satellite, land, water). A custom `hex-drop` layer draws every resolution-1 cell (`earthHexCells()`, 842 hexes) with `projectTileFor3D` so each hex starts about 2800 km above the sphere and falls onto it. Delay is by latitude: north lands first, south last. The dive punches into the Austin cell: other earth hexes fade, then `diveHexCells()` replaces that cell with a tighter honeycomb as zoom rises (resolution 1→8). The basemap fades in around zoom 7.4. The drop layer hands off around zoom 10.8. Viewport city cells are not requested until that flight ends. Drag, scroll zoom, keyboard, touch, and the zoom / reset controls stay locked until then so a press cannot skip or yank the globe. `prefers-reduced-motion` skips the flight and the drop, and opens on Austin. A basemap change during the flight is applied when the flight ends, and it does not replay.

Zoom buttons ease 0.55 steps over 1180ms with an ease-in-out curve, centered on the unobstructed map area. Wheel zoom is slower so the globe does not jump. The grid updates during the move, and resolution bands have 0.35 zoom of hysteresis so they do not flicker. Fit and reset use the same curve. `prefers-reduced-motion` jumps instead.

Cell fill is snapshot freshness, not record count. Empty hexes have no fill. Green (`#2ee6a6`) is the current Overture release. Yellow (`#f5c451`) is an older stored release. Those populated fills stay visible without hover. While inspect is open, selected query hexes with no matching filtered rows paint as empty after the table load settles. City zoom matches the opening drop: glass fill, a mint rim (`#7ef0dc` for current), and a soft bloom that grows as you get closer. Hover and selection use white.

### Cell display

**Map layers** picks one of three modes:

- **Lens** (default). Empty hex outlines fade in near the pointer. Hexes with current or stale data stay filled and outlined even when the pointer is elsewhere. City zoom (resolution 7 and 8) stays still until hover. The hovered cell lifts off the globe on a `hex-lift` layer (`projectTileFor3D`, about 420 m) with a ground shadow. There is no hover card. Click a ready hex to open Inspect. While inspect is open, a further click adds that hex to the query. Shift-click still selects. Process queues an ingestion job from the selection dock or `/jobs`. Zooming in or out keeps the last grid on a second source (`h3-out`) and fades it while the next cells appear, so resolution swaps do not pop. `prefers-reduced-motion` skips the stagger. The radius scales with zoom. Each frame sets MapLibre feature state (`lens`, `hover`, `appear`) on the affected cells, so pointer moves never rebuild the GeoJSON source.
- **Grid** also paints empty-cell outlines across the view.
- **Hidden** hides the H3 layers.

The fill sits under the basemap's roads and buildings, so streets cut through the color. Outlines sit above roads, where they stay unbroken, and under the place labels. MapLibre's attribution control stays on, with `© OpenStreetMap contributors, Overture Maps Foundation` and a link to `/licenses`. Streets tiles still credit OpenFreeMap / OSM. Satellite tiles still credit Esri. `/licenses` is the public notice for CDLA Permissive 2.0, Apache 2.0 / Foursquare, ODbL buildings, NAD addresses, and Esri terms.

Switching basemaps calls `setStyle(style, { diff: false })`. That reloads the style and fires `style.load`, which re-adds the H3 source and layers. A diffed update drops them without an event. Box zoom is off because it claims every shift-press and swallows shift-click.

### Layout

Desktop keeps a minimal chrome: nav rail, map controls, status pill, and a selection dock with Process. Workflows and Jobs stay in the side nav. At 767 px and below, the explorer switches to a top bar with menu and map controls, and the same dock sits at the bottom. The snapshot legend is Empty → No Data, current green, and stale yellow labeled Old snapshot.

Touch input is detected with `(hover: none), (pointer: coarse)`. On touch screens the lens stays under a reticle at the map center. Taps add to the selection instead of replacing it. A ready tap opens inspect; later taps add hexes to that query. Process still opens from the dock.

Hexes start as missing until Process finishes. Inspect unlocks when rows exist in Supabase.

## Overture ingest

Process uses DuckDB `httpfs` and `spatial` against the public Overture S3 bucket. It always reads places, buildings, and addresses. DuckDB is capped at 160MB and one thread, reads 200-row pages, and is closed when the job ends. Places and addresses store a Point from `ST_X`/`ST_Y`. Building footprints are simplified (`ST_SimplifyPreserveTopology`, then at most 24 ring vertices). H3 comes from the geometry point or footprint centroid. Only rows in the selected hexes stay in memory. Node then associates place→building (point-in-polygon, else nearest within 40 m), place→address (nested `addresses[]` match, else nearest), and building→address (nearest). Each feature row stores Overture `sources`. After the theme writes, Node upserts `overture_release_snapshots` and `overture_hex_snapshots` through `ingest_overture_snapshot`. Map count queries load only `h3_res8` and `release_version` when there are no filters, and never load geometry. Anon can SELECT those tables. Direct INSERT is denied. Queries select `phones`, `sources`, and the other feature columns. If those are missing, run `supabase/migrations/20261027_overture_features.sql` and `supabase/migrations/20261027_overture_snapshots.sql` (or re-run the base Overture file, which now adds the same columns) and reload the PostgREST schema, then reprocess existing hexes. The Node reader falls back to the original columns so Inspect still lists rows. Snapshot metadata is optional: a missing RPC logs a warning and does not fail the job.

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

Explorer queries read `overture_places`, `overture_buildings`, and `overture_addresses`. Snapshot metadata lives in `overture_release_snapshots` and `overture_hex_snapshots`. Run `supabase/migrations/20261027_overture.sql` after the workflow migration, then the features and snapshots files.

Accounts live in Supabase Auth plus `public.profiles` (`id` = `auth.users.id`, email, timestamps). A trigger writes the profile on sign-up. `delete_own_account()` is a SECURITY DEFINER RPC that deletes `auth.users` for `auth.uid()`; profiles and workflow rows cascade. Settings requires the password and the word DELETE. Run `supabase/migrations/20261027_auth.sql` after the workflow file, then `supabase/migrations/20261027_query_workflows.sql`. Turn off Confirm email in the Supabase Auth settings if a session should start right after create-account.

Query workflows are the product shape: `query_workflows` stores name, SELECT SQL, `custom_sql`, `h3_cells` (1–300, nationwide allowed), inspect `filters`, private `enrichments`, and optional `release_version` (null = latest). Owner RLS (`auth.uid()`). Table GRANT is `authenticated` only (`select, insert, update, delete`); `anon` is revoked. Unique name per owner. A trigger caps each owner at 5. Node writes that table with the signed-in user's JWT, never the service-role key. A 42501 / permission denied means run `supabase/migrations/20261027_query_workflow_grants.sql`. Create from Inspect refreshes a stale access cookie first; the save request uses that JWT so RLS `auth.uid() = owner_user_id` still matches. A JWT or RLS failure asks the user to sign in again instead of “The workflow request failed.” A run can auto-process missing hexes in process-agent batches (<10 each), then checks `overture_hex_snapshots`, historizes missing current cuts for already-processed hexes, then queries. A pin is a historical query and never backfills. `query_workflow_runs` and `hail_hex_stats` are owner-only. Hail ranges clamp to first process. NOAA GRIB files are processed in temp space and discarded. The older `workflows*` tables stay the ingest scaffold (20 hexes, connected, 220 km2). Node jobs still do not write those ingest tables.

The Node server may use the anon key only. The service-role key stays out of the environment and out of the repo. The browser never receives the key.

OpenAI + Rho marketplace is a **demo scaffold**. Structured quote + `ai_column` + simulated ledger debit/tips are live on Node. Real Rho card charge remains target-only. Next agent: [marketplace.md](marketplace.md). Rho is one staging treasury and a virtual card (VPN `app.rho-staging.co`), not a Rho account per user. OpenAI stays server-side only. Do not put `OPENAI_API_KEY`, `RHO_API_TOKEN`, the VPN profile, or a card PAN in the repo or the browser.

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
