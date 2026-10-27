# Workflow pipeline

This document defines segmented ingestion for workflow runs.

## Scope and safety limits

Every run is scoped to one selected H3 resolution-8 group:

- max 20 hexes
- hexes must be one connected component
- bbox is derived from selected hexes
- bbox area must be <= 220 km2
- per-dataset row cap (default 400,000, hard cap 1,000,000)
- total-row cap (default 900,000, hard cap 2,000,000)

The server enforces these limits when building a plan. The Spark job enforces them again.

## End-to-end flow

```
UI / API caller
  -> POST /api/workflow-ingestion/plan
     validates hexes + connectedness + limits
     returns plan JSON with release, bbox, caps, and storage prefixes
  -> Spark job consumes that plan
     bbox prefilter (if lat/lng columns exist)
     exact filter by h3_res8 in selected cells
     cap checks
     writes segmented outputs + hex metrics
  -> Supabase stores workflow, runs, subscriptions, and metrics
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

The app now exposes this through the **Workflows** page (`/workflows`), which can create and download plan JSON from the current map selection.

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

All tables are protected with owner-based RLS using `auth.uid() = owner_user_id`.

## Notes

- Connectivity is enforced by API/job logic, not SQL.
- Keep `release_version` immutable per run.
- Keep caps strict. Lower limits through env vars; code will not allow values above the hard caps.
