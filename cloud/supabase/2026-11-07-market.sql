-- ============================================================================
-- THE MARKETPLACE (Update B: used aircraft). Needs 2026-11-07-airlines.sql,
-- 2026-11-07-alliances.sql and 2026-11-07-admin.sql first, then
-- market-prices.sql (made from the game's catalog) straight after this.
--
--   Game money only. A shared airline lists an owned aircraft; another
--   airline of the same mode (Career or Sandbox, two separate markets) buys
--   it. The server is the record: each career's game applies what happened
--   (aircraft out on listing, money in on sale, aircraft and bill on purchase,
--   aircraft back when a listing ends unsold) and then claims it here, once.
--   The game also remembers what it applied, so a lost answer or a crash
--   can't apply anything twice.
--
--   Escrow: the aircraft leaves the seller's fleet as soon as the listing is
--   confirmed, and comes back only if the listing ends unsold (cancelled,
--   30 days old, removed by a moderator, or the airline stopped sharing).
--
--   Prices must be 40% to 120% of the game's resale value for the type (75%
--   of list), so money can't be moved between a player's own airlines cheaply.
--   Nobody can buy from their own airlines. Limits: 10 listings open per
--   airline, 20 new listings and 10 purchases a day per player, and on the
--   real game an account must be 7 days old to trade.
--
--   Trade records (the airlines, the aircraft type, the price and when) are
--   kept 12 months for moderation. A closed account's name in them becomes a
--   placeholder. Admins can reverse a trade: each side's game applies it.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
/** List prices from the game's catalog (market-prices.sql). */
create table private.market_models (
  id text primary key,
  price bigint not null check (price > 0)
);

