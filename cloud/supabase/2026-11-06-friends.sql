-- Friends (Update A, phase A3). Needs 2026-11-05-logos.sql first.
-- Friends are found by a private friend code, never by username, because a
-- username is half of a password login. Players can't touch these tables: only
-- the functions below, which go by the signed-in player and talk in public ids,
-- never account numbers. Everything is per channel: dev and the real game stay apart.

-- A player's public identity. Separate from profiles because it has to last while
-- they aren't sharing an airline, so a friend survives them turning sharing off and on.
create table public.online_players (
  user_id uuid not null references auth.users(id) on delete cascade,
  channel text not null check (channel in ('main', 'dev')),
  public_id uuid not null default gen_random_uuid() unique,
  -- No vowels, 0 or 1: nothing misread, and no accidental words
  code text not null check (code ~ '^[2-9BCDFGHJKLMNPQRSTVWXZ]{8}$'),
  primary key (user_id, channel),
  unique (channel, code)
);
alter table public.online_players enable row level security;
revoke all on public.online_players from anon, authenticated;

-- One row per pair, smaller id first. A declined row stays for a week so the same
-- player can't ask again straight away, and nobody can see it.
create table public.friendships (
  channel text not null check (channel in ('main', 'dev')),
  a uuid not null references auth.users(id) on delete cascade,
  b uuid not null references auth.users(id) on delete cascade,
  status text not null check (status in ('pending', 'accepted', 'declined')),
  requested_by uuid not null,
  -- The code that was typed: all the sender sees until the request is accepted
  via_code text,
  -- Whether a wants b's aircraft on a's map, and the other way round
  a_map boolean not null default true,
  b_map boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (channel, a, b),
  check (a < b),
  check (requested_by = a or requested_by = b)
);
create index friendships_b on public.friendships (channel, b);
alter table public.friendships enable row level security;
revoke all on public.friendships from anon, authenticated;

create table public.blocks (
  channel text not null check (channel in ('main', 'dev')),
  blocker uuid not null references auth.users(id) on delete cascade,
  blocked uuid not null references auth.users(id) on delete cascade,
  -- The airline's name when blocked, so the player can tell who to unblock
  label text not null,
  created_at timestamptz not null default now(),
  primary key (channel, blocker, blocked)
);
create index blocks_blocked on public.blocks (channel, blocked);
alter table public.blocks enable row level security;
revoke all on public.blocks from anon, authenticated;

create table private.friend_meter (
  user_id uuid not null references auth.users(id) on delete cascade,
  channel text not null,
  day date not null default current_date,
  requests int not null default 0,
  codes int not null default 0,
  primary key (user_id, channel, day)
);

create function private.new_friend_code() returns text
  language sql volatile set search_path = ''
as $$
  select string_agg(substr('23456789BCDFGHJKLMNPQRSTVWXZ', 1 + get_byte(r, i) % 28, 1), '')
  from (select decode(replace(gen_random_uuid()::text, '-', ''), 'hex') as r) u,
       -- The bytes of a uuid that are fully random
       unnest(array[0, 1, 2, 3, 4, 5, 9, 10]) i
$$;

/** The player's public identity, made the first time it's needed. */
create function private.online_player(uid uuid, ch text) returns public.online_players
  language plpgsql security definer set search_path = ''
as $$
declare rec public.online_players;
begin
  select * into rec from public.online_players where user_id = uid and channel = ch;
  if found then return rec; end if;
  for attempt in 1..5 loop
    begin
      insert into public.online_players (user_id, channel, code) values (uid, ch, private.new_friend_code())
      on conflict (user_id, channel) do nothing;
      select * into rec from public.online_players where user_id = uid and channel = ch;
      return rec;
    exception when unique_violation then
      null; -- that code was taken: draw another
    end;
  end loop;
  raise exception 'No friend code available';
end $$;

/** Today's count of something for this player, raised by one unless it's at the limit. False at the limit. */
create function private.friend_count_up(uid uuid, ch text, what text, lim int) returns boolean
  language plpgsql security definer set search_path = ''
as $$
declare n int;
begin
  insert into private.friend_meter (user_id, channel) values (uid, ch) on conflict do nothing;
  select case what when 'requests' then requests else codes end into n
    from private.friend_meter where user_id = uid and channel = ch and day = current_date for update;
  if n >= lim then return false; end if;
  update private.friend_meter
    set requests = requests + (what = 'requests')::int, codes = codes + (what = 'codes')::int
    where user_id = uid and channel = ch and day = current_date;
  return true;
end $$;

