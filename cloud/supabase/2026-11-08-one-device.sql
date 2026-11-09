-- One device at a time (v3.0.2).
--
-- An account can be signed in on one device at once. Every player call passes
-- private.cloud_gate(), so the rule lives there: the active session is the one
-- signed in most recently. A newer sign-in takes over on its first call; an
-- older one is refused with code P0410, and the game then signs out on that
-- device (its careers stay on it). A session that signed out or expired stops
-- counting, so the next device to call takes over.
--
-- The admin site never calls cloud_gate, so signing in there doesn't sign a
-- moderator out of the game.

create table if not exists private.active_sessions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  session_id uuid not null,
  since timestamptz not null default now()
);
alter table private.active_sessions enable row level security;
revoke all on private.active_sessions from public, anon, authenticated;

create or replace function private.cloud_gate()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  sid uuid;
  cur uuid;
  cur_made timestamptz;
  my_made timestamptz;
begin
  if uid is null then raise exception 'Not signed in'; end if;
  begin
    sid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when others then
    sid := null;
  end;
  if sid is not null then
    select a.session_id, s.created_at into cur, cur_made
      from private.active_sessions a left join auth.sessions s on s.id = a.session_id
      where a.user_id = uid;
    if cur is distinct from sid then
      select s.created_at into my_made from auth.sessions s where s.id = sid;
      if cur is null or cur_made is null or (my_made is not null and my_made >= cur_made) then
        insert into private.active_sessions(user_id, session_id) values (uid, sid)
          on conflict (user_id) do update set session_id = excluded.session_id, since = now();
      else
        raise exception 'You signed in on another device, so you were signed out here.' using errcode = 'P0410';
      end if;
    end if;
  end if;
  if not private.cloud_meter(uid, 'call', 0) then
    raise exception 'Too many syncs right now. Try again later.' using errcode = 'P0429';
  end if;
  return uid;
end $$;
