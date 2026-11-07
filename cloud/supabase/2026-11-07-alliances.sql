-- Alliances (Update A, phase A5). Needs 2026-11-07-airlines.sql first.
--
-- An alliance is made of shared airlines, not players: one alliance per airline, up to 20
-- airlines, all Career or all Sandbox. A leader starts it, invites their airline's friends,
-- and can remove members, hand over the lead or disband it. Members can leave. There are
-- no messages of any kind.
--
-- Everything goes through the functions below, which check who's asking. Names, tags and
-- descriptions go through the word filter. The alliance's logo can only be its leader's
-- airline logo, so it's the same reviewed picture, shown only once approved.
--
-- A leader who leaves or stops sharing hands the lead to the longest-standing member, and
-- an alliance with nobody left goes. What happened in an alliance (started, joined, left,
-- removed, new leader, renamed) is kept 12 months for moderation, then deleted.
--
-- Members appear on each other's maps if they show their flights to friends, as friends do.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.alliances (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('main', 'dev')),
  mode text not null check (mode in ('career', 'sandbox')),
  name text not null check (char_length(name) between 3 and 40),
  tag text not null check (tag ~ '^[A-Z0-9]{2,4}$'),
  colours jsonb not null,
  description text not null default '' check (char_length(description) <= 300),
  -- The hash of the leader's airline logo when it was set, or null
  logo text check (logo ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index alliances_name on public.alliances (channel, lower(name));
create unique index alliances_tag on public.alliances (channel, tag);

-- One row per airline: an airline is in one alliance at most
create table public.alliance_members (
  airline uuid primary key references public.profiles(public_id) on delete cascade,
  alliance uuid not null references public.alliances(id) on delete cascade,
  role text not null check (role in ('leader', 'member')),
  joined_at timestamptz not null default now()
);
create index alliance_members_alliance on public.alliance_members (alliance);
create unique index alliance_members_one_leader on public.alliance_members (alliance) where role = 'leader';

create table public.alliance_invites (
  alliance uuid not null references public.alliances(id) on delete cascade,
  airline uuid not null references public.profiles(public_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (alliance, airline)
);
create index alliance_invites_airline on public.alliance_invites (airline);

-- For moderation (A6). Airline ids only: a removed airline leaves nothing that names it
create table private.alliance_events (
  id bigint generated always as identity primary key,
  alliance uuid not null,
  channel text not null,
  kind text not null check (kind in ('created', 'edited', 'joined', 'left', 'removed', 'leader', 'disbanded')),
  actor uuid,
  target uuid,
  detail jsonb,
  at timestamptz not null default now()
);
create index alliance_events_alliance on private.alliance_events (alliance, at);

alter table public.alliances enable row level security;
alter table public.alliance_members enable row level security;
alter table public.alliance_invites enable row level security;
revoke all on public.alliances, public.alliance_members, public.alliance_invites from anon, authenticated;

-- Alliance changes count towards a daily limit, like friend requests
alter table private.friend_meter add column alliance int not null default 0;

create or replace function private.friend_count_up(uid uuid, ch text, what text, lim int) returns boolean
  language plpgsql security definer set search_path = ''
as $$
declare n int;
begin
  insert into private.friend_meter (user_id, channel) values (uid, ch) on conflict do nothing;
  select case what when 'requests' then requests when 'codes' then codes else alliance end into n
    from private.friend_meter where user_id = uid and channel = ch and day = current_date for update;
  if n >= lim then return false; end if;
  update private.friend_meter
    set requests = requests + (what = 'requests')::int, codes = codes + (what = 'codes')::int, alliance = alliance + (what = 'alliance')::int
    where user_id = uid and channel = ch and day = current_date;
  return true;
end $$;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
/** Whether either player has blocked the other. */
create function private.blocked_between(x uuid, y uuid, ch text) returns boolean
  language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.blocks where channel = ch and ((blocker = x and blocked = y) or (blocker = y and blocked = x))) $$;

/** What others see of an alliance: enough for a badge. Null if there isn't one. */
create function private.alliance_card(p_alliance uuid) returns jsonb
  language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('id', id, 'name', name, 'tag', tag, 'colours', colours, 'logo', logo,
    'members', (select count(*) from public.alliance_members where alliance = a.id))
  from public.alliances a where id = p_alliance
$$;

create function private.alliance_log(p_alliance uuid, ch text, k text, p_actor uuid, p_target uuid, p_detail jsonb default null) returns void
  language sql security definer set search_path = ''
as $$ insert into private.alliance_events (alliance, channel, kind, actor, target, detail) values (p_alliance, ch, k, p_actor, p_target, p_detail) $$;

/** After a member goes: an empty alliance goes too, and one without a leader gets the longest-standing member. */
create function private.alliance_member_gone() returns trigger
  language plpgsql security definer set search_path = ''
as $$
declare al public.alliances; next uuid;
begin
  select * into al from public.alliances where id = old.alliance;
  if al.id is null then return null; end if; -- the alliance itself is being removed
  if not exists (select 1 from public.alliance_members where alliance = al.id) then
    delete from public.alliances where id = al.id;
    perform private.alliance_log(al.id, al.channel, 'disbanded', null, null, jsonb_build_object('name', al.name, 'why', 'empty'));
    return null;
  end if;
  if not exists (select 1 from public.alliance_members where alliance = al.id and role = 'leader') then
    select airline into next from public.alliance_members where alliance = al.id order by joined_at, airline limit 1;
    update public.alliance_members set role = 'leader' where airline = next;
    perform private.alliance_log(al.id, al.channel, 'leader', null, next);
  end if;
  return null;
end $$;
create trigger alliance_member_gone after delete on public.alliance_members for each row execute function private.alliance_member_gone();

/** An airline that changes between Career and Sandbox leaves its alliance, as it leaves its friends. */
create function private.alliance_mode_changed() returns trigger
  language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.alliance_members where airline = new.public_id;
  delete from public.alliance_invites where airline = new.public_id;
  return null;
end $$;
create trigger alliance_mode_changed after update of mode on public.profiles for each row when (old.mode is distinct from new.mode) execute function private.alliance_mode_changed();

/** Checks an alliance's name, tag, colours and description. 'ok' or what's wrong. */
create function private.alliance_check(p_name text, p_tag text, p_colours jsonb, p_description text) returns text
  language plpgsql stable security definer set search_path = ''
as $$
begin
  if p_name is null or char_length(btrim(p_name)) not between 3 and 40 or btrim(p_name) !~ '^[[:alnum:] &''.-]+$' or private.moderate_bad(p_name) then return 'bad_name'; end if;
  if p_tag is null or p_tag !~ '^[A-Z0-9]{2,4}$' or private.moderate_bad(p_tag) then return 'bad_tag'; end if;
  if jsonb_typeof(p_colours) <> 'object' or not private.is_hex(p_colours->'a') or not private.is_hex(p_colours->'b') or p_colours - 'a' - 'b' <> '{}'::jsonb then return 'bad_colours'; end if;
  if char_length(coalesce(p_description, '')) > 300 or private.moderate_bad(p_description) then return 'bad_text'; end if;
  return 'ok';
end $$;

/** The leader airline's logo, if it has an approved-or-waiting one to use. */
create function private.airline_logo(p public.profiles) returns text
  language sql stable set search_path = ''
as $$ select case when (p.liveries->0->>'badge') ~ '^[0-9a-f]{64}$' then p.liveries->0->>'badge' end $$;

revoke all on function private.blocked_between(uuid, uuid, text) from public, anon, authenticated;
revoke all on function private.alliance_card(uuid) from public, anon, authenticated;
revoke all on function private.alliance_log(uuid, text, text, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function private.alliance_member_gone() from public, anon, authenticated;
revoke all on function private.alliance_mode_changed() from public, anon, authenticated;
revoke all on function private.alliance_check(text, text, jsonb, text) from public, anon, authenticated;
revoke all on function private.airline_logo(public.profiles) from public, anon, authenticated;

-- A friend's card now says which alliance they're in
create or replace function private.friend_card(p_air uuid, ch text) returns jsonb
  language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('airline', airline, 'code', code, 'callsign', callsign, 'colours', colours, 'stats', stats, 'badge', liveries->0->>'badge', 'updatedAt', updated_at,
    'alliance', (select private.alliance_card(m.alliance) from public.alliance_members m where m.airline = p_air))
  from public.profiles where public_id = p_air and channel = ch and private.feature_on(ch, 'profiles')
$$;

-- ---------------------------------------------------------------------------
-- The Alliances screen
-- ---------------------------------------------------------------------------
/**
 * This airline's alliance (with its members, and the invites waiting if it leads), and the invites
 * made to it. Null while the feature is off or if the airline isn't the player's. Members either
 * player has blocked are left out of the list.
 */
create function public.alliance_mine(p_channel text, p_me uuid)
  returns jsonb language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.cloud_gate(); ch text := private.cloud_ch(p_channel); me public.profiles := private.my_airline(uid, ch, p_me);
  m public.alliance_members; al public.alliances;
begin
  if not private.feature_on(ch, 'alliances') or me.public_id is null then return null; end if;
  select * into m from public.alliance_members where airline = p_me;
  if m.alliance is not null then select * into al from public.alliances where id = m.alliance; end if;
  return jsonb_build_object(
    'mode', me.mode,
    'alliance', case when al.id is null then null else jsonb_build_object(
      'id', al.id, 'name', al.name, 'tag', al.tag, 'colours', al.colours, 'description', al.description, 'logo', al.logo,
      'createdAt', al.created_at, 'role', m.role, 'max', 20,
      'members', coalesce((
        select jsonb_agg(jsonb_build_object('id', x.airline, 'role', x.role, 'joinedAt', x.joined_at, 'me', x.airline = p_me, 'card', private.friend_card(x.airline, ch)) order by x.role <> 'leader', x.joined_at)
        from public.alliance_members x join public.profiles p on p.public_id = x.airline
        where x.alliance = al.id and (x.airline = p_me or not private.blocked_between(uid, p.user_id, ch))), '[]'::jsonb),
      'count', (select count(*) from public.alliance_members where alliance = al.id),
      'invited', case when m.role = 'leader' then coalesce((
        select jsonb_agg(jsonb_build_object('id', i.airline, 'at', i.created_at, 'card', private.friend_card(i.airline, ch)) order by i.created_at desc)
        from public.alliance_invites i where i.alliance = al.id), '[]'::jsonb) else '[]'::jsonb end
    ) end,
    'invites', coalesce((
      select jsonb_agg(jsonb_build_object('alliance', private.alliance_card(i.alliance), 'from', private.friend_card(l.airline, ch), 'at', i.created_at) order by i.created_at desc)
      from public.alliance_invites i
      join public.alliance_members l on l.alliance = i.alliance and l.role = 'leader'
      join public.profiles lp on lp.public_id = l.airline
      where i.airline = p_me and not private.blocked_between(uid, lp.user_id, ch)), '[]'::jsonb)
  );
end $$;

/**
 * Starts an alliance led by this airline. Answers: created, off, share_first, already_in, bad_name,
 * bad_tag, bad_colours, bad_text, name_taken, tag_taken, too_many_today.
 */
create function public.alliance_create(p_channel text, p_me uuid, p_name text, p_tag text, p_colours jsonb, p_description text, p_use_logo boolean)
  returns text language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.cloud_gate(); ch text := private.cloud_ch(p_channel); me public.profiles := private.my_airline(uid, ch, p_me); r text; aid uuid;
begin
  if not private.feature_on(ch, 'alliances') then return 'off'; end if;
  if me.public_id is null then return 'share_first'; end if;
  r := private.alliance_check(p_name, p_tag, p_colours, p_description);
  if r <> 'ok' then return r; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_me::text, 79));
  if exists (select 1 from public.alliance_members where airline = p_me) then return 'already_in'; end if;
  if exists (select 1 from public.alliances where channel = ch and lower(name) = lower(btrim(p_name))) then return 'name_taken'; end if;
  if exists (select 1 from public.alliances where channel = ch and tag = p_tag) then return 'tag_taken'; end if;
  if not private.friend_count_up(uid, ch, 'alliance', 30) then return 'too_many_today'; end if;
  begin
    insert into public.alliances (channel, mode, name, tag, colours, description, logo)
    values (ch, me.mode, btrim(p_name), p_tag, p_colours, btrim(coalesce(p_description, '')), case when p_use_logo then private.airline_logo(me) end)
    returning id into aid;
  exception when unique_violation then
    return 'name_taken'; -- someone took it at the same moment
  end;
  insert into public.alliance_members (airline, alliance, role) values (p_me, aid, 'leader');
  -- Invites to other alliances are no use now
  delete from public.alliance_invites where airline = p_me;
  perform private.alliance_log(aid, ch, 'created', p_me, null, jsonb_build_object('name', btrim(p_name), 'tag', p_tag));
  return 'created';
