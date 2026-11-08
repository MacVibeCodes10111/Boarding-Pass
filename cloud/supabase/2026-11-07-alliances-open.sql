-- ============================================================================
-- FINDING ALLIANCES (Update A, after A6). Needs 2026-11-07-alliances.sql and
-- 2026-11-07-admin.sql first.
--
--   Every airline can now find alliances of its own mode (Career or Sandbox):
--   by searching, and through three featured alliances picked at random each
--   week (Monday to Sunday, UTC) and kept for the week. What anyone sees of an
--   alliance: its name, tag, colours, logo, description, size, when it began,
--   whether it's open, its airlines (name, code, colours, logo, summary) and
--   their totals. Never more than a friend would see.
--
--   The leader chooses how airlines get in: "open" (join at once) or
--   "request" (the leader accepts or declines; no message goes with it).
--   Invites from the leader still work as before. Blocks hide alliances whose
--   leader either player has blocked, and requests from blocked airlines.
-- ============================================================================

alter table public.alliances add column joining text not null default 'request' check (joining in ('open', 'request'));

/** An airline asking to join. One per alliance; up to 5 at once per airline. Gone after 30 days. */
create table public.alliance_requests (
  alliance uuid not null references public.alliances(id) on delete cascade,
  airline uuid not null references public.profiles(public_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (alliance, airline)
);
create index alliance_requests_airline on public.alliance_requests (airline);
alter table public.alliance_requests enable row level security;
revoke all on public.alliance_requests from anon, authenticated;

/** The week's featured alliances, per channel and mode. Kept 8 weeks. */
create table private.alliance_featured (
  channel text not null,
  mode text not null,
  week text not null,
  alliance uuid not null,
  picked_at timestamptz not null default now(),
  primary key (channel, mode, week, alliance)
);
alter table private.alliance_featured enable row level security;
revoke all on private.alliance_featured from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
/** A number from an airline's summary, or 0. */
create function private.stat_of(s jsonb, k text) returns numeric
  language sql immutable set search_path = ''
as $$ select case when jsonb_typeof(s->k) = 'number' then greatest(0, (s->>k)::numeric) else 0 end $$;

/** Whether the viewer and the alliance's leader have blocked each other. */
create function private.leader_blocked(p_alliance uuid, viewer uuid, ch text) returns boolean
  language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.alliance_members m join public.profiles p on p.public_id = m.airline
    where m.alliance = p_alliance and m.role = 'leader' and private.blocked_between(viewer, p.user_id, ch))
$$;

/**
 * What every airline of the same mode sees of an alliance. `full` adds its airlines (leaving out
 * any the viewer has blocked, or who blocked them).
 */
create function private.alliance_public(p_alliance uuid, viewer uuid, ch text, p_full boolean) returns jsonb
  language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('id', a.id, 'name', a.name, 'tag', a.tag, 'colours', a.colours, 'logo', a.logo, 'description', a.description,
    'createdAt', a.created_at, 'joining', a.joining, 'members', t.n,
    'totals', jsonb_build_object('fleet', t.fleet, 'routes', t.routes, 'airports', t.airports, 'hubs', t.hubs),
    'airlines', case when p_full then coalesce((
      select jsonb_agg(jsonb_build_object('id', m.airline, 'role', m.role, 'joinedAt', m.joined_at,
        'card', jsonb_build_object('airline', p.airline, 'code', p.code, 'callsign', p.callsign, 'colours', p.colours, 'stats', p.stats, 'badge', p.liveries->0->>'badge', 'updatedAt', p.updated_at))
        order by m.role <> 'leader', m.joined_at)
      from public.alliance_members m join public.profiles p on p.public_id = m.airline
      where m.alliance = a.id and (p.user_id = viewer or not private.blocked_between(viewer, p.user_id, ch))), '[]'::jsonb) end)
  from public.alliances a,
  lateral (select count(*) as n, sum(private.stat_of(p.stats, 'fleet')) as fleet, sum(private.stat_of(p.stats, 'routes')) as routes,
      sum(private.stat_of(p.stats, 'airports')) as airports, sum(private.stat_of(p.stats, 'hubs')) as hubs
    from public.alliance_members m join public.profiles p on p.public_id = m.airline where m.alliance = a.id) t
  where a.id = p_alliance
$$;

/** Adds an airline to an alliance (the caller has checked it may). Its other requests and invites go. */
create function private.alliance_add(p_alliance uuid, ch text, p_airline uuid, via text) returns void
  language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.alliance_members (airline, alliance, role) values (p_airline, p_alliance, 'member');
  delete from public.alliance_invites where airline = p_airline;
  delete from public.alliance_requests where airline = p_airline;
  perform private.alliance_log(p_alliance, ch, 'joined', p_airline, null, jsonb_build_object('via', via));
end $$;

