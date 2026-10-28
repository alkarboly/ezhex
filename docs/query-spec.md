# Query spec

This is the server query contract. It is not SQL. `validateQuery` rejects unknown datasets, fields, and operators before any records are read.

The explorer opens this contract from a hex. Click a ready cell to open a fitted inspect panel. There is no Query button and no hover card. While inspect is open, clicking another ready hex adds it to the selected set and the table refetches. `mergeFeatureRows` left-joins each place to its `address_id` / `building_id`. Unmatched places stay, with nulls. Unused addresses and buildings are appended. Taxonomy labels of the form `primary_category < category` split on the first `<`: `main_category` is the left side, `category` is the right side (or `basic_category` when there is no `<`). Snapshot stays `release_version`; `snapshot_date` is the `YYYY-MM-DD` prefix and is filterable. The inspect table also shows Overture `sources`, derived `attribution`, contact fields, building extras, address extras, and ids. Inspect filters in the browser: multi-select category and main category, snapshot date, status, building class, confidence ≥ / ≤ sliders, and yes/no for underground, phone, email, socials, and official id (`brand.wikidata`). Linked building `names.primary`, `subtype`, `class`, `height`, and `num_floors` appear on the place row. Building names are uncommon in Overture; height and floors are often null. The sidebar query builder still compiles `PlacesForm` / `BuildingsForm` / `AddressesForm` to this contract for map counts and the results panel. Process always loads all three themes, including GeoJSON geometry, `sources`, and computed `building_id` / `address_id` links. `GET /api/query-schemas` drives the field whitelist. `query_enabled` is true when Supabase is configured or when `DATA_MODE=mock`.

```json
{
  "dataset": "places",
  "h3_cells": ["88489e3467fffff"],
  "filters": [
    { "field": "basic_category", "operator": "in", "value": ["restaurant", "cafe"] }
  ],
  "sort": { "field": "names.primary", "direction": "asc" },
  "limit": 50,
  "offset": 0,
  "release_version": "2026-10-21.0"
}
```

`h3_cells` are `h3-js` indexes. `88489e3467fffff` is the resolution-8 cell for 30.2672, -97.7431. An empty list is valid and returns no rows. A query may include at most 300 cells. `limit` is an integer from 1 to 2000.

`release_version` is optional snapshot metadata. When set, the query reads only that Overture release. When omitted, each hex uses its newest stored release so current and historical rows are not mixed. Every result row includes `release_version`, `snapshot_date`, formatted `sources`, and derived `attribution`. `GET /api/releases` lists ingested snapshots (`release_version`, hex and theme counts, `source_datasets`, `current`). `POST /api/cell-counts` accepts the same optional pin.

Filters are combined with AND. Missing numeric values do not pass `gte` or `lte`.

The September 2026 Overture places schema removed `categories`. High-level category filters use `basic_category`. The more specific label is `taxonomy.primary`.

## Places

| Field | Source | Operators |
| --- | --- | --- |
| `names.primary` | `names.primary` | `contains` |
| `basic_category` | `basic_category` | `eq`, `in` |
| `taxonomy.primary` | `taxonomy.primary` | `eq`, `in` |
| `confidence` | `confidence` | `gte`, `lte` |
| `operating_status` | `operating_status` | display and sort only |
| `phones` | `phones` | `contains` |
| `websites` | `websites` | `contains` |
| `brand_name` | `brand.names.primary` | `contains` |
| `building_id` | computed containing or nearest building GERS id | display only |
| `address_id` | computed matched or nearest address GERS id | display only |
| `socials` | `socials` | `contains` |
| `emails` | `emails` | `contains` |
| `brand_wikidata` | `brand.wikidata` | `contains` |
| `taxonomy.hierarchy` | `taxonomy.hierarchy` | display only |
| `main_category` | characters left of the first `<` in `taxonomy.primary` | display only |
| `place_addresses` | `addresses[]` | display only |
| `release_version` | `release_version` | display and sort only |
| `snapshot_date` | `YYYY-MM-DD` prefix of `release_version` | display and sort only |
| `sources` | Overture `sources` (property, dataset, record_id, update_time) | display only |
| `attribution` | derived from `sources[].dataset` and `/licenses` terms | display only |
| `geometry` | `geometry` (Point) | stored, not a filter |