end $$;

/** Changes the alliance's name, tag, colours, description or logo. Leader only. Answers as alliance_create, plus saved, not_leader. */
create function public.alliance_edit(p_channel text, p_me uuid, p_name text, p_tag text, p_colours jsonb, p_description text, p_use_logo boolean)
  returns text language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.cloud_gate(); ch text := private.cloud_ch(p_channel); me public.profiles := private.my_airline(uid, ch, p_me); r text; al public.alliances;
begin
  if not private.feature_on(ch, 'alliances') then return 'off'; end if;
  if me.public_id is null then return 'share_first'; end if;
  select a.* into al from public.alliances a join public.alliance_members m on m.alliance = a.id where m.airline = p_me and m.role = 'leader';
  if al.id is null then return 'not_leader'; end if;
  r := private.alliance_check(p_name, p_tag, p_colours, p_description);
  if r <> 'ok' then return r; end if;
  if exists (select 1 from public.alliances where channel = ch and lower(name) = lower(btrim(p_name)) and id <> al.id) then return 'name_taken'; end if;
  if exists (select 1 from public.alliances where channel = ch and tag = p_tag and id <> al.id) then return 'tag_taken'; end if;
  if not private.friend_count_up(uid, ch, 'alliance', 30) then return 'too_many_today'; end if;
  begin
    update public.alliances set name = btrim(p_name), tag = p_tag, colours = p_colours, description = btrim(coalesce(p_description, '')),
      logo = case when p_use_logo then coalesce(private.airline_logo(me), logo) end, updated_at = now()
    where id = al.id;
  exception when unique_violation then
    return 'name_taken';
  end;
  if al.name <> btrim(p_name) or al.tag <> p_tag or al.description <> btrim(coalesce(p_description, '')) then
    perform private.alliance_log(al.id, ch, 'edited', p_me, null, jsonb_build_object('from', jsonb_build_object('name', al.name, 'tag', al.tag, 'description', al.description), 'to', jsonb_build_object('name', btrim(p_name), 'tag', p_tag, 'description', btrim(coalesce(p_description, '')))));
  end if;
  return 'saved';
