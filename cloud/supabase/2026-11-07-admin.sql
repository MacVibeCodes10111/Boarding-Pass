-- ============================================================================
-- REPORTS, MODERATION AND THE ADMIN PORTAL (Update A, phase A6)
--   Needs 2026-11-07-airlines.sql and 2026-11-07-alliances.sql first.
--
--   Players report an airline, an alliance or a logo (report_make), and get a
--   plain notice when a moderator changes something of theirs (notices_mine).
--
--   Admins: three locks, all needed. Cloudflare Access in front of the admin site;
--   a Boarding Pass account signed in with two-factor (aal2); and a row in
--   private.admins. Every admin_* function checks the last two itself, so
--   nothing in the game, and nobody past Access alone, can use them. The table
--   lives in `private`, which the API can't reach at all.
--
--   Every admin change needs a reason and is written to private.admin_log in the
--   same transaction (who, what, before, after, why). Changes are rate-limited.
--   Admins see only what players share, and reports. Never saves, emails or
--   sign-in details; only the owner can look an account up by username.
--
--   Add the first owner by hand, after they've turned on two-factor in the
--   admin site:
--     insert into private.admins (user_id, role) select id, 'owner' from auth.users where email = '<username>@players.boardingpass.my';
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table private.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'moderator')),
  added_by uuid,
  added_at timestamptz not null default now()
);

/** Kept 12 months, then deleted. Outlasts the accounts in it (no foreign keys). */
create table private.admin_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  admin uuid not null,
  admin_name text not null,
  action text not null,
  channel text,
  target_kind text,
  target_id text,
  before jsonb,
  after jsonb,
  reason text not null
);
create index admin_log_at on private.admin_log (at desc);
create index admin_log_target on private.admin_log (target_id, at desc);

create table private.admin_meter (
  user_id uuid not null,
  hour timestamptz not null,
  n int not null default 0,
  primary key (user_id, hour)
);

/** What a player is told when a moderator changed something of theirs. Never who did it. */
create table private.notices (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  channel text not null,
  airline uuid,
  text text not null,
  at timestamptz not null default now(),
  seen_at timestamptz
);
create index notices_user on private.notices (user_id, channel) where seen_at is null;

/** A player kept out of sharing until `until` (null: for good). Their games keep working. */
create table private.suspensions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  until timestamptz,
  label text not null default '',
  reason text not null,
  at timestamptz not null default now()
);

/** Kept 12 months. The reporter's account can go; the report stays. */
create table private.reports (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('main', 'dev')),
  reporter uuid references auth.users (id) on delete set null,
  reporter_airline uuid,
  reporter_label text not null default '',
  kind text not null check (kind in ('airline', 'alliance', 'logo')),
  target uuid not null,
  logo text check (logo ~ '^[0-9a-f]{64}$'),
  reason text not null check (reason in ('name', 'logo', 'impersonation', 'other')),
  note text not null default '' check (char_length(note) <= 300),
  snapshot jsonb not null,
  status text not null default 'open' check (status in ('open', 'dismissed', 'resolved')),
  created_at timestamptz not null default now(),
  handled_at timestamptz,
  handled_by uuid,
  handled_note text
);
create index reports_open on private.reports (channel, status, created_at desc);
create index reports_target on private.reports (target);
create index reports_reporter on private.reports (reporter, created_at);

-- A moderator's reset: these fields stay as set until mod_until, whatever the game sends
alter table public.profiles add column mod_until timestamptz, add column mod_fields jsonb, add column hidden_liveries text;
alter table public.alliances add column mod_until timestamptz;

alter table private.admins enable row level security;
alter table private.admin_log enable row level security;
alter table private.admin_meter enable row level security;
alter table private.notices enable row level security;
alter table private.suspensions enable row level security;
alter table private.reports enable row level security;
revoke all on private.admins, private.admin_log, private.admin_meter, private.notices, private.suspensions, private.reports from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
/** A player's username, or their sign-in name. Admins only ever see it through owner-only functions or the team list. */
create function private.username_of(uid uuid) returns text
  language sql stable security definer set search_path = ''
as $$
  select coalesce(nullif(raw_user_meta_data->>'username', ''), case when email like '%@players.boardingpass.my' then split_part(email, '@', 1) end, nullif(raw_user_meta_data->>'user_name', ''), nullif(raw_user_meta_data->>'name', ''), 'player')
  from auth.users where id = uid
$$;

create function private.suspended(uid uuid) returns boolean
  language sql stable security definer set search_path = ''
as $$ select exists (select 1 from private.suspensions where user_id = uid and (until is null or until > now())) $$;

create function private.notify(uid uuid, ch text, p_airline uuid, msg text) returns void
  language sql security definer set search_path = ''
as $$ insert into private.notices (user_id, channel, airline, text) select uid, ch, p_airline, msg where uid is not null $$;

/** Lock 2 and lock 3: signed in with two-factor, and in the admins table. Raises otherwise. */
create function private.admin_gate(need_owner boolean default false) returns private.admins
  language plpgsql stable security definer set search_path = ''
as $$
declare uid uuid := auth.uid(); a private.admins;
begin
  if uid is null then raise exception 'not_admin' using errcode = '42501'; end if;
  if coalesce(auth.jwt()->>'aal', '') <> 'aal2' then raise exception 'needs_2fa' using errcode = '42501'; end if;
  select * into a from private.admins where user_id = uid;
  if a.user_id is null then raise exception 'not_admin' using errcode = '42501'; end if;
  if need_owner and a.role <> 'owner' then raise exception 'owner_only' using errcode = '42501'; end if;
  return a;
