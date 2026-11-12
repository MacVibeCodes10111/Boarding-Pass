-- Security sweep (2026-11-11). Three small tightenings; nothing players see changes.
--
-- 1. private.username_of took the name from the account's own details first,
--    which a signed-in player can rewrite (auth.updateUser). The owner's admin
--    pages, the team list and the admin log show that name, so a player or a
--    moderator could pose as someone else there. Now: a username account always
--    shows the name it signs in with (its address can't change, see
--    private.guard_auth_user), and a Google or Discord account shows the name
--    that sign-in gave, which only Google or Discord can change. The account's
--    own details are only a last resort.
-- 2. private.account_key still had the built-in "anyone may run it" grant.
--    Nobody could reach it (only the owner can use schema private), but it now
--    matches the other helpers.
-- 3. Row Level Security on the private tables that didn't have it. Only the
--    security definer functions read them (they run as the owner, which RLS
--    doesn't stop), and no policy is added, so this only matters if a grant is
--    ever made by mistake.
--
-- Safe to run again.

create or replace function private.username_of(uid uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    case when u.email like '%@players.boardingpass.my' then split_part(u.email, '@', 1) end,
    (select coalesce(nullif(i.identity_data->>'user_name', ''), nullif(i.identity_data->>'name', ''), nullif(i.identity_data->>'full_name', ''))
       from auth.identities i
       where i.user_id = u.id and i.provider = coalesce(u.raw_app_meta_data->>'provider', i.provider)
       order by i.created_at limit 1),
    nullif(u.raw_user_meta_data->>'user_name', ''), nullif(u.raw_user_meta_data->>'name', ''), 'player')
  from auth.users u where u.id = uid
$$;
revoke all on function private.username_of(uuid) from public, anon, authenticated;

revoke all on function private.account_key(uuid) from public, anon, authenticated;

alter table if exists private.alliance_events enable row level security;
alter table if exists private.cloud_usage enable row level security;
alter table if exists private.friend_meter enable row level security;
alter table if exists private.logo_cleanup enable row level security;
alter table if exists private.logo_removals enable row level security;
alter table if exists private.signup_allowance enable row level security;
alter table if exists private.signup_log enable row level security;