end $$;

/**
 * Invites one of this airline's friends. Leader only. Answers: sent, off, not_leader, not_friend,
 * other_mode, in_alliance, already, full, too_many_today.
 */
create function public.alliance_invite(p_channel text, p_me uuid, p_id uuid)
  returns text language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.cloud_gate(); ch text := private.cloud_ch(p_channel); me public.profiles := private.my_airline(uid, ch, p_me);
  them public.profiles := private.airline_of(ch, p_id); al public.alliances;
begin
  if not private.feature_on(ch, 'alliances') then return 'off'; end if;
  select a.* into al from public.alliances a join public.alliance_members m on m.alliance = a.id where m.airline = p_me and m.role = 'leader';
  if me.public_id is null or al.id is null then return 'not_leader'; end if;
  if them.public_id is null or not exists (select 1 from public.friendships where channel = ch and a = least(p_me, p_id) and b = greatest(p_me, p_id) and status = 'accepted') then return 'not_friend'; end if;
  if private.blocked_between(uid, them.user_id, ch) then return 'not_friend'; end if;
  if them.mode <> al.mode then return 'other_mode'; end if;
  perform pg_advisory_xact_lock(hashtextextended(al.id::text, 80));
  if exists (select 1 from public.alliance_members where airline = p_id) then return 'in_alliance'; end if;
  if exists (select 1 from public.alliance_invites where alliance = al.id and airline = p_id) then return 'already'; end if;
  if (select count(*) from public.alliance_members where alliance = al.id) + (select count(*) from public.alliance_invites where alliance = al.id) >= 20 then return 'full'; end if;
  if not private.friend_count_up(uid, ch, 'alliance', 30) then return 'too_many_today'; end if;
  insert into public.alliance_invites (alliance, airline) values (al.id, p_id);
  return 'sent';