end $$;

/** Writes the log entry for a change, in the same transaction, and counts it: 60 changes an hour per admin. */
create function private.admin_act(a private.admins, p_action text, ch text, p_kind text, p_target text, p_before jsonb, p_after jsonb, p_reason text) returns void
  language plpgsql security definer set search_path = ''
as $$
declare k int;
begin
  if p_reason is null or char_length(btrim(p_reason)) not between 3 and 300 then raise exception 'reason_needed' using errcode = '22023'; end if;
  insert into private.admin_meter (user_id, hour, n) values (a.user_id, date_trunc('hour', now()), 1)
  on conflict (user_id, hour) do update set n = private.admin_meter.n + 1 returning n into k;
  if k > 60 then raise exception 'too_many_changes' using errcode = 'P0429'; end if;
  insert into private.admin_log (admin, admin_name, action, channel, target_kind, target_id, before, after, reason)
  values (a.user_id, private.username_of(a.user_id), p_action, ch, p_kind, p_target, p_before, p_after, btrim(p_reason));
end $$;

/** What admins see of an airline in a list. */
create function private.admin_card(p public.profiles) returns jsonb
  language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('id', p.public_id, 'channel', p.channel, 'airline', p.airline, 'code', p.code, 'callsign', p.callsign, 'colours', p.colours,
    'badge', p.liveries->0->>'badge', 'mode', p.mode, 'sharedAt', p.shared_at, 'fleet', p.stats->'fleet',
    'alliance', (select jsonb_build_object('id', a.id, 'name', a.name, 'tag', a.tag) from public.alliance_members m join public.alliances a on a.id = m.alliance where m.airline = p.public_id),
    'openReports', (select count(*) from private.reports r where r.target = p.public_id and r.status = 'open'),
    'suspended', private.suspended(p.user_id))
$$;

create function private.admin_alliance_card(al public.alliances) returns jsonb
  language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('id', al.id, 'channel', al.channel, 'mode', al.mode, 'name', al.name, 'tag', al.tag, 'colours', al.colours, 'logo', al.logo,
    'description', al.description, 'createdAt', al.created_at, 'lockedUntil', al.mod_until,
    'members', (select count(*) from public.alliance_members where alliance = al.id),
    'leader', (select p.airline from public.alliance_members m join public.profiles p on p.public_id = m.airline where m.alliance = al.id and m.role = 'leader'),
    'openReports', (select count(*) from private.reports r where r.target = al.id and r.status = 'open'))
$$;

/** A safe stand-in name, the same each time for the same thing. */
create function private.safe_number(x uuid) returns text
  language sql immutable set search_path = ''
as $$ select lpad(((('x' || substr(md5(x::text), 1, 7))::bit(28)::int % 9000) + 1000)::text, 4, '0') $$;

