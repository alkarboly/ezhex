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

- MapLibre map centered on Austin, with streets (OpenFreeMap) and satellite (Esri) basemaps
- H3 resolution 8 cells for the current view, from `h3-js` boundaries. By default they light up as a lens around the cursor. **Map layers** switches to a full grid or hides them.
- Click, shift-click or Add mode, select visible (300 cell cap), clear, and zoom to the selection
- Places, buildings, and addresses, each with its own filters and a one-click example
- A JSON query spec, plain-language summary, paged results, and CSV export
- Cell color shows the filtered count, scaled to the busiest cell on screen
- Phones get a bottom sheet with Filters and Results tabs. The lens sits under a center reticle, and **Add** selects the cell beneath it.

Selecting cells does not change the color of unselected cells. Color follows the attribute filters. The table lists records inside the selection.

## Not in this slice

Sign-in, saved queries, Row Level Security, the Overture query RPC, and Spark ingestion. See `docs/architecture.md`.

## Docs

- [docs/README.md](docs/README.md)
- [docs/architecture.md](docs/architecture.md)
- [docs/query-spec.md](docs/query-spec.md)
