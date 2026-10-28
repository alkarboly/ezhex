-- Saved inspect / query workflows. Hexes may be nationwide and disconnected.
-- Ingest workflows stay on public.workflows (20 hexes, connected, 220 km2).

create table if not exists public.query_workflows (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  sql text not null check (length(sql) between 1 and 20000),
  custom_sql boolean not null default false,
  h3_cells text[] not null check (cardinality(h3_cells) between 1 and 300),
  filters jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint query_workflows_hexes_valid check (public.res8_hex_array_is_valid(h3_cells)),
  constraint query_workflows_hexes_unique check (public.array_items_unique(h3_cells))
);

create unique index if not exists query_workflows_owner_name_unique
  on public.query_workflows (owner_user_id, lower(trim(name)));
create index if not exists query_workflows_owner_updated_idx
  on public.query_workflows (owner_user_id, updated_at desc);

create or replace function public.query_workflows_cap()
returns trigger
language plpgsql
as $$
begin
  if (
    select count(*)
    from public.query_workflows
    where owner_user_id = new.owner_user_id
  ) >= 5 then
    raise exception 'Workflow limit is 5.';
  end if;
  return new;
end;
$$;

drop trigger if exists query_workflows_cap_trigger on public.query_workflows;
create trigger query_workflows_cap_trigger
  before insert on public.query_workflows
  for each row
  execute procedure public.query_workflows_cap();

create or replace function public.query_workflows_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists query_workflows_touch_trigger on public.query_workflows;
create trigger query_workflows_touch_trigger
  before update on public.query_workflows
  for each row
  execute procedure public.query_workflows_touch();

alter table public.query_workflows enable row level security;

drop policy if exists query_workflows_owner_select on public.query_workflows;
create policy query_workflows_owner_select
  on public.query_workflows
  for select
  using (auth.uid() = owner_user_id);

drop policy if exists query_workflows_owner_insert on public.query_workflows;
create policy query_workflows_owner_insert
  on public.query_workflows
  for insert
  with check (auth.uid() = owner_user_id);

drop policy if exists query_workflows_owner_update on public.query_workflows;
create policy query_workflows_owner_update
  on public.query_workflows
  for update
  using (auth.uid() = owner_user_id)
  with check (auth.uid() = owner_user_id);

drop policy if exists query_workflows_owner_delete on public.query_workflows;
create policy query_workflows_owner_delete
  on public.query_workflows
  for delete
  using (auth.uid() = owner_user_id);

notify pgrst, 'reload schema';
