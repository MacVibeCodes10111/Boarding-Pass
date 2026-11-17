-- Keep online airlines, and who's online (2026-11-17).
--
-- 1. Airlines live online now, so the server keeps each one's copy. Before,
--    a copy was deleted once the player's other devices had it, or after 90
--    days, because the cloud only moved careers between devices. Now a copy
--    goes only when the player deletes the airline, an admin removes it, or
--    the account is deleted (12 months without use).
-- 2. When each player was last active: every call the game makes stamps it
--    (at most every 20 seconds); a game being played calls about every 30
--    seconds. The owner's admin site lists who's online. Kept 2 days.
-- 3. Cheat flags and money given or taken are deleted after 12 months.

-- 1. Never delete a copy because the devices have it
create or replace function private.cloud_settle(uid uuid, ch text, sid text) returns boolean
  language sql stable security definer set search_path = ''
as $$ select false $$;

create or replace function private.cloud_cleanup() returns void
  language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.cloud_devices where last_seen < now() - interval '180 days';
  delete from auth.users u
  where greatest(u.created_at, coalesce(u.last_sign_in_at, u.created_at),
                 coalesce((select max(d.last_seen) from public.cloud_devices d where d.user_id = u.id), u.created_at),
                 coalesce((select l.at from private.last_active l where l.user_id = u.id), u.created_at))
        < now() - interval '365 days';
  delete from private.cloud_usage where period_start < now() - interval '2 days';
  delete from private.signup_log where created_at < now() - interval '25 hours';
  delete from private.signup_allowance where created_at < now() - interval '1 hour';
  delete from private.last_active where at < now() - interval '2 days';
  -- Records kept 12 months, as the Privacy policy says
  delete from private.save_flags where at < now() - interval '12 months';
  delete from private.grants where created_at < now() - interval '12 months' and (claimed_at is not null or cancelled_at is not null);
end $$;

-- 2. Last active
create table private.last_active (
  user_id uuid primary key references auth.users (id) on delete cascade,
  at timestamptz not null default now()
);
alter table private.last_active enable row level security;

create or replace function private.cloud_gate() returns uuid
  language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  sid uuid;
  cur uuid;
  cur_made timestamptz;
  my_made timestamptz;
begin
  if uid is null then raise exception 'Not signed in'; end if;
  begin
    sid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when others then
    sid := null;
  end;
  if sid is not null then
    select a.session_id, s.created_at into cur, cur_made
      from private.active_sessions a left join auth.sessions s on s.id = a.session_id
      where a.user_id = uid;
    if cur is distinct from sid then
      select s.created_at into my_made from auth.sessions s where s.id = sid;
      if cur is null or cur_made is null or (my_made is not null and my_made >= cur_made) then
        insert into private.active_sessions(user_id, session_id) values (uid, sid)
          on conflict (user_id) do update set session_id = excluded.session_id, since = now();
      else
        raise exception 'You signed in on another device, so you were signed out here.' using errcode = 'P0410';
      end if;
    end if;
  end if;
  if not private.cloud_meter(uid, 'call', 0) then
    raise exception 'Too many syncs right now. Try again later.' using errcode = 'P0429';
  end if;
  insert into private.last_active (user_id, at) values (uid, now())
    on conflict (user_id) do update set at = excluded.at where private.last_active.at < now() - interval '20 seconds';
  return uid;
end $$;

/** Who's online (active in the last 15 minutes), newest first, with counts. Owner only. */
create function public.admin_online(p_channel text) returns jsonb
  language plpgsql stable security definer set search_path = ''
as $$
declare
  a private.admins := private.admin_gate(true);
  ch text := private.cloud_ch(p_channel);
begin
  return jsonb_build_object(
    'now', (select count(*) from private.last_active where at > now() - interval '2 minutes'),
    'hour', (select count(*) from private.last_active where at > now() - interval '1 hour'),
    'day', (select count(*) from private.last_active where at > now() - interval '24 hours'),
    'rows', coalesce((
      select jsonb_agg(card order by at desc)
      from (
        select l.at, jsonb_build_object(
          'user', l.user_id,
          'username', private.username_of(l.user_id),
          'at', l.at,
          'device', (select d.name from public.cloud_devices d where d.user_id = l.user_id and d.channel = ch order by d.last_seen desc limit 1),
          'airline', s.airline,
          'saveId', s.save_id,
          'savedAt', s.updated_at
        ) as card
        from private.last_active l
        left join lateral (select c.airline, c.save_id, c.updated_at from public.cloud_saves c where c.user_id = l.user_id and c.channel = ch order by c.updated_at desc limit 1) s on true
        where l.at > now() - interval '15 minutes'
        order by l.at desc
        limit 200
      ) x
    ), '[]'::jsonb)
  );
end $$;
revoke all on function public.admin_online(text) from public, anon;
grant execute on function public.admin_online(text) to authenticated;
