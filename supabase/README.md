# Supabase

Workflow migrations are included in `supabase/migrations/20261027_workflows.sql`.
Run that migration once in the Supabase SQL editor (or your migration runner) before using workflow tables.

The server client in `src/lib/supabase.ts` is created only when `SUPABASE_URL` and `SUPABASE_ANON_KEY` are both set (`VITE_` names are aliases). It never reads a service-role key, and the browser bundle does not include it.

`src/services/supabase-provider.ts` implements the same provider interface as the mock and refuses explorer queries until a whitelisted RPC exists. Ingestion jobs created from the explorer or `/jobs` stay in the Node process for now. They are not written to these tables because the server has no user session for RLS. See `docs/architecture.md` for workflow-table and query-RPC details.

Current migration scope:

- `workflows`
- `workflow_subscriptions`
- `workflow_runs`
- `workflow_hex_metrics`

All workflow tables use owner-based RLS (`auth.uid() = owner_user_id`).
