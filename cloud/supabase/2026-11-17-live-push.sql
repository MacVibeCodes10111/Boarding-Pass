-- Live updates to players (2026-11-17). When the owner gives or takes cash,
-- removes a career from the cloud, or a moderator sends a notice, the server
-- tells that player's game straight away (Supabase Realtime, private channel
-- "player:<their id>"), and the game fetches the change itself through the
-- usual checked functions. The events carry no personal details: only what
-- kind of change, which channel and which career.
--
-- Players can listen only on their own channel and can't send anything (no
-- insert policy). If the push fails, the admin action still goes through and
-- the game's regular checks pick the change up a little later.

create policy "players hear their own channel" on realtime.messages
  for select to authenticated
  using (realtime.topic() = 'player:' || (select auth.uid())::text and extension = 'broadcast');

create function private.push_player(uid uuid, ch text, kind text, save_id text) returns void
  language plpgsql security definer set search_path = ''
as $$
begin
  if uid is null then return; end if;
  perform realtime.send(jsonb_build_object('kind', kind, 'channel', ch, 'saveId', save_id), kind, 'player:' || uid::text, true);
exception when others then
  null; -- never block the change itself
end $$;
revoke all on function private.push_player(uuid, text, text, text) from public, anon, authenticated;

create function private.push_grant() returns trigger
  language plpgsql security definer set search_path = ''
as $$ begin perform private.push_player(new.user_id, new.channel, 'grant', new.save_id); return new; end $$;
create trigger push_grant after insert on private.grants for each row execute function private.push_grant();

create function private.push_removed() returns trigger
  language plpgsql security definer set search_path = ''
as $$ begin perform private.push_player(new.user_id, new.channel, 'removed', new.save_id); return new; end $$;
create trigger push_removed after insert on private.cloud_removed for each row execute function private.push_removed();

create function private.push_notice() returns trigger
  language plpgsql security definer set search_path = ''
as $$ begin perform private.push_player(new.user_id, new.channel, 'notice', null); return new; end $$;
create trigger push_notice after insert on private.notices for each row execute function private.push_notice();

revoke all on function private.push_grant(), private.push_removed(), private.push_notice() from public, anon, authenticated;
