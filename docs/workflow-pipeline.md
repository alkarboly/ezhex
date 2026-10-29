# Workflow pipeline

This document defines segmented ingestion for workflow runs.

## Scope and safety limits

Every run is scoped to one selected H3 resolution-8 group:

- max 20 hexes
- hexes must be one connected component
- bbox is derived from selected hexes
- bbox area must be <= 220 km2
- per-dataset row cap (default 8,000, hard cap 1,000,000)
- total-row cap (default 20,000, hard cap 2,000,000)

The server enforces these limits when building a plan. The Spark job enforces them again.

## End-to-end flow

```
UI / API caller
  -> POST /api/hex-status
     ready | missing | processing, plus current | stale snapshot
  -> GET /api/query-schemas (dataset + field/operator whitelist + capability)
  -> GET /api/releases (ingested snapshot metadata)
  -> GET /api/workflow-ingestion/limits
  -> POST /api/workflow-ingestion/plan
     validates hexes + connectedness + limits
     returns plan JSON with release, bbox, caps, and storage prefixes
  -> POST /api/workflow-ingestion/jobs
     same validation, then an in-memory job on one process-wide store
     UI always sends places, buildings, and addresses
     DATA_MODE=supabase: DuckDB reads geometry plus Overture attributes, associates rows, writes Supabase
     DATA_MODE=mock: Node runs a local ingest
     Austin seed hexes resolve immediately
     other hexes get synthetic rows, then succeed
  -> POST /api/workflow-ingestion/jobs/:id/run
     reruns a queued or failed job on Node (mock) or fails (supabase)
  -> Spark job consumes that plan when silver parquet exists
     bbox prefilter (if lat/lng columns exist)
     exact filter by h3_res8 in selected cells
     cap checks
     writes segmented outputs + hex metrics
  -> Supabase stores workflow, runs, subscriptions, and metrics
     (Node jobs are not written here yet)
  -> Inspect SQL + Create a workflow
     GET/POST/PATCH/DELETE /api/query-workflows
     owner RLS, 5 per account, nationwide hexes
     enrichments stay on the workflow and are private
     POST /api/agent/plan turns a prompt into intent, region, hexes, and one-hex jobs for missing cells
       the Explorer agent waits for hex confirmation, then creates one ingestion job per missing hex and follows its logs
     POST /api/agent/query picks observed categories and returns filters, SQL, enrichments, counts, hail window, quote
     POST /api/agent-assist/draft configures the inspect query and enrichments for the selected hexes (API only)
     POST /api/agent-assist/quote updates quote lines as query/enhancements change
     POST /api/query-workflows/:id/quote returns agent quote lines + simulated ledger balance
     POST /api/query-workflows/:id/run auto-processes missing hexes (one hex per job), then checks snapshots, then query + enrichments
     POST /api/query-workflows/:id/check-new-data reads overture_hex_snapshots for that workflow (demo subscribe check; no schedule)
     GET /api/ledger returns simulated ledger entries (debits, payouts, tips)
  -> Add-ons (optional; none run unless chosen)
     Weather → hail (`hail_history`) via POST /api/enrichments/hail
     Custom polygon (`geofence`) keep inside|outside from draw, upload, or pasted text
     AI enhance (`ai_column`) writes one typed column from each row
  -> POST /api/hex-snapshots/check
     processed | first_release_version | latest_release_version | has_current
```

## API contract

`POST /api/workflow-ingestion/plan`

```json
{
  "release_version": "2026-09-24.0",
  "h3_cells": ["88489e3467fffff"],
  "datasets": ["places", "addresses", "buildings"]
}
```

`GET /api/workflow-ingestion/limits`

Returns hard/effective guardrails and the required H3 resolution.

`GET /api/query-schemas`

Returns server-side query schemas (dataset + fields + operators) from the same whitelist used by validation, plus `query_enabled` capability for the active data mode.

`POST /api/workflow-ingestion/jobs`

