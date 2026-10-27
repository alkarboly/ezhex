# Architecture

This slice is a local explorer. Nothing is written to a database.

```
Explorer page
  → Zustand (dataset, H3 selection, filter forms)
  → buildQuerySpec() → QuerySpec JSON
  → validateQuery() whitelist
  → DataProvider
       mock: in-memory Austin records
       supabase: not connected; methods throw
  → map cell colors and the results table
```

There is no auth hop. Mock records are not user-scoped because they are not stored. The nav rail shows which provider is active. On phones it is in the menu.

## Map

The map loads H3 resolution 8 cells that intersect the current viewport. It pads the view by 1.25 edge lengths before calling `polygonToCells`, so cells along the edges are drawn whole. Below zoom 11, or above 800 cells, the grid is not drawn. Selected cells are always drawn. Boundaries come from `h3-js` `cellToBoundary` in GeoJSON `[lng, lat]` order. The app does not draw a world-wide grid.

The MapLibre container fills the map slot with absolute positioning. MapLibre's stylesheet sets `.maplibregl-map` to `position: relative`, which collapses that slot and clips the canvas, so the app overrides it. The worker URL is set with `setWorkerUrl` because Vite's prebundle does not sit next to `maplibre-gl-worker.mjs`.

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

The browser client may use the anon key only. The service-role key stays off the frontend.
