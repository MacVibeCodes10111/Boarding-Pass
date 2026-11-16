-- Admin grants and cloud save removal (2026-11-16). Owner only.
--
-- Grants: the owner gives a career cash (or takes it away: a negative amount),
-- with a reason. The server never edits a stored save. The grant waits here
-- until the player's game, signed in with that career open, reads it
-- (grants_mine), applies it once (keeping its id in the save), writes a letter
-- with the reason, saves, and claims it (grant_claim). An open grant can be
-- cancelled. `kind` is 'cash' for now; gems and paid items can use the same
-- table later. The game also skips a kind it doesn't know, so old versions
-- don't break.
--
-- Removing a save: the cloud copy goes, the career is taken out of the
-- player's cloud picks, and it's remembered (private.cloud_removed) so it can't
-- be picked again. The copy on the player's devices stays. The player gets a
-- notice. Open grants for it are cancelled.
--
-- Every change goes through private.admin_act: reason needed, logged, 60 an hour.

create table private.grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  channel text not null check (channel in ('main', 'dev')),
  save_id text not null,
  kind text not null check (kind in ('cash')),
  amount bigint not null check (amount <> 0 and abs(amount) <= 100000000000),
  reason text not null,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  claimed_at timestamptz,
  cancelled_at timestamptz
);
create index grants_open on private.grants (user_id, channel, save_id) where claimed_at is null and cancelled_at is null;
alter table private.grants enable row level security;

create table private.cloud_removed (
  user_id uuid not null references auth.users (id) on delete cascade,
  channel text not null,
  save_id text not null,
  at timestamptz not null default now(),
  primary key (user_id, channel, save_id)
);
alter table private.cloud_removed enable row level security;

/** What admins see of one grant. */
create function private.grant_card(g private.grants) returns jsonb
  language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('id', g.id, 'kind', g.kind, 'amount', g.amount, 'reason', g.reason, 'at', g.created_at,
    'claimedAt', g.claimed_at, 'cancelledAt', g.cancelled_at)
$$;

/** Cloud saves by owner username ("@name", prefix), airline name or friend code, newest first, with their grants. */
create function public.admin_saves(p_channel text, p_q text) returns jsonb
  language plpgsql stable security definer set search_path = ''
as $$
declare
  a private.admins := private.admin_gate(true);
  ch text := private.cloud_ch(p_channel);
  q text := btrim(coalesce(p_q, ''));
  -- A friend code (8 letters and numbers, dashes and case don't matter): the save that shares that airline
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
        'friendCode', (select p.friend_code from public.profiles p where p.user_id = s.user_id and p.channel = ch and p.save_id = s.save_id),
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

/** Gives a cloud save cash (a negative amount takes it away). It reaches the save the next time it's played. */
create function public.admin_grant(p_channel text, p_user uuid, p_save_id text, p_kind text, p_amount bigint, p_reason text) returns text
  language plpgsql security definer set search_path = ''
as $$
declare
  a private.admins := private.admin_gate(true);
  ch text := private.cloud_ch(p_channel);
  s public.cloud_saves;
  g private.grants;
begin
  if p_kind is null or p_kind not in ('cash') then return 'bad_kind'; end if;
  if p_amount is null or p_amount = 0 or abs(p_amount) > 100000000000 then return 'bad_amount'; end if;
  select * into s from public.cloud_saves where user_id = p_user and channel = ch and save_id = p_save_id;
  if s.user_id is null then return 'not_found'; end if;
  insert into private.grants (user_id, channel, save_id, kind, amount, reason, created_by)
  values (p_user, ch, p_save_id, p_kind, p_amount, btrim(coalesce(p_reason, '')), a.user_id)
  returning * into g;
  perform private.admin_act(a, 'grant', ch, 'save', p_user || '/' || p_save_id, null,
    jsonb_build_object('grant', g.id, 'airline', s.airline, 'kind', p_kind, 'amount', p_amount), p_reason);
  return 'ok';
end $$;

/** Cancels a grant the player's game hasn't applied yet. */
create function public.admin_grant_cancel(p_channel text, p_id uuid, p_reason text) returns text
  language plpgsql security definer set search_path = ''
as $$
declare
  a private.admins := private.admin_gate(true);
  ch text := private.cloud_ch(p_channel);
  g private.grants;
begin
  update private.grants set cancelled_at = now()
    where id = p_id and channel = ch and claimed_at is null and cancelled_at is null
    returning * into g;
  if g.id is null then return 'gone'; end if;
  perform private.admin_act(a, 'grant_cancel', ch, 'save', g.user_id || '/' || g.save_id, private.grant_card(g), null, p_reason);
  return 'ok';
end $$;

/** Removes a career from the cloud for good. The player's devices keep their copy; they're told. */
create function public.admin_save_delete(p_channel text, p_user uuid, p_save_id text, p_reason text) returns text
  language plpgsql security definer set search_path = ''
as $$
declare
  a private.admins := private.admin_gate(true);
  ch text := private.cloud_ch(p_channel);
  s public.cloud_saves;
begin
  select * into s from public.cloud_saves where user_id = p_user and channel = ch and save_id = p_save_id;
  if s.user_id is null then return 'not_found'; end if;
  -- First: it checks the reason and the hourly limit, and nothing below happens if it refuses
  perform private.admin_act(a, 'save_delete', ch, 'save', p_user || '/' || p_save_id,
    jsonb_build_object('airline', s.airline, 'rev', s.rev, 'bytes', octet_length(s.data), 'updatedAt', s.updated_at), null, p_reason);
  delete from public.cloud_saves where user_id = p_user and channel = ch and save_id = p_save_id;
  delete from public.cloud_picks where user_id = p_user and channel = ch and save_id = p_save_id;
  delete from public.cloud_save_receipts where user_id = p_user and channel = ch and save_id = p_save_id;
  update private.grants set cancelled_at = now()
    where user_id = p_user and channel = ch and save_id = p_save_id and claimed_at is null and cancelled_at is null;
  insert into private.cloud_removed (user_id, channel, save_id) values (p_user, ch, p_save_id) on conflict do nothing;
  perform private.notify(p_user, ch, null,
    'Your career “' || coalesce(nullif(s.airline, ''), 'Untitled') || '” was removed from cloud saves by a moderator. It stays on the devices that have it, but it won’t sync any more.');
  return 'ok';
end $$;

/** The player's open grants for one of their careers, oldest first. */
create function public.grants_mine(p_channel text, p_save_id text) returns jsonb
  language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.cloud_gate(); ch text := private.cloud_ch(p_channel);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', g.id, 'kind', g.kind, 'amount', g.amount, 'reason', g.reason, 'at', g.created_at) order by g.created_at)
    from private.grants g
    where g.user_id = uid and g.channel = ch and g.save_id = p_save_id and g.claimed_at is null and g.cancelled_at is null
  ), '[]'::jsonb);
