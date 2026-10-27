-- Overture feature tables for hex-scoped ingest and explorer queries.
-- Anon can read. Writes go through SECURITY DEFINER RPCs with caps.

create table if not exists public.overture_places (
  id text not null,
  release_version text not null check (release_version ~ '^[A-Za-z0-9._-]{3,64}$'),
  h3_res8 text not null,
  lat double precision not null check (lat >= -90 and lat <= 90),
  lng double precision not null check (lng >= -180 and lng <= 180),
  names_primary text,
  basic_category text,
  taxonomy_primary text,
  taxonomy_hierarchy text[],
  confidence double precision,
  operating_status text,
  ingested_at timestamptz not null default now(),
  primary key (id, release_version),
  constraint overture_places_hex_valid check (public.res8_hex_array_is_valid(array[h3_res8]))
);

create index if not exists overture_places_hex_idx on public.overture_places (h3_res8);
create index if not exists overture_places_release_hex_idx on public.overture_places (release_version, h3_res8);

create table if not exists public.overture_buildings (
  id text not null,
  release_version text not null check (release_version ~ '^[A-Za-z0-9._-]{3,64}$'),
  h3_res8 text not null,
  lat double precision not null check (lat >= -90 and lat <= 90),
  lng double precision not null check (lng >= -180 and lng <= 180),
  subtype text,
  height double precision,
  num_floors integer,
  ingested_at timestamptz not null default now(),
  primary key (id, release_version),
  constraint overture_buildings_hex_valid check (public.res8_hex_array_is_valid(array[h3_res8]))
);

create index if not exists overture_buildings_hex_idx on public.overture_buildings (h3_res8);
create index if not exists overture_buildings_release_hex_idx on public.overture_buildings (release_version, h3_res8);

create table if not exists public.overture_addresses (
  id text not null,
  release_version text not null check (release_version ~ '^[A-Za-z0-9._-]{3,64}$'),
  h3_res8 text not null,
  lat double precision not null check (lat >= -90 and lat <= 90),
  lng double precision not null check (lng >= -180 and lng <= 180),
  country text,
  number text,
  street text,
  postcode text,
  region text,
  locality text,
  ingested_at timestamptz not null default now(),
  primary key (id, release_version),
  constraint overture_addresses_hex_valid check (public.res8_hex_array_is_valid(array[h3_res8]))
);

create index if not exists overture_addresses_hex_idx on public.overture_addresses (h3_res8);
create index if not exists overture_addresses_release_hex_idx on public.overture_addresses (release_version, h3_res8);

alter table public.overture_places enable row level security;
alter table public.overture_buildings enable row level security;
alter table public.overture_addresses enable row level security;

drop policy if exists overture_places_read on public.overture_places;
create policy overture_places_read on public.overture_places
  for select to anon, authenticated using (true);

drop policy if exists overture_buildings_read on public.overture_buildings;
create policy overture_buildings_read on public.overture_buildings
  for select to anon, authenticated using (true);

drop policy if exists overture_addresses_read on public.overture_addresses;
create policy overture_addresses_read on public.overture_addresses
  for select to anon, authenticated using (true);

grant select on public.overture_places to anon, authenticated;
grant select on public.overture_buildings to anon, authenticated;
grant select on public.overture_addresses to anon, authenticated;