revoke all on function private.username_of(uuid), private.suspended(uuid), private.notify(uuid, text, uuid, text), private.admin_gate(boolean),
  private.admin_act(private.admins, text, text, text, text, jsonb, jsonb, text), private.admin_card(public.profiles),
  private.admin_alliance_card(public.alliances), private.safe_number(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- What changes for players
-- ---------------------------------------------------------------------------
/**
 * As before, and: a suspended player can't share; a name a moderator reset stays until the lock ends;
 * hidden liveries stay hidden until the player changes them. Answers: saved, too_soon, too_many, off,
 * bad_name, bad_text, bad_livery, too_big, suspended.
 */
create or replace function public.profile_publish(p_channel text, p_save_id text, p_airline text, p_code text, p_callsign text, p_colours jsonb, p_liveries jsonb, p_stats jsonb, p_mode text)
  returns text language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.cloud_gate(); ch text := private.cloud_ch(p_channel); old public.profiles; r text; k text; locked boolean; same boolean;
begin
  if not private.feature_on(ch, 'profiles') then return 'off'; end if;
  if private.suspended(uid) then return 'suspended'; end if;
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

  perform pg_advisory_xact_lock(hashtextextended(uid::text, 78));
  select * into old from public.profiles where user_id = uid and channel = ch and save_id = p_save_id;
  if found then
    if old.updated_at > now() - interval '60 seconds' then return 'too_soon'; end if;
    if old.mode <> p_mode then
      delete from public.friendships where channel = ch and (a = old.public_id or b = old.public_id);
    end if;
    locked := old.mod_until is not null and old.mod_until > now();
    same := old.hidden_liveries is not null and old.hidden_liveries = md5(p_liveries::text);
    update public.profiles set
      airline = case when locked and old.mod_fields ? 'airline' then old.mod_fields->>'airline' else btrim(p_airline) end,
      code = case when locked and old.mod_fields ? 'code' then old.mod_fields->>'code' else p_code end,
      callsign = case when locked and old.mod_fields ? 'callsign' then old.mod_fields->>'callsign' else coalesce(p_callsign, '') end,
      colours = p_colours,
      liveries = case when same then old.liveries else p_liveries end,
      hidden_liveries = case when same then old.hidden_liveries end,
      mod_fields = case when locked then old.mod_fields end,
      mod_until = case when locked then old.mod_until end,
      stats = p_stats, mode = p_mode, updated_at = now()
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
      null;
    end;
  end loop;
  raise exception 'No friend code available';
end $$;

/** As before, and refused ('locked') while a moderator's reset holds. */
create or replace function public.alliance_edit(p_channel text, p_me uuid, p_name text, p_tag text, p_colours jsonb, p_description text, p_use_logo boolean)
  returns text language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.cloud_gate(); ch text := private.cloud_ch(p_channel); me public.profiles := private.my_airline(uid, ch, p_me); r text; al public.alliances;
begin
  if not private.feature_on(ch, 'alliances') then return 'off'; end if;
  if me.public_id is null then return 'share_first'; end if;
  select a.* into al from public.alliances a join public.alliance_members m on m.alliance = a.id where m.airline = p_me and m.role = 'leader';
  if al.id is null then return 'not_leader'; end if;
  if al.mod_until is not null and al.mod_until > now() then return 'locked'; end if;
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
 * Reports an airline, an alliance or a logo (on an airline or alliance, `p_target`). Only moderators
 * see it, with the reporter's airline. Answers: sent, already, too_many_today, off, share_first,
 * not_found, self, bad.
 */
create function public.report_make(p_channel text, p_me uuid, p_kind text, p_target uuid, p_logo text, p_reason text, p_note text)
  returns text language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.cloud_gate(); ch text := private.cloud_ch(p_channel); me public.profiles := private.my_airline(uid, ch, p_me); them public.profiles; al public.alliances; snap jsonb;
begin
  if not private.feature_on(ch, 'reports') then return 'off'; end if;
  if me.public_id is null then return 'share_first'; end if;
  if p_kind is null or p_kind not in ('airline', 'alliance', 'logo') or p_reason is null or p_reason not in ('name', 'logo', 'impersonation', 'other') or char_length(coalesce(p_note, '')) > 300 then return 'bad'; end if;
  if p_kind = 'logo' and coalesce(p_logo, '') !~ '^[0-9a-f]{64}$' then return 'bad'; end if;
  select * into them from public.profiles where channel = ch and public_id = p_target;
  if them.public_id is not null then
    if them.user_id = uid then return 'self'; end if;
    if p_kind = 'alliance' then return 'bad'; end if;
    snap := private.admin_card(them) || jsonb_build_object('liveries', them.liveries);
  else
    select * into al from public.alliances where channel = ch and id = p_target;
    if al.id is null or p_kind = 'airline' then return 'not_found'; end if;
    snap := private.admin_alliance_card(al);
  end if;
  if exists (select 1 from private.reports where reporter = uid and target = p_target and kind = p_kind and coalesce(logo, '') = coalesce(p_logo, '') and status = 'open') then return 'already'; end if;
  if (select count(*) from private.reports where reporter = uid and created_at > now() - interval '1 day') >= 10 then return 'too_many_today'; end if;
  insert into private.reports (channel, reporter, reporter_airline, reporter_label, kind, target, logo, reason, note, snapshot)
  values (ch, uid, p_me, me.airline, p_kind, p_target, case when p_kind = 'logo' then p_logo end, p_reason, btrim(coalesce(p_note, '')), snap);
  return 'sent';
end $$;

/** What moderators changed of this player's since they last looked. Shown once. */
create function public.notices_mine(p_channel text)
  returns jsonb language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.cloud_gate(); ch text := private.cloud_ch(p_channel); out jsonb;
begin
  with seen as (
    update private.notices set seen_at = now() where user_id = uid and channel = ch and seen_at is null returning id, text, at
  ) select coalesce(jsonb_agg(jsonb_build_object('text', text, 'at', at) order by id), '[]'::jsonb) into out from seen;
  return out;
end $$;

-- ---------------------------------------------------------------------------
-- Admin: reading
-- ---------------------------------------------------------------------------
create function public.admin_whoami()
  returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare a private.admins := private.admin_gate();
begin
  return jsonb_build_object('id', a.user_id, 'role', a.role, 'name', private.username_of(a.user_id), 'since', a.added_at);
end $$;

create function public.admin_dashboard(p_channel text)
  returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare a private.admins := private.admin_gate(); ch text := private.cloud_ch(p_channel);
begin
  return jsonb_build_object(
    'openReports', (select count(*) from private.reports where channel = ch and status = 'open'),
    'airlines', (select count(*) from public.profiles where channel = ch),
    'airlinesToday', (select count(*) from public.profiles where channel = ch and shared_at > date_trunc('day', now())),
    'players', (select count(distinct user_id) from public.profiles where channel = ch),
    'alliances', (select count(*) from public.alliances where channel = ch),
    'alliancesToday', (select count(*) from public.alliances where channel = ch and created_at > date_trunc('day', now())),
    'removalsWeek', (select count(*) from private.admin_log where (channel = ch or channel is null) and at > now() - interval '7 days' and action <> 'logo_approve' and action not like 'report_%' and action not like 'team_%'),
    'suspended', (select count(*) from private.suspensions where until is null or until > now()),
    'dbBytes', pg_database_size(current_database()),
    'dbCap', 500 * 1024 * 1024);
end $$;

/** Shared airlines, newest first. `@name` looks an account up by username: the owner only. */
create function public.admin_airlines(p_channel text, p_q text, p_limit int default 50)
  returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare a private.admins := private.admin_gate(); ch text := private.cloud_ch(p_channel); q text := btrim(coalesce(p_q, '')); fc text := upper(regexp_replace(q, '[^A-Za-z0-9]', '', 'g'));
begin
  if q like '@%' then
    if a.role <> 'owner' then raise exception 'owner_only' using errcode = '42501'; end if;
    return coalesce((select jsonb_agg(private.admin_card(p) || jsonb_build_object('username', private.username_of(p.user_id)) order by p.shared_at desc)
      from public.profiles p where p.channel = ch and private.username_of(p.user_id) ilike substr(q, 2) || '%'), '[]'::jsonb);
  end if;
  return coalesce((select jsonb_agg(c order by (c->>'sharedAt') desc) from (
    select private.admin_card(p) c from public.profiles p
    where p.channel = ch and (q = '' or p.airline ilike '%' || q || '%' or p.code = upper(q) or p.callsign ilike '%' || q || '%' or (char_length(fc) = 8 and p.friend_code = fc))
    order by p.shared_at desc limit least(greatest(coalesce(p_limit, 50), 1), 200)) x), '[]'::jsonb);
end $$;

/** Everything shared about one airline, its reports and what moderators did. Not its save, email or sign-in. */
create function public.admin_airline(p_channel text, p_id uuid)
  returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare a private.admins := private.admin_gate(); ch text := private.cloud_ch(p_channel); p public.profiles;
begin
  select * into p from public.profiles where channel = ch and public_id = p_id;
  if p.public_id is null then return null; end if;
  return private.admin_card(p) || jsonb_build_object(
    'liveries', p.liveries, 'stats', p.stats, 'friendCode', p.friend_code, 'mapOn', p.map_on, 'updatedAt', p.updated_at,
    'lockedUntil', p.mod_until, 'locked', p.mod_fields, 'liveriesHidden', p.hidden_liveries is not null,
    'friends', (select count(*) from public.friendships fr where fr.channel = ch and fr.status = 'accepted' and (fr.a = p_id or fr.b = p_id)),
    'accountSince', (select created_at from auth.users where id = p.user_id),
    'otherAirlines', (select count(*) - 1 from public.profiles where user_id = p.user_id),
    'username', case when a.role = 'owner' then private.username_of(p.user_id) end,
    'suspension', (select jsonb_build_object('until', s.until, 'reason', s.reason) from private.suspensions s where s.user_id = p.user_id and (s.until is null or s.until > now())),
    'timesReported', (select count(*) from private.reports r where r.target = p_id),
    'timesActioned', (select count(*) from private.admin_log l where l.target_id = p_id::text and l.action not like 'report_%'),
    'reports', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'reason', r.reason, 'note', r.note, 'status', r.status, 'at', r.created_at, 'by', r.reporter_label) order by r.created_at desc)
      from private.reports r where r.target = p_id), '[]'::jsonb),
    'actions', coalesce((select jsonb_agg(jsonb_build_object('at', l.at, 'by', l.admin_name, 'action', l.action, 'reason', l.reason, 'before', l.before, 'after', l.after) order by l.at desc)
      from private.admin_log l where l.target_id = p_id::text), '[]'::jsonb));
