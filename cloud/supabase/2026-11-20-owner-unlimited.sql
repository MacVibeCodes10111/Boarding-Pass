-- 2026-11-20: the owner's account has no per-account limits (Mac asked: "unlimit my account").
-- Everyone else keeps theirs, and the whole-project daily caps (which keep us in the free
-- tier) still count the owner too. Usage is still counted, so it shows up as before.
-- Also for everyone (Mac's OK the same day): calls 1200 an hour / 12000 a day (were 600 / 4000:
-- a long day's play could reach 4000), uploads 240 / 2000 (were 120 / 1000). Downloads unchanged.
create or replace function private.cloud_meter(uid uuid, kind text, bytes bigint)
 returns boolean
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  whole constant uuid := '00000000-0000-0000-0000-000000000000';
  hour_start timestamptz := date_trunc('hour', now());
  day_start timestamptz := date_trunc('day', now());
  u_h private.cloud_usage%rowtype; u_d private.cloud_usage%rowtype; g_d private.cloud_usage%rowtype;
  free boolean := exists (select 1 from private.admins a where a.user_id = uid and a.role = 'owner');
begin
  insert into private.cloud_usage(user_id, period, period_start) values (uid, 'h', hour_start), (uid, 'd', day_start), (whole, 'd', day_start)
    on conflict (user_id, period) do nothing;
  update private.cloud_usage set period_start = hour_start, pushes = 0, pulls = 0, pull_bytes = 0, calls = 0
    where user_id = uid and period = 'h' and period_start < hour_start;
  update private.cloud_usage set period_start = day_start, pushes = 0, pulls = 0, pull_bytes = 0, calls = 0
    where period = 'd' and user_id in (uid, whole) and period_start < day_start;
  select * into u_h from private.cloud_usage where user_id = uid and period = 'h' for update;
  select * into u_d from private.cloud_usage where user_id = uid and period = 'd' for update;
  select * into g_d from private.cloud_usage where user_id = whole and period = 'd' for update;
  if kind = 'call' then
    if (not free and (u_h.calls >= 1200 or u_d.calls >= 12000)) or g_d.calls >= 300000 then return false; end if;
    update private.cloud_usage set calls = calls + 1 where user_id in (uid, whole) and period in ('h', 'd');
  elsif kind = 'push' then
    if not free and (u_h.pushes >= 240 or u_d.pushes >= 2000) then return false; end if;
    update private.cloud_usage set pushes = pushes + 1 where user_id = uid and period in ('h', 'd');
  else
    if (not free and (u_h.pulls >= 120 or u_d.pulls >= 1500
          or u_h.pull_bytes + bytes > 25 * 1024 * 1024
          or u_d.pull_bytes + bytes > 60 * 1024 * 1024))
       or g_d.pull_bytes + bytes > 120 * 1024 * 1024 then
      return false;
    end if;
    update private.cloud_usage set pulls = pulls + 1, pull_bytes = pull_bytes + bytes where user_id = uid and period in ('h', 'd');
    update private.cloud_usage set pull_bytes = pull_bytes + bytes where user_id = whole and period = 'd';
  end if;
  return true;
end $function$;
