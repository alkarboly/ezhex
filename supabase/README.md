# Supabase

No migrations are applied in this slice.

The server client in `src/lib/supabase.ts` is created only when `SUPABASE_URL` and `SUPABASE_ANON_KEY` are both set (`VITE_` names are aliases). It never reads a service-role key, and the browser bundle does not include it.

`src/services/supabase-provider.ts` implements the same provider interface as the mock and refuses queries until a whitelisted RPC exists. See `docs/architecture.md` for the planned `saved_queries` table and feature-table access.
