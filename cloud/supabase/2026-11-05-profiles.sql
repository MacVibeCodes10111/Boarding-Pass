-- Airline profiles (Update A, phase A1). Needs moderation.sql first.
-- A player who turns sharing on has one profile per channel: one chosen career.
-- Additive: touches nothing that exists. In A1 only its owner can read it: the
-- terms promise sharing only with people you choose, and friends arrive in A3.
create table public.profiles (
  user_id uuid not null references auth.users(id) on delete cascade,
  channel text not null check (channel in ('main', 'dev')),
  -- What other players will know this airline by: never the account number.
  public_id uuid not null default gen_random_uuid() unique,
  save_id text not null check (char_length(save_id) between 1 and 80),
  airline text not null check (char_length(airline) between 1 and 40),
  code text not null check (code ~ '^[A-Z0-9]{2,3}$'),
  callsign text not null check (char_length(callsign) <= 30),
  colours jsonb not null,
  liveries jsonb not null,
  stats jsonb not null,
  shared_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, channel)
);
alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;

create or replace function private.is_hex(j jsonb) returns boolean
  language sql immutable set search_path = ''
as $$ select jsonb_typeof(j) = 'string' and (j #>> '{}') ~ '^#[0-9a-fA-F]{6}$' $$;

/** Everything in a shared livery must be short text or a sensible number, with no picture data smuggled in. */
create or replace function private.json_safe(j jsonb, depth int default 0) returns boolean
  language plpgsql immutable set search_path = ''
as $$
declare v jsonb; k text;
begin
  if depth > 8 then return false; end if;
  case jsonb_typeof(j)
    when 'string' then return char_length(j #>> '{}') <= 64 and (j #>> '{}') !~* '^\s*(data|https?|javascript):';
    when 'number' then return abs((j #>> '{}')::numeric) <= 1000;
    when 'boolean' then return true;
    when 'array' then
      for v in select * from jsonb_array_elements(j) loop
        if not private.json_safe(v, depth + 1) then return false; end if;
      end loop;
      return true;
    when 'object' then
      for k, v in select * from jsonb_each(j) loop
        if char_length(k) > 40 or not private.json_safe(v, depth + 1) then return false; end if;
      end loop;
      return true;
    else return false;
  end case;
end $$;

/** A shared livery: only known kinds and fields, valid colours, and no blocked words. 'ok', 'bad_text' or 'bad_livery'. */
create or replace function private.check_liveries(j jsonb) returns text
  language plpgsql immutable set search_path = ''
as $$
declare lv jsonb; l jsonb; k text;
  fields constant text[] := array['id','kind','hidden','opacity','region','only','adj','frame','colour','v0','v1','shape','x','y','w','h','rot','d','dx','dy','text','font','size','auto','airlineName','registration','strokes'];
begin
  if jsonb_typeof(j) <> 'array' or jsonb_array_length(j) not between 1 and 2 or not private.json_safe(j) then return 'bad_livery'; end if;
  for lv in select * from jsonb_array_elements(j) loop
    if jsonb_typeof(lv) <> 'object' or lv->>'v' <> '2' or jsonb_typeof(lv->'layers') <> 'array' or jsonb_array_length(lv->'layers') > 40 then return 'bad_livery'; end if;
    for k in select * from jsonb_object_keys(lv) loop
      if not k = any(array['v','name','layers']) then return 'bad_livery'; end if;
    end loop;
    if char_length(coalesce(lv->>'name', '')) > 30 then return 'bad_livery'; end if;
    if private.moderate_bad(lv->>'name') then return 'bad_text'; end if;
    for l in select * from jsonb_array_elements(lv->'layers') loop
      if jsonb_typeof(l) <> 'object' or not (l->>'kind') = any(array['fill','band','shape','path','text','paint']) then return 'bad_livery'; end if;
      for k in select * from jsonb_object_keys(l) loop
        if not k = any(fields) then return 'bad_livery'; end if;
      end loop;
      if l ? 'colour' and not private.is_hex(l->'colour') then return 'bad_livery'; end if;
      if char_length(coalesce(l->>'text', '')) > 40 then return 'bad_livery'; end if;
      if private.moderate_bad(l->>'text') then return 'bad_text'; end if;
    end loop;
  end loop;
  return 'ok';
end $$;

revoke all on function private.is_hex(jsonb) from public, anon, authenticated;
revoke all on function private.json_safe(jsonb, int) from public, anon, authenticated;
revoke all on function private.check_liveries(jsonb) from public, anon, authenticated;

/** Saves the player's profile. Answers: saved, too_soon, off, bad_name, bad_text, bad_livery, too_big. */
create or replace function public.profile_publish(p_channel text, p_save_id text, p_airline text, p_code text, p_callsign text, p_colours jsonb, p_liveries jsonb, p_stats jsonb)
  returns text language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.cloud_gate(); ch text := private.cloud_ch(p_channel); last_at timestamptz; old_save text; r text; k text;
begin
  if not private.feature_on(ch, 'profiles') then return 'off'; end if;
  if p_save_id is null or char_length(p_save_id) not between 1 and 80 then return 'bad_name'; end if;
  if p_airline is null or char_length(btrim(p_airline)) not between 1 and 40 or private.moderate_bad(p_airline) then return 'bad_name'; end if;
  if p_code is null or p_code !~ '^[A-Z0-9]{2,3}$' or private.moderate_bad(p_code) then return 'bad_name'; end if;
  if char_length(coalesce(p_callsign, '')) > 30 or private.moderate_bad(p_callsign) then return 'bad_name'; end if;
  if jsonb_typeof(p_colours) <> 'object' or not private.is_hex(p_colours->'a') or not private.is_hex(p_colours->'b') or p_colours - 'a' - 'b' <> '{}'::jsonb then return 'bad_livery'; end if;
  if jsonb_typeof(p_stats) <> 'object' or not private.json_safe(p_stats) or octet_length(p_stats::text) > 300 then return 'bad_livery'; end if;
  for k in select * from jsonb_object_keys(p_stats) loop
    if not k = any(array['fleet','routes','airports','hubs','weeks','founded']) then return 'bad_livery'; end if;
  end loop;
  if octet_length(p_liveries::text) > 128000 then return 'too_big'; end if;
  r := private.check_liveries(p_liveries);
  if r <> 'ok' then return r; end if;
  select updated_at, save_id into last_at, old_save from public.profiles where user_id = uid and channel = ch;
  -- The game publishes every few minutes at most; switching career is always allowed
  if last_at > now() - interval '60 seconds' and old_save = p_save_id then return 'too_soon'; end if;
  insert into public.profiles (user_id, channel, save_id, airline, code, callsign, colours, liveries, stats)
  values (uid, ch, p_save_id, btrim(p_airline), p_code, coalesce(p_callsign, ''), p_colours, p_liveries, p_stats)
  on conflict (user_id, channel) do update set
    save_id = excluded.save_id, airline = excluded.airline, code = excluded.code, callsign = excluded.callsign,
    colours = excluded.colours, liveries = excluded.liveries, stats = excluded.stats, updated_at = now();
  return 'saved';
end $$;

/** The player's own profile, or null. */
create or replace function public.profile_mine(p_channel text)
  returns jsonb language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.cloud_gate(); ch text := private.cloud_ch(p_channel);
begin
  return (select jsonb_build_object('saveId', save_id, 'airline', airline, 'updatedAt', updated_at)
          from public.profiles where user_id = uid and channel = ch);
end $$;

/** Stops sharing. Works even with the feature off: a player can always take their airline down. */
create or replace function public.profile_delete(p_channel text)
  returns void language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.cloud_gate(); ch text := private.cloud_ch(p_channel);
begin
  delete from public.profiles where user_id = uid and channel = ch;
end $$;

revoke all on function public.profile_publish(text, text, text, text, text, jsonb, jsonb, jsonb) from public, anon;
revoke all on function public.profile_mine(text) from public, anon;
revoke all on function public.profile_delete(text) from public, anon;
grant execute on function public.profile_publish(text, text, text, text, text, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.profile_mine(text) to authenticated;
grant execute on function public.profile_delete(text) to authenticated;