end $$;

/** Cards for airlines by id (the logo grid's "used by"), any channel. */
create function public.admin_cards(p_ids uuid[])
  returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare a private.admins := private.admin_gate();
begin
  return coalesce((select jsonb_object_agg(p.public_id, private.admin_card(p)) from public.profiles p where p.public_id = any(p_ids[1:500])), '{}'::jsonb);
end $$;

/** Alliances using these logos. */
create function public.admin_logo_alliances(p_hashes text[])
  returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare a private.admins := private.admin_gate();
begin
  return coalesce((select jsonb_agg(jsonb_build_object('logo', al.logo, 'id', al.id, 'channel', al.channel, 'name', al.name, 'tag', al.tag)) from public.alliances al where al.logo = any(p_hashes[1:500])), '[]'::jsonb);
end $$;

create function public.admin_alliances(p_channel text, p_q text)
  returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare a private.admins := private.admin_gate(); ch text := private.cloud_ch(p_channel); q text := btrim(coalesce(p_q, ''));
begin
  return coalesce((select jsonb_agg(c order by (c->>'createdAt') desc) from (
    select private.admin_alliance_card(al) c from public.alliances al
    where al.channel = ch and (q = '' or al.name ilike '%' || q || '%' or al.tag = upper(q))
    order by al.created_at desc limit 200) x), '[]'::jsonb);
end $$;

create function public.admin_alliance(p_channel text, p_id uuid)
  returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare a private.admins := private.admin_gate(); ch text := private.cloud_ch(p_channel); al public.alliances;
