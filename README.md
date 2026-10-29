# ReadyHex

ReadyHex (readyhex.com) is an H3 map for exploring Overture building, address, and place records. Process a hex to download all three themes, with geometry and links, from the public Overture release into Supabase.

## Run locally

```bash
npm install
pip install -r pipelines/hail/requirements.txt
npm run dev
```

Weather add-on hail decode NOAA MRMS `MESH_Max_1440min` 12Z files through `pipelines/hail/extract_mesh.py`. That needs the Python packages above (`xarray`, `cfgrib`, `eccodes`). The Render build installs the same file.

Open http://localhost:5173. That command starts the Node server, which also serves the app. Set `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `.env`, then run `supabase/migrations/20261027_overture.sql`, `supabase/migrations/20261027_overture_features.sql`, `supabase/migrations/20261027_overture_snapshots.sql`, `supabase/migrations/20261027_auth.sql`, `supabase/migrations/20261027_query_workflows.sql`, `supabase/migrations/20261027_workflow_enrichments.sql`, `supabase/migrations/20261027_hex_snapshot_history.sql`, `supabase/migrations/20261027_query_workflow_grants.sql`, `supabase/migrations/20261028_agentic_ledger.sql`, and `supabase/migrations/20261029_query_workflow_subscribe.sql`. If query errors with `phones does not exist`, run the features file — that column is not on the original places table. Inspect opens one feature table as SQL; you do not pick a theme. Settings creates and deletes accounts. Saving a workflow needs a sign-in when Supabase is configured. Create a workflow refreshes that session, then writes with the current JWT. The map does not require a login.

```bash
npm run build
npm start
```

`start` runs the production server from `dist-server/` and serves the built app from `dist/`.

```bash
npm run verify
npm run build
```

`verify` checks that resolution-8 cell boundaries are real H3 polygons and that mock filters change the counts. `build` typechecks and writes `dist/`. The build uses Node `22.16.0`.

## Data mode

| Variable | Purpose |
| --- | --- |
| `DATA_MODE` | `supabase` (default) or `mock` for local verify. |
| `SUPABASE_URL` | Project URL, used only when mode is `supabase` |
| `SUPABASE_ANON_KEY` | Publishable anon key, read only by the server |
| `OVERTURE_RELEASE` | Public Overture release id. Default `2026-10-21.0`. |

Copy `.env.example` to `.env` if you want to set them. The `VITE_` names of those three variables still work as aliases. Do not put the Supabase service-role key in this app or on Render.

`supabase` mode reads Overture rows from Supabase. Process downloads the public `2026-10-21.0` release for the selected hexes. The active mode is shown in the sidebar, or in the menu on phones. It comes from `GET /api/source`.

## Workflow ingestion planning

The server includes segmented-ingestion planning and job routes:

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
- `POST /api/query-workflows/:id/check-new-data`
- `GET /api/query-workflows/:id/runs`
- `GET /api/ledger`
- `POST /api/agent-assist/draft`
- `POST /api/agent-assist/quote`
- `POST /api/agent/plan`
- `POST /api/agent/query`
- `POST /api/enrichments/hail`
- `GET /api/workflow-ingestion/limits`
- `POST /api/workflow-ingestion/plan`
- `POST /api/workflow-ingestion/jobs`
- `GET /api/workflow-ingestion/jobs`
- `GET /api/workflow-ingestion/jobs/:id`
- `POST /api/workflow-ingestion/jobs/:id/run`
- `POST /api/hex-snapshots/check`
- `POST /api/hex-status`

The plan route enforces:

- max 20 selected hexes
- one connected hex group
- H3 resolution 8 only
- bbox area cap
- row caps per dataset and per run

It returns a Spark plan JSON with release version, selected hexes, bbox, row caps, and storage prefixes. Spark scaffolding lives in `pipelines/spark/`.

`/api/query-schemas` returns dataset/field/operator contracts from the same whitelist used by query validation, plus whether query execution is enabled in the current mode.

`/api/workflow-ingestion/jobs` starts a hex-scoped Overture download into Supabase. Each job includes a `logs` array (`at`, `level`, `message`). `/jobs` keeps that stream collapsed until Logs is pressed. Process always writes places, buildings, and addresses, including GeoJSON and computed links. `/api/hex-status` is ready when those tables have rows for the hex. The map paints empty / green / yellow from that snapshot and keeps populated hexes visible without hover.

