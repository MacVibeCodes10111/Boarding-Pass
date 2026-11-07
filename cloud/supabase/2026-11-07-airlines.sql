-- Friends per airline, and Career and Sandbox kept apart (Update A, after A4).
-- Needs 2026-11-06-friends.sql and 2026-11-06-friends-map.sql first.
--
-- A player can share several airlines, each with its own friend code, friends and
-- map choice: friends are airlines, not accounts. Sharing happens from inside a
-- career; the main menu picks which shared airline to look at.
--
-- Each shared airline says whether it plays Career or Sandbox, and the two never
-- mix: friends (and later alliances and the marketplace) stay within one mode.
-- An airline that changes mode (an edited save opens as Sandbox) loses its friends.
--
-- Blocking is about the person: a block stops all of their airlines reaching any of
-- yours, and ends every friendship between the two of you.
--
-- Existing data is carried over: the one airline each player shared keeps the id,
-- friend code and map choice the player had, so friendships and stored schedules
-- still match.

-- ---------------------------------------------------------------------------
-- Shared airlines: one row each, several per player
-- ---------------------------------------------------------------------------
alter table public.profiles add column mode text not null default 'career' check (mode in ('career', 'sandbox'));
alter table public.profiles add column friend_code text;
alter table public.profiles add column map_on boolean not null default false;
alter table public.profiles add constraint profiles_friend_code_key unique (channel, friend_code);

update public.profiles s set public_id = p.public_id, friend_code = p.code, map_on = p.map_on
from public.online_players p where p.user_id = s.user_id and p.channel = s.channel;

do $$
declare r record;
begin
  for r in select user_id, channel, save_id from public.profiles where friend_code is null loop
    for attempt in 1..5 loop
      begin
        update public.profiles set friend_code = private.new_friend_code() where user_id = r.user_id and channel = r.channel and save_id = r.save_id;
        exit;
      exception when unique_violation then
        null; -- that code was taken: draw another
      end;
    end loop;
  end loop;
end $$;

alter table public.profiles alter column friend_code set not null;
alter table public.profiles add constraint profiles_friend_code_check check (friend_code ~ '^[2-9BCDFGHJKLMNPQRSTVWXZ]{8}$');
alter table public.profiles drop constraint profiles_pkey;
alter table public.profiles add primary key (user_id, channel, save_id);

