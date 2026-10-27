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
  -> POST /api/hex-status
     ready | missing | processing, plus current | stale snapshot
  -> GET /api/query-schemas (dataset + field/operator whitelist + capability)
  -> GET /api/workflow-ingestion/limits
  -> POST /api/workflow-ingestion/plan
     validates hexes + connectedness + limits
     returns plan JSON with release, bbox, caps, and storage prefixes
  -> POST /api/workflow-ingestion/jobs
     same validation, then an in-memory job
     DATA_MODE=mock: Node runs a local ingest
     Austin seed hexes resolve immediately
     other hexes get synthetic rows, then succeed
  -> POST /api/workflow-ingestion/jobs/:id/run
     reruns a queued or failed job on Node (mock) or fails (supabase)
  -> Spark job consumes that plan when silver parquet exists
     bbox prefilter (if lat/lng columns exist)
     exact filter by h3_res8 in selected cells
     cap checks
     writes segmented outputs + hex metrics
  -> Supabase stores workflow, runs, subscriptions, and metrics
     (Node jobs are not written here yet; no auth hop)
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

`POST /api/workflow-ingestion/jobs`

Same body as the plan route. Returns an `IngestionJob` including `logs`. In mock mode the server processes the hexes immediately and writes queryable rows. Creating the same release + hex set + datasets again returns the existing queued, running, or succeeded job.

`GET /api/workflow-ingestion/jobs`

Lists jobs in the Node process, newest first, with the same `logs` array. The store keeps at most 200 jobs and 200 log lines per job. The store is lost on restart.

`GET /api/workflow-ingestion/jobs/:id`

Returns one job, including its live log stream.

Each log line is `{ at, level, message }` where `level` is `info`, `warn`, or `error`. Lines cover job create, hex list, DuckDB/S3 reads, bbox vs selected-hex counts, Supabase RPC batches, and success or failure.

`POST /api/hex-status`

```json
{ "h3_cells": ["88489e3467fffff"] }
```

Returns per-hex `ready`, `missing`, or `processing`, plus `snapshot` (`current` | `stale` | null), `release_version`, and counts including `current_count` and `stale_count`. The current snapshot is `OVERTURE_RELEASE`.

The explorer hover card and `/jobs` create jobs from selected hexes. `/jobs` shows a live log pane per job and polls while a job is queued or running. Opening `/jobs` also processes any queued mock jobs. `/workflows` still builds and downloads plan JSON. Query opens from a ready hex and uses the same schema whitelist.

`POST /api/workflow-ingestion/jobs/:id/run` processes a queued or failed job on this Node process. In mock mode that writes synthetic rows for the selected hexes so they can be queried. Spark is not required for that path.

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