/** An airline that joins any alliance, however, takes back its requests to others. */
create function private.alliance_member_added() returns trigger
  language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.alliance_requests where airline = new.airline;
  return null;
end $$;
create trigger alliance_member_added after insert on public.alliance_members for each row execute function private.alliance_member_added();

-- An airline that changes mode loses its requests too
create or replace function private.alliance_mode_changed() returns trigger
  language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.alliance_members where airline = new.public_id;
  delete from public.alliance_invites where airline = new.public_id;
  delete from public.alliance_requests where airline = new.public_id;
  return null;
end $$;

revoke all on function private.stat_of(jsonb, text), private.leader_blocked(uuid, uuid, text), private.alliance_public(uuid, uuid, text, boolean),
  private.alliance_add(uuid, text, uuid, text), private.alliance_member_added() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The Alliances screen, now with joining and requests
-- ---------------------------------------------------------------------------
create or replace function public.alliance_mine(p_channel text, p_me uuid)
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
      'createdAt', al.created_at, 'role', m.role, 'max', 20, 'joining', al.joining,
      'members', coalesce((
        select jsonb_agg(jsonb_build_object('id', x.airline, 'role', x.role, 'joinedAt', x.joined_at, 'me', x.airline = p_me, 'card', private.friend_card(x.airline, ch)) order by x.role <> 'leader', x.joined_at)
        from public.alliance_members x join public.profiles p on p.public_id = x.airline
        where x.alliance = al.id and (x.airline = p_me or not private.blocked_between(uid, p.user_id, ch))), '[]'::jsonb),
      'count', (select count(*) from public.alliance_members where alliance = al.id),
      'invited', case when m.role = 'leader' then coalesce((
        select jsonb_agg(jsonb_build_object('id', i.airline, 'at', i.created_at, 'card', private.friend_card(i.airline, ch)) order by i.created_at desc)
        from public.alliance_invites i where i.alliance = al.id), '[]'::jsonb) else '[]'::jsonb end,
      'requests', case when m.role = 'leader' then coalesce((
        select jsonb_agg(jsonb_build_object('id', r.airline, 'at', r.created_at, 'card', private.friend_card(r.airline, ch)) order by r.created_at)
        from public.alliance_requests r join public.profiles p on p.public_id = r.airline
        where r.alliance = al.id and not private.blocked_between(uid, p.user_id, ch)), '[]'::jsonb) else '[]'::jsonb end
    ) end,
    'invites', coalesce((
      select jsonb_agg(jsonb_build_object('alliance', private.alliance_card(i.alliance), 'from', private.friend_card(l.airline, ch), 'at', i.created_at) order by i.created_at desc)
      from public.alliance_invites i
      join public.alliance_members l on l.alliance = i.alliance and l.role = 'leader'
      join public.profiles lp on lp.public_id = l.airline
      where i.airline = p_me and not private.blocked_between(uid, lp.user_id, ch)), '[]'::jsonb),
    'asked', coalesce((
      select jsonb_agg(jsonb_build_object('alliance', private.alliance_card(r.alliance), 'at', r.created_at) order by r.created_at desc)
      from public.alliance_requests r where r.airline = p_me), '[]'::jsonb)
  );
end $$;

/** Open, or by request. Leader only. Answers: saved, off, not_leader, bad. */
create function public.alliance_set_joining(p_channel text, p_me uuid, p_joining text)
  returns text language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.cloud_gate(); ch text := private.cloud_ch(p_channel); me public.profiles := private.my_airline(uid, ch, p_me); al uuid;
begin
  if not private.feature_on(ch, 'alliances') then return 'off'; end if;
  if p_joining is null or p_joining not in ('open', 'request') then return 'bad'; end if;
  select alliance into al from public.alliance_members where airline = p_me and role = 'leader';
  if me.public_id is null or al is null then return 'not_leader'; end if;
  update public.alliances set joining = p_joining, updated_at = now() where id = al and joining <> p_joining;
  return 'saved';
end $$;

/**
 * Alliances of this airline's mode whose name has `p_q` in it, or whose tag is `p_q`; with no words,
 * the biggest. Up to 20. Leaves out alliances whose leader either player has blocked.
 */
create function public.alliance_search(p_channel text, p_me uuid, p_q text)
  returns jsonb language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.cloud_gate(); ch text := private.cloud_ch(p_channel); me public.profiles := private.my_airline(uid, ch, p_me);
  q text := btrim(coalesce(p_q, ''));
begin
  if not private.feature_on(ch, 'alliances') or me.public_id is null then return null; end if;
  if char_length(q) > 40 then q := left(q, 40); end if;
  q := replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_');
  return coalesce((
    select jsonb_agg(private.alliance_public(x.id, uid, ch, false) order by x.n desc, x.name)
    from (
      select a.id, a.name, (select count(*) from public.alliance_members m where m.alliance = a.id) as n
      from public.alliances a
      where a.channel = ch and a.mode = me.mode
        and (q = '' or a.name ilike '%' || q || '%' or a.tag = upper(q))
        and not private.leader_blocked(a.id, uid, ch)
      order by n desc, a.name
      limit 20
    ) x), '[]'::jsonb);