create table public.market_listings (
  -- Made by the game, so asking again after a lost answer can't list twice
  id uuid primary key,
  channel text not null check (channel in ('main', 'dev')),
  mode text not null check (mode in ('career', 'sandbox')),
  seller uuid not null,
  seller_user uuid not null references auth.users (id) on delete cascade,
  seller_save text not null,
  seller_label text not null,
  model text not null,
  cabin jsonb not null,
  tail text not null,
  price bigint not null check (price > 0),
  status text not null default 'open' check (status in ('open', 'sold', 'cancelled', 'expired', 'removed', 'withdrawn')),
  -- When the seller's game took the aircraft back after an unsold end
  returned_at timestamptz,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create index market_listings_open on public.market_listings (channel, mode, created_at desc) where status = 'open';
create index market_listings_seller on public.market_listings (seller_user, seller_save);
create index market_listings_airline on public.market_listings (seller) where status = 'open';

create table public.market_trades (
  id uuid primary key default gen_random_uuid(),
  listing uuid not null,
  channel text not null,
  mode text not null,
  model text not null,
  cabin jsonb not null,
  tail text not null,
  price bigint not null,
  seller uuid,
  seller_user uuid references auth.users (id) on delete set null,
  seller_save text not null,
  seller_label text not null,
  buyer uuid,
  buyer_user uuid references auth.users (id) on delete set null,
  buyer_save text not null,
  buyer_label text not null,
  at timestamptz not null default now(),
  seller_claimed_at timestamptz,
  buyer_claimed_at timestamptz,
  reversed_at timestamptz,
  reversed_reason text,
  seller_reversal_at timestamptz,
  buyer_reversal_at timestamptz
);
create index market_trades_seller on public.market_trades (seller_user, seller_save, at desc);
create index market_trades_buyer on public.market_trades (buyer_user, buyer_save, at desc);
create index market_trades_at on public.market_trades (channel, at desc);

create table private.market_meter (
  user_id uuid not null,
  channel text not null,
  day date not null default current_date,
  lists int not null default 0,
  buys int not null default 0,
  primary key (user_id, channel, day)
);

alter table private.market_models enable row level security;
alter table public.market_listings enable row level security;
alter table public.market_trades enable row level security;
alter table private.market_meter enable row level security;
revoke all on private.market_models, private.market_meter from public, anon, authenticated;
revoke all on public.market_listings, public.market_trades from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
/** The allowed price range for a type: 40% to 120% of its resale value (75% of list). Nulls if it isn't a known type. */
create function private.market_band(p_model text, out lo bigint, out hi bigint)
  language sql stable security definer set search_path = ''
as $$
  select ceil(round(price * 3 / 4.0) * 2 / 5.0)::bigint, floor(round(price * 3 / 4.0) * 6 / 5.0)::bigint
  from private.market_models where id = p_model
$$;

/** Whether this player may trade now: 'ok', 'off', 'suspended' or 'too_new'. */
create function private.market_gate(uid uuid, ch text) returns text
  language sql stable security definer set search_path = ''
as $$
  select case
    when not private.feature_on(ch, 'marketplace') then 'off'
    when private.suspended(uid) then 'suspended'
    when ch = 'main' and (select created_at from auth.users where id = uid) > now() - interval '7 days' then 'too_new'
    else 'ok' end
$$;

/** Counts a listing or a purchase towards today's limit. False when it's reached. */
create function private.market_count_up(uid uuid, ch text, what text, lim int) returns boolean
  language plpgsql security definer set search_path = ''
as $$
declare n int;
begin
  insert into private.market_meter (user_id, channel) values (uid, ch) on conflict do nothing;
  select case when what = 'lists' then lists else buys end into n from private.market_meter where user_id = uid and channel = ch and day = current_date for update;
  if n >= lim then return false; end if;
  update private.market_meter set lists = lists + (what = 'lists')::int, buys = buys + (what = 'buys')::int where user_id = uid and channel = ch and day = current_date;
  return true;
end $$;

/** A cabin: the eight numbers the game uses, each a sensible size. */
create function private.market_cabin_ok(c jsonb) returns boolean
  language sql immutable set search_path = ''
as $$
  select jsonb_typeof(c) = 'object'
    and (select count(*) from jsonb_object_keys(c)) = 8
    and (select bool_and(k = any(array['econSeats','premSeats','busSeats','firstSeats','econPitchIn','premPitchIn','busPitchIn','firstPitchIn'])
           and jsonb_typeof(c->k) = 'number' and (c->>k)::numeric between 0 and 1000) from jsonb_object_keys(c) k)
$$;

/** What buyers see of a seller: its name, code, colours, logo and alliance. */
create function private.market_seller(p_air uuid, ch text) returns jsonb
  language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('id', p.public_id, 'airline', p.airline, 'code', p.code, 'colours', p.colours, 'badge', p.liveries->0->>'badge',
    'alliance', (select private.alliance_card(m.alliance) from public.alliance_members m where m.airline = p.public_id))
  from public.profiles p where p.public_id = p_air and p.channel = ch
$$;

/** A closed account's airline in a trade record becomes a placeholder. */
create function private.market_trade_forget() returns trigger
  language plpgsql security definer set search_path = ''
as $$
begin
  if new.seller_user is null and old.seller_user is not null then new.seller_label := 'A closed account'; new.seller := null; new.seller_save := ''; end if;
  if new.buyer_user is null and old.buyer_user is not null then new.buyer_label := 'A closed account'; new.buyer := null; new.buyer_save := ''; end if;
  return new;
end $$;
create trigger market_trade_forget before update on public.market_trades for each row execute function private.market_trade_forget();

/** An airline that stops sharing or changes mode takes its open listings off; its game takes the aircraft back. */
create function private.market_airline_gone() returns trigger
  language plpgsql security definer set search_path = ''
as $$
begin
  update public.market_listings set status = 'withdrawn', closed_at = now() where seller = old.public_id and status = 'open';
  return null;
end $$;
create trigger market_airline_gone after delete on public.profiles for each row execute function private.market_airline_gone();
create trigger market_airline_mode after update of mode on public.profiles for each row when (old.mode is distinct from new.mode) execute function private.market_airline_gone();

revoke all on function private.market_band(text), private.market_gate(uuid, text), private.market_count_up(uuid, text, text, int),
  private.market_cabin_ok(jsonb), private.market_seller(uuid, text), private.market_trade_forget(), private.market_airline_gone() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Selling
-- ---------------------------------------------------------------------------
/**
 * Lists one of this airline's owned aircraft. The game removes it from the fleet once this answers
 * 'listed' (asking again with the same id answers 'listed' again). Answers: listed, off, suspended,
 * too_new, share_first, bad, bad_price, already, too_many, too_many_today, taken.
 */
create function public.market_list(p_channel text, p_me uuid, p_id uuid, p_model text, p_cabin jsonb, p_tail text, p_price bigint)
  returns text language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.cloud_gate(); ch text := private.cloud_ch(p_channel); me public.profiles := private.my_airline(uid, ch, p_me);
  g text := private.market_gate(uid, ch); b record; old public.market_listings;
begin
  if g <> 'ok' then return g; end if;
  if me.public_id is null then return 'share_first'; end if;
  if p_id is null or p_tail is null or p_tail !~ '^[A-Z0-9-]{2,10}$' or not private.market_cabin_ok(p_cabin) then return 'bad'; end if;
  select * into old from public.market_listings where id = p_id;
  if old.id is not null then return case when old.seller_user = uid and old.seller = p_me then 'listed' else 'taken' end; end if;
  select * into b from private.market_band(p_model);
  if b.lo is null then return 'bad'; end if;
  if p_price is null or p_price < b.lo or p_price > b.hi then return 'bad_price'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_me::text, 82));
  if exists (select 1 from public.market_listings where seller = p_me and seller_save = me.save_id and tail = p_tail and status = 'open') then return 'already'; end if;
  if (select count(*) from public.market_listings where seller = p_me and status = 'open') >= 10 then return 'too_many'; end if;
  if not private.market_count_up(uid, ch, 'lists', 20) then return 'too_many_today'; end if;
  insert into public.market_listings (id, channel, mode, seller, seller_user, seller_save, seller_label, model, cabin, tail, price)
  values (p_id, ch, me.mode, p_me, uid, me.save_id, me.airline, p_model, p_cabin, p_tail, p_price);
  return 'listed';
