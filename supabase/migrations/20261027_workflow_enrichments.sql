-- Private workflow enrichments and hail extracts.
-- Query workflows stay owner-only. NOAA GRIB files are never stored.

alter table public.query_workflows
  add column if not exists enrichments jsonb not null default '[]'::jsonb;

alter table public.query_workflows
  drop constraint if exists query_workflows_enrichments_array;

alter table public.query_workflows
  add constraint query_workflows_enrichments_array
  check (jsonb_typeof(enrichments) = 'array' and jsonb_array_length(enrichments) <= 4);

create table if not exists public.query_workflow_runs (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.query_workflows (id) on delete cascade,
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  status text not null check (status in ('queued', 'running', 'succeeded', 'failed')),
  row_count integer not null default 0 check (row_count >= 0),
  error_message text,
  result_rows jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists query_workflow_runs_owner_idx
  on public.query_workflow_runs (owner_user_id, created_at desc);
create index if not exists query_workflow_runs_workflow_idx
  on public.query_workflow_runs (workflow_id, created_at desc);

create table if not exists public.hail_hex_stats (
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  h3_res8 text not null check (h3_res8 ~ '^[0-9a-f]{15}$' and left(h3_res8, 2) = '88'),
  day date not null check (day >= date '2020-11-01'),
  mesh_mm_max real,
  source_key text,
  created_at timestamptz not null default now(),
  primary key (owner_user_id, h3_res8, day)
);

alter table public.query_workflow_runs enable row level security;
alter table public.hail_hex_stats enable row level security;

drop policy if exists query_workflow_runs_owner_select on public.query_workflow_runs;
create policy query_workflow_runs_owner_select
  on public.query_workflow_runs for select
  using (auth.uid() = owner_user_id);

drop policy if exists query_workflow_runs_owner_insert on public.query_workflow_runs;
create policy query_workflow_runs_owner_insert
  on public.query_workflow_runs for insert
  with check (auth.uid() = owner_user_id);

drop policy if exists query_workflow_runs_owner_update on public.query_workflow_runs;
create policy query_workflow_runs_owner_update
  on public.query_workflow_runs for update
  using (auth.uid() = owner_user_id)
  with check (auth.uid() = owner_user_id);

drop policy if exists query_workflow_runs_owner_delete on public.query_workflow_runs;
create policy query_workflow_runs_owner_delete
  on public.query_workflow_runs for delete
  using (auth.uid() = owner_user_id);

drop policy if exists hail_hex_stats_owner_select on public.hail_hex_stats;
create policy hail_hex_stats_owner_select
  on public.hail_hex_stats for select
  using (auth.uid() = owner_user_id);

drop policy if exists hail_hex_stats_owner_insert on public.hail_hex_stats;
create policy hail_hex_stats_owner_insert
  on public.hail_hex_stats for insert
  with check (auth.uid() = owner_user_id);

drop policy if exists hail_hex_stats_owner_update on public.hail_hex_stats;
create policy hail_hex_stats_owner_update
  on public.hail_hex_stats for update
  using (auth.uid() = owner_user_id)
  with check (auth.uid() = owner_user_id);

drop policy if exists hail_hex_stats_owner_delete on public.hail_hex_stats;
create policy hail_hex_stats_owner_delete
  on public.hail_hex_stats for delete
  using (auth.uid() = owner_user_id);

revoke all on table public.query_workflow_runs from public, anon;
grant select, insert, update, delete on table public.query_workflow_runs to authenticated;
revoke all on table public.hail_hex_stats from public, anon;
grant select, insert, update, delete on table public.hail_hex_stats to authenticated;

notify pgrst, 'reload schema';
