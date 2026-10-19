-- HEAVEN & HELL portal — Supabase schema.
--
-- Run once in Supabase Dashboard > SQL Editor (safe to re-run).
--
-- Every record lives in one table, grouped by collection:
--   portalData     coach-only: client profiles, diet plans, progress, diet templates
--   clientIntakes  questionnaire submissions; anyone may submit, only the coach reads them
--   clientPortals  one row per client keyed by access code; the code lets a client read
--                  their plan and append check-ins
-- The table itself is closed to the browser. All access goes through the functions below,
-- which enforce who may do what.

create table if not exists public.hh_documents (
  collection text not null check (collection in ('portalData', 'clientIntakes', 'clientPortals')),
  id text not null check (length(id) between 1 and 299 and position('/' in id) = 0),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (collection, id)
);
alter table public.hh_documents enable row level security;
revoke all on public.hh_documents from anon, authenticated;

-- The coach account. Change the address here if the coach's login email changes.
create or replace function public.hh_is_admin() returns boolean
language sql stable set search_path = public as $$
  select coalesce(auth.jwt() ->> 'role' = 'authenticated' and lower(auth.jwt() ->> 'email') = 'kaviraja391@gmail.com', false)
$$;

-- Applies a patch to a document. Values shaped {"__hh": ...} are field operations:
--   {"__hh":"ts"}                    current server time
--   {"__hh":"union","items":[...]}   append items not already in the array
--   {"__hh":"remove","items":[...]}  remove every matching item from the array
create or replace function public.hh_apply(old jsonb, patch jsonb) returns jsonb
language plpgsql stable set search_path = public as $$
declare
  k text;
  v jsonb;
  cur jsonb;
  result jsonb := coalesce(old, '{}'::jsonb);