end $$;

/** Takes a listing down; the game then takes the aircraft back. Answers: cancelled, gone (sold or already ended). */
create function public.market_cancel(p_channel text, p_save_id text, p_id uuid)
  returns text language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.cloud_gate(); ch text := private.cloud_ch(p_channel);
begin
  update public.market_listings set status = 'cancelled', closed_at = now()
  where id = p_id and channel = ch and seller_user = uid and seller_save = p_save_id and status = 'open';
  return case when found then 'cancelled' else 'gone' end;
end $$;

-- ---------------------------------------------------------------------------
-- Buying
-- ---------------------------------------------------------------------------
/**
 * Aircraft for sale to this airline: its mode, not its own player's, not from anyone either has
 * blocked. Filters: types (ids), most it'll pay, the seller's alliance. Sort: new, cheap, dear.
 * Up to 60.
 */
create function public.market_browse(p_channel text, p_me uuid, p_models text[], p_max bigint, p_alliance uuid, p_sort text)
  returns jsonb language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.cloud_gate(); ch text := private.cloud_ch(p_channel); me public.profiles := private.my_airline(uid, ch, p_me);
begin
  if private.market_gate(uid, ch) = 'off' or me.public_id is null then return null; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', x.id, 'model', x.model, 'cabin', x.cabin, 'price', x.price, 'createdAt', x.created_at, 'seller', private.market_seller(x.seller, ch))
      order by case when p_sort = 'cheap' then x.price end, case when p_sort = 'dear' then x.price end desc, x.created_at desc)
    from (
      select l.* from public.market_listings l
      where l.channel = ch and l.mode = me.mode and l.status = 'open' and l.created_at > now() - interval '30 days'
        and l.seller_user <> uid
        and not private.blocked_between(uid, l.seller_user, ch)
        and (p_models is null or cardinality(p_models) = 0 or l.model = any(p_models))
        and (p_max is null or l.price <= p_max)
        and (p_alliance is null or exists (select 1 from public.alliance_members m where m.airline = l.seller and m.alliance = p_alliance))
      order by case when p_sort = 'cheap' then l.price end, case when p_sort = 'dear' then l.price end desc, l.created_at desc
      limit 60
    ) x), '[]'::jsonb);
end $$;

