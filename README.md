# WorldPulse

WorldPulse is an H3 map for exploring Overture-shaped building, address, and place records. This slice runs locally on synthetic Austin data. Supabase storage and sign-in are the next slice.

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:5173. That command starts the Node server, which also serves the app. The default dataset is Places. No API keys are required.

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
| `DATA_MODE` | `mock` (default) or `supabase`. The server reads this. |
| `SUPABASE_URL` | Project URL, used only when mode is `supabase` |
| `SUPABASE_ANON_KEY` | Publishable anon key, read only by the server |

Copy `.env.example` to `.env` if you want to set them. The `VITE_` names of those three variables still work as aliases. Do not put the Supabase service-role key in this app or on Render.

`supabase` mode does not query Overture tables yet. Leave the mode on `mock` until that routing exists. The active mode is shown in the sidebar, or in the menu on phones. It comes from `GET /api/source`.

## Workflow ingestion planning

The server includes segmented-ingestion planning routes:

- `GET /api/workflow-ingestion/limits`
- `POST /api/workflow-ingestion/plan`

The plan route enforces:

- max 20 selected hexes
- one connected hex group
- H3 resolution 8 only
- bbox area cap
- row caps per dataset and per run

It returns a Spark plan JSON with release version, selected hexes, bbox, row caps, and storage prefixes. Spark scaffolding lives in `pipelines/spark/`.

Workflow ingestion envs in `.env.example`:

- `WORKFLOW_MAX_BBOX_AREA_KM2`
- `WORKFLOW_MAX_ROWS_PER_DATASET`
- `WORKFLOW_MAX_TOTAL_ROWS`
- `OVERTURE_SILVER_PREFIX`
- `WORKFLOW_OUTPUT_PREFIX`
- `WORKFLOW_METRICS_PREFIX`

## Deploy

Render runs a Node web service. `render.yaml` builds `main` with Node 22.16.0, starts `node dist-server/index.js`, and sets `DATA_MODE=mock`. The install uses `npm ci --include=dev` so TypeScript and Vite are present when `NODE_ENV` is `production`.

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
- H3 resolution 8 cells for the current view, from `h3-js` boundaries. By default they light up as a lens around the cursor. **Map layers** switches to a full grid or hides them.
- Minimal explorer chrome: map controls, status, selection count, and a direct **Workflows** action
- Workflow ingestion planning endpoints plus a Workflows page that builds/downloads plan JSON from selected hexes
- Query schemas are served by the API whitelist (`/api/query-schemas`) so UI choices track server-side query contracts
- Spark/Supabase workflow scaffolding with hard caps on hex count, bbox area, and row counts

## Not in this slice

Sign-in UX, workflow-run orchestration from the UI, and the Supabase Overture query RPC for explorer reads. Spark execution still runs outside the app. See `docs/architecture.md`.

## Docs

- [docs/README.md](docs/README.md)
- [docs/architecture.md](docs/architecture.md)
- [docs/query-spec.md](docs/query-spec.md)
- [docs/workflow-pipeline.md](docs/workflow-pipeline.md)
