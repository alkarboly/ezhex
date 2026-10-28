-- Table privileges for private query workflows. RLS still limits rows to auth.uid().
-- Run this in the live SQL editor if Workflows returns 42501 / GRANT SELECT.

revoke all on table public.query_workflows from public, anon;
grant select, insert, update, delete on table public.query_workflows to authenticated;

do $$
begin
  if to_regclass('public.query_workflow_runs') is not null then
    revoke all on table public.query_workflow_runs from public, anon;
    grant select, insert, update, delete on table public.query_workflow_runs to authenticated;
  end if;
  if to_regclass('public.hail_hex_stats') is not null then
    revoke all on table public.hail_hex_stats from public, anon;
    grant select, insert, update, delete on table public.hail_hex_stats to authenticated;
  end if;
end $$;

notify pgrst, 'reload schema';