/**
 * Buys a listed aircraft for this airline. The trade is recorded at once; the buyer's game then adds
 * the aircraft and takes the money, and the seller's game is paid when it next checks.
 * Answers {result, trade?}: bought, off, suspended, too_new, share_first, gone, own, other_mode, too_many_today.
 */
create function public.market_buy(p_channel text, p_me uuid, p_id uuid)
  returns jsonb language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.cloud_gate(); ch text := private.cloud_ch(p_channel); me public.profiles := private.my_airline(uid, ch, p_me);
  g text := private.market_gate(uid, ch); l public.market_listings; t public.market_trades;
begin
  if g <> 'ok' then return jsonb_build_object('result', g); end if;
  if me.public_id is null then return jsonb_build_object('result', 'share_first'); end if;
  select * into l from public.market_listings where id = p_id and channel = ch for update;
  if l.id is null or l.status <> 'open' or l.created_at <= now() - interval '30 days' or private.blocked_between(uid, l.seller_user, ch) then return jsonb_build_object('result', 'gone'); end if;
  if l.seller_user = uid then return jsonb_build_object('result', 'own'); end if;
  if l.mode <> me.mode then return jsonb_build_object('result', 'other_mode'); end if;
  if not private.market_count_up(uid, ch, 'buys', 10) then return jsonb_build_object('result', 'too_many_today'); end if;
  update public.market_listings set status = 'sold', closed_at = now() where id = l.id;
  insert into public.market_trades (listing, channel, mode, model, cabin, tail, price, seller, seller_user, seller_save, seller_label, buyer, buyer_user, buyer_save, buyer_label)
  values (l.id, ch, l.mode, l.model, l.cabin, l.tail, l.price, l.seller, l.seller_user, l.seller_save, l.seller_label, p_me, uid, me.save_id, me.airline)
  returning * into t;
  return jsonb_build_object('result', 'bought', 'trade', jsonb_build_object('id', t.id, 'model', t.model, 'cabin', t.cabin, 'price', t.price, 'from', t.seller_label));
end $$;

-- ---------------------------------------------------------------------------
-- What each career's game applies
-- ---------------------------------------------------------------------------
/**
 * This career's listings (open, ended and not taken back yet, or sold in the last 30 days) and its
 * trades in the last 12 months, newest first, with what its game still has to apply.
 */
create function public.market_mine(p_channel text, p_save_id text)
  returns jsonb language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.cloud_gate(); ch text := private.cloud_ch(p_channel);
begin
  if not private.feature_on(ch, 'marketplace') then return null; end if;
  update public.market_listings set status = 'expired', closed_at = now()
  where seller_user = uid and seller_save = p_save_id and status = 'open' and created_at <= now() - interval '30 days';
  return jsonb_build_object(
    'listings', coalesce((
      select jsonb_agg(jsonb_build_object('id', l.id, 'model', l.model, 'cabin', l.cabin, 'tail', l.tail, 'price', l.price, 'status', l.status,
        'createdAt', l.created_at, 'closedAt', l.closed_at, 'returned', l.returned_at is not null) order by l.created_at desc)
      from public.market_listings l
      where l.channel = ch and l.seller_user = uid and l.seller_save = p_save_id
        and (l.status = 'open' or (l.status <> 'sold' and l.returned_at is null) or l.closed_at > now() - interval '30 days')), '[]'::jsonb),
    'trades', coalesce((
      select jsonb_agg(x.j order by x.at desc) from (
        select t.at, jsonb_build_object('id', t.id, 'listing', t.listing, 'role', case when t.seller_user = uid and t.seller_save = p_save_id then 'seller' else 'buyer' end,
          'model', t.model, 'cabin', t.cabin, 'tail', t.tail, 'price', t.price, 'at', t.at,
          'other', case when t.seller_user = uid and t.seller_save = p_save_id then t.buyer_label else t.seller_label end,
          'claimed', case when t.seller_user = uid and t.seller_save = p_save_id then t.seller_claimed_at is not null else t.buyer_claimed_at is not null end,
          'reversed', t.reversed_at is not null,
          'reversalClaimed', case when t.seller_user = uid and t.seller_save = p_save_id then t.seller_reversal_at is not null else t.buyer_reversal_at is not null end) as j
        from public.market_trades t
        where t.channel = ch and ((t.seller_user = uid and t.seller_save = p_save_id) or (t.buyer_user = uid and t.buyer_save = p_save_id))
          and t.at > now() - interval '12 months'
        order by t.at desc limit 100) x), '[]'::jsonb));