begin
  select * into al from public.alliances where channel = ch and id = p_id;
  if al.id is null then return null; end if;
  return private.admin_alliance_card(al) || jsonb_build_object(
    'memberList', coalesce((select jsonb_agg(private.admin_card(p) || jsonb_build_object('role', m.role, 'joinedAt', m.joined_at) order by m.role = 'member', m.joined_at)
      from public.alliance_members m join public.profiles p on p.public_id = m.airline where m.alliance = p_id), '[]'::jsonb),
    'invites', coalesce((select jsonb_agg(private.admin_card(p) || jsonb_build_object('invitedAt', i.created_at) order by i.created_at)
      from public.alliance_invites i join public.profiles p on p.public_id = i.airline where i.alliance = p_id), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(jsonb_build_object('at', e.at, 'kind', e.kind, 'detail', e.detail,
        'actor', (select airline from public.profiles where public_id = e.actor), 'target', (select airline from public.profiles where public_id = e.target)) order by e.at desc)
      from private.alliance_events e where e.alliance = p_id), '[]'::jsonb),
    'reports', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'reason', r.reason, 'note', r.note, 'status', r.status, 'at', r.created_at, 'by', r.reporter_label) order by r.created_at desc)
      from private.reports r where r.target = p_id), '[]'::jsonb),
    'actions', coalesce((select jsonb_agg(jsonb_build_object('at', l.at, 'by', l.admin_name, 'action', l.action, 'reason', l.reason, 'before', l.before, 'after', l.after) order by l.at desc)
      from private.admin_log l where l.target_id = p_id::text), '[]'::jsonb));
end $$;

/** Reports, newest first, with the item as reported and as it is now. */
create function public.admin_reports(p_channel text, p_status text)
  returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare a private.admins := private.admin_gate(); ch text := private.cloud_ch(p_channel);
begin
  return coalesce((select jsonb_agg(x order by (x->>'at') desc) from (
    select jsonb_build_object('id', r.id, 'kind', r.kind, 'target', r.target, 'logo', r.logo, 'reason', r.reason, 'note', r.note, 'status', r.status, 'at', r.created_at,
      'by', jsonb_build_object('id', r.reporter_airline, 'airline', r.reporter_label), 'snapshot', r.snapshot, 'handledAt', r.handled_at, 'handledNote', r.handled_note,
      'now', coalesce((select private.admin_card(p) || jsonb_build_object('liveries', p.liveries) from public.profiles p where p.public_id = r.target),
                      (select private.admin_alliance_card(al) from public.alliances al where al.id = r.target))) x
    from private.reports r where r.channel = ch and (coalesce(p_status, 'open') = 'all' or r.status = coalesce(p_status, 'open'))
    order by r.created_at desc limit 200) y), '[]'::jsonb);
end $$;

create function public.admin_suspensions()
  returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare a private.admins := private.admin_gate();
begin
  return coalesce((select jsonb_agg(jsonb_build_object('user', s.user_id, 'label', s.label, 'until', s.until, 'reason', s.reason, 'at', s.at) order by s.at desc)
    from private.suspensions s where s.until is null or s.until > now()), '[]'::jsonb);
end $$;

create function public.admin_log_list(p_before bigint, p_limit int default 100)
  returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare a private.admins := private.admin_gate();
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'at', l.at, 'by', l.admin_name, 'action', l.action, 'channel', l.channel, 'kind', l.target_kind, 'target', l.target_id, 'before', l.before, 'after', l.after, 'reason', l.reason) order by l.id desc)
    from (select * from private.admin_log where p_before is null or id < p_before order by id desc limit least(greatest(coalesce(p_limit, 100), 1), 1000)) l), '[]'::jsonb);
end $$;

create function public.admin_team()
  returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare a private.admins := private.admin_gate();
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', t.user_id, 'name', private.username_of(t.user_id), 'role', t.role, 'since', t.added_at) order by t.role, t.added_at) from private.admins t), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- Admin: changes. Each needs a reason and is logged with what it was before.
-- ---------------------------------------------------------------------------
create function public.admin_report_close(p_id uuid, p_status text, p_reason text)
  returns text language plpgsql security definer set search_path = ''
as $$
declare a private.admins := private.admin_gate(); r private.reports;
begin
  if p_status not in ('dismissed', 'resolved') then return 'bad'; end if;
  select * into r from private.reports where id = p_id;
  if r.id is null then return 'not_found'; end if;
  perform private.admin_act(a, 'report_' || p_status, r.channel, 'report', p_id::text, jsonb_build_object('status', r.status), jsonb_build_object('status', p_status), p_reason);
  update private.reports set status = p_status, handled_at = now(), handled_by = a.user_id, handled_note = btrim(p_reason) where id = p_id;
  return 'ok';
end $$;

/** Resets an airline's name, code or callsign to a safe stand-in, kept for p_days whatever the game sends. */
create function public.admin_airline_reset(p_channel text, p_id uuid, p_fields text[], p_days int, p_reason text)
  returns text language plpgsql security definer set search_path = ''
as $$
declare a private.admins := private.admin_gate(); ch text := private.cloud_ch(p_channel); p public.profiles; f jsonb := '{}'::jsonb; n text;
begin
  select * into p from public.profiles where channel = ch and public_id = p_id;
  if p.public_id is null then return 'not_found'; end if;
  if p_fields is null or cardinality(p_fields) = 0 or not p_fields <@ array['airline', 'code', 'callsign'] or coalesce(p_days, 0) not between 1 and 365 then return 'bad'; end if;
  n := private.safe_number(p_id);
  if 'airline' = any(p_fields) then f := f || jsonb_build_object('airline', 'Airline ' || n); end if;
  if 'code' = any(p_fields) then f := f || jsonb_build_object('code', 'XX'); end if;
  if 'callsign' = any(p_fields) then f := f || jsonb_build_object('callsign', ''); end if;
  perform private.admin_act(a, 'airline_reset', ch, 'airline', p_id::text, jsonb_build_object('airline', p.airline, 'code', p.code, 'callsign', p.callsign), f || jsonb_build_object('days', p_days), p_reason);
  update public.profiles set airline = coalesce(f->>'airline', airline), code = coalesce(f->>'code', code), callsign = coalesce(f->>'callsign', callsign),
    mod_fields = f, mod_until = now() + make_interval(days => p_days), updated_at = now()
  where public_id = p_id;
  perform private.notify(p.user_id, ch, p_id, format('Your shared airline %s had its %s reset because it broke the sharing rules. Other players see “%s” until %s.',
    p.airline, array_to_string(array(select case x when 'airline' then 'name' else x end from unnest(p_fields) x), ' and '), coalesce(f->>'airline', p.airline), to_char(now() + make_interval(days => p_days), 'FMDD Mon YYYY')));
  return 'ok';
