-- Logos in shared liveries (Update A, phase A2). Needs 2026-11-05-profiles.sql first.
-- The pictures live in Cloudflare R2, through the Worker in logos-worker/. This
-- side lets the Worker ask whether uploads are on, lets profiles name a logo by
-- its hash, and keeps a list of logos to remove, because the database can't
-- delete R2 files itself and a deleted account has no sign-in left to ask with.

-- What the nightly job has to clear. channel null means every channel (a deleted account).
create table private.logo_removals (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  channel text check (channel in ('main', 'dev')),
  at timestamptz not null default now()
);

-- The fingerprint of the Worker's CLEANUP_KEY (logos-worker/setup-cleanup-key.sh). The key itself is only in Cloudflare.
create table private.logo_cleanup (
  id int primary key check (id = 1),
  key_hash text not null
);

create function private.logo_key_ok(p_key text) returns boolean
  language sql stable set search_path = ''
as $$
  select coalesce((select key_hash = encode(sha256(convert_to(coalesce(p_key, ''), 'UTF8')), 'hex') from private.logo_cleanup where id = 1), false)
$$;
revoke all on function private.logo_key_ok(text) from public, anon, authenticated;

-- A problem here must never stop an account being deleted.
create function private.queue_logo_removal() returns trigger
  language plpgsql security definer set search_path = ''
as $$
begin
  begin
    insert into private.logo_removals (user_id, channel) values (old.id, null);
  exception when others then
    raise warning 'logo removal not queued: %', sqlerrm;
  end;
  return old;
end $$;
revoke all on function private.queue_logo_removal() from public, anon, authenticated;
create trigger bp_queue_logo_removal after delete on auth.users for each row execute function private.queue_logo_removal();

/** For the Worker, with the player's sign-in: may this player upload a logo? */
create function public.logo_gate(p_channel text)
  returns boolean language plpgsql security definer set search_path = ''
as $$
declare ch text := private.cloud_ch(p_channel);
begin
  perform private.cloud_gate();
  return private.feature_on(ch, 'profiles') and private.feature_on(ch, 'logos');
end $$;
revoke all on function public.logo_gate(text) from public, anon;
grant execute on function public.logo_gate(text) to authenticated;

/** For the nightly job: what to remove. Null unless the key is right. */
create function public.logo_removals_take(p_key text)
  returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  if not private.logo_key_ok(p_key) then return null; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'user_id', user_id, 'channel', channel, 'at', floor(extract(epoch from at) * 1000))), '[]'::jsonb)
          from (select * from private.logo_removals order by id limit 100) r);
end $$;

/** For the nightly job: these are done. */
create function public.logo_removals_done(p_key text, p_ids bigint[])
  returns void language plpgsql security definer set search_path = ''
as $$
begin
  if private.logo_key_ok(p_key) then
    delete from private.logo_removals where id = any(p_ids);
  end if;
end $$;
-- The Worker's nightly job has no player, so it comes in as the anonymous visitor; the key is what lets it in.
revoke all on function public.logo_removals_take(text) from public, authenticated;
revoke all on function public.logo_removals_done(text, bigint[]) from public, authenticated;
grant execute on function public.logo_removals_take(text) to anon;
grant execute on function public.logo_removals_done(text, bigint[]) to anon;

/** A shared livery: only known kinds and fields, valid colours, and no blocked words. Logos are named by hash. 'ok', 'bad_text' or 'bad_livery'. */
create or replace function private.check_liveries(j jsonb) returns text
  language plpgsql immutable set search_path = ''
as $$
declare lv jsonb; l jsonb; k text;
  fields constant text[] := array['id','kind','hidden','opacity','region','only','adj','frame','colour','v0','v1','shape','x','y','w','h','rot','d','dx','dy','text','font','size','auto','airlineName','registration','strokes','logo'];
begin
  if jsonb_typeof(j) <> 'array' or jsonb_array_length(j) not between 1 and 2 or not private.json_safe(j) then return 'bad_livery'; end if;
  for lv in select * from jsonb_array_elements(j) loop
    if jsonb_typeof(lv) <> 'object' or lv->>'v' <> '2' or jsonb_typeof(lv->'layers') <> 'array' or jsonb_array_length(lv->'layers') > 40 then return 'bad_livery'; end if;
    for k in select * from jsonb_object_keys(lv) loop
      if not k = any(array['v','name','layers','badge']) then return 'bad_livery'; end if;
    end loop;
    if lv ? 'badge' and coalesce(lv->>'badge', '') !~ '^[0-9a-f]{64}$' then return 'bad_livery'; end if;
    if char_length(coalesce(lv->>'name', '')) > 30 then return 'bad_livery'; end if;
    if private.moderate_bad(lv->>'name') then return 'bad_text'; end if;
    for l in select * from jsonb_array_elements(lv->'layers') loop
      if jsonb_typeof(l) <> 'object' or not (l->>'kind') = any(array['fill','band','shape','path','text','paint','logo']) then return 'bad_livery'; end if;
      for k in select * from jsonb_object_keys(l) loop
        if not k = any(fields) then return 'bad_livery'; end if;
      end loop;
      if (l->>'kind') = 'logo' then
        if coalesce(l->>'logo', '') !~ '^[0-9a-f]{64}$' then return 'bad_livery'; end if;
      elsif l ? 'logo' then
        return 'bad_livery';
      end if;
      if l ? 'colour' and not private.is_hex(l->'colour') then return 'bad_livery'; end if;
      if char_length(coalesce(l->>'text', '')) > 40 then return 'bad_livery'; end if;
      if private.moderate_bad(l->>'text') then return 'bad_text'; end if;
    end loop;
  end loop;
  return 'ok';
end $$;

/** The same as before, and refuses logos while the logos flag is off. */
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
  if not private.feature_on(ch, 'logos') and (p_liveries @? '$[*].layers[*] ? (@.kind == "logo")' or p_liveries @? '$[*].badge') then return 'bad_livery'; end if;
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

/** Stops sharing, and queues its logos for removal in case the game can't reach the Worker. */
create or replace function public.profile_delete(p_channel text)
  returns void language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.cloud_gate(); ch text := private.cloud_ch(p_channel);
begin
  delete from public.profiles where user_id = uid and channel = ch;
  if found then
    insert into private.logo_removals (user_id, channel) values (uid, ch);
  end if;
end $$;
