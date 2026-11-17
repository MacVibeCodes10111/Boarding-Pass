-- Sandbox online too (2026-11-17). Sandbox airlines get the same treatment as
-- Careers: kept in the account, played online, each comes online once, and the
-- same import deadline. Each account keeps up to 4 airlines in all, Career and
-- Sandbox together (Mac, 2026-11-17; was 6 Careers). Accounts that have more
-- than 4 online when this is applied are grandfathered: their limit stays at
-- what they had (private.pick_limits).
--
--   * cloud_picks.mode says which kind each one is. Older picks get it from
--     the server's own save check when it has read the save, else 'career'.
--   * The kind shown to the owner and in the overview prefers what the save
--     check read from the save itself over what the device said.
--   * Older game versions send no p_mode: they keep the old behaviour, and
--     what they pick counts as a Career.

alter table public.cloud_picks add column if not exists mode text check (mode in ('career', 'sandbox'));
update public.cloud_picks p set mode = coalesce(
  (select case when st.stats->>'mode' = 'sandbox' then 'sandbox' else 'career' end
     from private.save_stats st where st.user_id = p.user_id and st.channel = p.channel and st.save_id = p.save_id),
  'career')
  where mode is null;

/** Grandfathered limits: accounts with more than 4 airlines online when the limit became 4. */
create table private.pick_limits (
  user_id uuid not null references auth.users (id) on delete cascade,
  channel text not null,
  max_picks int not null check (max_picks between 4 and 12),
  at timestamptz not null default now(),
  primary key (user_id, channel)
);
alter table private.pick_limits enable row level security;
insert into private.pick_limits (user_id, channel, max_picks)
  select user_id, channel, least(count(*), 12) from public.cloud_picks group by user_id, channel having count(*) > 4
  on conflict do nothing;

/** How many airlines an account keeps: 4, or what it had when the limit became 4. */
create function private.pick_limit(uid uuid, ch text) returns int
  language sql stable security definer set search_path = ''
as $$ select coalesce((select max_picks from private.pick_limits where user_id = uid and channel = ch), 4) $$;
revoke all on function private.pick_limit(uuid, text) from public, anon, authenticated;

/** Which kind an airline in the cloud is: what the save check read, else what the device said. */
create or replace function private.save_mode(uid uuid, ch text, sid text) returns text
  language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select case when st.stats->>'mode' = 'sandbox' then 'sandbox' else 'career' end from private.save_stats st where st.user_id = uid and st.channel = ch and st.save_id = sid),
    (select p.mode from public.cloud_picks p where p.user_id = uid and p.channel = ch and p.save_id = sid),
    'career')
$$;
revoke all on function private.save_mode(uuid, text, text) from public, anon, authenticated;

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
begin
  if p_save_id is null or char_length(p_save_id) not between 1 and 80 then raise exception 'Missing data'; end if;
  if p_on then
    if exists (select 1 from private.cloud_removed where user_id = uid and channel = ch and save_id = p_save_id) then return 'removed'; end if;
    if exists (select 1 from public.cloud_picks where user_id = uid and channel = ch and save_id = p_save_id) then return 'ok'; end if;
    if p_mode in ('career', 'sandbox') then
      if exists (select 1 from private.cloud_known where user_id = uid and channel = ch and save_id = p_save_id) then return 'used'; end if;
      born := case when p_save_id ~ '^SAVE-\d{13}$' then to_timestamp(substr(p_save_id, 6)::bigint / 1000.0) end;
      select import_until into until from private.online_rules where channel = ch;
      if until is not null and now() > until and (born is null or born < now() - interval '2 days') then return 'closed'; end if;
    end if;
    -- 4 airlines in all (or a grandfathered limit)
    select count(*) into n from public.cloud_picks p where p.user_id = uid and p.channel = ch;
    if n >= private.pick_limit(uid, ch) then return 'full'; end if;
    insert into public.cloud_picks(user_id, channel, save_id, airline, mode) values (uid, ch, p_save_id, left(coalesce(p_airline, ''), 80), m);
    insert into private.cloud_known (user_id, channel, save_id) values (uid, ch, p_save_id) on conflict do nothing;
    return 'ok';
  end if;
  delete from public.cloud_picks where user_id = uid and channel = ch and save_id = p_save_id;
  delete from public.cloud_saves where user_id = uid and channel = ch and save_id = p_save_id;
  return 'ok';
end $$;

create or replace function public.cloud_push(p_device uuid, p_device_name text, p_channel text, p_save_id text, p_rev bigint, p_airline text, p_data text) returns text
  language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.cloud_gate(); ch text := private.cloud_ch(p_channel); cur bigint; n int;
begin
  if p_device is null or p_save_id is null or p_rev is null or p_data is null then raise exception 'Missing data'; end if;
  if not exists (select 1 from public.cloud_picks where user_id = uid and channel = ch and save_id = p_save_id) then return 'not_picked'; end if;
  if not private.cloud_meter(uid, 'push', 0) then return 'rate_limited'; end if;
  perform private.cloud_touch(uid, p_device, p_device_name, ch);
  update public.cloud_picks set airline = left(coalesce(p_airline, ''), 80) where user_id = uid and channel = ch and save_id = p_save_id;
  select rev into cur from public.cloud_saves where user_id = uid and channel = ch and save_id = p_save_id for update;
  if found then
    if cur > p_rev then return 'older'; end if;
    if cur = p_rev then return 'same'; end if;
    update public.cloud_saves
      set rev = p_rev, airline = left(coalesce(p_airline, ''), 80), data = p_data, from_device = p_device, updated_at = now()
      where user_id = uid and channel = ch and save_id = p_save_id;
    update public.cloud_save_receipts set rev = -1 where user_id = uid and channel = ch and save_id = p_save_id;
    return 'saved';
  end if;
  if pg_total_relation_size('public.cloud_saves') > 400 * 1024 * 1024 then return 'server_full'; end if;
  select count(*) into n from public.cloud_saves where user_id = uid and channel = ch;
  if n >= private.pick_limit(uid, ch) then return 'full'; end if;
  insert into public.cloud_saves(user_id, channel, save_id, rev, airline, data, from_device)
  values (uid, ch, p_save_id, p_rev, left(coalesce(p_airline, ''), 80), p_data, p_device);
  return 'saved';
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
    'devices', coalesce((select jsonb_agg(jsonb_build_object('name', d.name, 'lastSeen', d.last_seen, 'thisDevice', d.device_id = p_device)
                 order by d.last_seen desc) from public.cloud_devices d where d.user_id = uid and d.channel = ch), '[]'::jsonb));
end $$;
