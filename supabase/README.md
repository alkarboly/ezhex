# Supabase

Run these migrations in the Supabase SQL editor, in order:

1. `supabase/migrations/20261027_workflows.sql`
2. `supabase/migrations/20261027_overture.sql`
3. `supabase/migrations/20261027_overture_features.sql`

The second file creates `overture_places`, `overture_buildings`, and `overture_addresses`, plus ingest RPCs. The third adds geometry, extra Overture columns, and computed association ids. Anon can read those tables. Writes go through `ingest_overture_*` only. Reprocess hexes after the third migration.

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

All workflow tables use owner-based RLS (`auth.uid() = owner_user_id`).