/** Who a public id belongs to, in this channel. */
create function private.user_of(ch text, p_id uuid) returns uuid
  language sql stable security definer set search_path = ''
as $$ select user_id from public.online_players where channel = ch and public_id = p_id $$;

/** Stops two calls for the same players changing counts at once. Always in the same order, so they can't deadlock. */
create function private.friends_lock(x uuid, y uuid) returns void
  language plpgsql set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(least(x, y)::text, 77));
  perform pg_advisory_xact_lock(hashtextextended(greatest(x, y)::text, 77));
end $$;

/** How many friends this player has. */
create function private.friend_total(uid uuid, ch text) returns int
  language sql stable security definer set search_path = ''
as $$ select count(*)::int from public.friendships where channel = ch and status = 'accepted' and (a = uid or b = uid) $$;

/** What a friend sees of an airline. Null if it isn't being shared. */
create function private.friend_card(uid uuid, ch text) returns jsonb
  language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('airline', airline, 'code', code, 'callsign', callsign, 'colours', colours, 'stats', stats, 'badge', liveries->0->>'badge', 'updatedAt', updated_at)
  from public.profiles where user_id = uid and channel = ch and private.feature_on(ch, 'profiles')
$$;

revoke all on function private.new_friend_code() from public, anon, authenticated;
revoke all on function private.online_player(uuid, text) from public, anon, authenticated;
revoke all on function private.friend_count_up(uuid, text, text, int) from public, anon, authenticated;
revoke all on function private.user_of(text, uuid) from public, anon, authenticated;
revoke all on function private.friends_lock(uuid, uuid) from public, anon, authenticated;
revoke all on function private.friend_total(uuid, text) from public, anon, authenticated;
revoke all on function private.friend_card(uuid, text) from public, anon, authenticated;

/** The whole Friends screen in one call. Null while the feature is off. */
create function public.friends_list(p_channel text)
  returns jsonb language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.cloud_gate(); ch text := private.cloud_ch(p_channel); me public.online_players;
begin
  if not private.feature_on(ch, 'friends') then return null; end if;
  me := private.online_player(uid, ch);
  return jsonb_build_object(
    'id', me.public_id,
    'code', me.code,
    'friends', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.public_id, 'onMap', case when f.a = uid then f.a_map else f.b_map end, 'since', f.updated_at, 'card', private.friend_card(p.user_id, ch)) order by f.updated_at desc)
      from public.friendships f join public.online_players p on p.channel = ch and p.user_id = case when f.a = uid then f.b else f.a end
      where f.channel = ch and f.status = 'accepted' and (f.a = uid or f.b = uid)), '[]'::jsonb),
    'incoming', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.public_id, 'at', f.created_at, 'card', private.friend_card(p.user_id, ch)) order by f.created_at desc)
      from public.friendships f join public.online_players p on p.channel = ch and p.user_id = f.requested_by
      where f.channel = ch and f.status = 'pending' and f.requested_by <> uid and (f.a = uid or f.b = uid)), '[]'::jsonb),
    -- Only the code they typed: nothing about the other airline until it's accepted
    'outgoing', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.public_id, 'at', f.created_at, 'code', f.via_code) order by f.created_at desc)
      from public.friendships f join public.online_players p on p.channel = ch and p.user_id = case when f.a = uid then f.b else f.a end
      where f.channel = ch and f.status = 'pending' and f.requested_by = uid), '[]'::jsonb),
    'blocked', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.public_id, 'label', k.label) order by k.created_at desc)
      from public.blocks k join public.online_players p on p.channel = ch and p.user_id = k.blocked
      where k.channel = ch and k.blocker = uid), '[]'::jsonb)
  );
end $$;

/**
 * Asks to be friends. Answers: sent, accepted (they'd already asked you), not_found, self, already,
 * already_sent, too_soon, you_blocked, limit, their_limit, too_many_today, share_first, off.
 * A player who has blocked you looks the same as a code that doesn't exist.
 */
create function public.friend_request(p_channel text, p_code text)
  returns text language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.cloud_gate(); ch text := private.cloud_ch(p_channel); c text; other uuid; x uuid; y uuid; f public.friendships;