end $$;

/**
 * Marks something as applied by this career's game: r:<listing> (aircraft taken back), s:<trade>
 * (paid), b:<trade> (aircraft received), xs:<trade> / xb:<trade> (a reversal). True the first time.
 */
create function public.market_claim(p_channel text, p_save_id text, p_key text)
  returns boolean language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.cloud_gate(); ch text := private.cloud_ch(p_channel); k text := split_part(coalesce(p_key, ''), ':', 1); x uuid;
begin
  if coalesce(p_key, '') !~ '^(r|s|b|xs|xb):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  x := split_part(p_key, ':', 2)::uuid;
  if k = 'r' then
    update public.market_listings l set returned_at = now() where l.id = x and l.channel = ch and l.seller_user = uid and l.seller_save = p_save_id
      and l.status in ('cancelled', 'expired', 'removed', 'withdrawn') and l.returned_at is null;
  elsif k = 's' then
    update public.market_trades t set seller_claimed_at = now() where t.id = x and t.channel = ch and t.seller_user = uid and t.seller_save = p_save_id and t.seller_claimed_at is null;
  elsif k = 'b' then
    update public.market_trades t set buyer_claimed_at = now() where t.id = x and t.channel = ch and t.buyer_user = uid and t.buyer_save = p_save_id and t.buyer_claimed_at is null;
  elsif k = 'xs' then
    update public.market_trades t set seller_reversal_at = now() where t.id = x and t.channel = ch and t.seller_user = uid and t.seller_save = p_save_id and t.reversed_at is not null and t.seller_reversal_at is null;
  else
    update public.market_trades t set buyer_reversal_at = now() where t.id = x and t.channel = ch and t.buyer_user = uid and t.buyer_save = p_save_id and t.reversed_at is not null and t.buyer_reversal_at is null;
  end if;
  return found;
end $$;

-- ---------------------------------------------------------------------------
-- The admin site
-- ---------------------------------------------------------------------------
/**
 * Open listings and recent trades, newest first, each trade flagged when the same two players have
 * traded 3 times or more in 30 days ('pair'), or its price sits at the edge of the band ('edge').
 */
create function public.admin_market(p_channel text)
  returns jsonb language plpgsql security definer set search_path = ''
as $$
declare a private.admins := private.admin_gate(); ch text := private.cloud_ch(p_channel);
begin
  return jsonb_build_object(
    'open', (select count(*) from public.market_listings where channel = ch and status = 'open'),
    'tradesToday', (select count(*) from public.market_trades where channel = ch and at > now() - interval '1 day'),
    'listings', coalesce((
      select jsonb_agg(jsonb_build_object('id', l.id, 'mode', l.mode, 'seller', l.seller, 'sellerLabel', l.seller_label, 'model', l.model, 'tail', l.tail, 'price', l.price, 'createdAt', l.created_at) order by l.created_at desc)
      from (select * from public.market_listings where channel = ch and status = 'open' order by created_at desc limit 100) l), '[]'::jsonb),
    'trades', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'mode', t.mode, 'model', t.model, 'tail', t.tail, 'price', t.price, 'at', t.at,
        'seller', t.seller, 'sellerLabel', t.seller_label, 'buyer', t.buyer, 'buyerLabel', t.buyer_label,
        'reversedAt', t.reversed_at, 'reversedReason', t.reversed_reason,
        'lo', b.lo, 'hi', b.hi,
        'pair', (select count(*) from public.market_trades u where u.channel = ch and u.at > now() - interval '30 days'
                   and ((u.seller_user = t.seller_user and u.buyer_user = t.buyer_user) or (u.seller_user = t.buyer_user and u.buyer_user = t.seller_user))) >= 3,
        'edge', b.lo is not null and (t.price <= b.lo * 1.05 or t.price >= b.hi * 0.95)) order by t.at desc)
      from (select * from public.market_trades where channel = ch order by at desc limit 150) t
      left join lateral private.market_band(t.model) b on true), '[]'::jsonb));
