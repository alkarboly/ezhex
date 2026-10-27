-- Workflow and segmented-ingestion schema.
-- Guardrails are strict: one connected hex group, max 20 hexes, capped bbox area,
-- and capped row limits per run.

create extension if not exists pgcrypto;

create or replace function public.array_items_unique(input text[])
returns boolean
language sql
immutable
as $$
  select cardinality(input) = cardinality(array_agg(distinct value))
  from unnest(input) as value;
$$;

create or replace function public.res8_hex_array_is_valid(input text[])
returns boolean
language sql
immutable
as $$
  select coalesce(bool_and(value ~ '^[0-9a-f]{15}$' and left(value, 2) = '88'), false)
  from unnest(input) as value;
$$;

create or replace function public.workflow_datasets_are_valid(input text[])
returns boolean
language sql
immutable
as $$
  select coalesce(bool_and(value in ('places', 'addresses', 'buildings')), false)
  from unnest(input) as value;
$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'workflow_status') then
    create type public.workflow_status as enum ('draft', 'active', 'paused', 'archived');
  end if;
  if not exists (select 1 from pg_type where typname = 'workflow_run_status') then
    create type public.workflow_run_status as enum ('queued', 'running', 'succeeded', 'failed', 'cancelled');
  end if;
  if not exists (select 1 from pg_type where typname = 'workflow_trigger') then
    create type public.workflow_trigger as enum ('manual', 'scheduled', 'release');
  end if;
end $$;

create table if not exists public.workflows (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  description text,
  release_version text not null check (release_version ~ '^[A-Za-z0-9._-]{3,64}$'),
  h3_resolution smallint not null default 8 check (h3_resolution = 8),
  selected_hexes text[] not null check (cardinality(selected_hexes) between 1 and 20),
  hex_set_hash text not null check (hex_set_hash ~ '^[0-9a-f]{64}$'),
  bbox_west double precision not null check (bbox_west >= -180 and bbox_west <= 180),
  bbox_south double precision not null check (bbox_south >= -90 and bbox_south <= 90),
  bbox_east double precision not null check (bbox_east >= -180 and bbox_east <= 180),
  bbox_north double precision not null check (bbox_north >= -90 and bbox_north <= 90),
  bbox_area_km2 double precision not null check (bbox_area_km2 > 0 and bbox_area_km2 <= 220),
  datasets text[] not null default array['places', 'addresses', 'buildings']::text[],
  query_config jsonb not null default '{}'::jsonb,
  status public.workflow_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workflows_hexes_valid check (public.res8_hex_array_is_valid(selected_hexes)),
  constraint workflows_hexes_unique check (public.array_items_unique(selected_hexes)),
  constraint workflows_datasets_valid check (public.workflow_datasets_are_valid(datasets)),
  constraint workflows_datasets_unique check (public.array_items_unique(datasets))
);

create unique index if not exists workflows_owner_name_unique on public.workflows (owner_user_id, name);
create index if not exists workflows_owner_status_idx on public.workflows (owner_user_id, status);
create index if not exists workflows_hex_hash_idx on public.workflows (hex_set_hash);

create table if not exists public.workflow_subscriptions (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.workflows (id) on delete cascade,
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  trigger public.workflow_trigger not null default 'release',
  cron text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workflow_subscriptions_cron_required
    check ((trigger = 'scheduled' and cron is not null) or (trigger <> 'scheduled' and cron is null))
);

create index if not exists workflow_subscriptions_owner_idx on public.workflow_subscriptions (owner_user_id, active);
create index if not exists workflow_subscriptions_workflow_idx on public.workflow_subscriptions (workflow_id, active);

create table if not exists public.workflow_runs (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.workflows (id) on delete cascade,
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  run_id text not null unique check (run_id ~ '^[A-Za-z0-9-]{12,120}$'),
  release_version text not null check (release_version ~ '^[A-Za-z0-9._-]{3,64}$'),
  pipeline_version text not null check (length(trim(pipeline_version)) between 2 and 64),
  trigger public.workflow_trigger not null default 'manual',
  status public.workflow_run_status not null default 'queued',
  selected_hexes text[] not null check (cardinality(selected_hexes) between 1 and 20),
  hex_set_hash text not null check (hex_set_hash ~ '^[0-9a-f]{64}$'),
  datasets text[] not null check (cardinality(datasets) between 1 and 3),
  max_rows_per_dataset integer not null check (max_rows_per_dataset > 0 and max_rows_per_dataset <= 1000000),
  max_total_rows integer not null check (max_total_rows > 0 and max_total_rows <= 2000000),
  input_prefix text not null,
  output_prefix text not null,
  metrics_prefix text not null,
  rows_places bigint not null default 0 check (rows_places >= 0),
  rows_addresses bigint not null default 0 check (rows_addresses >= 0),
  rows_buildings bigint not null default 0 check (rows_buildings >= 0),
  rows_total bigint not null default 0 check (rows_total >= 0),
  started_at timestamptz,
  finished_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workflow_runs_hexes_valid check (public.res8_hex_array_is_valid(selected_hexes)),
  constraint workflow_runs_hexes_unique check (public.array_items_unique(selected_hexes)),
  constraint workflow_runs_datasets_valid check (public.workflow_datasets_are_valid(datasets)),
  constraint workflow_runs_datasets_unique check (public.array_items_unique(datasets)),
  constraint workflow_runs_started_before_finished check (finished_at is null or started_at is null or finished_at >= started_at)
);