end $$;

/** Hides an airline's liveries: other players see the standard one until the player changes theirs. */
create function public.admin_airline_hide_liveries(p_channel text, p_id uuid, p_reason text)
  returns text language plpgsql security definer set search_path = ''
as $$
declare a private.admins := private.admin_gate(); ch text := private.cloud_ch(p_channel); p public.profiles;
begin
  select * into p from public.profiles where channel = ch and public_id = p_id;
  if p.public_id is null then return 'not_found'; end if;
  if p.hidden_liveries is not null then return 'ok'; end if;
  perform private.admin_act(a, 'liveries_hide', ch, 'airline', p_id::text, jsonb_build_object('liveries', p.liveries), jsonb_build_object('liveries', '[]'::jsonb), p_reason);
  update public.profiles set hidden_liveries = md5(p.liveries::text), liveries = '[]'::jsonb, updated_at = now() where public_id = p_id;
  perform private.notify(p.user_id, ch, p_id, format('The liveries of your shared airline %s were hidden because they broke the sharing rules. Other players see the standard livery until you change yours.', p.airline));
  return 'ok';
end $$;

/** Resets an alliance's name, tag, description or logo, and stops its leader changing them for p_days. */
create function public.admin_alliance_reset(p_channel text, p_id uuid, p_fields text[], p_days int, p_reason text)
  returns text language plpgsql security definer set search_path = ''
as $$
declare a private.admins := private.admin_gate(); ch text := private.cloud_ch(p_channel); al public.alliances; n text; t text; lead uuid;
begin
  select * into al from public.alliances where channel = ch and id = p_id;
  if al.id is null then return 'not_found'; end if;
  if p_fields is null or cardinality(p_fields) = 0 or not p_fields <@ array['name', 'tag', 'description', 'logo'] or coalesce(p_days, 0) not between 1 and 365 then return 'bad'; end if;
  n := private.safe_number(p_id);
  t := 'A' || substr(n, 2);
  while 'tag' = any(p_fields) and exists (select 1 from public.alliances where channel = ch and tag = t and id <> p_id) loop
    t := 'A' || lpad((floor(random() * 1000))::int::text, 3, '0');
  end loop;
  perform private.admin_act(a, 'alliance_reset', ch, 'alliance', p_id::text, jsonb_build_object('name', al.name, 'tag', al.tag, 'description', al.description, 'logo', al.logo), jsonb_build_object('fields', p_fields, 'days', p_days), p_reason);
  update public.alliances set
    name = case when 'name' = any(p_fields) then 'Alliance ' || n else name end,
    tag = case when 'tag' = any(p_fields) then t else tag end,
    description = case when 'description' = any(p_fields) then '' else description end,
    logo = case when 'logo' = any(p_fields) then null else logo end,
    mod_until = now() + make_interval(days => p_days), updated_at = now()
  where id = p_id;
  select p.user_id into lead from public.alliance_members m join public.profiles p on p.public_id = m.airline where m.alliance = p_id and m.role = 'leader';
  perform private.notify(lead, ch, null, format('Your alliance %s was changed because it broke the sharing rules. It can be edited again from %s.', al.name, to_char(now() + make_interval(days => p_days), 'FMDD Mon YYYY')));
  return 'ok';
end $$;

create function public.admin_alliance_kick(p_channel text, p_alliance uuid, p_airline uuid, p_reason text)
  returns text language plpgsql security definer set search_path = ''
as $$
declare a private.admins := private.admin_gate(); ch text := private.cloud_ch(p_channel); al public.alliances; p public.profiles;
begin
  select * into al from public.alliances where channel = ch and id = p_alliance;
  select * into p from public.profiles where channel = ch and public_id = p_airline;
  if al.id is null or p.public_id is null or not exists (select 1 from public.alliance_members where alliance = p_alliance and airline = p_airline) then return 'not_found'; end if;
  perform private.admin_act(a, 'alliance_remove', ch, 'alliance', p_alliance::text, jsonb_build_object('airline', p.airline, 'id', p_airline), null, p_reason);
  delete from public.alliance_members where alliance = p_alliance and airline = p_airline;
  perform private.alliance_log(p_alliance, ch, 'removed', null, p_airline, jsonb_build_object('by', 'moderator'));
  perform private.notify(p.user_id, ch, p_airline, format('Your shared airline %s was taken out of the alliance %s because of the sharing rules.', p.airline, al.name));
  return 'ok';
end $$;

create function public.admin_alliance_lead(p_channel text, p_alliance uuid, p_airline uuid, p_reason text)
  returns text language plpgsql security definer set search_path = ''