end $$;

/** The player's game has applied the grant and saved: it won't be sent again. */
create function public.grant_claim(p_channel text, p_save_id text, p_id uuid) returns boolean
  language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.cloud_gate(); ch text := private.cloud_ch(p_channel);
begin
  update private.grants set claimed_at = now()
    where id = p_id and user_id = uid and channel = ch and save_id = p_save_id and claimed_at is null and cancelled_at is null;
  return found;
end $$;

-- Picking a removed career is refused ('removed'). Unchanged otherwise.
create or replace function public.cloud_pick(p_channel text, p_save_id text, p_airline text, p_on boolean) returns text
  language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.cloud_gate(); ch text := private.cloud_ch(p_channel); n int;
begin
  if p_save_id is null or char_length(p_save_id) not between 1 and 80 then raise exception 'Missing data'; end if;
  if p_on then
    if exists (select 1 from private.cloud_removed where user_id = uid and channel = ch and save_id = p_save_id) then return 'removed'; end if;
    if exists (select 1 from public.cloud_picks where user_id = uid and channel = ch and save_id = p_save_id) then return 'ok'; end if;
    select count(*) into n from public.cloud_picks where user_id = uid and channel = ch;
    if n >= 4 then return 'full'; end if;
    insert into public.cloud_picks(user_id, channel, save_id, airline) values (uid, ch, p_save_id, left(coalesce(p_airline, ''), 80));
    return 'ok';
  end if;
  delete from public.cloud_picks where user_id = uid and channel = ch and save_id = p_save_id;
  delete from public.cloud_saves where user_id = uid and channel = ch and save_id = p_save_id;
  return 'ok';
end $$;

-- Only signed-in players and admins, through these functions
revoke all on function public.admin_saves(text, text), public.admin_grant(text, uuid, text, text, bigint, text),
  public.admin_grant_cancel(text, uuid, text), public.admin_save_delete(text, uuid, text, text),
  public.grants_mine(text, text), public.grant_claim(text, text, uuid) from public, anon;
grant execute on function public.admin_saves(text, text), public.admin_grant(text, uuid, text, text, bigint, text),
  public.admin_grant_cancel(text, uuid, text), public.admin_save_delete(text, uuid, text, text),
  public.grants_mine(text, text), public.grant_claim(text, text, uuid) to authenticated;
revoke all on function private.grant_card(private.grants) from public, anon, authenticated;