end $$;

/**
 * The week's three featured alliances for this airline's mode (fewer if there aren't three).
 * Picked at random the first time anyone asks in a week, then kept; one that closes is replaced.
 * Alliances a moderator has just reset aren't picked.
 */
create function public.alliance_featured(p_channel text, p_me uuid)
  returns jsonb language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.cloud_gate(); ch text := private.cloud_ch(p_channel); me public.profiles := private.my_airline(uid, ch, p_me);
  wk text := to_char(now() at time zone 'utc', 'IYYY-"W"IW'); n int;
begin
  if not private.feature_on(ch, 'alliances') or me.public_id is null then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended(ch || me.mode || wk, 81));
  delete from private.alliance_featured f where f.channel = ch and f.mode = me.mode and f.week = wk
    and not exists (select 1 from public.alliances a where a.id = f.alliance and a.mode = me.mode);
  select count(*) into n from private.alliance_featured where channel = ch and mode = me.mode and week = wk;
  if n < 3 then
    insert into private.alliance_featured (channel, mode, week, alliance)
    select ch, me.mode, wk, a.id from public.alliances a
    where a.channel = ch and a.mode = me.mode and (a.mod_until is null or a.mod_until < now())
      and not exists (select 1 from private.alliance_featured f where f.channel = ch and f.mode = me.mode and f.week = wk and f.alliance = a.id)
    order by random() limit 3 - n;
  end if;
  return jsonb_build_object('week', wk, 'until', date_trunc('week', now() at time zone 'utc') + interval '7 days',
    'alliances', coalesce((
      select jsonb_agg(private.alliance_public(f.alliance, uid, ch, false) order by f.picked_at, f.alliance)
      from private.alliance_featured f
      where f.channel = ch and f.mode = me.mode and f.week = wk and not private.leader_blocked(f.alliance, uid, ch)), '[]'::jsonb));
end $$;

/**
 * One alliance in full, as every airline of its mode sees it, and where this airline stands with it:
 * member, invited, asked, other (in another alliance), or none. Null if it can't be seen.
 */
create function public.alliance_view(p_channel text, p_me uuid, p_id uuid)
  returns jsonb language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.cloud_gate(); ch text := private.cloud_ch(p_channel); me public.profiles := private.my_airline(uid, ch, p_me);
  al public.alliances; mine uuid;
begin
  if not private.feature_on(ch, 'alliances') or me.public_id is null then return null; end if;
  select * into al from public.alliances where id = p_id and channel = ch and mode = me.mode;
  if al.id is null or private.leader_blocked(al.id, uid, ch) then return null; end if;
  select alliance into mine from public.alliance_members where airline = p_me;
  return private.alliance_public(al.id, uid, ch, true) || jsonb_build_object('standing',
    case when mine = al.id then 'member'
         when mine is not null then 'other'
         when exists (select 1 from public.alliance_invites where alliance = al.id and airline = p_me) then 'invited'
         when exists (select 1 from public.alliance_requests where alliance = al.id and airline = p_me) then 'asked'
         else 'none' end);
end $$;

/**
 * Joins an open alliance, or asks to join one that takes requests (an invite is taken up at once).
 * Answers: joined, requested, off, share_first, gone, already_in, already_asked, other_mode, full,
 * too_many_asks, too_many_today.
 */
create function public.alliance_join(p_channel text, p_me uuid, p_alliance uuid)
  returns text language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.cloud_gate(); ch text := private.cloud_ch(p_channel); me public.profiles := private.my_airline(uid, ch, p_me); al public.alliances; invited boolean;
begin
  if not private.feature_on(ch, 'alliances') then return 'off'; end if;
  if me.public_id is null then return 'share_first'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_alliance::text, 80));
  perform pg_advisory_xact_lock(hashtextextended(p_me::text, 79));
  select * into al from public.alliances where id = p_alliance and channel = ch;
  if al.id is null or private.leader_blocked(al.id, uid, ch) then return 'gone'; end if;
  if al.mode <> me.mode then return 'other_mode'; end if;
  if exists (select 1 from public.alliance_members where airline = p_me) then return 'already_in'; end if;
  if exists (select 1 from public.alliance_requests where alliance = al.id and airline = p_me) then return 'already_asked'; end if;
  invited := exists (select 1 from public.alliance_invites where alliance = al.id and airline = p_me);
  if not invited and (select count(*) from public.alliance_members where alliance = al.id) + (select count(*) from public.alliance_invites where alliance = al.id) >= 20 then return 'full'; end if;
  if invited and (select count(*) from public.alliance_members where alliance = al.id) >= 20 then return 'full'; end if;
  if not private.friend_count_up(uid, ch, 'alliance', 30) then return 'too_many_today'; end if;
  if invited or al.joining = 'open' then
    perform private.alliance_add(al.id, ch, p_me, case when invited then 'invite' else 'open' end);
    return 'joined';
  end if;
  if (select count(*) from public.alliance_requests where airline = p_me) >= 5 then return 'too_many_asks'; end if;
  insert into public.alliance_requests (alliance, airline) values (al.id, p_me);
  return 'requested';