as $$
declare a private.admins := private.admin_gate(); ch text := private.cloud_ch(p_channel); old uuid;
begin
  if not exists (select 1 from public.alliance_members m join public.alliances al on al.id = m.alliance where al.channel = ch and m.alliance = p_alliance and m.airline = p_airline) then return 'not_found'; end if;
  select airline into old from public.alliance_members where alliance = p_alliance and role = 'leader';
  if old = p_airline then return 'ok'; end if;
  perform private.admin_act(a, 'alliance_lead', ch, 'alliance', p_alliance::text, jsonb_build_object('leader', old), jsonb_build_object('leader', p_airline), p_reason);
  update public.alliance_members set role = 'member' where alliance = p_alliance and role = 'leader';
  update public.alliance_members set role = 'leader' where alliance = p_alliance and airline = p_airline;
  perform private.alliance_log(p_alliance, ch, 'leader', null, p_airline, jsonb_build_object('by', 'moderator'));
  return 'ok';
end $$;

create function public.admin_alliance_disband(p_channel text, p_alliance uuid, p_reason text)
  returns text language plpgsql security definer set search_path = ''
as $$
declare a private.admins := private.admin_gate(); ch text := private.cloud_ch(p_channel); al public.alliances; m record;
begin
  select * into al from public.alliances where channel = ch and id = p_alliance;
  if al.id is null then return 'not_found'; end if;
  perform private.admin_act(a, 'alliance_disband', ch, 'alliance', p_alliance::text, private.admin_alliance_card(al), null, p_reason);
  for m in select p.user_id, p.public_id from public.alliance_members x join public.profiles p on p.public_id = x.airline where x.alliance = p_alliance loop
    perform private.notify(m.user_id, ch, m.public_id, format('The alliance %s was ended because it broke the sharing rules.', al.name));
  end loop;
  delete from public.alliances where id = p_alliance;
  return 'ok';
end $$;

/**
 * Keeps the player who shares this airline out of sharing for p_days (null: for good), in every
 * channel. All their shared airlines stop being shared now, as if they'd stopped sharing them.
 */
create function public.admin_suspend(p_channel text, p_airline uuid, p_days int, p_reason text)
  returns text language plpgsql security definer set search_path = ''
as $$
declare a private.admins := private.admin_gate(); ch text := private.cloud_ch(p_channel); p public.profiles; gone jsonb; untl timestamptz;
begin
  select * into p from public.profiles where channel = ch and public_id = p_airline;
  if p.public_id is null then return 'not_found'; end if;
  if p.user_id = a.user_id or exists (select 1 from private.admins where user_id = p.user_id) then return 'admin'; end if;
  if p_days is not null and p_days not between 1 and 3650 then return 'bad'; end if;
  untl := case when p_days is null then null else now() + make_interval(days => p_days) end;
  select jsonb_agg(jsonb_build_object('id', x.public_id, 'channel', x.channel, 'airline', x.airline)) into gone from public.profiles x where x.user_id = p.user_id;
  perform private.admin_act(a, 'suspend', ch, 'airline', p_airline::text, jsonb_build_object('airlines', gone), jsonb_build_object('until', untl), p_reason);
  insert into private.suspensions (user_id, until, label, reason) values (p.user_id, untl, p.airline, btrim(p_reason))
  on conflict (user_id) do update set until = excluded.until, label = excluded.label, reason = excluded.reason, at = now();
  delete from public.profiles where user_id = p.user_id;
  insert into private.logo_removals (user_id, channel, kind) values (p.user_id, null, 'all');
  perform private.notify(p.user_id, c, null, case when untl is null then 'Your airlines were taken out of sharing for good because of the sharing rules. Your careers keep working as before.'
    else format('Your airlines were taken out of sharing until %s because of the sharing rules. Your careers keep working as before.', to_char(untl, 'FMDD Mon YYYY')) end)
  from unnest(array['main', 'dev']) c;
  return 'ok';
end $$;

create function public.admin_unsuspend(p_user uuid, p_reason text)
  returns text language plpgsql security definer set search_path = ''
as $$
declare a private.admins := private.admin_gate(); s private.suspensions;
begin
  select * into s from private.suspensions where user_id = p_user;
  if s.user_id is null then return 'not_found'; end if;
  perform private.admin_act(a, 'unsuspend', null, 'player', p_user::text, jsonb_build_object('until', s.until, 'label', s.label), null, p_reason);
  delete from private.suspensions where user_id = p_user;
  return 'ok';
end $$;

/**
 * Called by the logos Worker, with the admin's own token, before it approves or removes a logo:
 * checks the admin, logs it and tells the airlines that used it. `p_owners`: [{ channel, airline }].
 * On removal, alliances using it lose it too.
 */
create function public.admin_logo_act(p_hash text, p_action text, p_reason text, p_owners jsonb)
  returns text language plpgsql security definer set search_path = ''