-- ---------------------------------------------------------------------------
-- Friendships between airlines. Removing an airline removes its friendships.
-- ---------------------------------------------------------------------------
create table public.airline_friendships (
  channel text not null check (channel in ('main', 'dev')),
  a uuid not null references public.profiles(public_id) on delete cascade,
  b uuid not null references public.profiles(public_id) on delete cascade,
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

insert into public.airline_friendships (channel, a, b, status, requested_by, via_code, a_map, b_map, created_at, updated_at)
select f.channel, least(pa.public_id, pb.public_id), greatest(pa.public_id, pb.public_id), f.status,
       case when f.requested_by = f.a then pa.public_id else pb.public_id end, f.via_code,
       case when pa.public_id < pb.public_id then f.a_map else f.b_map end,
       case when pa.public_id < pb.public_id then f.b_map else f.a_map end,
       f.created_at, f.updated_at
from public.friendships f
join public.profiles pa on pa.user_id = f.a and pa.channel = f.channel
join public.profiles pb on pb.user_id = f.b and pb.channel = f.channel;

drop table public.friendships;
alter table public.airline_friendships rename to friendships;
alter table public.friendships rename constraint airline_friendships_pkey to friendships_pkey;
create index friendships_b on public.friendships (channel, b);
alter table public.friendships enable row level security;
revoke all on public.friendships from anon, authenticated;

-- A block is named by its own id, so unblocking never needs the other player's account
alter table public.blocks add column id uuid not null default gen_random_uuid() unique;

-- The nightly clean-up can be for one airline (null: all of the player's in that channel)
alter table private.logo_removals add column airline uuid;

-- ---------------------------------------------------------------------------
-- What went before
-- ---------------------------------------------------------------------------
drop function public.friends_list(text);
drop function public.friend_request(text, text);
drop function public.friend_respond(text, uuid, boolean);
drop function public.friend_remove(text, uuid);
drop function public.friend_block(text, uuid);
drop function public.friend_unblock(text, uuid);
drop function public.friend_code_new(text);
drop function public.friend_map_set(text, uuid, boolean);
drop function public.friend_liveries(text, uuid);
drop function public.map_share_set(text, boolean);
drop function public.schedule_gate(text);
drop function public.friends_on_map(text);
drop function public.profile_mine(text);
drop function public.profile_delete(text);
drop function public.profile_publish(text, text, text, text, text, jsonb, jsonb, jsonb);
drop function public.logo_gate(text);
drop function private.online_player(uuid, text);
drop function private.user_of(text, uuid);
drop function private.friend_total(uuid, text);
drop function private.friend_card(uuid, text);
drop table public.online_players;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
/** One of the player's own shared airlines. Every field null if it isn't theirs. */
create function private.my_airline(uid uuid, ch text, p_id uuid) returns public.profiles
  language sql stable security definer set search_path = ''
as $$ select * from public.profiles where user_id = uid and channel = ch and public_id = p_id $$;

/** Any shared airline in this channel. */
create function private.airline_of(ch text, p_id uuid) returns public.profiles
  language sql stable security definer set search_path = ''
as $$ select * from public.profiles where channel = ch and public_id = p_id $$;

/** How many friends this airline has. */
create function private.friend_total(p_air uuid, ch text) returns int
  language sql stable security definer set search_path = ''
as $$ select count(*)::int from public.friendships where channel = ch and status = 'accepted' and (a = p_air or b = p_air) $$;

/** What a friend sees of an airline. Null if it isn't being shared. */
create function private.friend_card(p_air uuid, ch text) returns jsonb
  language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('airline', airline, 'code', code, 'callsign', callsign, 'colours', colours, 'stats', stats, 'badge', liveries->0->>'badge', 'updatedAt', updated_at)
  from public.profiles where public_id = p_air and channel = ch and private.feature_on(ch, 'profiles')
$$;

revoke all on function private.my_airline(uuid, text, uuid) from public, anon, authenticated;
revoke all on function private.airline_of(text, uuid) from public, anon, authenticated;
revoke all on function private.friend_total(uuid, text) from public, anon, authenticated;
revoke all on function private.friend_card(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Sharing airlines
-- ---------------------------------------------------------------------------
/**
 * Shares a career, or updates it. Ten airlines a player at most. Answers: saved, too_soon, too_many,
 * off, bad_name, bad_text, bad_livery, too_big.
 */
create function public.profile_publish(p_channel text, p_save_id text, p_airline text, p_code text, p_callsign text, p_colours jsonb, p_liveries jsonb, p_stats jsonb, p_mode text)
  returns text language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.cloud_gate(); ch text := private.cloud_ch(p_channel); old public.profiles; r text; k text;
begin
  if not private.feature_on(ch, 'profiles') then return 'off'; end if;
  if p_mode is null or p_mode not in ('career', 'sandbox') then return 'bad_name'; end if;
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

  -- One at a time per player, so the count can't be raced past
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 78));
  select * into old from public.profiles where user_id = uid and channel = ch and save_id = p_save_id;
  if found then
    -- The game publishes every few minutes at most
    if old.updated_at > now() - interval '60 seconds' then return 'too_soon'; end if;
    -- Career and Sandbox never mix: an airline that changes mode leaves its friends behind
    if old.mode <> p_mode then
      delete from public.friendships where channel = ch and (a = old.public_id or b = old.public_id);
    end if;
    update public.profiles set airline = btrim(p_airline), code = p_code, callsign = coalesce(p_callsign, ''), colours = p_colours,
      liveries = p_liveries, stats = p_stats, mode = p_mode, updated_at = now()
    where user_id = uid and channel = ch and save_id = p_save_id;
    return 'saved';
  end if;
  if (select count(*) from public.profiles where user_id = uid and channel = ch) >= 10 then return 'too_many'; end if;
  for attempt in 1..5 loop
    begin
      insert into public.profiles (user_id, channel, save_id, airline, code, callsign, colours, liveries, stats, mode, friend_code)
      values (uid, ch, p_save_id, btrim(p_airline), p_code, coalesce(p_callsign, ''), p_colours, p_liveries, p_stats, p_mode, private.new_friend_code());
      return 'saved';
    exception when unique_violation then
      null; -- that friend code was taken: draw another
    end;
  end loop;
  raise exception 'No friend code available';
end $$;

/** The player's shared airlines, oldest first. */
create function public.airlines_mine(p_channel text)
  returns jsonb language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.cloud_gate(); ch text := private.cloud_ch(p_channel);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', public_id, 'saveId', save_id, 'airline', airline, 'code', code, 'friendCode', friend_code, 'mode', mode, 'mapOn', map_on, 'updatedAt', updated_at) order by shared_at)
    from public.profiles where user_id = uid and channel = ch
  ), '[]'::jsonb);
