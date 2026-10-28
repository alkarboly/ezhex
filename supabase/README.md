# Supabase

Run these migrations in the Supabase SQL editor, in order:

1. `supabase/migrations/20261027_workflows.sql`
2. `supabase/migrations/20261027_overture.sql`
3. `supabase/migrations/20261027_overture_features.sql`
4. `supabase/migrations/20261027_overture_snapshots.sql`
5. `supabase/migrations/20261027_auth.sql`

The second file creates `overture_places`, `overture_buildings`, and `overture_addresses`, plus ingest RPCs, and adds the feature columns (`phones`, geometry, association ids) if the tables already exist. The third replaces the ingest RPCs so those columns are written. The fourth adds `sources` on those tables, `overture_release_snapshots`, `overture_hex_snapshots`, and `ingest_overture_snapshot`. The fifth adds `profiles`, the sign-up trigger, and `delete_own_account()`. All five notify PostgREST to reload its schema. Anon can read the Overture tables. Writes go through `ingest_overture_*` only. Reprocess hexes after the snapshot migration so sources and snapshot metadata fill in. If Inspect errors with `column overture_places.phones does not exist`, run the features file. In Supabase Auth, turn off Confirm email if create-account should start a session immediately.

The server client in `src/lib/supabase.ts` is created only when `SUPABASE_URL` and `SUPABASE_ANON_KEY` are both set (`VITE_` names are aliases). It never reads a service-role key, and the browser bundle does not include it.

`src/services/supabase-provider.ts` reads those Overture tables with the anon key. Process downloads the public Overture release for the selected hex bbox and upserts through the ingest RPCs. Workflow tables still require `auth.uid()` and are not written by this Node process.

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

All workflow tables use owner-based RLS (`auth.uid() = owner_user_id`). Snapshot tables are readable by anon. Profiles are readable by the signed-in owner. Account-owned workflows are next; do not treat the scaffold as the final workflow contract.
