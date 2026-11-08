-- Backup of everything online (not cloud saves). Run in the Supabase dashboard's SQL Editor on
-- the live project, then copy the one cell it returns into a dated .json file. See BACKUPS.md.
-- Read-only: it changes nothing.
select jsonb_build_object(
  'taken_at', now(),
  'features', (select coalesce(jsonb_agg(t), '[]') from public.features t),
  'profiles', (select coalesce(jsonb_agg(t), '[]') from public.profiles t),
  'friendships', (select coalesce(jsonb_agg(t), '[]') from public.friendships t),
  'blocks', (select coalesce(jsonb_agg(t), '[]') from public.blocks t),
  'alliances', (select coalesce(jsonb_agg(t), '[]') from public.alliances t),
  'alliance_members', (select coalesce(jsonb_agg(t), '[]') from public.alliance_members t),
  'alliance_invites', (select coalesce(jsonb_agg(t), '[]') from public.alliance_invites t),
  'alliance_requests', (select coalesce(jsonb_agg(t), '[]') from public.alliance_requests t),
  'alliance_featured', (select coalesce(jsonb_agg(t), '[]') from private.alliance_featured t),
  'market_listings', (select coalesce(jsonb_agg(t), '[]') from public.market_listings t),
  'market_trades', (select coalesce(jsonb_agg(t), '[]') from public.market_trades t),
  'reports', (select coalesce(jsonb_agg(t), '[]') from private.reports t),
  'notices', (select coalesce(jsonb_agg(t), '[]') from private.notices t),
  'suspensions', (select coalesce(jsonb_agg(t), '[]') from private.suspensions t),
  'admins', (select coalesce(jsonb_agg(t), '[]') from private.admins t),
  'admin_log', (select coalesce(jsonb_agg(t), '[]') from private.admin_log t)
) as backup;