The mock basic categories are `restaurant`, `cafe`, `bar`, `hotel`, `museum`, `park`, and `hospital`. Primary values also include `art_museum` and `playground`. Those lists are the sample in this mock, not the full Overture taxonomy.

`operating_status` in the mock is `open` or `permanently_closed`. A permanently closed place has `confidence` 0. Some open places have no confidence.

## Buildings

| Field | Source | Operators |
| --- | --- | --- |
| `subtype` | `subtype` | `eq`, `in`, `is_null`, `is_not_null` |
| `height` | `height`, meters | `gte`, `lte`, `is_null`, `is_not_null` |
| `num_floors` | `num_floors` | `gte`, `lte`, `is_null`, `is_not_null` |
| `names.primary` | `names.primary` | `contains` |
| `class` | `class` | `eq`, `in`, `is_null`, `is_not_null` |
| `address_id` | computed nearest address GERS id | display only |
| `has_parts` | `has_parts` | display only |
| `is_underground` | `is_underground` | display only |
| `num_floors_underground` | `num_floors_underground` | display and sort only |
| `min_height` | `min_height`, meters | display and sort only |
| `min_floor` | `min_floor` | display and sort only |
| `level` | `level` | display and sort only |
| `facade_color` | `facade_color` | display only |
| `facade_material` | `facade_material` | display only |
| `roof_material` | `roof_material` | display only |
| `roof_shape` | `roof_shape` | display only |
| `roof_direction` | `roof_direction` | display and sort only |
| `roof_color` | `roof_color` | display only |
| `release_version` | `release_version` | display and sort only |
| `snapshot_date` | `YYYY-MM-DD` prefix of `release_version` | display and sort only |
| `sources` | Overture `sources` (property, dataset, record_id, update_time) | display only |
| `attribution` | derived from `sources[].dataset` and `/licenses` terms | display only |
| `geometry` | `geometry` (Polygon or MultiPolygon) | stored, not a filter |

`subtype` values are the Overture building enum: `agricultural`, `civic`, `commercial`, `education`, `entertainment`, `industrial`, `medical`, `military`, `outbuilding`, `religious`, `residential`, `service`, `transportation`. Null means the source value is absent.

## Addresses

Overture stores US locality in `address_levels`, not as top-level columns. For this mock the first level is the state and the second is the locality.

| Field | Source | Operators |
| --- | --- | --- |
| `number` | `number` | display and sort only |
| `street` | `street` | `contains` |
| `locality` | `address_levels[1].value` | `contains` |
| `region` | `address_levels[0].value` | `contains` |
| `postcode` | `postcode` | `eq` |
| `address` | derived from number, street, locality, region, and postcode | `contains` |
| `unit` | `unit` | `contains` |
| `postal_city` | `postal_city` | `contains` |
| `building_id` | computed nearest building GERS id | display only |
| `country` | `country` | display and sort only |
| `release_version` | `release_version` | display and sort only |
| `snapshot_date` | `YYYY-MM-DD` prefix of `release_version` | display and sort only |
| `sources` | Overture `sources` (property, dataset, record_id, update_time) | display only |
| `attribution` | derived from `sources[].dataset` and `/licenses` terms | display only |
| `geometry` | `geometry` (Point) | stored, not a filter |

`address` is a search string, not an Overture column. Postal codes in the mock are a coarse Austin assignment, not a geocoder.

## Map counts

`getCellCounts` uses the same filters and whitelist as `runQuery`. Its `h3_cells` are the cells on screen (up to 800), not the selection. This is what drives map coloring.