end $$;

/** Takes back an invite. Leader only. */
create function public.alliance_invite_cancel(p_channel text, p_me uuid, p_id uuid)
  returns void language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.cloud_gate(); ch text := private.cloud_ch(p_channel); me public.profiles := private.my_airline(uid, ch, p_me);
begin
  if me.public_id is null then return; end if;
  delete from public.alliance_invites i using public.alliance_members m
  where m.airline = p_me and m.role = 'leader' and i.alliance = m.alliance and i.airline = p_id;
end $$;

/** Accepts or declines an invite made to this airline. Answers: joined, declined, gone, full, in_alliance, other_mode, off. */
create function public.alliance_respond(p_channel text, p_me uuid, p_alliance uuid, p_accept boolean)
  returns text language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.cloud_gate(); ch text := private.cloud_ch(p_channel); me public.profiles := private.my_airline(uid, ch, p_me); al public.alliances; leader_user uuid;
begin
  if me.public_id is null then return 'gone'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_alliance::text, 80));
  if not exists (select 1 from public.alliance_invites where alliance = p_alliance and airline = p_me) then return 'gone'; end if;
  if not p_accept then
    delete from public.alliance_invites where alliance = p_alliance and airline = p_me;
    return 'declined';
  end if;
  if not private.feature_on(ch, 'alliances') then return 'off'; end if;
  select * into al from public.alliances where id = p_alliance;
  select p.user_id into leader_user from public.alliance_members m join public.profiles p on p.public_id = m.airline where m.alliance = p_alliance and m.role = 'leader';
  if al.id is null or private.blocked_between(uid, leader_user, ch) then
    delete from public.alliance_invites where alliance = p_alliance and airline = p_me;
    return 'gone';
  end if;
  if al.mode <> me.mode then return 'other_mode'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_me::text, 79));
  if exists (select 1 from public.alliance_members where airline = p_me) then return 'in_alliance'; end if;
  if (select count(*) from public.alliance_members where alliance = p_alliance) >= 20 then return 'full'; end if;
  insert into public.alliance_members (airline, alliance, role) values (p_me, p_alliance, 'member');
  delete from public.alliance_invites where airline = p_me;
  perform private.alliance_log(p_alliance, ch, 'joined', p_me, null);
  return 'joined';