end $$;

/** Stops sharing one airline: its friends go with it, and its logos and schedule are queued for removal. Works even with the feature off. */
create function public.profile_delete(p_channel text, p_save_id text)
  returns void language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.cloud_gate(); ch text := private.cloud_ch(p_channel); gone uuid;
begin
  delete from public.profiles where user_id = uid and channel = ch and save_id = p_save_id returning public_id into gone;
  if gone is not null then
    insert into private.logo_removals (user_id, channel, airline) values (uid, ch, gone);
  end if;
end $$;

/** For the Worker, with the player's sign-in: may this airline of theirs upload a logo? */
create function public.logo_gate(p_channel text, p_airline uuid)
  returns boolean language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.cloud_gate(); ch text := private.cloud_ch(p_channel);
begin
  return private.feature_on(ch, 'profiles') and private.feature_on(ch, 'logos')
    and exists (select 1 from public.profiles where user_id = uid and channel = ch and public_id = p_airline);
end $$;

/** For the nightly job: what to remove. Null unless the key is right. */
create or replace function public.logo_removals_take(p_key text)
  returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  if not private.logo_key_ok(p_key) then return null; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'user_id', user_id, 'channel', channel, 'kind', kind, 'airline', airline, 'at', floor(extract(epoch from at) * 1000))), '[]'::jsonb)
          from (select * from private.logo_removals order by id limit 100) r);
end $$;

-- ---------------------------------------------------------------------------
-- Friends: always as one of the player's airlines (p_me)
-- ---------------------------------------------------------------------------
/** The Friends screen for one airline. Null while the feature is off, or if the airline isn't the player's. */
create function public.friends_list(p_channel text, p_me uuid)
  returns jsonb language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.cloud_gate(); ch text := private.cloud_ch(p_channel); me public.profiles := private.my_airline(uid, ch, p_me);
