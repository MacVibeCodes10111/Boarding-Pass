-- Feature flags for online features (Update A, phase A0).
-- Additive: touches nothing that exists. One row per channel and feature; a
-- missing row means off. Signed-in players can read the flags and nobody can
-- change them through the API: Mac switches them in the Supabase dashboard.
create table public.features (
  channel text not null check (channel in ('main', 'dev')),
  feature text not null,
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (channel, feature)
);

alter table public.features enable row level security;
revoke all on public.features from anon, authenticated;
grant select on public.features to authenticated;
create policy "signed-in players read flags" on public.features for select to authenticated using (true);

-- For the server functions of each feature: they refuse when it's off, whatever the game shows.
create function private.feature_on(ch text, f text) returns boolean
  language sql stable set search_path = ''
as $$ select coalesce((select enabled from public.features where channel = ch and feature = f), false) $$;
revoke all on function private.feature_on(text, text) from public, anon, authenticated;

-- Everything off, except the Online section in dev builds and on the test site.
insert into public.features (channel, feature, enabled)
select c, f, (c = 'dev' and f = 'online')
from unnest(array['main', 'dev']) c,
     unnest(array['online', 'profiles', 'logos', 'friends', 'friends_map', 'alliances', 'reports', 'marketplace']) f;