end $$;

/** Leaves the alliance. A leader's lead passes to the longest-standing member; the last one out closes it. Works even with the feature off. */
create function public.alliance_leave(p_channel text, p_me uuid)
  returns void language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.cloud_gate(); ch text := private.cloud_ch(p_channel); me public.profiles := private.my_airline(uid, ch, p_me); m public.alliance_members;
begin
  if me.public_id is null then return; end if;
  select * into m from public.alliance_members where airline = p_me;
  if m.alliance is null then return; end if;
  perform pg_advisory_xact_lock(hashtextextended(m.alliance::text, 80));
  perform private.alliance_log(m.alliance, ch, 'left', p_me, null);
  delete from public.alliance_members where airline = p_me;
end $$;

/** Removes a member. Leader only. */
create function public.alliance_kick(p_channel text, p_me uuid, p_id uuid)
  returns boolean language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.cloud_gate(); ch text := private.cloud_ch(p_channel); me public.profiles := private.my_airline(uid, ch, p_me); al uuid;
begin
  if me.public_id is null or p_id is null or p_id = p_me then return false; end if;
  select alliance into al from public.alliance_members where airline = p_me and role = 'leader';
  if al is null then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended(al::text, 80));
  delete from public.alliance_members where airline = p_id and alliance = al;
  if not found then return false; end if;
  perform private.alliance_log(al, ch, 'removed', p_me, p_id);
  return true;