create unique index if not exists workflow_runs_unique_workload
  on public.workflow_runs (workflow_id, release_version, hex_set_hash, pipeline_version);
create index if not exists workflow_runs_owner_created_idx on public.workflow_runs (owner_user_id, created_at desc);
create index if not exists workflow_runs_status_idx on public.workflow_runs (status, created_at desc);

create table if not exists public.workflow_hex_metrics (
  run_id uuid not null references public.workflow_runs (id) on delete cascade,
  h3_res8 text not null check (h3_res8 ~ '^[0-9a-f]{15}$' and left(h3_res8, 2) = '88'),
  places_count bigint not null default 0 check (places_count >= 0),
  addresses_count bigint not null default 0 check (addresses_count >= 0),
  buildings_count bigint not null default 0 check (buildings_count >= 0),
  place_address_match_rate double precision check (place_address_match_rate is null or (place_address_match_rate >= 0 and place_address_match_rate <= 1)),
  place_in_building_rate double precision check (place_in_building_rate is null or (place_in_building_rate >= 0 and place_in_building_rate <= 1)),
  address_in_building_rate double precision check (address_in_building_rate is null or (address_in_building_rate >= 0 and address_in_building_rate <= 1)),
  created_at timestamptz not null default now(),
  primary key (run_id, h3_res8)
);

create index if not exists workflow_hex_metrics_h3_idx on public.workflow_hex_metrics (h3_res8);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists workflows_set_updated_at on public.workflows;
create trigger workflows_set_updated_at
before update on public.workflows
for each row execute procedure public.set_updated_at();

drop trigger if exists workflow_subscriptions_set_updated_at on public.workflow_subscriptions;
create trigger workflow_subscriptions_set_updated_at
before update on public.workflow_subscriptions
for each row execute procedure public.set_updated_at();

drop trigger if exists workflow_runs_set_updated_at on public.workflow_runs;
create trigger workflow_runs_set_updated_at
before update on public.workflow_runs
for each row execute procedure public.set_updated_at();

alter table public.workflows enable row level security;
alter table public.workflow_subscriptions enable row level security;
alter table public.workflow_runs enable row level security;
alter table public.workflow_hex_metrics enable row level security;

create policy "workflows owner select" on public.workflows
for select using (auth.uid() = owner_user_id);
create policy "workflows owner insert" on public.workflows
for insert with check (auth.uid() = owner_user_id);
create policy "workflows owner update" on public.workflows
for update using (auth.uid() = owner_user_id) with check (auth.uid() = owner_user_id);
create policy "workflows owner delete" on public.workflows
for delete using (auth.uid() = owner_user_id);

create policy "workflow_subscriptions owner select" on public.workflow_subscriptions
for select using (auth.uid() = owner_user_id);
create policy "workflow_subscriptions owner insert" on public.workflow_subscriptions
for insert with check (auth.uid() = owner_user_id);
create policy "workflow_subscriptions owner update" on public.workflow_subscriptions
for update using (auth.uid() = owner_user_id) with check (auth.uid() = owner_user_id);
create policy "workflow_subscriptions owner delete" on public.workflow_subscriptions
for delete using (auth.uid() = owner_user_id);

create policy "workflow_runs owner select" on public.workflow_runs
for select using (auth.uid() = owner_user_id);
create policy "workflow_runs owner insert" on public.workflow_runs
for insert with check (auth.uid() = owner_user_id);
create policy "workflow_runs owner update" on public.workflow_runs
for update using (auth.uid() = owner_user_id) with check (auth.uid() = owner_user_id);

create policy "workflow_hex_metrics owner select" on public.workflow_hex_metrics
for select using (
  exists (
    select 1
    from public.workflow_runs runs
    where runs.id = workflow_hex_metrics.run_id
      and runs.owner_user_id = auth.uid()
  )
);
create policy "workflow_hex_metrics owner insert" on public.workflow_hex_metrics
for insert with check (
  exists (
    select 1
    from public.workflow_runs runs
    where runs.id = workflow_hex_metrics.run_id
      and runs.owner_user_id = auth.uid()
  )
);
create policy "workflow_hex_metrics owner update" on public.workflow_hex_metrics
for update using (
  exists (
    select 1
    from public.workflow_runs runs
    where runs.id = workflow_hex_metrics.run_id
      and runs.owner_user_id = auth.uid()
  )
) with check (
  exists (
    select 1
    from public.workflow_runs runs
    where runs.id = workflow_hex_metrics.run_id
      and runs.owner_user_id = auth.uid()
  )
);
create policy "workflow_hex_metrics owner delete" on public.workflow_hex_metrics
for delete using (
  exists (
    select 1
    from public.workflow_runs runs
    where runs.id = workflow_hex_metrics.run_id
      and runs.owner_user_id = auth.uid()
  )
);
