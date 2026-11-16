-- The rich list (2026-11-16). Owner only.
--
-- Cloud saves are scrambled (src/game/saveCrypt.ts) with a key that's in the
-- game's own code, so the owner's admin page can read them. It fetches the
-- saves that changed since it last looked (admin_save_blobs), works out each
-- career's cash, debt, fleet, age and so on in the browser, and stores that
-- summary here (admin_save_stats_put), so the next look only reads what changed.
-- admin_rich lists the richest (or oldest) careers from the stored summaries.
-- Nothing here changes cloud_saves or what the game sends.

create table private.save_stats (
  user_id uuid not null references auth.users (id) on delete cascade,
  channel text not null,
  save_id text not null,
  rev bigint not null,
  stats jsonb not null,
  at timestamptz not null default now(),
  primary key (user_id, channel, save_id)
);
alter table private.save_stats enable row level security;

/** A whole number from a summary, if it's a number between lo and hi. */
create function private.stat_num(j jsonb, k text, lo numeric, hi numeric) returns numeric
  language sql immutable set search_path = ''
as $$
  select case when jsonb_typeof(j->k) = 'number' and (j->>k)::numeric between lo and hi then round((j->>k)::numeric) end
$$;

/** Saves whose summary is missing or older than the save, newest first, about 8 MB at a time. */
create function public.admin_save_blobs(p_channel text) returns jsonb
  language plpgsql stable security definer set search_path = ''
as $$
declare a private.admins := private.admin_gate(true); ch text := private.cloud_ch(p_channel);
begin
  return jsonb_build_object(
    'left', (select count(*) from public.cloud_saves s
             left join private.save_stats st on st.user_id = s.user_id and st.channel = s.channel and st.save_id = s.save_id
             where s.channel = ch and st.rev is distinct from s.rev),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object('user', x.user_id, 'saveId', x.save_id, 'rev', x.rev, 'data', x.data))
      from (
        select s.user_id, s.save_id, s.rev, s.data,
               sum(octet_length(s.data)) over (order by s.updated_at desc, s.save_id) - octet_length(s.data) as before
        from public.cloud_saves s
        left join private.save_stats st on st.user_id = s.user_id and st.channel = s.channel and st.save_id = s.save_id
        where s.channel = ch and st.rev is distinct from s.rev
        order by s.updated_at desc, s.save_id
        limit 40
      ) x
      where x.before < 8000000
    ), '[]'::jsonb)
  );
end $$;

/** Stores the summaries the admin page worked out. Only for the save revision it read. */
create function public.admin_save_stats_put(p_channel text, p_rows jsonb) returns integer
  language plpgsql security definer set search_path = ''
as $$
declare
  a private.admins := private.admin_gate(true);
  ch text := private.cloud_ch(p_channel);
  r jsonb;
  st jsonb;
  n int := 0;
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 100 then raise exception 'Missing data'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    st := coalesce(r->'stats', '{}'::jsonb);
    insert into private.save_stats (user_id, channel, save_id, rev, stats)
    select s.user_id, ch, s.save_id, s.rev, jsonb_strip_nulls(jsonb_build_object(
      'cash', private.stat_num(st, 'cash', -1e15, 1e15),
      'debt', private.stat_num(st, 'debt', 0, 1e15),
      'mode', case when st->>'mode' in ('career', 'sandbox') then st->>'mode' end,
      'weeks', private.stat_num(st, 'weeks', 0, 1e7),
      'fleet', private.stat_num(st, 'fleet', 0, 1e5),
      'routes', private.stat_num(st, 'routes', 0, 1e6),
      'hubs', private.stat_num(st, 'hubs', 0, 1e4),
      'startedAt', private.stat_num(st, 'startedAt', 1.5e12, 4e12),
      'tampered', case when st->'tampered' = 'true'::jsonb then true end,
      'unreadable', case when st->'unreadable' = 'true'::jsonb then true end))
    from public.cloud_saves s
    where s.channel = ch and s.user_id = (r->>'user')::uuid and s.save_id = r->>'saveId' and s.rev = (r->>'rev')::bigint
    on conflict (user_id, channel, save_id) do update set rev = excluded.rev, stats = excluded.stats, at = now();
    if found then n := n + 1; end if;
  end loop;
  -- Summaries of saves that have left the cloud
  delete from private.save_stats st where st.channel = ch
    and not exists (select 1 from public.cloud_saves s where s.user_id = st.user_id and s.channel = st.channel and s.save_id = st.save_id);
  return n;
end $$;

/** The richest careers (p_sort 'cash') or the oldest ('age') of one mode. */
create function public.admin_rich(p_channel text, p_mode text, p_sort text, p_limit integer default 100) returns jsonb
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
          'fresh', st.rev = s.rev
        ) as card
        from public.cloud_saves s
        join private.save_stats st on st.user_id = s.user_id and st.channel = s.channel and st.save_id = s.save_id
        where s.channel = ch and coalesce(st.stats->>'mode', 'career') = m
        order by
          case when p_sort = 'age' then (st.stats->>'startedAt')::numeric end asc nulls last,
          case when p_sort is distinct from 'age' then (st.stats->>'cash')::numeric end desc nulls last,
          s.updated_at desc
        limit lim
      ) x
    ), '[]'::jsonb)
  );
end $$;

-- The saves search shows the summary too
create or replace function public.admin_saves(p_channel text, p_q text) returns jsonb
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
        'stats', (select st.stats from private.save_stats st where st.user_id = s.user_id and st.channel = ch and st.save_id = s.save_id),
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

revoke all on function public.admin_save_blobs(text), public.admin_save_stats_put(text, jsonb), public.admin_rich(text, text, text, integer) from public, anon;
grant execute on function public.admin_save_blobs(text), public.admin_save_stats_put(text, jsonb), public.admin_rich(text, text, text, integer) to authenticated;
revoke all on function private.stat_num(jsonb, text, numeric, numeric) from public, anon, authenticated;