Workflow ingestion envs in `.env.example`:

- `WORKFLOW_MAX_BBOX_AREA_KM2`
- `WORKFLOW_MAX_ROWS_PER_DATASET`
- `WORKFLOW_MAX_TOTAL_ROWS`
- `OVERTURE_SILVER_PREFIX`
- `WORKFLOW_OUTPUT_PREFIX`
- `WORKFLOW_METRICS_PREFIX`

## Deploy

Production is [readyhex.com](https://readyhex.com). Point that domain at this Render web service. Rename the existing Render web service to `readyhex` in the dashboard if its name does not match, so a blueprint sync does not create a second service.

Render runs a Node web service. `render.yaml` builds `main` with Node 22.16.0 using `build:web` at a 384MB heap, then starts `NODE_OPTIONS=--max-old-space-size=256 node dist-server/index.js`. Do not set `NODE_OPTIONS` in the dashboard or the Vite build will OOM. It sets `DATA_MODE=supabase` and the 8,000 / 20,000 ingest caps. The install uses `npm ci --include=dev` so TypeScript and Vite are present when `NODE_ENV` is `production`.

Create the service from the blueprint, then sign in with GitHub and deploy it:

[Deploy to Render](https://render.com/deploy?repo=https://github.com/alkarboly/ezhex)

From a terminal, after [installing the Render CLI](https://render.com/docs/cli):

```bash
winget install render.cli
render login
render blueprints validate
```

`render blueprints validate` checks `render.yaml`. It does not create the service. The first deploy is the blueprint link above, or Dashboard → New → Blueprint. After the service exists, pushes to `main` deploy on their own. A manual deploy is:

```bash
render services
render deploys create SERVICE_ID --wait --confirm
```

`SERVICE_ID` is the id from `render services`, not the name. Do not add the Supabase service-role key. The free instance sleeps when idle and wakes on the next request.

## What works now

- MapLibre globe in the dark streets basemap. It turns from orbit and flies into Austin. Streets (OpenFreeMap) and satellite (Esri) basemaps
- H3 cells for the current view, from `h3-js` boundaries. City zoom uses resolution 8. Zooming out steps to coarser hexes down to resolution 4. The opening load hides the basemap, sidebar, agent, and map attribution. The credit line stays collapsed to an info button after that flight. Resolution-1 hexes fall onto a dark sphere, north first. Drag and zoom stay locked until that flight lands. Then the selection dock fades in (0 selected, Clear, Process, Add-ons), then the sidebar fades in over the map, then after 2 seconds the agent bubble fades in with a click prompt. The map canvas does not resize or pop when that chrome appears. The dive punches into the Austin hex and splits it into the city grid. Hover lifts that city hex off the map. City hexes use the same glass fill and mint bloom as the opening drop. City zoom stays still until you touch a cell. Zoom swaps fade the last grid out so the hexes do not pop. Parent hexes stay empty; only the exact processed resolution-8 cells take color. Zooming out past that floor eases into a globe you can scroll, with no hex mesh. Empty hexes stay unfilled. Green is the current Overture snapshot. Yellow is an older snapshot. **Map layers** switches between lens, grid, or hidden.
- Hex-first explorer: click a ready hex to inspect. Further clicks add hexes to that query. Process stays on the selection dock. There is no Query button and no hover card. Workflows and Jobs stay in the side nav
- Jobs page at `/jobs` starts hex-scoped Overture downloads into Supabase. Logs stay collapsed until opened.
- Query schemas are served by the API whitelist (`/api/query-schemas`) so UI choices track server-side query contracts
- Release snapshots stay as metadata (`GET /api/releases`, `POST /api/hex-snapshots/check`). Process writes the first hex snapshot. A workflow run checks that table and historizes the latest cut. Query with `release_version` for a historical slice stored after first process
- `/licenses` credits OpenStreetMap, Overture, Foursquare, NAD, OpenFreeMap, and Esri
- Optional Supabase accounts in Settings: create, sign in, sign out, delete account. The public map does not require a login
- Inspect is SQL: generated from hexes and filters, collapsed until opened, editable custom SELECT, copy SQL, download CSV. View workflow and an agent query load that SQL into the editor and open it. The hex chip lists included cells. Preview hexes frames all of them; Exit query closes inspect. The map follows those inspect filters while the query is open
- Query workflows (5 per account) save that inspect SQL, hex set, and private enrichments. Rename on `/workflows`. View workflow restores hexes, Inspect, Add-ons, and the SQL editor. Quote & run executes it (process missing hexes, then geofence / weather / AI enhance on that run). Subscribe to new data checks stored snapshots when you turn it on (no schedule)
- Add-ons is a picker, off by default: Weather (hail from NOAA MRMS MESH 12Z files), a custom polygon (keep inside or outside from draw, upload, or pasted text), and AI enhance (one typed `ai_column` from each row). Stored kinds stay `geofence`, `hail_history`, and `ai_column`. Only hex-day mm and run result rows are retained
- The agent is a chat bubble at the bottom left of the Explorer (Ctrl/⌘ K). The empty panel has a short intro, four capability cards, and 3 examples: coffee along South Lamar, commercial properties with confirmed phone numbers along South Lamar in Austin TX, and residential addresses in North Austin after a hail storm for a roof-repair door-flyer campaign. Type a request. It highlights hexes from the named area: a corridor along a street or highway (along, on, or just the road name), or a loose polygon around a neighborhood or the area between two places. A city named in the request is searched there, not on the current map city. Austin, Dallas, and Houston have fallback pins when the geocoder misses. The planner uses gpt-4o. Pasted H3 ids or an explicit “selected hexes” still win. It waits for you to confirm those hexes (the card shows the matched place; click the map to add or remove them); creates one process job per missing hex; chooses the query; then shows geofence, Weather, and AI column steps from the prompt, the Weather toggle, or Add-ons already saved on the explorer; then waits for **Approve & run**. Saved Add-ons survive that plan. Geofence and AI column run as specialist jobs on the workflow run. A live caption on the map follows each step. Add-ons **Open agent** opens the same bubble
- Workflows run through an agent quote path (orchestrator + specialist lines), auto-process missing hexes one hex per job, debit a simulated ledger, and credit demo tips from agents
- Ledger page at `/ledger` shows seeded credits, spend, tips, and per-agent entries for the signed-in user (or mock guest)
- Hard caps on hex count, bbox area, and row counts for ingest. Query workflows allow up to 300 disconnected hexes

Click a ready hex to pin a fitted table. Click another ready hex to add it to the same query. The hex chip lists every included H3. Preview hexes frames those cells equally; Exit query leaves inspect. SQL starts collapsed. Each place is matched to its address and building when those ids exist; unmatched rows stay with nulls. Taxonomy `primary < category` splits into main category and category. Snapshot stays the release id; snapshot date is the date prefix. Each column has a Power Query-style filter (remove blanks, or pick one or a few values). The toolbar still covers category, main category, snapshot date, status, building class, confidence (Any / Has a score / Missing / ≥ 0.5 / ≥ 0.7 / ≥ 0.9), underground, phone, email, socials, and official id. Category lists and presence controls can select `null` for empty values. A confidence floor drops rows with no score. While inspect is open, the map draws only matching inspect rows and unfills query hexes that have none. The table also includes sources, attribution, contact fields, building extras, and address extras. Building name, subtype, height, and floors show when Overture has them — names and heights are often empty. Missing hexes have to be processed first. Process pulls real Overture rows.

## Not in this slice

Persisting ingest job records to Supabase. The older `workflows*` tables stay the connected ingest scaffold. Query workflows live in `query_workflows`. Real Rho card debits are not wired yet: the marketplace path uses a simulated in-app ledger and optional OpenAI model calls. See `docs/marketplace.md` and `docs/architecture.md`.

## Docs

- [docs/README.md](docs/README.md)
- [docs/architecture.md](docs/architecture.md)
- [docs/query-spec.md](docs/query-spec.md)
- [docs/workflow-pipeline.md](docs/workflow-pipeline.md)
- [docs/marketplace.md](docs/marketplace.md)