end $$;

/** Hands the lead to another member. Leader only. */
create function public.alliance_lead(p_channel text, p_me uuid, p_id uuid)
  returns boolean language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.cloud_gate(); ch text := private.cloud_ch(p_channel); me public.profiles := private.my_airline(uid, ch, p_me); al uuid;
begin
  if me.public_id is null or p_id is null or p_id = p_me then return false; end if;
  select alliance into al from public.alliance_members where airline = p_me and role = 'leader';
  if al is null then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended(al::text, 80));
  if not exists (select 1 from public.alliance_members where airline = p_id and alliance = al) then return false; end if;
  update public.alliance_members set role = 'member' where airline = p_me;
  update public.alliance_members set role = 'leader' where airline = p_id;
  perform private.alliance_log(al, ch, 'leader', p_me, p_id);
  return true;
end $$;

/** Closes the alliance: every member leaves and the invites go. Leader only. */
create function public.alliance_disband(p_channel text, p_me uuid)
  returns boolean language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.cloud_gate(); ch text := private.cloud_ch(p_channel); me public.profiles := private.my_airline(uid, ch, p_me); al public.alliances;
begin
  if me.public_id is null then return false; end if;
  select a.* into al from public.alliances a join public.alliance_members m on m.alliance = a.id where m.airline = p_me and m.role = 'leader';
  if al.id is null then return false; end if;
  perform private.alliance_log(al.id, ch, 'disbanded', p_me, null, jsonb_build_object('name', al.name));
  delete from public.alliances where id = al.id;
  return true;
end $$;

-- ---------------------------------------------------------------------------
-- Alliance members on the map, and their liveries
-- ---------------------------------------------------------------------------
/**
 * Whose aircraft this airline's map can show: friends (up to 20, by this airline's own toggle) and
 * members of its alliance (up to 19) who show their flights. Each says whether they're in the
 * alliance, and which alliance they're in.
 */
create or replace function public.friends_on_map(p_channel text, p_me uuid)
  returns jsonb language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.cloud_gate(); ch text := private.cloud_ch(p_channel); me public.profiles := private.my_airline(uid, ch, p_me); mine uuid;
begin
  if me.public_id is null or not private.feature_on(ch, 'friends') or not private.feature_on(ch, 'friends_map') or not private.feature_on(ch, 'profiles') then return '[]'::jsonb; end if;
  if private.feature_on(ch, 'alliances') then select alliance into mine from public.alliance_members where airline = p_me; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', x.public_id, 'airline', x.airline, 'code', x.code, 'callsign', x.callsign, 'colours', x.colours, 'updatedAt', x.updated_at,
      'ally', x.ally, 'alliance', (select private.alliance_card(m.alliance) from public.alliance_members m where m.airline = x.public_id)))
    from (
      (select s.public_id, s.airline, s.code, s.callsign, s.colours, s.updated_at, coalesce(mm.alliance = mine, false) as ally
       from public.friendships f
       join public.profiles s on s.channel = ch and s.public_id = case when f.a = p_me then f.b else f.a end and s.map_on
       left join public.alliance_members mm on mm.airline = s.public_id
       where f.channel = ch and f.status = 'accepted' and (f.a = p_me or f.b = p_me)
         and case when f.a = p_me then f.a_map else f.b_map end
       order by s.updated_at desc
       limit 20)
      union all
      (select s.public_id, s.airline, s.code, s.callsign, s.colours, s.updated_at, true
       from public.alliance_members mm
       join public.profiles s on s.public_id = mm.airline and s.channel = ch and s.map_on
       where mine is not null and mm.alliance = mine and mm.airline <> p_me
         and not private.blocked_between(uid, s.user_id, ch)
         -- Friends are in the list above, or this airline chose not to see them
         and not exists (select 1 from public.friendships f where f.channel = ch and f.status = 'accepted' and f.a = least(p_me, s.public_id) and f.b = greatest(p_me, s.public_id))
       order by s.updated_at desc
       limit 19)
    ) x
  ), '[]'::jsonb);
