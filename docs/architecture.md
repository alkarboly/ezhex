# Architecture

This slice is a local explorer. Nothing is written to a database.

```
Browser
  → Zustand builds a QuerySpec JSON
  → POST /api/cell-counts and POST /api/query
  → Node server
       validateQuery() whitelist
       DataProvider, running in the server process
         mock: in-memory Austin records
         supabase: not connected; methods throw
  → JSON back to the map and the results table
```

The browser does not import the dataset or the Supabase client. It still uses `h3-js` to draw cell shapes. Filtering and counts run in Node, from the libraries in `node_modules`, so the server can take on packages that do not belong in a page bundle. There is no auth hop. Mock records are not user-scoped because they are not stored. The nav rail shows the mode the server reports. On phones it is in the menu.

## Map

The map loads H3 resolution 8 cells that intersect the current viewport. It pads the view by 1.25 edge lengths before calling `polygonToCells`, so cells along the edges are drawn whole. Below zoom 11, or above 800 cells, the grid is not drawn. Selected cells are always drawn. Boundaries come from `h3-js` `cellToBoundary` in GeoJSON `[lng, lat]` order. The app does not draw a world-wide grid.

The MapLibre container fills the map slot with absolute positioning. MapLibre's stylesheet sets `.maplibregl-map` to `position: relative`, which collapses that slot and clips the canvas, so the app overrides it. The worker URL is set with `setWorkerUrl` because Vite's prebundle does not sit next to `maplibre-gl-worker.mjs`.

The projection is a globe. On each style load the map sets that projection and a sky in the page background (`#05080c`) with a mint horizon. The atmosphere fades out by zoom 8, so the city view stays flat enough to read the cells. The globe uses the selected basemap. On the dark streets style, land and water are shifted into that same palette below zoom 7 so the continents stay readable, then those paints return to the basemap colors. The camera starts over Africa, turns across the Atlantic onto North America, then flies down to Austin. Viewport cells are not requested until that flight ends, or until the user presses the map, which skips the rest of the flight. `prefers-reduced-motion` skips it and opens on Austin. A basemap change during the flight is applied when the flight ends, and it does not replay.

Cell fill color is the count of records that pass the current attribute filters, including the results search when that dataset has one. The scale runs to the busiest drawn cell. Outlines carry state: amber for selected, mint for the result you clicked, white under the pointer. Clicking a result flies to that cell.

### Cell display

**Map layers** picks one of three modes:

- **Lens** (default). Cells near the pointer fade in with a smooth falloff, and the hovered cell shows its count in a card. The radius scales with zoom. Each frame sets MapLibre feature state (`lens`, `hover`) on the affected cells, so pointer moves never rebuild the GeoJSON source. Before the pointer first reaches the map, the lens rests at the center of the unobstructed map area.
- **Grid** colors every drawn cell.
- **Hidden** hides the H3 layers.

The fill sits under the basemap's roads and buildings, so streets cut through the color. Outlines sit above roads, where they stay unbroken, and under the place labels.

Switching basemaps calls `setStyle(style, { diff: false })`. That reloads the style and fires `style.load`, which re-adds the H3 source and layers. A diffed update drops them without an event. Box zoom is off because it claims every shift-press and swallows shift-click.

### Layout

Desktop has a nav rail, a floating query panel, a results panel, and a selection dock. At 767 px and below, the explorer switches to a top bar, a menu drawer, and a bottom sheet with Filters and Results tabs. The sheet snaps to peek, half, and full.

Touch input is detected with `(hover: none), (pointer: coarse)`. On touch screens the lens stays under a reticle at the map center. Taps add to the selection instead of replacing it. The sheet's **Add** button toggles the cell under the reticle.

Panels report how much of the map they cover. Fly-to, fit-to-selection, and the lens rest point use those insets, so they center on the visible part of the map.

Examples select the seven cells around the visible center, then pan without zooming so the cells stay clear of the results panel that opens. The postal code 78701 example selects downtown Austin instead and zooms there, because that postcode only exists downtown.

## Mock coverage

Synthetic records exist for H3 resolution 8 cells inside:

- west `-97.9`
- south `30.15`
- east `-97.6`
- north `30.45`

Points sit on the cell center, so each record's `h3` matches `latLngToCell`. Counts are generated per cell and respond to filters. They are not a live Overture release.

Sample place categories are limited to labels named in the Overture places guide. Building `subtype` uses the enum in the Overture building schema. Address `locality` and `region` are the two US `address_levels` values: state, then locality.

## Supabase, next

Not applied. The intended shape:

- `places`, `buildings`, and `addresses` stay read-only for signed-in users. Ingest (outside this app) should store `h3_res8` from the feature point or footprint centroid.
- A Postgres function accepts the query spec JSON, checks field names and operators against the same whitelist, and returns rows, the total, and counts by cell. The browser never sends SQL or raw column names.
- `saved_queries` stores `query_config jsonb` as a `QuerySpec`, with RLS `auth.uid() = user_id`.

```sql
create table saved_queries (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id),
    name text not null,
    description text,
    query_config jsonb not null,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);
```

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

`DATA_MODE=mock` is read when the process handles a request, not baked in by Vite. Changing it still needs a restart, which a Render env change does by redeploying. Paths with no file, such as `/settings`, receive `index.html`. A missing file that has an extension returns 404, so a broken script is not replaced with HTML. Hashed files under `/assets/` are cached for a year.

The anon key is not in the blueprint. Add `SUPABASE_URL` and `SUPABASE_ANON_KEY` in the Render dashboard only, and never add the service-role key. The free instance sleeps after a stretch of no requests and wakes on the next one.