begin
  if not private.feature_on(ch, 'friends') then return 'off'; end if;
  -- The other player sees who's asking, so there has to be an airline to show
  if not exists (select 1 from public.profiles where user_id = uid and channel = ch) then return 'share_first'; end if;
  -- Failures count too, so codes can't be guessed
  if not private.friend_count_up(uid, ch, 'requests', 20) then return 'too_many_today'; end if;
  c := upper(regexp_replace(coalesce(p_code, ''), '[^a-zA-Z0-9]', '', 'g'));
  if c !~ '^[2-9BCDFGHJKLMNPQRSTVWXZ]{8}$' then return 'not_found'; end if;
  select user_id into other from public.online_players where channel = ch and code = c;
  if other is null then return 'not_found'; end if;
  if other = uid then return 'self'; end if;
  perform private.friends_lock(uid, other);
  if exists (select 1 from public.blocks where channel = ch and blocker = other and blocked = uid) then return 'not_found'; end if;
  if exists (select 1 from public.blocks where channel = ch and blocker = uid and blocked = other) then return 'you_blocked'; end if;
  x := least(uid, other); y := greatest(uid, other);
  select * into f from public.friendships where channel = ch and a = x and b = y;
  if found then
    if f.status = 'accepted' then return 'already'; end if;
    if f.status = 'pending' and f.requested_by = uid then return 'already_sent'; end if;
    if f.status = 'pending' then
      if private.friend_total(uid, ch) >= 100 then return 'limit'; end if;
      if private.friend_total(other, ch) >= 100 then return 'their_limit'; end if;
      update public.friendships set status = 'accepted', via_code = null, updated_at = now() where channel = ch and a = x and b = y;
      return 'accepted';
    end if;
    -- Declined: whoever was turned down waits a week. The one who declined can change their mind
    if f.requested_by = uid and f.updated_at > now() - interval '7 days' then return 'too_soon'; end if;
  end if;
  if private.friend_total(uid, ch) >= 100 then return 'limit'; end if;
  if (select count(*) from public.friendships where channel = ch and status = 'pending' and requested_by = uid) >= 50 then return 'limit'; end if;
  if private.friend_total(other, ch) >= 100 then return 'their_limit'; end if;
  if (select count(*) from public.friendships where channel = ch and status = 'pending' and requested_by <> other and (a = other or b = other)) >= 50 then return 'their_limit'; end if;
  insert into public.friendships (channel, a, b, status, requested_by, via_code) values (ch, x, y, 'pending', uid, c)
  on conflict (channel, a, b) do update set status = 'pending', requested_by = uid, via_code = c, a_map = true, b_map = true, created_at = now(), updated_at = now();
  return 'sent';
end $$;

/** Accepts or declines a request made to this player. Answers: accepted, declined, gone, limit, their_limit, off. */
create function public.friend_respond(p_channel text, p_id uuid, p_accept boolean)
  returns text language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.cloud_gate(); ch text := private.cloud_ch(p_channel); other uuid := private.user_of(ch, p_id); x uuid; y uuid;
begin
  if other is null or other = uid then return 'gone'; end if;
  perform private.friends_lock(uid, other);
  x := least(uid, other); y := greatest(uid, other);
  if not exists (select 1 from public.friendships where channel = ch and a = x and b = y and status = 'pending' and requested_by = other) then return 'gone'; end if;
  if not p_accept then
    update public.friendships set status = 'declined', via_code = null, updated_at = now() where channel = ch and a = x and b = y;
    return 'declined';
  end if;
  if not private.feature_on(ch, 'friends') then return 'off'; end if;
  if private.friend_total(uid, ch) >= 100 then return 'limit'; end if;
  if private.friend_total(other, ch) >= 100 then return 'their_limit'; end if;
  update public.friendships set status = 'accepted', via_code = null, updated_at = now() where channel = ch and a = x and b = y;
  return 'accepted';
end $$;

/** Removes a friend or cancels a request you sent. Works even with the feature off. */
create function public.friend_remove(p_channel text, p_id uuid)
  returns void language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.cloud_gate(); ch text := private.cloud_ch(p_channel); other uuid := private.user_of(ch, p_id);
begin
  if other is null then return; end if;
  delete from public.friendships
  where channel = ch and a = least(uid, other) and b = greatest(uid, other)
    and (status = 'accepted' or (status = 'pending' and requested_by = uid));
end $$;

/**
 * Blocks a friend, or someone who asked: the friendship goes, and each stops seeing the other.
 * Only for someone you already know of. Works even with the feature off.
 */
create function public.friend_block(p_channel text, p_id uuid)
  returns boolean language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.cloud_gate(); ch text := private.cloud_ch(p_channel); other uuid := private.user_of(ch, p_id); x uuid; y uuid; name text;