Same body as the plan route. Returns an `IngestionJob` including `logs`. In mock mode the server processes the hexes immediately and writes queryable rows. Creating the same release + hex set + datasets again returns the existing queued, running, or succeeded job.

`GET /api/workflow-ingestion/jobs`

Lists jobs in the Node process, newest first, with the same `logs` array. The store keeps at most 200 jobs and 200 log lines per job. The store is lost on restart.

`GET /api/workflow-ingestion/jobs/:id`

Returns one job, including its live log stream. Lookup accepts the job id or `run_id`. A 404 means the in-memory store lost the job (restart or isolate split); the Explorer agent creates that hex’s job again.

Each log line is `{ at, level, message }` where `level` is `info`, `warn`, or `error`. Lines cover job create, hex list, DuckDB/S3 reads, bbox vs selected-hex counts, Supabase RPC batches, and success or failure.

`POST /api/hex-status`

```json
{ "h3_cells": ["88489e3467fffff"] }
```

Returns per-hex `ready`, `missing`, or `processing`, plus `snapshot` (`current` | `stale` | null), `release_version`, and counts including `current_count` and `stale_count`. The current snapshot is `OVERTURE_RELEASE`.

`GET /api/releases`

Lists `overture_release_snapshots` (or the mock catalog). Each row is one processed Overture release: hex count, theme counts, source datasets, and whether it is the current `OVERTURE_RELEASE`. Feature tables keep older releases. `POST /api/query` and `POST /api/cell-counts` take optional `release_version` to read one cut.

The explorer selection dock and `/jobs` create jobs from selected hexes. There is no hover card and no Query button. Process always loads places, buildings, and addresses. `/jobs` keeps a live log pane per job, including association match rates, collapsed until Logs is pressed, and polls while a job is queued or running. Opening `/jobs` also processes any queued mock jobs. `/workflows` lists saved query workflows (inspect SQL + hexes, 5 per account). The name is editable on the card. View workflow restores every hex on the map, Inspect, Add-ons, and the stored SQL in the editor, including nationwide disconnected sets. Subscribe to new data is a persistable demo flag; turning it on checks `overture_hex_snapshots` immediately. Check now repeats that read. The same page still builds and downloads ingest plan JSON. Inspect opens a fitted panel from a ready hex click, fetches all three themes unfiltered, and shows one joined table with snapshot, snapshot date, sources, attribution, split taxonomy, and the stored theme fields. The inspect query is shown as SQL, collapsed until opened; View workflow and an agent query open that editor with the saved SQL. The hex chip lists every included H3. Preview hexes frames the camera equally around those cells; Exit query closes inspect. Copy SQL and download CSV are available. Create a workflow stores that SQL and the selected hexes. An agent query shows **Save to agent**, which writes Inspect filters, SQL, and Add-ons back onto that turn (and `PATCH`es the saved query workflow when the turn already has one). Further hex clicks add cells to that query. Each inspect column has a Power Query-style filter (remove blanks, or pick one or a few values, including blanks). Toolbar filters still cover category, main category, snapshot date, status, building class, confidence (Any / Has a score / Missing / ≥ 0.5 / ≥ 0.7 / ≥ 0.9; a floor excludes empty scores), and presence flags. Column picks store in `filters.columnFilters` (`not_null` drops empty cells) or the matching named list. Each list and presence control includes `null` so empty values can be kept. Nulls stay when a link is missing. Building height and floors appear when the Overture row has them.

