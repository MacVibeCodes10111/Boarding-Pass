-- Online careers (2026-11-17). Career careers live in the cloud: playing one
-- needs an account and a connection. Sandbox stays on the device.
--
--   * Up to 6 careers per account (was 4).
--   * Each Career goes online once. A career that has been in the cloud and
--     left it (deleted, or turned off by an older version) can't come back as a
--     Career, so an edited copy can't be put back in.
--   * Careers made before the update can be brought online until
--     private.online_rules.import_until for that channel (90 days after the
--     update ships; set at release). A new career (its id is its start time) can
--     always go online. Without a date, importing stays open.
--   * Only the new game sends p_mode = 'career', so older versions keep the old
--     behaviour (apart from the 6).
--   * cloud_rules also gives the server's clock: a Career's time runs by it, so
--     changing the device's clock does nothing.

create table private.online_rules (
  channel text primary key check (channel in ('main', 'dev')),
  import_until timestamptz
);
alter table private.online_rules enable row level security;

/** Every save that has been in the cloud, so a Career only goes online once. */
create table private.cloud_known (
  user_id uuid not null references auth.users (id) on delete cascade,
  channel text not null,
  save_id text not null,
  at timestamptz not null default now(),
  primary key (user_id, channel, save_id)
);
alter table private.cloud_known enable row level security;
insert into private.cloud_known (user_id, channel, save_id) select user_id, channel, save_id from public.cloud_picks on conflict do nothing;
insert into private.cloud_known (user_id, channel, save_id) select user_id, channel, save_id from public.cloud_saves on conflict do nothing;

/** The online rules: how many careers, until when old ones can come online, and the server's clock. */
create function public.cloud_rules(p_channel text) returns jsonb
  language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.cloud_gate(); ch text := private.cloud_ch(p_channel);
begin
  return jsonb_build_object('maxPicks', 6, 'importUntil', (select import_until from private.online_rules where channel = ch),
    -- The server's clock (ms): the game times Careers by it, not by the device's clock
    'now', floor(extract(epoch from clock_timestamp()) * 1000)::bigint);
end $$;

drop function public.cloud_pick(text, text, text, boolean);
create function public.cloud_pick(p_channel text, p_save_id text, p_airline text, p_on boolean, p_mode text default null) returns text
  language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := private.cloud_gate();
  ch text := private.cloud_ch(p_channel);
  n int;
  born timestamptz;
  until timestamptz;
begin
  if p_save_id is null or char_length(p_save_id) not between 1 and 80 then raise exception 'Missing data'; end if;
  if p_on then
    if exists (select 1 from private.cloud_removed where user_id = uid and channel = ch and save_id = p_save_id) then return 'removed'; end if;
    if exists (select 1 from public.cloud_picks where user_id = uid and channel = ch and save_id = p_save_id) then return 'ok'; end if;
    if p_mode = 'career' then
      if exists (select 1 from private.cloud_known where user_id = uid and channel = ch and save_id = p_save_id) then return 'used'; end if;
      born := case when p_save_id ~ '^SAVE-\d{13}$' then to_timestamp(substr(p_save_id, 6)::bigint / 1000.0) end;
      select import_until into until from private.online_rules where channel = ch;
      if until is not null and now() > until and (born is null or born < now() - interval '2 days') then return 'closed'; end if;
    end if;
    select count(*) into n from public.cloud_picks where user_id = uid and channel = ch;
    if n >= 6 then return 'full'; end if;
    insert into public.cloud_picks(user_id, channel, save_id, airline) values (uid, ch, p_save_id, left(coalesce(p_airline, ''), 80));
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
  if n >= 6 then return 'full'; end if;
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
                 'bytes', octet_length(s.data),
                 'waitingHere', s.from_device <> p_device and not exists (select 1 from public.cloud_save_receipts r
                      where r.user_id = uid and r.channel = ch and r.save_id = s.save_id and r.device_id = p_device and r.rev >= s.rev))
                 order by s.updated_at desc)
               from public.cloud_saves s left join public.cloud_devices d on d.user_id = s.user_id and d.device_id = s.from_device
               where s.user_id = uid and s.channel = ch), '[]'::jsonb),
    'picks', coalesce((select jsonb_agg(jsonb_build_object('saveId', p.save_id, 'airline', p.airline) order by p.picked_at)
               from public.cloud_picks p where p.user_id = uid and p.channel = ch), '[]'::jsonb),
    'maxPicks', 6,
    'importUntil', (select import_until from private.online_rules where channel = ch),
    'devices', coalesce((select jsonb_agg(jsonb_build_object('name', d.name, 'lastSeen', d.last_seen, 'thisDevice', d.device_id = p_device)
                 order by d.last_seen desc) from public.cloud_devices d where d.user_id = uid and d.channel = ch), '[]'::jsonb));
end $$;

revoke all on function public.cloud_rules(text), public.cloud_pick(text, text, text, boolean, text) from public, anon;
grant execute on function public.cloud_rules(text), public.cloud_pick(text, text, text, boolean, text) to authenticated;
