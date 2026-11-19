-- Account limits and imports (2026-11-17, after v3.2.0).
--
-- 1. The owner can raise (or lower back) how many airlines an account keeps,
--    from the admin site's Saves page: 4 to 20, logged with a reason.
-- 2. During the 90 days for importing, an airline made before online play
--    (its id is older than the v3.2.0 release) still comes in when the account
--    is at its limit, and the account's limit grows to fit it (up to 12).
--    It must be unique: an old airline comes online once, into one account
--    only, ever (private.cloud_known, across every account).
-- 3. The removal notice no longer says the airline stays playable on devices.

alter table private.pick_limits drop constraint if exists pick_limits_max_picks_check;
alter table private.pick_limits add constraint pick_limits_max_picks_check check (max_picks between 1 and 20);

alter table private.online_rules add column if not exists old_before timestamptz;
-- v3.2.0 went out at 17:43 UTC on 17 November 2026: airlines started before then are "from before"
insert into private.online_rules (channel, old_before) values ('main', '2026-11-17 17:43:02+00'), ('dev', '2026-11-17 17:43:02+00')
  on conflict (channel) do update set old_before = excluded.old_before;

create index if not exists cloud_known_save on private.cloud_known (channel, save_id);

create or replace function public.cloud_pick(p_channel text, p_save_id text, p_airline text, p_on boolean, p_mode text default null) returns text
  language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := private.cloud_gate();
  ch text := private.cloud_ch(p_channel);
  m text := case when p_mode = 'sandbox' then 'sandbox' else 'career' end;
  n int;
  born timestamptz;
  until timestamptz;
  old_cut timestamptz;
  old_import boolean := false;
begin
  if p_save_id is null or char_length(p_save_id) not between 1 and 80 then raise exception 'Missing data'; end if;
  if p_on then
    if exists (select 1 from private.cloud_removed where user_id = uid and channel = ch and save_id = p_save_id) then return 'removed'; end if;
    if exists (select 1 from public.cloud_picks where user_id = uid and channel = ch and save_id = p_save_id) then return 'ok'; end if;
    if p_mode in ('career', 'sandbox') then
      if exists (select 1 from private.cloud_known where user_id = uid and channel = ch and save_id = p_save_id) then return 'used'; end if;
      born := case when p_save_id ~ '^SAVE-\d{13}$' then to_timestamp(substr(p_save_id, 6)::bigint / 1000.0) end;
      select import_until, old_before into until, old_cut from private.online_rules where channel = ch;
      if until is not null and now() > until and (born is null or born < now() - interval '2 days') then return 'closed'; end if;
      old_import := born is not null and old_cut is not null and born < old_cut;
      -- An airline from before comes online once, into one account only
      if old_import and exists (select 1 from private.cloud_known where channel = ch and save_id = p_save_id) then return 'used'; end if;
    end if;
    select count(*) into n from public.cloud_picks p where p.user_id = uid and p.channel = ch;
    if n >= private.pick_limit(uid, ch) then
      -- While importing is open, an airline from before still comes in, and the limit grows to fit it
      if not (old_import and (until is null or now() <= until) and n < 12) then return 'full'; end if;
      insert into private.pick_limits (user_id, channel, max_picks) values (uid, ch, n + 1)
        on conflict (user_id, channel) do update set max_picks = greatest(private.pick_limits.max_picks, excluded.max_picks), at = now();
    end if;
    insert into public.cloud_picks(user_id, channel, save_id, airline, mode) values (uid, ch, p_save_id, left(coalesce(p_airline, ''), 80), m);
    insert into private.cloud_known (user_id, channel, save_id) values (uid, ch, p_save_id) on conflict do nothing;
    return 'ok';
  end if;
  delete from public.cloud_picks where user_id = uid and channel = ch and save_id = p_save_id;
  delete from public.cloud_saves where user_id = uid and channel = ch and save_id = p_save_id;
  return 'ok';
end $$;

create or replace function public.cloud_overview(p_device uuid, p_channel text) returns jsonb
  language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.cloud_gate(); ch text := private.cloud_ch(p_channel);
begin
  return jsonb_build_object(
    'saves', coalesce((select jsonb_agg(jsonb_build_object('saveId', s.save_id, 'airline', s.airline, 'rev', s.rev,
                 'updatedAt', s.updated_at, 'fromThisDevice', s.from_device = p_device, 'fromName', coalesce(d.name, ''),
                 'bytes', octet_length(s.data), 'mode', private.save_mode(uid, ch, s.save_id),
                 'waitingHere', s.from_device <> p_device and not exists (select 1 from public.cloud_save_receipts r
                      where r.user_id = uid and r.channel = ch and r.save_id = s.save_id and r.device_id = p_device and r.rev >= s.rev))
                 order by s.updated_at desc)
               from public.cloud_saves s left join public.cloud_devices d on d.user_id = s.user_id and d.device_id = s.from_device
               where s.user_id = uid and s.channel = ch), '[]'::jsonb),
    'picks', coalesce((select jsonb_agg(jsonb_build_object('saveId', p.save_id, 'airline', p.airline, 'mode', private.save_mode(uid, ch, p.save_id)) order by p.picked_at)
               from public.cloud_picks p where p.user_id = uid and p.channel = ch), '[]'::jsonb),
    'maxPicks', private.pick_limit(uid, ch),
    'importUntil', (select import_until from private.online_rules where channel = ch),
    'oldBefore', (select old_before from private.online_rules where channel = ch),
    'devices', coalesce((select jsonb_agg(jsonb_build_object('name', d.name, 'lastSeen', d.last_seen, 'thisDevice', d.device_id = p_device)
                 order by d.last_seen desc) from public.cloud_devices d where d.user_id = uid and d.channel = ch), '[]'::jsonb));
