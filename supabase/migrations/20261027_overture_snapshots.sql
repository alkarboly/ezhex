-- Release snapshot metadata, Overture sources on feature rows, and ingest RPC updates.
-- Run after 20261027_overture_features.sql.

alter table public.overture_places add column if not exists sources jsonb;
alter table public.overture_buildings add column if not exists sources jsonb;
alter table public.overture_addresses add column if not exists sources jsonb;

create table if not exists public.overture_release_snapshots (
  release_version text primary key check (release_version ~ '^[A-Za-z0-9._-]{3,64}$'),
  accessed_on date not null default current_date,
  source_uri text not null default '',
  themes text[] not null default array['places', 'buildings', 'addresses']::text[],
  hexes text[] not null default '{}',
  hex_count integer not null default 0,
  place_count integer not null default 0,
  building_count integer not null default 0,
  address_count integer not null default 0,
  source_datasets text[] not null default '{}',
  ingested_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.overture_hex_snapshots (
  release_version text not null references public.overture_release_snapshots (release_version) on delete cascade,
  h3_res8 text not null,
  place_count integer not null default 0,
  building_count integer not null default 0,
  address_count integer not null default 0,
  source_datasets text[] not null default '{}',
  ingested_at timestamptz not null default now(),
  primary key (release_version, h3_res8),
  constraint overture_hex_snapshots_hex_valid check (public.res8_hex_array_is_valid(array[h3_res8]))
);

create index if not exists overture_hex_snapshots_hex_idx on public.overture_hex_snapshots (h3_res8);

alter table public.overture_release_snapshots enable row level security;
alter table public.overture_hex_snapshots enable row level security;

drop policy if exists overture_release_snapshots_read on public.overture_release_snapshots;
create policy overture_release_snapshots_read on public.overture_release_snapshots
  for select to anon, authenticated using (true);

drop policy if exists overture_hex_snapshots_read on public.overture_hex_snapshots;
create policy overture_hex_snapshots_read on public.overture_hex_snapshots
  for select to anon, authenticated using (true);

grant select on public.overture_release_snapshots to anon, authenticated;
grant select on public.overture_hex_snapshots to anon, authenticated;

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
    taxonomy_primary, taxonomy_hierarchy, confidence, operating_status,
    geometry, websites, socials, emails, phones, brand_name, brand_wikidata,
    place_addresses, building_id, address_id, sources
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
    nullif(r->>'operating_status', ''),
    case when jsonb_typeof(r->'geometry') = 'object' then r->'geometry' else null end,
    case
      when jsonb_typeof(r->'websites') = 'array' then array(select jsonb_array_elements_text(r->'websites'))
      else null
    end,
    case
      when jsonb_typeof(r->'socials') = 'array' then array(select jsonb_array_elements_text(r->'socials'))
      else null
    end,
    case
      when jsonb_typeof(r->'emails') = 'array' then array(select jsonb_array_elements_text(r->'emails'))
      else null
    end,
    case
      when jsonb_typeof(r->'phones') = 'array' then array(select jsonb_array_elements_text(r->'phones'))
      else null
    end,
    nullif(r->>'brand_name', ''),
    nullif(r->>'brand_wikidata', ''),
    case when jsonb_typeof(r->'place_addresses') = 'array' then r->'place_addresses' else null end,
    nullif(r->>'building_id', ''),
    nullif(r->>'address_id', ''),
    case when jsonb_typeof(r->'sources') = 'array' then r->'sources' else null end
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
    geometry = excluded.geometry,
    websites = excluded.websites,
    socials = excluded.socials,
    emails = excluded.emails,
    phones = excluded.phones,
    brand_name = excluded.brand_name,
    brand_wikidata = excluded.brand_wikidata,
    place_addresses = excluded.place_addresses,
    building_id = excluded.building_id,
    address_id = excluded.address_id,
    sources = excluded.sources,
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
    id, release_version, h3_res8, lat, lng, subtype, height, num_floors,
    geometry, class, names_primary, has_parts, is_underground, num_floors_underground,
    min_height, min_floor, level, facade_color, facade_material, roof_material,
    roof_shape, roof_direction, roof_color, address_id, sources
  )
  select
    r->>'id',
    p_release,
    r->>'h3_res8',
    (r->>'lat')::double precision,
    (r->>'lng')::double precision,
    nullif(r->>'subtype', ''),
    nullif(r->>'height', '')::double precision,
    nullif(r->>'num_floors', '')::integer,
    case when jsonb_typeof(r->'geometry') = 'object' then r->'geometry' else null end,
    nullif(r->>'class', ''),
    nullif(r->>'names_primary', ''),
    case
      when r->>'has_parts' in ('true', 't', '1') then true
      when r->>'has_parts' in ('false', 'f', '0') then false
      else null
    end,
    case
      when r->>'is_underground' in ('true', 't', '1') then true
      when r->>'is_underground' in ('false', 'f', '0') then false
      else null
    end,
    nullif(r->>'num_floors_underground', '')::integer,
    nullif(r->>'min_height', '')::double precision,
    nullif(r->>'min_floor', '')::integer,
    nullif(r->>'level', '')::integer,
    nullif(r->>'facade_color', ''),
    nullif(r->>'facade_material', ''),
    nullif(r->>'roof_material', ''),
    nullif(r->>'roof_shape', ''),
    nullif(r->>'roof_direction', '')::double precision,
    nullif(r->>'roof_color', ''),
    nullif(r->>'address_id', ''),
    case when jsonb_typeof(r->'sources') = 'array' then r->'sources' else null end
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
    geometry = excluded.geometry,
    class = excluded.class,
    names_primary = excluded.names_primary,
    has_parts = excluded.has_parts,
    is_underground = excluded.is_underground,
    num_floors_underground = excluded.num_floors_underground,
    min_height = excluded.min_height,
    min_floor = excluded.min_floor,
    level = excluded.level,
    facade_color = excluded.facade_color,
    facade_material = excluded.facade_material,
    roof_material = excluded.roof_material,
    roof_shape = excluded.roof_shape,
    roof_direction = excluded.roof_direction,
    roof_color = excluded.roof_color,
    address_id = excluded.address_id,
    sources = excluded.sources,
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
    id, release_version, h3_res8, lat, lng, country, number, street, postcode, region, locality,
    geometry, unit, postal_city, building_id, sources
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
    nullif(r->>'locality', ''),
    case when jsonb_typeof(r->'geometry') = 'object' then r->'geometry' else null end,
    nullif(r->>'unit', ''),
    nullif(r->>'postal_city', ''),
    nullif(r->>'building_id', ''),
    case when jsonb_typeof(r->'sources') = 'array' then r->'sources' else null end
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
    geometry = excluded.geometry,
    unit = excluded.unit,
    postal_city = excluded.postal_city,
    building_id = excluded.building_id,
    sources = excluded.sources,
    ingested_at = now();

  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