begin
  for k, v in select * from jsonb_each(patch) loop
    if jsonb_typeof(v) = 'object' and v ? '__hh' then
      cur := result -> k;
      if jsonb_typeof(cur) is distinct from 'array' then cur := '[]'::jsonb; end if;
      if v ->> '__hh' = 'ts' then
        v := to_jsonb(to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
      elsif v ->> '__hh' = 'union' then
        select cur || coalesce(jsonb_agg(i.value order by i.n), '[]'::jsonb) into v
        from jsonb_array_elements(v -> 'items') with ordinality as i(value, n)
        where not exists (select 1 from jsonb_array_elements(cur) c where c = i.value);
      elsif v ->> '__hh' = 'remove' then
        select coalesce(jsonb_agg(c.value order by c.n), '[]'::jsonb) into v
        from jsonb_array_elements(cur) with ordinality as c(value, n)
        where not exists (select 1 from jsonb_array_elements(v -> 'items') i where i = c.value);
      else
        raise exception 'Unknown field operation' using errcode = '22023';
      end if;
    end if;
    result := jsonb_set(result, array[k], v, true);
  end loop;
  return result;
end $$;

-- Reads one document. The coach can read anything; anyone can read a client portal by its code.
create or replace function public.hh_get(p_collection text, p_id text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not (hh_is_admin() or p_collection = 'clientPortals') then
    raise exception 'Missing or insufficient permissions.' using errcode = '42501';
  end if;
  return (select data from hh_documents where collection = p_collection and id = p_id);
end $$;

-- Lists a whole collection (coach only).
create or replace function public.hh_list(p_collection text) returns table (id text, data jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  if not hh_is_admin() then
    raise exception 'Missing or insufficient permissions.' using errcode = '42501';
  end if;
  return query select d.id, d.data from hh_documents d where d.collection = p_collection order by d.updated_at desc;
end $$;

-- A short fingerprint that changes whenever a document (p_id given) or a whole collection
-- changes. Live views poll this instead of re-downloading the data, which keeps egress low.
-- Same access as hh_get / hh_list.
create or replace function public.hh_stamp(p_collection text, p_id text default null) returns text
language plpgsql stable security definer set search_path = public as $$
begin
  if p_id is not null then
    if not (hh_is_admin() or p_collection = 'clientPortals') then
      raise exception 'Missing or insufficient permissions.' using errcode = '42501';
    end if;
    return coalesce((select updated_at::text from hh_documents where collection = p_collection and id = p_id), 'none');
  end if;
  if not hh_is_admin() then
    raise exception 'Missing or insufficient permissions.' using errcode = '42501';
  end if;
  return (select count(*)::text || '/' || coalesce(max(updated_at)::text, '') from hh_documents where collection = p_collection);
end $$;

-- Writes one document. p_mode: 'set' replaces it, 'merge' updates the given fields (creating
-- the document if needed), 'update' updates the given fields of an existing document.
create or replace function public.hh_write(p_collection text, p_id text, p_data jsonb, p_mode text) returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  existing jsonb;
  has_row boolean;
  next_data jsonb;
begin
  if p_mode not in ('set', 'merge', 'update') or jsonb_typeof(p_data) is distinct from 'object' then
    raise exception 'Invalid write.' using errcode = '22023';
  end if;
  -- Visitors may only submit questionnaires or update a client portal; refuse anything else up front.
  if not hh_is_admin() and not ((p_collection = 'clientIntakes' and p_mode = 'set') or (p_collection = 'clientPortals' and p_mode = 'update')) then
    raise exception 'Missing or insufficient permissions.' using errcode = '42501';
  end if;
  select data into existing from hh_documents where collection = p_collection and id = p_id for update;
  has_row := found;
  if p_mode = 'update' and not has_row then
    raise exception 'No document to update.' using errcode = 'P0002';
  end if;
  next_data := hh_apply(case when p_mode = 'set' then '{}'::jsonb else existing end, p_data);

  if not hh_is_admin() then
    if p_collection = 'clientIntakes' and p_mode = 'set' then
      -- New questionnaire submission, stored under its client ID. Never overwrites.
      if has_row then raise exception 'That client ID is already taken.' using errcode = '23505'; end if;
      if p_id !~ '^HH-[A-Z0-9]{6}$'
         or next_data ->> 'applicantId' is distinct from p_id
         or (select count(*) from jsonb_object_keys(next_data)) >= 100
         or length(next_data::text) > 60000
         or jsonb_typeof(next_data -> '1_Full_Name') is distinct from 'string'
         or jsonb_typeof(next_data -> '4_Phone_Number') is distinct from 'string' then
        raise exception 'Missing or insufficient permissions.' using errcode = '42501';
      end if;
    elsif p_collection = 'clientPortals' and p_mode = 'update' then
      -- A client (who knows their code) may add one check-in or set their own target weight.
      if exists (select 1 from jsonb_object_keys(p_data) k where k not in ('checkins', 'lastCheckinAt', 'clientTargetWeight', 'clientTargetAt'))
         or (p_data ? 'checkins' and (p_data -> 'checkins' ->> '__hh' is distinct from 'union' or jsonb_array_length(p_data -> 'checkins' -> 'items') <> 1))
         or (p_data ? 'clientTargetWeight' and jsonb_typeof(p_data -> 'clientTargetWeight') is distinct from 'number')
         or length(p_data::text) > 5000
         or jsonb_array_length(coalesce(next_data -> 'checkins', '[]'::jsonb)) > 200 then
        raise exception 'Missing or insufficient permissions.' using errcode = '42501';
      end if;
    else
      raise exception 'Missing or insufficient permissions.' using errcode = '42501';
    end if;
  end if;

  if has_row then
    update hh_documents set data = next_data, updated_at = now() where collection = p_collection and id = p_id;
  else
    insert into hh_documents (collection, id, data) values (p_collection, p_id, next_data);
  end if;
end $$;

-- Deletes one document (coach only).
create or replace function public.hh_delete(p_collection text, p_id text) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if not hh_is_admin() then
    raise exception 'Missing or insufficient permissions.' using errcode = '42501';
  end if;
  delete from hh_documents where collection = p_collection and id = p_id;
end $$;

-- Client logins are generated from the coach's client list. Whenever portalData/main is saved,
-- every client gets (or keeps) a clientPortals row under their access code with their current
-- name, plan and progress; rows for codes no longer in the list are removed. Check-ins and the
-- client's own target weight already on a row are kept.
create or replace function public.hh_sync_portals() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  db jsonb := new.data -> 'database';
begin
  if jsonb_typeof(db) is distinct from 'object' then return new; end if;
  insert into hh_documents (collection, id, data)
  select 'clientPortals', c.key, jsonb_build_object(
      'name', coalesce(c.value ->> 'name', 'Client'),
      'diet', coalesce(c.value ->> 'diet', ''),
      'slot', coalesce(c.value ->> 'originalSlot', c.key),
      'dietUpdatedAt', c.value -> 'dietUpdatedAt',
      'targetWeight', c.value -> 'targetWeight',
      'targetSetAt', c.value -> 'targetSetAt',
      'progress', coalesce(c.value -> 'progress', '[]'::jsonb),
      'updatedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
  from jsonb_each(db) c
  where jsonb_typeof(c.value) = 'object' and length(c.key) between 1 and 299 and position('/' in c.key) = 0
  on conflict (collection, id) do update
    set data = hh_documents.data || excluded.data, updated_at = now();
  delete from hh_documents d where d.collection = 'clientPortals' and not (db ? d.id);
  return new;
end $$;

drop trigger if exists hh_sync_portals on public.hh_documents;
create trigger hh_sync_portals after insert or update on public.hh_documents
  for each row when (new.collection = 'portalData' and new.id = 'main')
  execute function public.hh_sync_portals();

-- Create logins for clients saved before this trigger existed.
update public.hh_documents set updated_at = now() where collection = 'portalData' and id = 'main';

revoke all on function public.hh_sync_portals() from public, anon, authenticated;
revoke all on function public.hh_is_admin(), public.hh_apply(jsonb, jsonb), public.hh_get(text, text), public.hh_list(text),
  public.hh_stamp(text, text), public.hh_write(text, text, jsonb, text), public.hh_delete(text, text) from public, anon, authenticated;
grant execute on function public.hh_get(text, text), public.hh_list(text), public.hh_stamp(text, text),
  public.hh_write(text, text, jsonb, text), public.hh_delete(text, text) to anon, authenticated;
