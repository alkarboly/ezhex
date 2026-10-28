# Supabase

Run these migrations in the Supabase SQL editor, in order:

1. `supabase/migrations/20261027_workflows.sql`
2. `supabase/migrations/20261027_overture.sql`
3. `supabase/migrations/20261027_overture_features.sql`
4. `supabase/migrations/20261027_overture_snapshots.sql`
5. `supabase/migrations/20261027_auth.sql`
6. `supabase/migrations/20261027_query_workflows.sql`
7. `supabase/migrations/20261027_workflow_enrichments.sql`
8. `supabase/migrations/20261027_hex_snapshot_history.sql`

The second file creates `overture_places`, `overture_buildings`, and `overture_addresses`, plus ingest RPCs, and adds the feature columns (`phones`, geometry, association ids) if the tables already exist. The third replaces the ingest RPCs so those columns are written. The fourth adds `sources` on those tables, `overture_release_snapshots`, `overture_hex_snapshots`, and `ingest_overture_snapshot`. The fifth adds `profiles`, the sign-up trigger, and `delete_own_account()`. The sixth adds `query_workflows` (inspect SQL, nationwide hexes, 5 per owner). The seventh adds private `enrichments`, `query_workflow_runs`, and owner-only `hail_hex_stats`. The eighth adds the workflow snapshot pin and run `snapshot_status`. All eight notify PostgREST to reload its schema. After a Render deploy, saving a workflow writes `enrichments` and `release_version`. If those columns are missing, Postgres returns 400 until files 7 and 8 have been run. Anon can read the Overture tables. Writes go through `ingest_overture_*` only. Query workflows write through the signed-in user's JWT. Reprocess hexes after the snapshot migration so sources and snapshot metadata fill in. If Inspect errors with `column overture_places.phones does not exist`, run the features file. In Supabase Auth, turn off Confirm email if create-account should start a session immediately.

The server client in `src/lib/supabase.ts` is created only when `SUPABASE_URL` and `SUPABASE_ANON_KEY` are both set (`VITE_` names are aliases). It never reads a service-role key, and the browser bundle does not include it.

`src/services/supabase-provider.ts` reads those Overture tables with the anon key. Process downloads the public Overture release for the selected hex bbox and upserts through the ingest RPCs. Ingest `workflows*` tables still require `auth.uid()` and are not written by Node jobs. Query workflows are written by Node with the signed-in user's JWT.

Current migration scope:

- `workflows`
- `workflow_subscriptions`
- `workflow_runs`
- `workflow_hex_metrics`
- `overture_places`
- `overture_buildings`
- `overture_addresses`
- `overture_release_snapshots`
- `overture_hex_snapshots`
- `profiles`
- `query_workflows`
- `query_workflow_runs`
- `hail_hex_stats`

`query_workflows.release_version` is an optional historical pin. `overture_hex_snapshots` is the table check for latest vs first process.

All workflow tables use owner-based RLS (`auth.uid() = owner_user_id`). Snapshot tables are readable by anon. Profiles are readable by the signed-in owner. Query workflows are the saved inspect queries (5 per owner, nationwide hexes, private enrichments). The older `workflows*` tables stay the ingest scaffold.
