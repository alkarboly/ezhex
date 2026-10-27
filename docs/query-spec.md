# Query spec

This is the server query contract. It is not SQL. `validateQuery` rejects unknown datasets, fields, and operators before any records are read.

The explorer opens this contract from a hex. Click a ready cell, press Inspect on the pinned hover card, or use Query on the selection dock. That opens a draggable window and runs the three theme queries with empty forms (no store filters). `mergeFeatureRows` left-joins each place to its `address_id` / `building_id`. Unmatched places stay, with nulls. Unused addresses and buildings are appended. Linked building `names.primary`, `subtype`, `class`, `height`, and `num_floors` appear on the place row. Building names are uncommon in Overture; height and floors are often null. Inspect then filters that table in the browser. Category and building dropdowns are distinct values from the loaded rows, not `BASIC_CATEGORIES` / `BUILDING_SUBTYPES`. The sidebar query builder still compiles `PlacesForm` / `BuildingsForm` / `AddressesForm` to this contract for map counts and the results panel; those enum dropdowns also list values observed in the selected hexes. Process always loads all three themes, including GeoJSON geometry and computed `building_id` / `address_id` links. `GET /api/query-schemas` drives the field whitelist. `query_enabled` is true when Supabase is configured or when `DATA_MODE=mock`.

```json
{
  "dataset": "places",
  "h3_cells": ["88489e3467fffff"],
  "filters": [
    { "field": "basic_category", "operator": "in", "value": ["restaurant", "cafe"] }
  ],
  "sort": { "field": "names.primary", "direction": "asc" },
  "limit": 50,
  "offset": 0
}
```

`h3_cells` are `h3-js` indexes. `88489e3467fffff` is the resolution-8 cell for 30.2672, -97.7431. An empty list is valid and returns no rows. A query may include at most 300 cells. `limit` is an integer from 1 to 2000.

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
| `geometry` | `geometry` (Point) | stored, not a filter |

`address` is a search string, not an Overture column. Postal codes in the mock are a coarse Austin assignment, not a geocoder.

## Map counts

`getCellCounts` uses the same filters and whitelist as `runQuery`. Its `h3_cells` are the cells on screen (up to 800), not the selection. This is what drives map coloring.