as $$
declare a private.admins := private.admin_gate(); o jsonb; p public.profiles;
begin
  if coalesce(p_hash, '') !~ '^[0-9a-f]{64}$' or p_action not in ('approve', 'remove') or jsonb_typeof(coalesce(p_owners, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_owners, '[]'::jsonb)) > 500 then return 'bad'; end if;
  perform private.admin_act(a, 'logo_' || p_action, null, 'logo', p_hash, null, jsonb_build_object('owners', p_owners), coalesce(nullif(btrim(p_reason), ''), case when p_action = 'approve' then 'Approved in review' end));
  if p_action = 'remove' then
    update public.alliances set logo = null, updated_at = now() where logo = p_hash;
    for o in select * from jsonb_array_elements(coalesce(p_owners, '[]'::jsonb)) loop
      select * into p from public.profiles where public_id = (o->>'airline')::uuid and channel = o->>'channel';
      if p.public_id is not null then
        perform private.notify(p.user_id, p.channel, p.public_id, format('A logo on your shared airline %s was removed because it broke the sharing rules. Other players can’t see it; it stays in your own game.', p.airline));
      end if;
    end loop;
  end if;
  return 'ok';
exception when invalid_text_representation then
  return 'bad';
end $$;

create function public.admin_team_add(p_username text, p_role text, p_reason text)
  returns text language plpgsql security definer set search_path = ''
as $$
declare a private.admins := private.admin_gate(true); uid uuid;
begin
  if p_role not in ('owner', 'moderator') then return 'bad'; end if;
  select id into uid from auth.users where email = lower(btrim(p_username)) || '@players.boardingpass.my';
  if uid is null then return 'not_found'; end if;
  perform private.admin_act(a, 'team_add', null, 'admin', uid::text, (select to_jsonb(t) from private.admins t where t.user_id = uid), jsonb_build_object('role', p_role, 'name', lower(btrim(p_username))), p_reason);
  insert into private.admins (user_id, role, added_by) values (uid, p_role, a.user_id) on conflict (user_id) do update set role = excluded.role;
  return 'ok';
end $$;

create function public.admin_team_remove(p_user uuid, p_reason text)
  returns text language plpgsql security definer set search_path = ''
as $$
declare a private.admins := private.admin_gate(true); t private.admins;
begin
  select * into t from private.admins where user_id = p_user;
  if t.user_id is null then return 'not_found'; end if;
  if t.role = 'owner' and (select count(*) from private.admins where role = 'owner') = 1 then return 'last_owner'; end if;
  perform private.admin_act(a, 'team_remove', null, 'admin', p_user::text, jsonb_build_object('role', t.role, 'name', private.username_of(p_user)), null, p_reason);
  delete from private.admins where user_id = p_user;
  return 'ok';
end $$;

-- ---------------------------------------------------------------------------
-- Keeping it tidy: the privacy policy's 12 months
-- ---------------------------------------------------------------------------
create function private.admin_cleanup() returns void
  language sql security definer set search_path = ''
as $$
  delete from private.admin_log where at < now() - interval '12 months';
  delete from private.reports where created_at < now() - interval '12 months';
  delete from private.notices where at < now() - interval '90 days';
  delete from private.admin_meter where hour < now() - interval '2 days';
  delete from private.suspensions where until is not null and until < now() - interval '12 months';
$$;
revoke all on function private.admin_cleanup() from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('bp-admin-cleanup', '47 4 * * *', 'select private.admin_cleanup()');
  end if;
end $$;

-- Only signed-in callers; the functions themselves check the rest
revoke all on function public.report_make(text, uuid, text, uuid, text, text, text), public.notices_mine(text),
  public.admin_whoami(), public.admin_dashboard(text), public.admin_airlines(text, text, int), public.admin_airline(text, uuid), public.admin_cards(uuid[]),
  public.admin_logo_alliances(text[]), public.admin_alliances(text, text), public.admin_alliance(text, uuid), public.admin_reports(text, text), public.admin_suspensions(),
  public.admin_log_list(bigint, int), public.admin_team(), public.admin_report_close(uuid, text, text), public.admin_airline_reset(text, uuid, text[], int, text),
  public.admin_airline_hide_liveries(text, uuid, text), public.admin_alliance_reset(text, uuid, text[], int, text), public.admin_alliance_kick(text, uuid, uuid, text),
  public.admin_alliance_lead(text, uuid, uuid, text), public.admin_alliance_disband(text, uuid, text), public.admin_suspend(text, uuid, int, text), public.admin_unsuspend(uuid, text),
  public.admin_logo_act(text, text, text, jsonb), public.admin_team_add(text, text, text), public.admin_team_remove(uuid, text) from public, anon;
grant execute on function public.report_make(text, uuid, text, uuid, text, text, text), public.notices_mine(text),
  public.admin_whoami(), public.admin_dashboard(text), public.admin_airlines(text, text, int), public.admin_airline(text, uuid), public.admin_cards(uuid[]),
  public.admin_logo_alliances(text[]), public.admin_alliances(text, text), public.admin_alliance(text, uuid), public.admin_reports(text, text), public.admin_suspensions(),
  public.admin_log_list(bigint, int), public.admin_team(), public.admin_report_close(uuid, text, text), public.admin_airline_reset(text, uuid, text[], int, text),
  public.admin_airline_hide_liveries(text, uuid, text), public.admin_alliance_reset(text, uuid, text[], int, text), public.admin_alliance_kick(text, uuid, uuid, text),
  public.admin_alliance_lead(text, uuid, uuid, text), public.admin_alliance_disband(text, uuid, text), public.admin_suspend(text, uuid, int, text), public.admin_unsuspend(uuid, text),
  public.admin_logo_act(text, text, text, jsonb), public.admin_team_add(text, text, text), public.admin_team_remove(uuid, text) to authenticated;
