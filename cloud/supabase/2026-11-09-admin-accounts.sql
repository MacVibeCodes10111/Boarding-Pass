-- Admin site: airlines grouped by account (2026-11-09).
--
-- admin_airlines now works by account: a search finds the accounts with a
-- matching airline (newest share first, up to p_limit accounts) and returns
-- every airline those accounts share, each with `account`, a short key that
-- only groups them (not the account's id, and not reversible to it). The owner
-- also gets each account's username, as with the "@username" search; other
-- moderators never see it.

create or replace function private.account_key(uid uuid)
returns text
language sql
immutable
set search_path = ''
as $$ select left(md5(uid::text || ':bp-admin-account'), 8) $$;

create or replace function public.admin_airlines(p_channel text, p_q text, p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a private.admins := private.admin_gate();
  ch text := private.cloud_ch(p_channel);
  q text := btrim(coalesce(p_q, ''));
  fc text := upper(regexp_replace(q, '[^A-Za-z0-9]', '', 'g'));
  is_owner boolean := a.role = 'owner';
  users uuid[];
begin
  if q like '@%' then
    if not is_owner then raise exception 'owner_only' using errcode = '42501'; end if;
    select array_agg(distinct p.user_id) into users
      from public.profiles p where p.channel = ch and private.username_of(p.user_id) ilike substr(q, 2) || '%';
  else
    select array_agg(x.user_id) into users from (
      select p.user_id, max(p.shared_at) as last
      from public.profiles p
      where p.channel = ch and (q = '' or p.airline ilike '%' || q || '%' or p.code = upper(q) or p.callsign ilike '%' || q || '%' or (char_length(fc) = 8 and p.friend_code = fc))
      group by p.user_id
      order by last desc
      limit least(greatest(coalesce(p_limit, 50), 1), 200)) x;
  end if;
  return coalesce((select jsonb_agg(y.c order by y.last desc, y.c->>'account', (y.c->>'sharedAt') desc) from (
      select private.admin_card(p)
               || jsonb_build_object('account', private.account_key(p.user_id))
               || case when is_owner then jsonb_build_object('username', private.username_of(p.user_id)) else '{}'::jsonb end as c,
             max(p.shared_at) over (partition by p.user_id) as last
      from public.profiles p
      where p.channel = ch and p.user_id = any(coalesce(users, '{}'))) y), '[]'::jsonb);
end $$;
