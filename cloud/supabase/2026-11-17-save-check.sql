-- The server's save check (2026-11-17). Replaces the rich list's reading in the
-- owner's browser (2026-11-16-save-stats.sql).
--
-- Every minute pg_cron calls the save-check server function (cloud/save-check).
-- It reads the Careers that changed (each at most every 30 minutes), works out
-- their cash, loans, fleet and game time, and judges each against the copy
-- before it by the server's clock (src/game/saveCheck.ts): game time faster than
-- real time, cash flights couldn't earn, or a save edited outside the game.
-- Flags are kept in private.save_flags and shown in the rich list. Nothing is
-- deleted or changed in the player's save.
--
-- The schedule passes a key that lives only in the database (Vault); the
-- functions here can only be called with the service role, i.e. by the server
-- function itself.

create extension if not exists pg_net with schema extensions;

create table private.save_flags (
  id bigserial primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  channel text not null,
  save_id text not null,
  rev bigint not null,
  at timestamptz not null default now(),
  flags text[] not null,
  before jsonb,
  after jsonb
);
create index save_flags_save on private.save_flags (user_id, channel, save_id);
alter table private.save_flags enable row level security;

-- The key the schedule sends; made here, never leaves the database
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'save_check_key', 'Sent by the save-check schedule to the save-check server function');

create function public.save_check_key_ok(p_key text) returns boolean
  language sql stable security definer set search_path = ''
as $$
  select coalesce(char_length(p_key) >= 32 and exists (select 1 from vault.decrypted_secrets where name = 'save_check_key' and decrypted_secret = p_key), false)
$$;

/** Careers to check: changed since their last check, and not checked in the last 30 minutes. About 6 MB at a time. */
create function public.save_check_take() returns jsonb
  language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('user', x.user_id, 'channel', x.channel, 'saveId', x.save_id, 'rev', x.rev, 'data', x.data,
           'pushedAt', floor(extract(epoch from x.updated_at) * 1000)::bigint, 'prev', x.prev,
           'grants', coalesce((select sum(g.amount) from private.grants g
                      where g.user_id = x.user_id and g.channel = x.channel and g.save_id = x.save_id and g.claimed_at is not null
                        and (x.prev->>'pushedAt' is null or g.claimed_at > to_timestamp((x.prev->>'pushedAt')::numeric / 1000))), 0))), '[]'::jsonb)
  from (
    select s.user_id, s.channel, s.save_id, s.rev, s.data, s.updated_at, st.stats as prev,
           sum(octet_length(s.data)) over (order by s.updated_at, s.save_id) - octet_length(s.data) as before
    from public.cloud_saves s
    left join private.save_stats st on st.user_id = s.user_id and st.channel = s.channel and st.save_id = s.save_id
    where (st.rev is distinct from s.rev)
      and (st.at is null or st.at < now() - interval '30 minutes')
      and coalesce(st.stats->>'mode', 'career') <> 'sandbox'
    order by s.updated_at, s.save_id
    limit 25
  ) x
  where x.before < 6000000
$$;

/** Stores what the check found, for the revision it read. Flags also go in the history. */
create function public.save_check_put(p_rows jsonb) returns integer
  language plpgsql security definer set search_path = ''