`GET /api/query-workflows` lists the signed-in owner's query workflows (`limit` 5, `remaining`). `POST /api/query-workflows` saves `{ name, sql, custom_sql, h3_cells, filters, enrichments, release_version, subscribe_new_data }`. `release_version` null or omitted means latest. `subscribe_new_data` defaults to false. The save uses the current access JWT; if that cookie is stale, Node refreshes it and Inspect refreshes the session before POST. A JWT or RLS miss returns “Sign in again to save a workflow.” A 400 that mentions those columns means `20261027_workflow_enrichments.sql`, `20261027_hex_snapshot_history.sql`, and `20261029_query_workflow_subscribe.sql` have not been run in the live SQL editor. `PATCH /api/query-workflows/:id` updates name, sql, custom_sql, h3_cells, filters, enrichments, the pin, or subscribe_new_data. Custom SQL must be a single SELECT on `overture_places`, `overture_buildings`, and `overture_addresses`. `POST /api/query-workflows/:id/quote` returns orchestrator + specialist quote lines and the current simulated ledger balance. `POST /api/query-workflows/:id/run` can auto-process missing hexes one hex per job, checks `overture_hex_snapshots`, historizes missing current snapshots for already-processed hexes, loads the inspect rows (or the pinned cut), then applies enrichments in order (`geofence`, `hail_history`, `ai_column`) and stores a private run. `POST /api/query-workflows/:id/check-new-data` is the subscribe demo: it reads that snapshot table and returns current / older / missing counts plus a short message. No schedule is wired. `GET` / `DELETE /api/query-workflows/:id` are owner-only. Ingest connectedness and the 20-hex / 220 km2 caps do not apply to query workflows. Mock mode keeps the same list in memory without an account.

`POST /api/hex-snapshots/check` `{ h3_cells }` reads `overture_hex_snapshots` and returns per-hex `processed`, `first_release_version`, `latest_release_version`, `has_current`, and `releases`. Hex-status uses the same table.

Workflows, enrichments, runs, hail extracts, and ledger views are private (`auth.uid() = owner_user_id`). Anon cannot read them.

### Agent

`POST /api/agent/plan`

```json
{
  "prompt": "Coffee shops within 1 km of the Texas State Capitol, with 30 days of hail history",
  "selection": [],
  "view": { "center": { "lat": 30.2747, "lng": -97.7404 }, "bounds": null, "zoom": 14 },
  "polygon": null,
  "weather": false,
  "enrichments": [],
  "previous": null
}
```

Returns `{ id, reply, used_model, intent, region, h3_cells, ready, missing, processing_jobs, batches, release_version, max_new_hexes, notes }`. `weather` is the optional Weather add-on toggle; hail is added when that toggle is on, the prompt asks for weather/hail, or a `hail_history` draft is in `enrichments`. A saved `ai_column` draft is kept unless the prompt drops it. The reply names those kept add-ons even when the model wrote the rest of the prose. `region` is `{ kind, label, center, radius_km, polygon }` with `kind` one of `selection`, `view`, `place`, `point`, or `polygon`; a circle or custom polygon becomes the geofence. `h3_cells` run from the region center outward (max 300). A list of H3 indexes in the prompt becomes the selection (resolution 8, or snapped to it). A named place is geocoded through Nominatim. If the prompt names a city, that city is geocoded first and the search is biased there. The map city (locality + ~30 km viewbox) is used only when the request does not name another city. Neighborhoods off the current zoom and conversational wording such as “in the Westgate neighborhood in Austin TX” or “along Tiffany Trail in Richardson Texas” stay in the named city. The geocoder highlights hexes as a corridor or a loose polygon. A street or highway named with along/on/down, or a known road name, traces the road (Nominatim lines, Photon highway matches in the search-city bbox if the trace is short) and keeps hexes within 0.6 km (`AGENT_CORRIDOR_KM`). Long interstate traces are clipped to the search city. “X between A and B” (for example I-35 between Austin and Buda) geocodes both cities and traces the road in that span; a short name inherits the other city’s state, and known Texas pins (Austin, Dallas, Houston, Buda) cover a geocoder miss. A request that names Austin, Dallas, or Houston uses that metro pin when Nominatim is off or misses. Without a traced road it highlights a loose area between those places (`AGENT_LOOSE_SPAN_KM`). A named neighborhood uses a loose polygon from the geocoded bbox. Leftover selected hexes are not used when the request names an area. A neighborhood that matches a small POI uses a 2 km hex circle (`AGENT_NEIGHBORHOOD_RADIUS_KM`). Commercial properties use the buildings dataset. A current map selection is used when the request does not name a new place, view, polygon, or map center. `batches` are one missing hex each (`MAX_AGENT_HEX_BATCH` is 1), capped at 36 new hexes (`AGENT_MAX_NEW_HEXES` lowers it). The Explorer agent pauses after revealing those hexes so a person can confirm or edit the selection; a place region shows the matched label. `previous` carries the last `{ intent, region, h3_cells }` for follow-ups.