end $$;

/** Reverses a trade: the buyer's game gives the aircraft back and is refunded; the seller's returns the money and gets it back. */
create function public.admin_market_reverse(p_channel text, p_trade uuid, p_reason text)
  returns text language plpgsql security definer set search_path = ''
as $$
declare a private.admins := private.admin_gate(); ch text := private.cloud_ch(p_channel); t public.market_trades;
begin
  select * into t from public.market_trades where id = p_trade and channel = ch for update;
  if t.id is null then return 'not_found'; end if;
  if t.reversed_at is not null then return 'already'; end if;
  perform private.admin_act(a, 'market_reverse', ch, 'trade', t.id::text, jsonb_build_object('price', t.price, 'model', t.model, 'seller', t.seller_label, 'buyer', t.buyer_label), null, p_reason);
  update public.market_trades set reversed_at = now(), reversed_reason = btrim(p_reason) where id = t.id;
  perform private.notify(t.seller_user, ch, t.seller, format('A marketplace sale (%s) was reversed by a moderator. The aircraft comes back to %s and the money goes back to the buyer.', t.tail, t.seller_label));
  perform private.notify(t.buyer_user, ch, t.buyer, format('A marketplace purchase (%s) was reversed by a moderator. The aircraft goes back to its seller and %s gets the money back.', t.tail, t.buyer_label));
  return 'ok';
end $$;

/** Takes an open listing down; the seller's game takes the aircraft back. */
create function public.admin_market_remove(p_channel text, p_listing uuid, p_reason text)
  returns text language plpgsql security definer set search_path = ''
as $$
declare a private.admins := private.admin_gate(); ch text := private.cloud_ch(p_channel); l public.market_listings;
begin
  select * into l from public.market_listings where id = p_listing and channel = ch for update;
  if l.id is null then return 'not_found'; end if;
  if l.status <> 'open' then return 'already'; end if;
  perform private.admin_act(a, 'market_remove', ch, 'listing', l.id::text, jsonb_build_object('price', l.price, 'model', l.model, 'tail', l.tail, 'seller', l.seller_label), null, p_reason);
  update public.market_listings set status = 'removed', closed_at = now() where id = l.id;
  perform private.notify(l.seller_user, ch, l.seller, format('Your marketplace listing for %s was taken down by a moderator. The aircraft is back in %s''s fleet.', l.tail, l.seller_label));
  return 'ok';
end $$;

-- ---------------------------------------------------------------------------
-- Nightly: old listings end, records go after 12 months
-- ---------------------------------------------------------------------------
create function private.market_cleanup() returns void
  language plpgsql security definer set search_path = ''
as $$
begin
  update public.market_listings set status = 'expired', closed_at = now() where status = 'open' and created_at <= now() - interval '30 days';
  delete from public.market_listings where closed_at < now() - interval '90 days' and (status = 'sold' or returned_at is not null);
  delete from public.market_listings where closed_at < now() - interval '12 months';
  delete from public.market_trades where at < now() - interval '12 months';
  delete from private.market_meter where day < current_date - 7;
end $$;
revoke all on function private.market_cleanup() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('bp-market-cleanup', '53 4 * * *', 'select private.market_cleanup()');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------
revoke all on function public.market_list(text, uuid, uuid, text, jsonb, text, bigint), public.market_cancel(text, text, uuid),
  public.market_browse(text, uuid, text[], bigint, uuid, text), public.market_buy(text, uuid, uuid), public.market_mine(text, text),
  public.market_claim(text, text, text), public.admin_market(text), public.admin_market_reverse(text, uuid, text),
  public.admin_market_remove(text, uuid, text) from public, anon;
grant execute on function public.market_list(text, uuid, uuid, text, jsonb, text, bigint), public.market_cancel(text, text, uuid),
  public.market_browse(text, uuid, text[], bigint, uuid, text), public.market_buy(text, uuid, uuid), public.market_mine(text, text),
  public.market_claim(text, text, text), public.admin_market(text), public.admin_market_reverse(text, uuid, text),
  public.admin_market_remove(text, uuid, text) to authenticated;