as $$
declare
  r jsonb;
  st jsonb;
  clean jsonb;
  fl text[];
  prev jsonb;
  sv public.cloud_saves;
  n int := 0;
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 100 then raise exception 'Missing data'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    select * into sv from public.cloud_saves
      where user_id = (r->>'user')::uuid and channel = r->>'channel' and save_id = r->>'saveId' and rev = (r->>'rev')::bigint;
    continue when sv.user_id is null;
    st := coalesce(r->'stats', '{}'::jsonb);
    select coalesce(array_agg(distinct f), '{}') into fl
      from jsonb_array_elements_text(case when jsonb_typeof(st->'flags') = 'array' then st->'flags' else '[]'::jsonb end) f
      where f in ('edited', 'time', 'cash');
    clean := jsonb_strip_nulls(jsonb_build_object(
      'cash', private.stat_num(st, 'cash', -1e15, 1e15),
      'debt', private.stat_num(st, 'debt', 0, 1e15),
      'mode', case when st->>'mode' in ('career', 'sandbox') then st->>'mode' end,
      'weeks', private.stat_num(st, 'weeks', 0, 1e7),
      'econMin', private.stat_num(st, 'econMin', 0, 1e11),
      'fleet', private.stat_num(st, 'fleet', 0, 1e5),
      'routes', private.stat_num(st, 'routes', 0, 1e6),
      'hubs', private.stat_num(st, 'hubs', 0, 1e4),
      'startedAt', private.stat_num(st, 'startedAt', 1.5e12, 4e12),
      'tampered', case when st->'tampered' = 'true'::jsonb then true end,
      'unreadable', case when st->'unreadable' = 'true'::jsonb then true end,
      'flags', case when cardinality(fl) > 0 then to_jsonb(fl) end,
      -- When the server received this copy: from the server, never from the save
      'pushedAt', floor(extract(epoch from sv.updated_at) * 1000)::bigint));
    select stats into prev from private.save_stats where user_id = sv.user_id and channel = sv.channel and save_id = sv.save_id;
    insert into private.save_stats (user_id, channel, save_id, rev, stats) values (sv.user_id, sv.channel, sv.save_id, sv.rev, clean)
      on conflict (user_id, channel, save_id) do update set rev = excluded.rev, stats = excluded.stats, at = now();
    if cardinality(fl) > 0 then
      insert into private.save_flags (user_id, channel, save_id, rev, flags, before, after) values (sv.user_id, sv.channel, sv.save_id, sv.rev, fl, prev, clean);
    end if;
    n := n + 1;
  end loop;
  delete from private.save_stats ss
    where not exists (select 1 from public.cloud_saves c where c.user_id = ss.user_id and c.channel = ss.channel and c.save_id = ss.save_id);
  return n;
end $$;

-- The browser no longer reads saves for the rich list
drop function if exists public.admin_save_blobs(text);
drop function if exists public.admin_save_stats_put(text, jsonb);

/** The richest careers (p_sort 'cash'), the oldest ('age'), or the flagged ones first ('flagged'), of one mode. */
create or replace function public.admin_rich(p_channel text, p_mode text, p_sort text, p_limit integer default 100) returns jsonb
  language plpgsql stable security definer set search_path = ''
as $$
declare
  a private.admins := private.admin_gate(true);
  ch text := private.cloud_ch(p_channel);
  m text := case when p_mode = 'sandbox' then 'sandbox' else 'career' end;
  lim int := least(greatest(coalesce(p_limit, 100), 1), 500);
begin
  return jsonb_build_object(
    'total', (select count(*) from public.cloud_saves where channel = ch),
    'rows', coalesce((
      select jsonb_agg(card)
      from (
        select jsonb_build_object(
          'user', s.user_id,
          'username', private.username_of(s.user_id),
          'saveId', s.save_id,
          'airline', s.airline,
          'updatedAt', s.updated_at,
          'friendCode', (select p.friend_code from public.profiles p where p.user_id = s.user_id and p.channel = ch and p.save_id = s.save_id),
          'stats', st.stats,
          'fresh', st.rev = s.rev,
          'flagCount', fc.n
        ) as card
        from public.cloud_saves s
        join private.save_stats st on st.user_id = s.user_id and st.channel = s.channel and st.save_id = s.save_id
        cross join lateral (select count(*) as n from private.save_flags f where f.user_id = s.user_id and f.channel = s.channel and f.save_id = s.save_id) fc
        where s.channel = ch and coalesce(st.stats->>'mode', 'career') = m
          and (p_sort is distinct from 'flagged' or fc.n > 0)
        order by
          case when p_sort = 'flagged' then fc.n end desc nulls last,
          case when p_sort = 'age' then (st.stats->>'startedAt')::numeric end asc nulls last,
          case when p_sort is distinct from 'age' then (st.stats->>'cash')::numeric end desc nulls last,
          s.updated_at desc
        limit lim
      ) x
    ), '[]'::jsonb)
  );
end $$;

revoke all on function public.save_check_key_ok(text), public.save_check_take(), public.save_check_put(jsonb) from public, anon, authenticated;
grant execute on function public.save_check_key_ok(text), public.save_check_take(), public.save_check_put(jsonb) to service_role;

-- The schedule (once the save-check function is deployed). The URL is the project's own:
--   live:  https://dlgkdknfxhmtkhpegufq.supabase.co/functions/v1/save-check
--   build: https://duvrftpiosoouovwlose.supabase.co/functions/v1/save-check
-- select cron.schedule('save-check', '* * * * *', $job$
--   select net.http_post(
--     url := '<URL above>',
--     headers := jsonb_build_object('content-type', 'application/json',
--                  'x-check-key', (select decrypted_secret from vault.decrypted_secrets where name = 'save_check_key')),
--     body := '{}'::jsonb, timeout_milliseconds := 60000)
-- $job$);