end $$;

/** Takes back a request to join. */
create function public.alliance_request_cancel(p_channel text, p_me uuid, p_alliance uuid)
  returns void language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.cloud_gate(); ch text := private.cloud_ch(p_channel); me public.profiles := private.my_airline(uid, ch, p_me);
begin
  if me.public_id is null then return; end if;
  delete from public.alliance_requests where alliance = p_alliance and airline = p_me;
end $$;

/** Accepts or declines a request to join. Leader only. Answers: joined, declined, gone, full, in_alliance, other_mode, off, not_leader. */
create function public.alliance_request_answer(p_channel text, p_me uuid, p_id uuid, p_accept boolean)
  returns text language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.cloud_gate(); ch text := private.cloud_ch(p_channel); me public.profiles := private.my_airline(uid, ch, p_me);
  al public.alliances; them public.profiles := private.airline_of(ch, p_id);
begin
  if me.public_id is null then return 'not_leader'; end if;
  select a.* into al from public.alliances a join public.alliance_members m on m.alliance = a.id where m.airline = p_me and m.role = 'leader';
  if al.id is null then return 'not_leader'; end if;
  perform pg_advisory_xact_lock(hashtextextended(al.id::text, 80));
  if not exists (select 1 from public.alliance_requests where alliance = al.id and airline = p_id) then return 'gone'; end if;
  if not p_accept then
    delete from public.alliance_requests where alliance = al.id and airline = p_id;
    return 'declined';
  end if;
  if not private.feature_on(ch, 'alliances') then return 'off'; end if;
  if them.public_id is null or private.blocked_between(uid, them.user_id, ch) then
    delete from public.alliance_requests where alliance = al.id and airline = p_id;
    return 'gone';
  end if;
  if them.mode <> al.mode then return 'other_mode'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 79));
  if exists (select 1 from public.alliance_members where airline = p_id) then
    delete from public.alliance_requests where airline = p_id;
    return 'in_alliance';
  end if;
  if (select count(*) from public.alliance_members where alliance = al.id) + (select count(*) from public.alliance_invites where alliance = al.id) >= 20 then return 'full'; end if;
  perform private.alliance_add(al.id, ch, p_id, 'request');
  return 'joined';
end $$;

-- ---------------------------------------------------------------------------
-- Nightly: requests after 30 days, featured picks after 8 weeks
-- ---------------------------------------------------------------------------
create or replace function private.alliances_cleanup() returns void
  language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.alliance_invites where created_at < now() - interval '30 days';
  delete from public.alliance_requests where created_at < now() - interval '30 days';
  delete from private.alliance_featured where picked_at < now() - interval '8 weeks';
  delete from private.alliance_events where at < now() - interval '12 months';
end $$;

-- The admin site shows how an alliance takes airlines
create or replace function private.admin_alliance_card(al public.alliances) returns jsonb
  language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('id', al.id, 'channel', al.channel, 'mode', al.mode, 'name', al.name, 'tag', al.tag, 'colours', al.colours, 'logo', al.logo,
    'description', al.description, 'createdAt', al.created_at, 'lockedUntil', al.mod_until, 'joining', al.joining,
    'members', (select count(*) from public.alliance_members where alliance = al.id),
    'leader', (select p.airline from public.alliance_members m join public.profiles p on p.public_id = m.airline where m.alliance = al.id and m.role = 'leader'),
    'openReports', (select count(*) from private.reports r where r.target = al.id and r.status = 'open'))
$$;

-- ---------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------
revoke all on function public.alliance_set_joining(text, uuid, text), public.alliance_search(text, uuid, text), public.alliance_featured(text, uuid),
  public.alliance_view(text, uuid, uuid), public.alliance_join(text, uuid, uuid), public.alliance_request_cancel(text, uuid, uuid),
  public.alliance_request_answer(text, uuid, uuid, boolean) from public, anon;
grant execute on function public.alliance_set_joining(text, uuid, text), public.alliance_search(text, uuid, text), public.alliance_featured(text, uuid),
  public.alliance_view(text, uuid, uuid), public.alliance_join(text, uuid, uuid), public.alliance_request_cancel(text, uuid, uuid),
  public.alliance_request_answer(text, uuid, uuid, boolean) to authenticated;