begin
  if other is null or other = uid then return false; end if;
  perform private.friends_lock(uid, other);
  x := least(uid, other); y := greatest(uid, other);
  -- A request this player sent doesn't count: all they know of the other side is a code
  if not exists (select 1 from public.friendships where channel = ch and a = x and b = y and (status = 'accepted' or (status = 'pending' and requested_by = other))) then return false; end if;
  select airline into name from public.profiles where user_id = other and channel = ch;
  insert into public.blocks (channel, blocker, blocked, label) values (ch, uid, other, coalesce(name, 'An airline'))
  on conflict (channel, blocker, blocked) do nothing;
  delete from public.friendships where channel = ch and a = x and b = y;
  return true;
end $$;

create function public.friend_unblock(p_channel text, p_id uuid)
  returns void language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.cloud_gate(); ch text := private.cloud_ch(p_channel); other uuid := private.user_of(ch, p_id);
begin
  delete from public.blocks where channel = ch and blocker = uid and blocked = other;
end $$;

/** A new friend code; the old one stops working. Up to 5 a day. Null at the limit or with the feature off. */
create function public.friend_code_new(p_channel text)
  returns text language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.cloud_gate(); ch text := private.cloud_ch(p_channel); fresh text;
begin
  if not private.feature_on(ch, 'friends') then return null; end if;
  perform private.online_player(uid, ch);
  if not private.friend_count_up(uid, ch, 'codes', 5) then return null; end if;
  for attempt in 1..5 loop
    begin
      fresh := private.new_friend_code();
      update public.online_players set code = fresh where user_id = uid and channel = ch;
      return fresh;
    exception when unique_violation then
      null; -- that code was taken: draw another
    end;
  end loop;
  return null;
end $$;

/** Whether this player wants a friend's aircraft on their own map. */
create function public.friend_map_set(p_channel text, p_id uuid, p_on boolean)
  returns void language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.cloud_gate(); ch text := private.cloud_ch(p_channel); other uuid := private.user_of(ch, p_id);
begin
  update public.friendships
    set a_map = case when a = uid then coalesce(p_on, true) else a_map end,
        b_map = case when b = uid then coalesce(p_on, true) else b_map end
  where channel = ch and a = least(uid, other) and b = greatest(uid, other) and status = 'accepted';
end $$;

/** A friend's liveries, to paint their aircraft. Null unless they're a friend right now. */
create function public.friend_liveries(p_channel text, p_id uuid)
  returns jsonb language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.cloud_gate(); ch text := private.cloud_ch(p_channel); other uuid := private.user_of(ch, p_id);
begin
  if other is null or not private.feature_on(ch, 'friends') or not private.feature_on(ch, 'profiles') then return null; end if;
  if not exists (select 1 from public.friendships where channel = ch and a = least(uid, other) and b = greatest(uid, other) and status = 'accepted') then return null; end if;
  return (select jsonb_build_object('liveries', liveries, 'updatedAt', updated_at) from public.profiles where user_id = other and channel = ch);
end $$;

/** Nightly: old requests and refusals, and yesterday's counts. */
create function private.friends_cleanup() returns void
  language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.friendships where (status = 'declined' and updated_at < now() - interval '7 days') or (status = 'pending' and created_at < now() - interval '30 days');
  delete from private.friend_meter where day < current_date - 1;
end $$;
revoke all on function private.friends_cleanup() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('bp-friends-cleanup', '37 4 * * *', 'select private.friends_cleanup()');
  end if;
end $$;

revoke all on function public.friends_list(text) from public, anon;
revoke all on function public.friend_request(text, text) from public, anon;
revoke all on function public.friend_respond(text, uuid, boolean) from public, anon;
revoke all on function public.friend_remove(text, uuid) from public, anon;
revoke all on function public.friend_block(text, uuid) from public, anon;
revoke all on function public.friend_unblock(text, uuid) from public, anon;
revoke all on function public.friend_code_new(text) from public, anon;
revoke all on function public.friend_map_set(text, uuid, boolean) from public, anon;
revoke all on function public.friend_liveries(text, uuid) from public, anon;
grant execute on function public.friends_list(text) to authenticated;
grant execute on function public.friend_request(text, text) to authenticated;
grant execute on function public.friend_respond(text, uuid, boolean) to authenticated;
grant execute on function public.friend_remove(text, uuid) to authenticated;
grant execute on function public.friend_block(text, uuid) to authenticated;
grant execute on function public.friend_unblock(text, uuid) to authenticated;
grant execute on function public.friend_code_new(text) to authenticated;
grant execute on function public.friend_map_set(text, uuid, boolean) to authenticated;
grant execute on function public.friend_liveries(text, uuid) to authenticated;