create or replace function public.ingest_overture_snapshot(p_release text, p_meta jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  hex_row jsonb;
  written integer := 0;
begin
  if p_release !~ '^[A-Za-z0-9._-]{3,64}$' then
    raise exception 'invalid release_version';
  end if;
  if jsonb_typeof(p_meta) <> 'object' then
    raise exception 'snapshot metadata must be an object';
  end if;

  insert into public.overture_release_snapshots (release_version, accessed_on, source_uri, themes)
  values (
    p_release,
    coalesce(nullif(p_meta->>'accessed_on', '')::date, current_date),
    coalesce(p_meta->>'source_uri', ''),
    case
      when jsonb_typeof(p_meta->'themes') = 'array' then array(
        select jsonb_array_elements_text(p_meta->'themes')
      )
      else array['places', 'buildings', 'addresses']::text[]
    end
  )
  on conflict (release_version) do update set
    accessed_on = excluded.accessed_on,
    source_uri = coalesce(nullif(excluded.source_uri, ''), public.overture_release_snapshots.source_uri),
    themes = excluded.themes,
    updated_at = now();

  if jsonb_typeof(p_meta->'hexes') = 'array' then
    for hex_row in select value from jsonb_array_elements(p_meta->'hexes')
    loop
      if not public.res8_hex_array_is_valid(array[hex_row->>'h3_res8']) then
        continue;
      end if;
      insert into public.overture_hex_snapshots (
        release_version, h3_res8, place_count, building_count, address_count, source_datasets
      )
      values (
        p_release,
        hex_row->>'h3_res8',
        coalesce(nullif(hex_row->>'place_count', '')::integer, 0),
        coalesce(nullif(hex_row->>'building_count', '')::integer, 0),
        coalesce(nullif(hex_row->>'address_count', '')::integer, 0),
        case
          when jsonb_typeof(hex_row->'source_datasets') = 'array' then array(
            select jsonb_array_elements_text(hex_row->'source_datasets')
          )
          else '{}'
        end
      )
      on conflict (release_version, h3_res8) do update set
        place_count = excluded.place_count,
        building_count = excluded.building_count,
        address_count = excluded.address_count,
        source_datasets = excluded.source_datasets,
        ingested_at = now();
      written := written + 1;
    end loop;
  end if;

  update public.overture_release_snapshots as snap
  set
    hexes = coalesce((
      select array_agg(hex.h3_res8 order by hex.h3_res8)
      from public.overture_hex_snapshots as hex
      where hex.release_version = p_release
    ), '{}'),
    hex_count = (
      select count(*)::integer from public.overture_hex_snapshots as hex where hex.release_version = p_release
    ),
    place_count = coalesce((
      select sum(hex.place_count)::integer from public.overture_hex_snapshots as hex where hex.release_version = p_release
    ), 0),
    building_count = coalesce((
      select sum(hex.building_count)::integer from public.overture_hex_snapshots as hex where hex.release_version = p_release
    ), 0),
    address_count = coalesce((
      select sum(hex.address_count)::integer from public.overture_hex_snapshots as hex where hex.release_version = p_release
    ), 0),
    source_datasets = coalesce((
      select array_agg(distinct dataset order by dataset)
      from public.overture_hex_snapshots as hex
      cross join lateral unnest(hex.source_datasets) as dataset
      where hex.release_version = p_release
    ), '{}'),
    updated_at = now()
  where snap.release_version = p_release;

  return written;
end;
$$;

revoke all on function public.ingest_overture_places(text, jsonb) from public;
revoke all on function public.ingest_overture_buildings(text, jsonb) from public;
revoke all on function public.ingest_overture_addresses(text, jsonb) from public;
revoke all on function public.ingest_overture_snapshot(text, jsonb) from public;
grant execute on function public.ingest_overture_places(text, jsonb) to anon, authenticated;
grant execute on function public.ingest_overture_buildings(text, jsonb) to anon, authenticated;
grant execute on function public.ingest_overture_addresses(text, jsonb) to anon, authenticated;
grant execute on function public.ingest_overture_snapshot(text, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