begin
  if not private.feature_on(ch, 'friends') or me.public_id is null then return null; end if;
  return jsonb_build_object(
    'id', me.public_id,
    'code', me.friend_code,
    'mode', me.mode,
    'friends', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'onMap', case when f.a = p_me then f.a_map else f.b_map end, 'since', f.updated_at, 'card', private.friend_card(o.id, ch)) order by f.updated_at desc)
      from public.friendships f cross join lateral (select case when f.a = p_me then f.b else f.a end as id) o
      where f.channel = ch and f.status = 'accepted' and (f.a = p_me or f.b = p_me)), '[]'::jsonb),
    'incoming', coalesce((
      select jsonb_agg(jsonb_build_object('id', f.requested_by, 'at', f.created_at, 'card', private.friend_card(f.requested_by, ch)) order by f.created_at desc)
      from public.friendships f
      where f.channel = ch and f.status = 'pending' and f.requested_by <> p_me and (f.a = p_me or f.b = p_me)), '[]'::jsonb),
    -- Only the code they typed: nothing about the other airline until it's accepted
    'outgoing', coalesce((
      select jsonb_agg(jsonb_build_object('id', case when f.a = p_me then f.b else f.a end, 'at', f.created_at, 'code', f.via_code) order by f.created_at desc)
      from public.friendships f
      where f.channel = ch and f.status = 'pending' and f.requested_by = p_me), '[]'::jsonb),
    -- Blocks are the player's, whichever airline they made them from
    'blocked', coalesce((
      select jsonb_agg(jsonb_build_object('id', k.id, 'label', k.label) order by k.created_at desc)
      from public.blocks k where k.channel = ch and k.blocker = uid), '[]'::jsonb)
  );
end $$;

/**
 * Asks to be friends. Answers: sent, accepted (they'd already asked), not_found, self, other_mode,
 * already, already_sent, too_soon, you_blocked, limit, their_limit, too_many_today, share_first, off.
 * A player who has blocked you looks the same as a code that doesn't exist.
 */
create function public.friend_request(p_channel text, p_me uuid, p_code text)
  returns text language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.cloud_gate(); ch text := private.cloud_ch(p_channel); me public.profiles := private.my_airline(uid, ch, p_me);
  c text; them public.profiles; x uuid; y uuid; f public.friendships;
begin
  if not private.feature_on(ch, 'friends') then return 'off'; end if;
  -- The other player sees who's asking, so it has to be a shared airline
  if me.public_id is null then return 'share_first'; end if;
  -- Failures count too, so codes can't be guessed
  if not private.friend_count_up(uid, ch, 'requests', 20) then return 'too_many_today'; end if;
  c := upper(regexp_replace(coalesce(p_code, ''), '[^a-zA-Z0-9]', '', 'g'));
  if c !~ '^[2-9BCDFGHJKLMNPQRSTVWXZ]{8}$' then return 'not_found'; end if;
  select * into them from public.profiles where channel = ch and friend_code = c;
  if them.public_id is null then return 'not_found'; end if;
  if them.user_id = uid then return 'self'; end if;
  perform private.friends_lock(me.public_id, them.public_id);
  if exists (select 1 from public.blocks where channel = ch and blocker = them.user_id and blocked = uid) then return 'not_found'; end if;
  if exists (select 1 from public.blocks where channel = ch and blocker = uid and blocked = them.user_id) then return 'you_blocked'; end if;
  if them.mode <> me.mode then return 'other_mode'; end if;
  x := least(me.public_id, them.public_id); y := greatest(me.public_id, them.public_id);
  select * into f from public.friendships where channel = ch and a = x and b = y;
  if found then
    if f.status = 'accepted' then return 'already'; end if;
    if f.status = 'pending' and f.requested_by = p_me then return 'already_sent'; end if;
    if f.status = 'pending' then
      if private.friend_total(p_me, ch) >= 100 then return 'limit'; end if;
      if private.friend_total(them.public_id, ch) >= 100 then return 'their_limit'; end if;
      update public.friendships set status = 'accepted', via_code = null, updated_at = now() where channel = ch and a = x and b = y;
      return 'accepted';
    end if;
    -- Declined: whoever was turned down waits a week. The one who declined can change their mind
    if f.requested_by = p_me and f.updated_at > now() - interval '7 days' then return 'too_soon'; end if;
  end if;
  if private.friend_total(p_me, ch) >= 100 then return 'limit'; end if;
  if (select count(*) from public.friendships where channel = ch and status = 'pending' and requested_by = p_me) >= 50 then return 'limit'; end if;
  if private.friend_total(them.public_id, ch) >= 100 then return 'their_limit'; end if;
  if (select count(*) from public.friendships where channel = ch and status = 'pending' and requested_by <> them.public_id and (a = them.public_id or b = them.public_id)) >= 50 then return 'their_limit'; end if;
  insert into public.friendships (channel, a, b, status, requested_by, via_code) values (ch, x, y, 'pending', p_me, c)
  on conflict (channel, a, b) do update set status = 'pending', requested_by = p_me, via_code = c, a_map = true, b_map = true, created_at = now(), updated_at = now();
  return 'sent';