`POST /api/agent/query` `{ prompt, h3_cells, intent, region, enrichments? }` returns `{ filters, sql, enrichments, categories, observed_categories, total_rows, matched_rows, fenced_rows, sample, workflow_name, hail_window, quote, notes, used_model }`. `filters` are inspect filters. `categories` are `{ value, count }` picks from values observed in those hexes. `enrichments` are in run order. A draft `geofence` is kept when the region has no polygon. `hail_window` is `{ start_date, end_date, floor }`, where `floor` is the first-process date the run clamps to.

Neither route writes rows or debits the ledger. Both need a session when Supabase accounts are configured; otherwise they use the demo guest. To execute a saved workflow, **Approve & run** on the agent panel saves then `POST /api/query-workflows/:id/run`. `/workflows` **Quote & run** does the same after a quote confirm. **View workflow** only restores the explorer. While the agent works, a live stage caption sits on the map; drag it off the hexes.

### Add-ons

A workflow is a query plus an optional ordered enrichment list (max 4, at most one `hail_history`, at most one `ai_column`). The Explorer **Add-ons** panel is a button picker: Weather, custom polygon, or AI enhance. None of these are on by default. Stored kinds stay `geofence`, `hail_history`, and `ai_column`.

**geofence.** `{ id, kind: "geofence", keep: "inside" | "outside", polygon }`. After the query, rows whose `lng`/`lat` fail the keep test are dropped. Choose **Custom polygon** in Add-ons to draw, upload, or paste, attach it to the agent, or save it onto the workflow.

**hail_history.** Weather add-on, not a default. `{ id, kind: "hail_history", start_date, end_date }`. NOAA MRMS `MESH_Max_1440min` (24h max estimated hail size, mm). Public S3, anonymous:

`s3://noaa-mrms-pds/CONUS/MESH_Max_1440min_00.50/YYYYMMDD/MRMS_MESH_Max_1440min_00.50_YYYYMMDD-HHMMSS.grib2.gz`

Use only the `120000` (12Z) file per day. Never sum overlapping files. Data from `2020-11-01`. Lon 0-360 is converted to -180..180. Values: `>0` hail mm, `0` none, `-1` missing, `-3` no coverage. Range cap is 366 days.

`POST /api/enrichments/hail` `{ h3_cells, start_date, end_date }` processes selected hexes and returns per-hex `{ hail_mm_max, hail_days, hail_last_date }`. The Explorer **Add-ons** button → **Weather** → **Hail** opens that path.

Live decode uses `pipelines/hail/extract_mesh.py` (xarray+cfgrib). Node writes a temp job JSON with hex bboxes, runs the script, downloads only that day's 12Z GRIB from `https://noaa-mrms-pds.s3.amazonaws.com`, keeps hex-day mm, and deletes the GRIB. Supabase stores `hail_hex_stats` per owner. Full grids are not retained. The Render build installs `pipelines/hail/requirements.txt` on Python 3.11.11 (`PYTHON_VERSION`) into the same interpreter the server spawns (`PYTHON`, default `python`). Mock mode synthesizes deterministic MESH for verify. A missing `xarray` install returns that error; live hail is not replaced with synthetic values.

**ai_column.** AI enhance add-on. `{ id, kind: "ai_column", column, value_type, prompt, source_fields, enum_values? }`. Uses AI plus the listed row fields to add one typed run-only column per row (`bool` | `enum` | `number` | `text`). The pass is row-capped (default 200). OpenAI is optional and server-side only; deterministic fallback is used when the key/model is unavailable.

