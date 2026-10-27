-- Add Overture geometry, extra theme fields, and computed association ids.
-- Run after 20261027_overture.sql. Reprocess hexes to fill the new columns.

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
    place_addresses, building_id, address_id
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
    nullif(r->>'address_id', '')
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
    roof_shape, roof_direction, roof_color, address_id
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
    nullif(r->>'address_id', '')
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
    geometry, unit, postal_city, building_id
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
    nullif(r->>'building_id', '')
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