create or replace function public.ingest_overture_places(p_release text, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted integer;
begin
  if p_release !~ '^[A-Za-z0-9._-]{3,64}$' then
    raise exception 'invalid release_version';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows must be a JSON array';
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    raise exception 'batch exceeds 2000 rows';
  end if;

  insert into public.overture_places (
    id, release_version, h3_res8, lat, lng, names_primary, basic_category,
    taxonomy_primary, taxonomy_hierarchy, confidence, operating_status
  )
  select
    r->>'id',
    p_release,
    r->>'h3_res8',
    (r->>'lat')::double precision,
    (r->>'lng')::double precision,
    nullif(r->>'names_primary', ''),
    nullif(r->>'basic_category', ''),
    nullif(r->>'taxonomy_primary', ''),
    case
      when jsonb_typeof(r->'taxonomy_hierarchy') = 'array' then array(
        select jsonb_array_elements_text(r->'taxonomy_hierarchy')
      )
      else null
    end,
    nullif(r->>'confidence', '')::double precision,
    nullif(r->>'operating_status', '')
  from jsonb_array_elements(p_rows) as r
  where coalesce(r->>'id', '') <> ''
    and public.res8_hex_array_is_valid(array[r->>'h3_res8'])
  on conflict (id, release_version) do update set
    h3_res8 = excluded.h3_res8,
    lat = excluded.lat,
    lng = excluded.lng,
    names_primary = excluded.names_primary,
    basic_category = excluded.basic_category,
    taxonomy_primary = excluded.taxonomy_primary,
    taxonomy_hierarchy = excluded.taxonomy_hierarchy,
    confidence = excluded.confidence,
    operating_status = excluded.operating_status,
    ingested_at = now();

  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

create or replace function public.ingest_overture_buildings(p_release text, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted integer;
begin
  if p_release !~ '^[A-Za-z0-9._-]{3,64}$' then
    raise exception 'invalid release_version';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows must be a JSON array';
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    raise exception 'batch exceeds 2000 rows';
  end if;

  insert into public.overture_buildings (
    id, release_version, h3_res8, lat, lng, subtype, height, num_floors
  )
  select
    r->>'id',
    p_release,
    r->>'h3_res8',
    (r->>'lat')::double precision,
    (r->>'lng')::double precision,
    nullif(r->>'subtype', ''),
    nullif(r->>'height', '')::double precision,
    nullif(r->>'num_floors', '')::integer
  from jsonb_array_elements(p_rows) as r
  where coalesce(r->>'id', '') <> ''
    and public.res8_hex_array_is_valid(array[r->>'h3_res8'])
  on conflict (id, release_version) do update set
    h3_res8 = excluded.h3_res8,
    lat = excluded.lat,
    lng = excluded.lng,
    subtype = excluded.subtype,
    height = excluded.height,
    num_floors = excluded.num_floors,
    ingested_at = now();

  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

create or replace function public.ingest_overture_addresses(p_release text, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted integer;
begin
  if p_release !~ '^[A-Za-z0-9._-]{3,64}$' then
    raise exception 'invalid release_version';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows must be a JSON array';
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    raise exception 'batch exceeds 2000 rows';
  end if;

  insert into public.overture_addresses (
    id, release_version, h3_res8, lat, lng, country, number, street, postcode, region, locality
  )
  select
    r->>'id',
    p_release,
    r->>'h3_res8',
    (r->>'lat')::double precision,
    (r->>'lng')::double precision,
    nullif(r->>'country', ''),
    nullif(r->>'number', ''),
    nullif(r->>'street', ''),
    nullif(r->>'postcode', ''),
    nullif(r->>'region', ''),
    nullif(r->>'locality', '')
  from jsonb_array_elements(p_rows) as r
  where coalesce(r->>'id', '') <> ''
    and public.res8_hex_array_is_valid(array[r->>'h3_res8'])
  on conflict (id, release_version) do update set
    h3_res8 = excluded.h3_res8,
    lat = excluded.lat,
    lng = excluded.lng,
    country = excluded.country,
    number = excluded.number,
    street = excluded.street,
    postcode = excluded.postcode,
    region = excluded.region,
    locality = excluded.locality,
    ingested_at = now();

  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

revoke all on function public.ingest_overture_places(text, jsonb) from public;
revoke all on function public.ingest_overture_buildings(text, jsonb) from public;
revoke all on function public.ingest_overture_addresses(text, jsonb) from public;
grant execute on function public.ingest_overture_places(text, jsonb) to anon, authenticated;
grant execute on function public.ingest_overture_buildings(text, jsonb) to anon, authenticated;
grant execute on function public.ingest_overture_addresses(text, jsonb) to anon, authenticated;

alter table public.overture_places
  add column if not exists geometry jsonb,
  add column if not exists websites text[],
  add column if not exists socials text[],
  add column if not exists emails text[],
  add column if not exists phones text[],
  add column if not exists brand_name text,
  add column if not exists brand_wikidata text,
  add column if not exists place_addresses jsonb,
  add column if not exists building_id text,
  add column if not exists address_id text;

alter table public.overture_buildings
  add column if not exists geometry jsonb,
  add column if not exists class text,
  add column if not exists names_primary text,
  add column if not exists has_parts boolean,
  add column if not exists is_underground boolean,
  add column if not exists num_floors_underground integer,
  add column if not exists min_height double precision,
  add column if not exists min_floor integer,
  add column if not exists level integer,
  add column if not exists facade_color text,
  add column if not exists facade_material text,
  add column if not exists roof_material text,
  add column if not exists roof_shape text,
  add column if not exists roof_direction double precision,
  add column if not exists roof_color text,
  add column if not exists address_id text;

alter table public.overture_addresses
  add column if not exists geometry jsonb,
  add column if not exists unit text,
  add column if not exists postal_city text,
  add column if not exists building_id text;

notify pgrst, 'reload schema';
