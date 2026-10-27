# Supabase

No migrations are applied in this slice.

The browser client in `src/lib/supabase.ts` is created only when `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are both set. It never reads a service-role key.

`src/services/supabase-provider.ts` implements the same provider interface as the mock and refuses queries until a whitelisted RPC exists. See `docs/architecture.md` for the planned `saved_queries` table and feature-table access.