end $$;

/** Accepts or declines a request made to this airline. Answers: accepted, declined, gone, limit, their_limit, off. */
create function public.friend_respond(p_channel text, p_me uuid, p_id uuid, p_accept boolean)
  returns text language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.cloud_gate(); ch text := private.cloud_ch(p_channel); me public.profiles := private.my_airline(uid, ch, p_me); x uuid; y uuid;
begin
  if me.public_id is null or p_id is null or p_id = p_me then return 'gone'; end if;
  perform private.friends_lock(p_me, p_id);
  x := least(p_me, p_id); y := greatest(p_me, p_id);
  if not exists (select 1 from public.friendships where channel = ch and a = x and b = y and status = 'pending' and requested_by = p_id) then return 'gone'; end if;
  if not p_accept then
    update public.friendships set status = 'declined', via_code = null, updated_at = now() where channel = ch and a = x and b = y;
    return 'declined';
  end if;
  if not private.feature_on(ch, 'friends') then return 'off'; end if;
  if private.friend_total(p_me, ch) >= 100 then return 'limit'; end if;
  if private.friend_total(p_id, ch) >= 100 then return 'their_limit'; end if;
  update public.friendships set status = 'accepted', via_code = null, updated_at = now() where channel = ch and a = x and b = y;
  return 'accepted';
end $$;

/** Removes a friend, or cancels a request this airline sent. Works even with the feature off. */
create function public.friend_remove(p_channel text, p_me uuid, p_id uuid)
  returns void language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.cloud_gate(); ch text := private.cloud_ch(p_channel); me public.profiles := private.my_airline(uid, ch, p_me);
begin
  if me.public_id is null or p_id is null then return; end if;
  delete from public.friendships
  where channel = ch and a = least(p_me, p_id) and b = greatest(p_me, p_id)
    and (status = 'accepted' or (status = 'pending' and requested_by = p_me));
end $$;

/**
 * Blocks the player behind a friend, or behind an airline that asked: none of their airlines can
 * reach any of this player's, and every friendship between the two goes. Only for an airline this
 * one already knows of. Works even with the feature off.
 */
create function public.friend_block(p_channel text, p_me uuid, p_id uuid)
  returns boolean language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.cloud_gate(); ch text := private.cloud_ch(p_channel); me public.profiles := private.my_airline(uid, ch, p_me);
  them public.profiles := private.airline_of(ch, p_id); x uuid; y uuid;
begin
  if me.public_id is null or them.public_id is null or them.user_id = uid then return false; end if;
  perform private.friends_lock(p_me, p_id);
  x := least(p_me, p_id); y := greatest(p_me, p_id);
  -- A request this airline sent doesn't count: all it knows of the other side is a code
  if not exists (select 1 from public.friendships where channel = ch and a = x and b = y and (status = 'accepted' or (status = 'pending' and requested_by = p_id))) then return false; end if;
  insert into public.blocks (channel, blocker, blocked, label) values (ch, uid, them.user_id, them.airline)
  on conflict (channel, blocker, blocked) do nothing;
  delete from public.friendships f using public.profiles pa, public.profiles pb
  where f.channel = ch and pa.public_id = f.a and pb.public_id = f.b
    and ((pa.user_id = uid and pb.user_id = them.user_id) or (pa.user_id = them.user_id and pb.user_id = uid));
  return true;