`POST /api/workflow-ingestion/jobs/:id/run` processes a queued or failed job on this Node process. In mock mode that writes synthetic rows for the selected hexes so they can be queried. Spark is not required for that path.

## Storage layout

Silver input:

`<input_prefix>/<release_version>/<dataset>`

Workflow outputs:

`<output_prefix>/runs/<run_id>/<dataset>/h3_res8=<hex>/...`

Hex metrics:

`<metrics_prefix>/runs/<run_id>/hex_metrics/...`

Default prefixes are in `.env.example`:

- `OVERTURE_SILVER_PREFIX`
- `WORKFLOW_OUTPUT_PREFIX`
- `WORKFLOW_METRICS_PREFIX`

## Supabase schema

Migration: `supabase/migrations/20261027_workflows.sql`

Primary tables:

- `workflows` (owner, release version, hex selection, filters, status)
- `workflow_subscriptions` (manual/scheduled/release triggers)
- `workflow_runs` (run status, caps, storage prefixes, row counts)
- `workflow_hex_metrics` (per-hex counts and quality rates)
- `overture_release_snapshots` (release metadata for historical queries)
- `overture_hex_snapshots` (per-hex counts for one release)

Query-workflow migration: `supabase/migrations/20261027_query_workflows.sql`

- `query_workflows` (owner, inspect SQL, custom flag, nationwide hexes 1–300, inspect filters, enrichments, optional `release_version`, `subscribe_new_data`, 5 per owner). While that query is open, the explorer map draws matching inspect rows and unfills selected hexes with none.

Enrichment migration: `supabase/migrations/20261027_workflow_enrichments.sql`

- `query_workflows.enrichments` (jsonb array, max 4)
- `query_workflow_runs` (private run results)
- `hail_hex_stats` (owner, hex, day, mesh_mm_max only)

Snapshot-history migration: `supabase/migrations/20261027_hex_snapshot_history.sql`

- `query_workflows.release_version` (null = latest)
- `query_workflow_runs.release_version`, `snapshot_status` (`current` | `stale` | `historical`), `historized_hexes`

Agentic metadata migration: `supabase/migrations/20261028_agentic_ledger.sql`

- `query_workflow_runs.logs` (per-run agent log lines)
- `query_workflow_runs.quote_total_usd_cents`, `tips_usd_cents`, `ledger_debit_id`

Subscribe migration: `supabase/migrations/20261029_query_workflow_subscribe.sql`

- `query_workflows.subscribe_new_data` (boolean, default false). Enabling the flag checks snapshots immediately; Check now repeats that read. No scheduler.

Grants migration: `supabase/migrations/20261027_query_workflow_grants.sql`

- `GRANT SELECT, INSERT, UPDATE, DELETE` on `query_workflows`, `query_workflow_runs`, and `hail_hex_stats` to `authenticated`
- `REVOKE` from `public` and `anon`

All workflow tables are protected with owner-based RLS using `auth.uid() = owner_user_id`. Table GRANT is required in addition to RLS; without it PostgREST returns 42501. Snapshot tables are readable by anon. `profiles` and `delete_own_account()` come from `supabase/migrations/20261027_auth.sql`. Accounts are optional for the public map. Saving a query workflow requires a session when Supabase is configured. The ingest `workflows*` tables stay the 20-hex connected scaffold. Query workflows are the user-facing saved inspect queries.

## Notes

- Connectivity is enforced by API/job logic, not SQL.
- Keep `release_version` immutable per run.
- Keep caps strict. Lower limits through env vars; code will not allow values above the hard caps.
- The Render free web service is 512MB. Process pages DuckDB at 200 rows, caps DuckDB at 160MB / 1 thread, closes the connection after the job, and defaults ingest to 8,000 rows per theme / 20,000 total. If the dashboard still has a higher `WORKFLOW_MAX_ROWS_PER_DATASET`, lower it or the instance will OOM again.
- OpenAI + Rho marketplace is demo/live for orchestrator quotes + `ai_column` + simulated ledger. Real Rho card debit is still target-only. Pickup contract: [marketplace.md](marketplace.md).