end $$;

/** Sets how many airlines an account keeps (4 = the normal limit). Owner only, logged. */
create function public.admin_set_limit(p_channel text, p_user uuid, p_limit int, p_reason text) returns text
  language plpgsql security definer set search_path = ''
as $$
declare
  a private.admins := private.admin_gate(true);
  ch text := private.cloud_ch(p_channel);
  before int;
begin
  if p_user is null or p_limit is null or p_limit not between 4 and 20 then raise exception 'Missing data'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Write a reason first'; end if;
  if not exists (select 1 from auth.users where id = p_user) then return 'not_found'; end if;
  before := private.pick_limit(p_user, ch);
  perform private.admin_act(a, 'set_limit', ch, 'account', p_user::text, jsonb_build_object('limit', before), jsonb_build_object('limit', p_limit), left(btrim(p_reason), 300));
  if p_limit = 4 then
    delete from private.pick_limits where user_id = p_user and channel = ch;
  else
    insert into private.pick_limits (user_id, channel, max_picks) values (p_user, ch, p_limit)
      on conflict (user_id, channel) do update set max_picks = excluded.max_picks, at = now();
  end if;
  return 'ok';
end $$;
revoke all on function public.admin_set_limit(text, uuid, int, text) from public, anon;
grant execute on function public.admin_set_limit(text, uuid, int, text) to authenticated;

-- The Saves page shows each account's limit and how many airlines it has
create or replace function public.admin_saves(p_channel text, p_q text) returns jsonb
  language plpgsql stable security definer set search_path = ''
as $$
declare
  a private.admins := private.admin_gate(true);
  ch text := private.cloud_ch(p_channel);
  q text := btrim(coalesce(p_q, ''));
  fc text := upper(regexp_replace(q, '[^A-Za-z0-9]', '', 'g'));
begin
  if char_length(q) < 2 then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(card order by (card->>'updatedAt') desc)
    from (
      select jsonb_build_object(
        'user', s.user_id,
        'username', private.username_of(s.user_id),
        'saveId', s.save_id,
        'airline', s.airline,
        'rev', s.rev,
        'bytes', octet_length(s.data),
        'updatedAt', s.updated_at,
        'stats', (select st.stats from private.save_stats st where st.user_id = s.user_id and st.channel = ch and st.save_id = s.save_id),
        'friendCode', (select p.friend_code from public.profiles p where p.user_id = s.user_id and p.channel = ch and p.save_id = s.save_id),
        'limit', private.pick_limit(s.user_id, ch),
        'airlines', (select count(*) from public.cloud_picks p where p.user_id = s.user_id and p.channel = ch),
        'grants', coalesce((select jsonb_agg(private.grant_card(g) order by g.created_at desc)
                            from (select * from private.grants g where g.user_id = s.user_id and g.channel = ch and g.save_id = s.save_id
                                  order by g.created_at desc limit 20) g), '[]'::jsonb)
      ) as card
      from public.cloud_saves s
      where s.channel = ch
        and (case when q like '@%' then private.username_of(s.user_id) ilike substr(q, 2) || '%'
                  else s.airline ilike '%' || q || '%' or s.save_id = q
                    or (char_length(fc) = 8 and exists (select 1 from public.profiles p
                          where p.user_id = s.user_id and p.channel = ch and p.save_id = s.save_id and p.friend_code = fc)) end)
      order by s.updated_at desc
      limit 50
    ) x
  ), '[]'::jsonb);
end $$;

-- 3. Removing an airline: the notice now says it can't be played any more
create or replace function public.admin_save_delete(p_channel text, p_user uuid, p_save_id text, p_reason text) returns text
  language plpgsql security definer set search_path = ''
as $$
declare a private.admins := private.admin_gate(true); ch text := private.cloud_ch(p_channel); s public.cloud_saves;
begin
  select * into s from public.cloud_saves where user_id = p_user and channel = ch and save_id = p_save_id;
  if s.user_id is null then return 'not_found'; end if;
  perform private.admin_act(a, 'save_delete', ch, 'save', p_user || '/' || p_save_id, jsonb_build_object('airline', s.airline, 'rev', s.rev, 'bytes', octet_length(s.data), 'updatedAt', s.updated_at), null, p_reason);
  delete from public.cloud_saves where user_id = p_user and channel = ch and save_id = p_save_id;
  delete from public.cloud_picks where user_id = p_user and channel = ch and save_id = p_save_id;
  delete from public.cloud_save_receipts where user_id = p_user and channel = ch and save_id = p_save_id;
  update private.grants set cancelled_at = now() where user_id = p_user and channel = ch and save_id = p_save_id and claimed_at is null and cancelled_at is null;
  insert into private.cloud_removed (user_id, channel, save_id) values (p_user, ch, p_save_id) on conflict do nothing;
  perform private.notify(p_user, ch, null, 'Your airline “' || coalesce(nullif(s.airline, ''), 'Untitled') || '” was removed from your account by a moderator, so it can’t be played any more.');
  return 'ok';
end $$;