end $$;

create function public.friend_unblock(p_channel text, p_block uuid)
  returns void language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.cloud_gate(); ch text := private.cloud_ch(p_channel);
begin
  delete from public.blocks where channel = ch and blocker = uid and id = p_block;
end $$;

/** A new friend code for this airline; the old one stops working. Up to 5 a day for each player. Null at the limit or with the feature off. */
create function public.friend_code_new(p_channel text, p_me uuid)
  returns text language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.cloud_gate(); ch text := private.cloud_ch(p_channel); me public.profiles := private.my_airline(uid, ch, p_me); fresh text;
begin
  if not private.feature_on(ch, 'friends') or me.public_id is null then return null; end if;
  if not private.friend_count_up(uid, ch, 'codes', 5) then return null; end if;
  for attempt in 1..5 loop
    begin
      fresh := private.new_friend_code();
      update public.profiles set friend_code = fresh where user_id = uid and channel = ch and public_id = p_me;
      return fresh;
    exception when unique_violation then
      null; -- that code was taken: draw another
    end;
  end loop;
  return null;
end $$;

/** Whether this airline's map shows a friend's aircraft. */
create function public.friend_map_set(p_channel text, p_me uuid, p_id uuid, p_on boolean)
  returns void language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.cloud_gate(); ch text := private.cloud_ch(p_channel); me public.profiles := private.my_airline(uid, ch, p_me);
begin
  if me.public_id is null or p_id is null then return; end if;
  update public.friendships
    set a_map = case when a = p_me then coalesce(p_on, true) else a_map end,
        b_map = case when b = p_me then coalesce(p_on, true) else b_map end
  where channel = ch and a = least(p_me, p_id) and b = greatest(p_me, p_id) and status = 'accepted';
end $$;

/** A friend's liveries, to paint their aircraft. Null unless they're this airline's friend right now. */
create function public.friend_liveries(p_channel text, p_me uuid, p_id uuid)
  returns jsonb language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.cloud_gate(); ch text := private.cloud_ch(p_channel); me public.profiles := private.my_airline(uid, ch, p_me);
begin
  if me.public_id is null or p_id is null or not private.feature_on(ch, 'friends') or not private.feature_on(ch, 'profiles') then return null; end if;
  if not exists (select 1 from public.friendships where channel = ch and a = least(p_me, p_id) and b = greatest(p_me, p_id) and status = 'accepted') then return null; end if;
  return (select jsonb_build_object('liveries', liveries, 'updatedAt', updated_at) from public.profiles where public_id = p_id and channel = ch);
end $$;

-- ---------------------------------------------------------------------------
-- Friends' aircraft on the map
-- ---------------------------------------------------------------------------
/**
 * Turns showing this airline's flights to its friends on or off. Answers: on, off, share_first, unavailable.
 * Turning off always works, and queues the schedule for removal in case the game can't reach the Worker.
 */
create function public.map_share_set(p_channel text, p_me uuid, p_on boolean)
  returns text language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.cloud_gate(); ch text := private.cloud_ch(p_channel);
begin
  if p_on is not true then
    update public.profiles set map_on = false where user_id = uid and channel = ch and public_id = p_me and map_on;
    if found then
      insert into private.logo_removals (user_id, channel, kind, airline) values (uid, ch, 'schedule', p_me);
    end if;
    return 'off';
  end if;
  if not private.feature_on(ch, 'friends') or not private.feature_on(ch, 'friends_map') then return 'unavailable'; end if;
  update public.profiles set map_on = true where user_id = uid and channel = ch and public_id = p_me;
  if not found then return 'share_first'; end if;
  return 'on';
end $$;

/** For the Worker, with the player's sign-in: the airline whose schedule this is. Null if it can't publish one. */
create function public.schedule_gate(p_channel text, p_me uuid)
  returns uuid language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.cloud_gate(); ch text := private.cloud_ch(p_channel);
