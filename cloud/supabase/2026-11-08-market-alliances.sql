-- The marketplace only works inside an alliance (2026-11-08).
-- Needs 2026-11-07-market.sql and 2026-11-07-alliances.sql. Run on the build project first, then live.
--
-- * Listing needs the airline to be in an alliance (answers no_alliance).
-- * Browsing shows only listings from airlines in the same alliance (none without one).
-- * Buying needs the seller to be in the buyer's alliance right now (answers not_ally).
-- * When an airline leaves an alliance (leaves, is removed, or the alliance ends), its open listings
--   are taken down, so its game takes the aircraft back, as with Take down.
-- * Open listings from airlines not in an alliance are taken down now, for the same reason.

/** The alliance an airline is in, or null. */
create or replace function private.market_alliance(p_air uuid) returns uuid
  language sql stable security definer set search_path = ''
as $$ select alliance from public.alliance_members where airline = p_air $$;
revoke all on function private.market_alliance(uuid) from public, anon, authenticated;

create or replace function public.market_list(p_channel text, p_me uuid, p_id uuid, p_model text, p_cabin jsonb, p_tail text, p_price bigint)
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
  if private.market_alliance(p_me) is null then return 'no_alliance'; end if;
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

/**
 * Aircraft for sale to this airline: from airlines in its own alliance, its mode, not its own
 * player's, not from anyone either has blocked. Filters: types (ids), most it'll pay (p_alliance is
 * kept for older games and ignored). Sort: new, cheap, dear. Up to 60.
 */
create or replace function public.market_browse(p_channel text, p_me uuid, p_models text[], p_max bigint, p_alliance uuid, p_sort text)
  returns jsonb language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.cloud_gate(); ch text := private.cloud_ch(p_channel); me public.profiles := private.my_airline(uid, ch, p_me);
  mine uuid := private.market_alliance(p_me);
begin
  if private.market_gate(uid, ch) = 'off' or me.public_id is null then return null; end if;
  if mine is null then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', x.id, 'model', x.model, 'cabin', x.cabin, 'price', x.price, 'createdAt', x.created_at, 'seller', private.market_seller(x.seller, ch))
      order by case when p_sort = 'cheap' then x.price end, case when p_sort = 'dear' then x.price end desc, x.created_at desc)
    from (
      select l.* from public.market_listings l
      join public.alliance_members m on m.airline = l.seller and m.alliance = mine
      where l.channel = ch and l.mode = me.mode and l.status = 'open' and l.created_at > now() - interval '30 days'
        and l.seller_user <> uid
        and not private.blocked_between(uid, l.seller_user, ch)
        and (p_models is null or cardinality(p_models) = 0 or l.model = any(p_models))
        and (p_max is null or l.price <= p_max)
      order by case when p_sort = 'cheap' then l.price end, case when p_sort = 'dear' then l.price end desc, l.created_at desc
      limit 60
    ) x), '[]'::jsonb);
end $$;

/**
 * Buys a listed aircraft for this airline, from an airline in its alliance. The trade is recorded at
 * once; the buyer's game then adds the aircraft and takes the money, and the seller's game is paid
 * when it next checks. Answers {result, trade?}: bought, off, suspended, too_new, share_first, gone,
 * own, other_mode, not_ally, too_many_today.
 */
create or replace function public.market_buy(p_channel text, p_me uuid, p_id uuid)
  returns jsonb language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.cloud_gate(); ch text := private.cloud_ch(p_channel); me public.profiles := private.my_airline(uid, ch, p_me);
  g text := private.market_gate(uid, ch); l public.market_listings; t public.market_trades; mine uuid := private.market_alliance(p_me);
begin
  if g <> 'ok' then return jsonb_build_object('result', g); end if;
  if me.public_id is null then return jsonb_build_object('result', 'share_first'); end if;
  select * into l from public.market_listings where id = p_id and channel = ch for update;
  if l.id is null or l.status <> 'open' or l.created_at <= now() - interval '30 days' or private.blocked_between(uid, l.seller_user, ch) then return jsonb_build_object('result', 'gone'); end if;
  if l.seller_user = uid then return jsonb_build_object('result', 'own'); end if;
  if l.mode <> me.mode then return jsonb_build_object('result', 'other_mode'); end if;
  if mine is null or private.market_alliance(l.seller) is distinct from mine then return jsonb_build_object('result', 'not_ally'); end if;
  if not private.market_count_up(uid, ch, 'buys', 10) then return jsonb_build_object('result', 'too_many_today'); end if;
  update public.market_listings set status = 'sold', closed_at = now() where id = l.id;
  insert into public.market_trades (listing, channel, mode, model, cabin, tail, price, seller, seller_user, seller_save, seller_label, buyer, buyer_user, buyer_save, buyer_label)
  values (l.id, ch, l.mode, l.model, l.cabin, l.tail, l.price, l.seller, l.seller_user, l.seller_save, l.seller_label, p_me, uid, me.save_id, me.airline)
  returning * into t;
  return jsonb_build_object('result', 'bought', 'trade', jsonb_build_object('id', t.id, 'model', t.model, 'cabin', t.cabin, 'price', t.price, 'from', t.seller_label));
end $$;

/** An airline out of its alliance can't sell to it any more: its open listings come down. */
create or replace function private.market_left_alliance() returns trigger
  language plpgsql security definer set search_path = ''
as $$
begin
  update public.market_listings set status = 'cancelled', closed_at = now() where seller = old.airline and status = 'open';
  return old;
end $$;
revoke all on function private.market_left_alliance() from public, anon, authenticated;

drop trigger if exists market_left_alliance on public.alliance_members;
create trigger market_left_alliance after delete on public.alliance_members
  for each row execute function private.market_left_alliance();

-- Listings from airlines that aren't in an alliance come down now
update public.market_listings l set status = 'cancelled', closed_at = now()
where l.status = 'open' and not exists (select 1 from public.alliance_members m where m.airline = l.seller);
