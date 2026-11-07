-- Friends' aircraft on the map (Update A, phase A4). Needs 2026-11-06-friends.sql first.
-- The schedules themselves live in R2 through the Worker (logos-worker/). This side
-- holds the player's choice to share them, and answers who may see whose. Deploy the
-- Worker from this phase before turning the friends_map flag on: an older Worker
-- would read a 'schedule' removal as "remove the player's logos too".

-- Off until the player turns it on. Lasts only while they share an airline.
alter table public.online_players add column map_on boolean not null default false;

-- What the nightly job has to clear: everything, or just the schedule.
alter table private.logo_removals add column kind text not null default 'all' check (kind in ('all', 'schedule'));

/** For the nightly job: what to remove. Null unless the key is right. */
create or replace function public.logo_removals_take(p_key text)
  returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  if not private.logo_key_ok(p_key) then return null; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'user_id', user_id, 'channel', channel, 'kind', kind, 'at', floor(extract(epoch from at) * 1000))), '[]'::jsonb)
          from (select * from private.logo_removals order by id limit 100) r);
end $$;

/**
 * Turns showing this player's flights to friends on or off. Answers: on, off, share_first, unavailable.
 * Turning off always works, and queues the schedule for removal in case the game can't reach the Worker.
 */
create function public.map_share_set(p_channel text, p_on boolean)
  returns text language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.cloud_gate(); ch text := private.cloud_ch(p_channel);
begin
  if p_on is not true then
    update public.online_players set map_on = false where user_id = uid and channel = ch and map_on;
    if found then
      insert into private.logo_removals (user_id, channel, kind) values (uid, ch, 'schedule');
    end if;
    return 'off';
  end if;
  if not private.feature_on(ch, 'friends') or not private.feature_on(ch, 'friends_map') then return 'unavailable'; end if;
  if not exists (select 1 from public.profiles where user_id = uid and channel = ch) then return 'share_first'; end if;
  perform private.online_player(uid, ch);
  update public.online_players set map_on = true where user_id = uid and channel = ch;
  return 'on';
end $$;

/** For the Worker, with the player's sign-in: where this player's schedule goes. Null if they can't publish one. */
create function public.schedule_gate(p_channel text)
  returns uuid language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.cloud_gate(); ch text := private.cloud_ch(p_channel);
begin
  if not private.feature_on(ch, 'friends') or not private.feature_on(ch, 'friends_map') then return null; end if;
  if not exists (select 1 from public.profiles where user_id = uid and channel = ch) then return null; end if;
  return (select public_id from public.online_players where user_id = uid and channel = ch and map_on);
end $$;

/**
 * The friends whose aircraft this player can have on their map right now: accepted, this
 * player's own toggle on, the friend sharing their flights. Blocking removes the friendship,
 * so a block ends this at once. 20 airlines at most, the most recently active first.
 */
create function public.friends_on_map(p_channel text)
  returns jsonb language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.cloud_gate(); ch text := private.cloud_ch(p_channel);
begin
  if not private.feature_on(ch, 'friends') or not private.feature_on(ch, 'friends_map') or not private.feature_on(ch, 'profiles') then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', x.public_id, 'airline', x.airline, 'code', x.code, 'callsign', x.callsign, 'colours', x.colours, 'updatedAt', x.updated_at))
    from (
      select p.public_id, s.airline, s.code, s.callsign, s.colours, s.updated_at
      from public.friendships f
      join public.online_players p on p.channel = ch and p.user_id = case when f.a = uid then f.b else f.a end and p.map_on
      join public.profiles s on s.channel = ch and s.user_id = p.user_id
      where f.channel = ch and f.status = 'accepted' and (f.a = uid or f.b = uid)
        and case when f.a = uid then f.a_map else f.b_map end
      order by s.updated_at desc
      limit 20
    ) x
  ), '[]'::jsonb);
end $$;

/** The player's own profile, or null, and whether they share their flights. */
create or replace function public.profile_mine(p_channel text)
  returns jsonb language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.cloud_gate(); ch text := private.cloud_ch(p_channel);
begin
  return (select jsonb_build_object('saveId', s.save_id, 'airline', s.airline, 'updatedAt', s.updated_at, 'mapOn', coalesce(p.map_on, false))
          from public.profiles s left join public.online_players p on p.user_id = s.user_id and p.channel = s.channel
          where s.user_id = uid and s.channel = ch);
end $$;

/** Stops sharing: the flights go with the airline, and its logos and schedule are queued for removal. */
create or replace function public.profile_delete(p_channel text)
  returns void language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.cloud_gate(); ch text := private.cloud_ch(p_channel);
begin
  delete from public.profiles where user_id = uid and channel = ch;
  if found then
    update public.online_players set map_on = false where user_id = uid and channel = ch;
    insert into private.logo_removals (user_id, channel) values (uid, ch);
  end if;
end $$;

revoke all on function public.map_share_set(text, boolean) from public, anon;
revoke all on function public.schedule_gate(text) from public, anon;
revoke all on function public.friends_on_map(text) from public, anon;
grant execute on function public.map_share_set(text, boolean) to authenticated;
grant execute on function public.schedule_gate(text) to authenticated;
grant execute on function public.friends_on_map(text) to authenticated;
