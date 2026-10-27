# WorldPulse

WorldPulse is an H3 map for exploring Overture-shaped building, address, and place records. This slice runs locally on synthetic Austin data. Supabase storage and sign-in are the next slice.

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:5173. The default dataset is Places. No API keys are required.

```bash
npm run verify
npm run build
```

`verify` checks that resolution-8 cell boundaries are real H3 polygons and that mock filters change the counts. `build` typechecks and writes `dist/`.

## Data mode

| Variable | Purpose |
| --- | --- |
| `VITE_DATA_MODE` | `mock` (default) or `supabase` |
| `VITE_SUPABASE_URL` | Project URL, used only when mode is `supabase` |
| `VITE_SUPABASE_ANON_KEY` | Publishable anon key |

Copy `.env.example` to `.env` if you want to set them. Vite exposes every `VITE_` variable to the browser. Do not put the Supabase service-role key in this app.

`supabase` mode does not query Overture tables yet. Leave the mode on `mock` until that routing exists. The active mode is shown in the sidebar, or in the menu on phones.

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

Sign-in, saved queries, Row Level Security, the Overture query RPC, Spark ingestion, and Render deployment. See `docs/architecture.md`.

## Docs

- [docs/README.md](docs/README.md)
- [docs/architecture.md](docs/architecture.md)
- [docs/query-spec.md](docs/query-spec.md)
