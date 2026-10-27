# WorldPulse

WorldPulse is an H3 map for exploring Overture building, address, and place records. Process a hex to download that cell from the public Overture release into Supabase.

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:5173. That command starts the Node server, which also serves the app. Set `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `.env`, then run `supabase/migrations/20261027_overture.sql`. The default dataset is Places.

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
- `GET /api/workflow-ingestion/limits`
- `POST /api/workflow-ingestion/plan`
- `POST /api/workflow-ingestion/jobs`
- `GET /api/workflow-ingestion/jobs`
- `GET /api/workflow-ingestion/jobs/:id`
- `POST /api/workflow-ingestion/jobs/:id/run`
- `POST /api/hex-status`

The plan route enforces:

- max 20 selected hexes
- one connected hex group
- H3 resolution 8 only
- bbox area cap
- row caps per dataset and per run

It returns a Spark plan JSON with release version, selected hexes, bbox, row caps, and storage prefixes. Spark scaffolding lives in `pipelines/spark/`.

`/api/query-schemas` returns dataset/field/operator contracts from the same whitelist used by query validation, plus whether query execution is enabled in the current mode.

`/api/workflow-ingestion/jobs` starts a hex-scoped Overture download into Supabase. Each job includes a `logs` array (`at`, `level`, `message`) that `/jobs` streams live. `/api/hex-status` is ready when those tables have rows for the hex. The map paints empty / green / yellow from that snapshot: no fill, current `OVERTURE_RELEASE`, or an older release.

Workflow ingestion envs in `.env.example`:

- `WORKFLOW_MAX_BBOX_AREA_KM2`
- `WORKFLOW_MAX_ROWS_PER_DATASET`
- `WORKFLOW_MAX_TOTAL_ROWS`
- `OVERTURE_SILVER_PREFIX`
- `WORKFLOW_OUTPUT_PREFIX`
- `WORKFLOW_METRICS_PREFIX`

## Deploy

Render runs a Node web service. `render.yaml` builds `main` with Node 22.16.0, starts `node dist-server/index.js`, and sets `DATA_MODE=supabase`. The install uses `npm ci --include=dev` so TypeScript and Vite are present when `NODE_ENV` is `production`.

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
- H3 resolution 8 cells for the current view, from `h3-js` boundaries. Empty hexes stay unfilled. Green is the current Overture snapshot. Yellow is an older snapshot. **Map layers** switches between lens, grid, or hidden.
- Hex-first explorer: hover a cell to inspect its table (if ready), request processing, or start a workflow. The selection dock does the same for a set of hexes
- Jobs page at `/jobs` starts hex-scoped Overture downloads into Supabase and shows a live log for each job
- Query schemas are served by the API whitelist (`/api/query-schemas`) so UI choices track server-side query contracts
- Hard caps on hex count, bbox area, and row counts

Hover a ready hex and press Inspect, or use Query on the dock, to pin a table of those rows with per-column filters. Missing hexes have to be processed first. Process pulls real Overture rows.

## Not in this slice

Sign-in UX and persisting job records to Supabase. See `docs/architecture.md`.

## Docs

- [docs/README.md](docs/README.md)
- [docs/architecture.md](docs/architecture.md)
- [docs/query-spec.md](docs/query-spec.md)
- [docs/workflow-pipeline.md](docs/workflow-pipeline.md)