end $$;

/** A friend's or alliance member's liveries, to paint their aircraft. Null otherwise. */
create or replace function public.friend_liveries(p_channel text, p_me uuid, p_id uuid)
  returns jsonb language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.cloud_gate(); ch text := private.cloud_ch(p_channel); me public.profiles := private.my_airline(uid, ch, p_me); them public.profiles := private.airline_of(ch, p_id);
begin
  if me.public_id is null or them.public_id is null or not private.feature_on(ch, 'friends') or not private.feature_on(ch, 'profiles') then return null; end if;
  if not exists (select 1 from public.friendships where channel = ch and a = least(p_me, p_id) and b = greatest(p_me, p_id) and status = 'accepted')
     and not (private.feature_on(ch, 'alliances') and not private.blocked_between(uid, them.user_id, ch)
              and exists (select 1 from public.alliance_members x join public.alliance_members y on y.alliance = x.alliance where x.airline = p_me and y.airline = p_id)) then
    return null;
  end if;
  return jsonb_build_object('liveries', them.liveries, 'updatedAt', them.updated_at);
end $$;

-- ---------------------------------------------------------------------------
-- Nightly: old invites, and alliance history after 12 months
-- ---------------------------------------------------------------------------
create function private.alliances_cleanup() returns void
  language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.alliance_invites where created_at < now() - interval '30 days';
  delete from private.alliance_events where at < now() - interval '12 months';
end $$;
revoke all on function private.alliances_cleanup() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('bp-alliances-cleanup', '41 4 * * *', 'select private.alliances_cleanup()');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------
revoke all on function public.alliance_mine(text, uuid) from public, anon;
revoke all on function public.alliance_create(text, uuid, text, text, jsonb, text, boolean) from public, anon;
revoke all on function public.alliance_edit(text, uuid, text, text, jsonb, text, boolean) from public, anon;
revoke all on function public.alliance_invite(text, uuid, uuid) from public, anon;
revoke all on function public.alliance_invite_cancel(text, uuid, uuid) from public, anon;
revoke all on function public.alliance_respond(text, uuid, uuid, boolean) from public, anon;
revoke all on function public.alliance_leave(text, uuid) from public, anon;
revoke all on function public.alliance_kick(text, uuid, uuid) from public, anon;
revoke all on function public.alliance_lead(text, uuid, uuid) from public, anon;
revoke all on function public.alliance_disband(text, uuid) from public, anon;
grant execute on function public.alliance_mine(text, uuid) to authenticated;
grant execute on function public.alliance_create(text, uuid, text, text, jsonb, text, boolean) to authenticated;
grant execute on function public.alliance_edit(text, uuid, text, text, jsonb, text, boolean) to authenticated;
grant execute on function public.alliance_invite(text, uuid, uuid) to authenticated;
grant execute on function public.alliance_invite_cancel(text, uuid, uuid) to authenticated;
grant execute on function public.alliance_respond(text, uuid, uuid, boolean) to authenticated;
grant execute on function public.alliance_leave(text, uuid) to authenticated;
grant execute on function public.alliance_kick(text, uuid, uuid) to authenticated;
grant execute on function public.alliance_lead(text, uuid, uuid) to authenticated;
grant execute on function public.alliance_disband(text, uuid) to authenticated;