begin
  if not private.feature_on(ch, 'friends') or not private.feature_on(ch, 'friends_map') then return null; end if;
  return (select public_id from public.profiles where user_id = uid and channel = ch and public_id = p_me and map_on);
end $$;

/**
 * The friends whose aircraft this airline's map can show right now: accepted, this airline's own
 * toggle on, the friend sharing their flights. 20 airlines at most, the most recently active first.
 */
create function public.friends_on_map(p_channel text, p_me uuid)
  returns jsonb language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.cloud_gate(); ch text := private.cloud_ch(p_channel); me public.profiles := private.my_airline(uid, ch, p_me);
begin
  if me.public_id is null or not private.feature_on(ch, 'friends') or not private.feature_on(ch, 'friends_map') or not private.feature_on(ch, 'profiles') then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', x.public_id, 'airline', x.airline, 'code', x.code, 'callsign', x.callsign, 'colours', x.colours, 'updatedAt', x.updated_at))
    from (
      select s.public_id, s.airline, s.code, s.callsign, s.colours, s.updated_at
      from public.friendships f
      join public.profiles s on s.channel = ch and s.public_id = case when f.a = p_me then f.b else f.a end and s.map_on
      where f.channel = ch and f.status = 'accepted' and (f.a = p_me or f.b = p_me)
        and case when f.a = p_me then f.a_map else f.b_map end
      order by s.updated_at desc
      limit 20
    ) x
  ), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------
revoke all on function public.profile_publish(text, text, text, text, text, jsonb, jsonb, jsonb, text) from public, anon;
revoke all on function public.airlines_mine(text) from public, anon;
revoke all on function public.profile_delete(text, text) from public, anon;
revoke all on function public.logo_gate(text, uuid) from public, anon;
revoke all on function public.friends_list(text, uuid) from public, anon;
revoke all on function public.friend_request(text, uuid, text) from public, anon;
revoke all on function public.friend_respond(text, uuid, uuid, boolean) from public, anon;
revoke all on function public.friend_remove(text, uuid, uuid) from public, anon;
revoke all on function public.friend_block(text, uuid, uuid) from public, anon;
revoke all on function public.friend_unblock(text, uuid) from public, anon;
revoke all on function public.friend_code_new(text, uuid) from public, anon;
revoke all on function public.friend_map_set(text, uuid, uuid, boolean) from public, anon;
revoke all on function public.friend_liveries(text, uuid, uuid) from public, anon;
revoke all on function public.map_share_set(text, uuid, boolean) from public, anon;
revoke all on function public.schedule_gate(text, uuid) from public, anon;
revoke all on function public.friends_on_map(text, uuid) from public, anon;
grant execute on function public.profile_publish(text, text, text, text, text, jsonb, jsonb, jsonb, text) to authenticated;
grant execute on function public.airlines_mine(text) to authenticated;
grant execute on function public.profile_delete(text, text) to authenticated;
grant execute on function public.logo_gate(text, uuid) to authenticated;
grant execute on function public.friends_list(text, uuid) to authenticated;
grant execute on function public.friend_request(text, uuid, text) to authenticated;
grant execute on function public.friend_respond(text, uuid, uuid, boolean) to authenticated;
grant execute on function public.friend_remove(text, uuid, uuid) to authenticated;
grant execute on function public.friend_block(text, uuid, uuid) to authenticated;
grant execute on function public.friend_unblock(text, uuid) to authenticated;
grant execute on function public.friend_code_new(text, uuid) to authenticated;
grant execute on function public.friend_map_set(text, uuid, uuid, boolean) to authenticated;
grant execute on function public.friend_liveries(text, uuid, uuid) to authenticated;
grant execute on function public.map_share_set(text, uuid, boolean) to authenticated;
grant execute on function public.schedule_gate(text, uuid) to authenticated;
grant execute on function public.friends_on_map(text, uuid) to authenticated;
