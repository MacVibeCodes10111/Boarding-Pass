// ============================================================================
// THE MARKETPLACE (Update B: used aircraft)
//   Game money only. The server (cloud/supabase/2026-11-07-market.sql) is the
//   record of every listing and trade; each career's game applies what
//   happened to its own save and then claims it, once:
//     l:<listing>  the aircraft left the fleet when it was listed (no claim)
//     r:<listing>  it came back after the listing ended unsold
//     s:<trade>    the sale's money came in
//     b:<trade>    a bought aircraft arrived and was paid for
//     xs:<trade>   a moderator reversed a sale: money out, aircraft back
//     xb:<trade>   a moderator reversed a purchase: aircraft out, money back
//   The save keeps the keys it applied (`market.applied`), so a lost answer,
//   a crash or a replay can't apply anything twice; the server's claim stops
//   it showing up again. Everything from the server is checked first.
// ============================================================================
import { AIRCRAFT_BY_ID } from './aircraftCatalog';
import { cloudRpc } from './cloud';
import { calculateCabinUsage, getDefaultCabinForModel } from './economics';
import { normaliseAllianceBadge, type AllianceBadge } from './friends';
import { calcAircraftResaleUsd } from './tiers';
import { withApplied, type MarketSave } from './marketSave';
import type { AircraftModel, CabinConfig, PlayerAircraft } from './types';

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX = /^#[0-9a-fA-F]{6}$/;
const HASH = /^[0-9a-f]{64}$/;
const TAIL = /^[A-Z0-9-]{2,10}$/;
export { MAX_APPLIED, normaliseMarket, withApplied, type MarketSave } from './marketSave';
export const MAX_LISTINGS = 10;
export const LISTING_DAYS = 30;

const list = (x: unknown): Record<string, unknown>[] => (Array.isArray(x) ? x.filter((v) => v && typeof v === 'object') : []);
const when = (x: unknown) => (typeof x === 'string' && !Number.isNaN(Date.parse(x)) ? x : '');
const short = (x: unknown, n: number) => (typeof x === 'string' ? x.slice(0, n) : '');
const money = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x > 0 && x < 1e12 ? Math.round(x) : null);

// ---------------------------------------------------------------------------
// Prices: 40% to 120% of the game's resale value (75% of list). The server checks the same.
// ---------------------------------------------------------------------------
export function priceBand(model: AircraftModel): { value: number; min: number; max: number } {
  const value = calcAircraftResaleUsd(model);
  return { value, min: Math.ceil((value * 2) / 5), max: Math.floor((value * 6) / 5) };
}
/** A price picked on a slider, kept inside the band and to the nearest $10,000 where it can be. */
export function clampPrice(model: AircraftModel, price: number): number {
  const { min, max } = priceBand(model);
  const r = Math.round(price / 10_000) * 10_000;
  return Math.max(min, Math.min(max, Number.isFinite(r) ? r : min));
}

/** A cabin from the server, if it fits the type; otherwise the type's usual one. */
export function marketCabin(model: AircraftModel, x: unknown): CabinConfig {
  const o = (x ?? {}) as Record<string, unknown>;
  const keys = ['econSeats', 'premSeats', 'busSeats', 'firstSeats', 'econPitchIn', 'premPitchIn', 'busPitchIn', 'firstPitchIn'] as const;
  if (keys.some((k) => typeof o[k] !== 'number' || !Number.isFinite(o[k]) || (o[k] as number) < 0 || (o[k] as number) > 1000)) return getDefaultCabinForModel(model);
  const cabin = Object.fromEntries(keys.map((k) => [k, Math.round(o[k] as number)])) as unknown as CabinConfig;
  return calculateCabinUsage(model, cabin).isValid ? cabin : getDefaultCabinForModel(model);
}
export const cabinSeats = (c: CabinConfig) => c.econSeats + c.premSeats + c.busSeats + c.firstSeats;

// ---------------------------------------------------------------------------
// What the server sends
// ---------------------------------------------------------------------------
export type ListingStatus = 'open' | 'sold' | 'cancelled' | 'expired' | 'removed' | 'withdrawn';
export interface MyListing {
  id: string;
  model: string;
  cabin: unknown;
  tail: string;
  price: number;
  status: ListingStatus;
  createdAt: string;
  closedAt: string;
  returned: boolean;
}
export interface MyTrade {
  id: string;
  listing: string;
  role: 'seller' | 'buyer';
  model: string;
  cabin: unknown;
  tail: string;
  price: number;
  at: string;
  /** The other airline's name when it happened. */
  other: string;
  claimed: boolean;
  reversed: boolean;
  reversalClaimed: boolean;
}
export interface MarketMine {
  listings: MyListing[];
  trades: MyTrade[];
}
const STATUSES: ListingStatus[] = ['open', 'sold', 'cancelled', 'expired', 'removed', 'withdrawn'];

export function normaliseMarketMine(x: unknown): MarketMine | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const listings: MyListing[] = [];
  for (const l of list(o.listings).slice(0, 200)) {
    const price = money(l.price);
    if (typeof l.id !== 'string' || !ID.test(l.id) || !AIRCRAFT_BY_ID.has(String(l.model)) || !TAIL.test(String(l.tail)) || price === null) continue;
    listings.push({
      id: l.id,
      model: String(l.model),
      cabin: l.cabin,
      tail: String(l.tail),
      price,
      status: STATUSES.includes(l.status as ListingStatus) ? (l.status as ListingStatus) : 'open',
      createdAt: when(l.createdAt),
      closedAt: when(l.closedAt),
      returned: l.returned === true,
    });
  }
  const trades: MyTrade[] = [];
  for (const t of list(o.trades).slice(0, 200)) {
    const price = money(t.price);
    if (typeof t.id !== 'string' || !ID.test(t.id) || !AIRCRAFT_BY_ID.has(String(t.model)) || price === null) continue;
    trades.push({
      id: t.id,
      listing: typeof t.listing === 'string' && ID.test(t.listing) ? t.listing : '',
      role: t.role === 'seller' ? 'seller' : 'buyer',
      model: String(t.model),
      cabin: t.cabin,
      tail: TAIL.test(String(t.tail)) ? String(t.tail) : '',
      price,
      at: when(t.at),
      other: short(t.other, 40) || 'Another airline',
      claimed: t.claimed === true,
      reversed: t.reversed === true,
      reversalClaimed: t.reversalClaimed === true,
    });
  }
  return { listings, trades };
}

export interface MarketSeller {
  id: string;
  airline: string;
  code: string;
  colours: { a: string; b: string };
  badge: string | null;
  alliance: AllianceBadge | null;
}
export interface MarketOffer {
  id: string;
  model: AircraftModel;
  cabin: CabinConfig;
  price: number;
  createdAt: string;
  seller: MarketSeller | null;
}
export function normaliseOffers(x: unknown): MarketOffer[] {
  const out: MarketOffer[] = [];
  for (const o of list(x).slice(0, 100)) {
    const model = AIRCRAFT_BY_ID.get(String(o.model));
    const price = money(o.price);
    if (typeof o.id !== 'string' || !ID.test(o.id) || !model || price === null) continue;
    const s = (o.seller ?? null) as Record<string, unknown> | null;
    const col = (s?.colours ?? {}) as Record<string, unknown>;
    out.push({
      id: o.id,
      model,
      cabin: marketCabin(model, o.cabin),
      price,
      createdAt: when(o.createdAt),
      seller:
        s && typeof s.id === 'string' && ID.test(s.id) && short(s.airline, 40)
          ? {
              id: s.id,
              airline: short(s.airline, 40),
              code: short(s.code, 3),
              colours: { a: HEX.test(String(col.a)) ? String(col.a) : '#475569', b: HEX.test(String(col.b)) ? String(col.b) : '#94a3b8' },
              badge: HASH.test(String(s.badge)) ? String(s.badge) : null,
              alliance: normaliseAllianceBadge(s.alliance),
            }
          : null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Working out what a career still has to apply
// ---------------------------------------------------------------------------
export type MarketAction =
  | { kind: 'escrow'; key: string; tail: string; model: string }
  | { kind: 'return'; key: string; tail: string; model: string; cabin: unknown }
  | { kind: 'sold'; key: string; tail: string; model: string; price: number; other: string }
  | { kind: 'bought'; key: string; trade: string; model: string; cabin: unknown; price: number; other: string }
  | { kind: 'unsell'; key: string; tail: string; model: string; cabin: unknown; price: number }
  | { kind: 'unbuy'; key: string; trade: string; model: string; price: number };

/**
 * Everything the server says happened that this save hasn't applied yet, in the order to apply it,
 * and the keys it has applied but the server hasn't heard about (to claim again).
 */
export function marketActions(mine: MarketMine, save: MarketSave): { apply: MarketAction[]; claim: string[] } {
  const done = new Set(save.applied);
  const apply: MarketAction[] = [];
  const claim: string[] = [];
  /** Keys applied in this pass. */
  const fresh = new Set<string>();
  const had = (k: string) => done.has(k) || fresh.has(k);
  const add = (a: MarketAction, needsClaim: boolean) => {
    if (!done.has(a.key)) {
      apply.push(a);
      fresh.add(a.key);
    } else if (needsClaim) claim.push(a.key);
  };
  // Each step goes with the one before it: a copy of the save that only now takes an aircraft
  // out for a listing also takes what came of it (back, or the money), even if another copy of
  // the save already claimed that. And nothing is undone that this save never did.
  // Escrow first: an aircraft that's listed (or was) must not still be in the fleet
  for (const l of mine.listings) add({ kind: 'escrow', key: `l:${l.id}`, tail: l.tail, model: l.model }, false);
  for (const l of mine.listings)
    if (['cancelled', 'expired', 'removed', 'withdrawn'].includes(l.status) && (!l.returned || fresh.has(`l:${l.id}`))) add({ kind: 'return', key: `r:${l.id}`, tail: l.tail, model: l.model, cabin: l.cabin }, true);
  const oldestFirst = [...mine.trades].reverse();
  for (const t of oldestFirst) {
    if (t.role === 'seller' && (!t.claimed || fresh.has(`l:${t.listing}`))) add({ kind: 'sold', key: `s:${t.id}`, tail: t.tail, model: t.model, price: t.price, other: t.other }, true);
    if (t.role === 'buyer' && !t.claimed) add({ kind: 'bought', key: `b:${t.id}`, trade: t.id, model: t.model, cabin: t.cabin, price: t.price, other: t.other }, true);
  }
  for (const t of oldestFirst) {
    if (!t.reversed) continue;
    const before = t.role === 'seller' ? `s:${t.id}` : `b:${t.id}`;
    if (!had(before) || (t.reversalClaimed && !fresh.has(before))) continue;
    if (t.role === 'seller') add({ kind: 'unsell', key: `xs:${t.id}`, tail: t.tail, model: t.model, cabin: t.cabin, price: t.price }, true);
    else add({ kind: 'unbuy', key: `xb:${t.id}`, trade: t.id, model: t.model, price: t.price }, true);
  }
  return { apply, claim };
}

export interface MarketResult {
  fleet: PlayerAircraft[];
  /** Aircraft that left the fleet (their flights go too). */
  removed: string[];
  /** Money in (+) and out (−). */
  cashIn: number;
  cashOut: number;
  market: MarketSave;
  /** Keys to claim on the server once the save is written. */
  claim: string[];
  /** What to tell the player. */
  news: string[];
}

/**
 * Applies the actions to a fleet. `newTail` gives a free registration for an aircraft that arrives
 * (it's given the fleet so far). New aircraft are owned and join `hub`.
 */
export function applyMarket(
  fleet: PlayerAircraft[],
  market: MarketSave,
  actions: MarketAction[],
  opts: { hub: string; now: number; newTail: (fleet: PlayerAircraft[]) => string; money: (n: number) => string }
): MarketResult {
  let f = [...fleet];
  const removed: string[] = [];
  const keys: string[] = [];
  const claim: string[] = [];
  const news: string[] = [];
  let cashIn = 0;
  let cashOut = 0;
  const arrive = (modelId: string, cabin: unknown, tail: string, trade?: string) => {
    const model = AIRCRAFT_BY_ID.get(modelId);
    if (!model) return '';
    const reg = tail && !f.some((a) => a.tailNumber === tail) ? tail : opts.newTail(f);
    f.push({ tailNumber: reg, model, acquisition: 'owned', hubIata: opts.hub, cabin: marketCabin(model, cabin), acquiredMin: opts.now, ...(trade ? { trade } : {}) });
    return reg;
  };
  const leave = (pick: (a: PlayerAircraft) => boolean) => {
    const gone = f.filter(pick);
    if (!gone.length) return null;
    const one = gone[0].tailNumber;
    f = f.filter((a) => a.tailNumber !== one);
    removed.push(one);
    return one;
  };
  for (const a of actions) {
    keys.push(a.key);
    switch (a.kind) {
      case 'escrow':
        leave((x) => x.tailNumber === a.tail && x.model.id === a.model && x.acquisition === 'owned');
        break;
      case 'return': {
        const reg = arrive(a.model, a.cabin, a.tail);
        claim.push(a.key);
        if (reg) news.push(`${reg} is back in your fleet: its marketplace listing ended unsold.`);
        break;
      }
      case 'sold':
        cashIn += a.price;
        claim.push(a.key);
        news.push(`${a.tail || 'Your aircraft'} sold on the marketplace to ${a.other} for ${opts.money(a.price)}.`);
        break;
      case 'bought': {
        const reg = arrive(a.model, a.cabin, '', a.trade);
        cashOut += a.price;
        claim.push(a.key);
        if (reg) news.push(`${reg} delivered to ${opts.hub}: bought from ${a.other} for ${opts.money(a.price)}.`);
        break;
      }
      case 'unsell': {
        cashOut += a.price;
        const reg = arrive(a.model, a.cabin, a.tail);
        claim.push(a.key);
        news.push(`A moderator reversed the sale of ${a.tail || 'an aircraft'}: ${reg || 'it'} is back and ${opts.money(a.price)} went back to the buyer.`);
        break;
      }
      case 'unbuy': {
        const reg = leave((x) => x.trade === a.trade);
        cashIn += a.price;
        claim.push(a.key);
        news.push(`A moderator reversed a marketplace purchase${reg ? ` (${reg})` : ''}: it went back to its seller and ${opts.money(a.price)} came back.`);
        break;
      }
    }
  }
  return { fleet: f, removed, cashIn, cashOut, market: withApplied(market, keys), claim, news };
}

// ---------------------------------------------------------------------------
// Server calls
// ---------------------------------------------------------------------------
const ANSWERS: Record<string, string> = {
  listed: '',
  cancelled: '',
  bought: '',
  off: 'The marketplace isn’t open right now.',
  suspended: 'This account can’t use the marketplace at the moment.',
  too_new: 'Accounts can trade on the marketplace once they’re 7 days old.',
  share_first: 'Share this airline first (Online → This airline).',
  bad: 'That aircraft can’t be listed.',
  bad_price: 'Pick a price inside the allowed range.',
  already: 'That aircraft is already listed.',
  too_many: `An airline can have ${MAX_LISTINGS} aircraft listed at once.`,
  too_many_today: 'That’s enough marketplace trading for today. Try again tomorrow.',
  taken: 'That didn’t work. Try again.',
  gone: 'That aircraft isn’t for sale any more.',
  own: 'That’s one of your own airlines’ aircraft.',
  other_mode: 'That aircraft is in the other market (Career and Sandbox are kept apart).',
  no_alliance: 'The marketplace is for alliances. Join or start one in Alliances first.',
  not_ally: 'That aircraft is for sale only inside its seller’s alliance.',
};
export const marketAnswer = (r: unknown) => ANSWERS[String(r)] ?? 'That didn’t work. Try again later.';

export const listAircraft = async (me: string, id: string, ac: PlayerAircraft, price: number) =>
  String(await cloudRpc('market_list', { p_me: me, p_id: id, p_model: ac.model.id, p_cabin: marketCabin(ac.model, ac.cabin), p_tail: ac.tailNumber, p_price: Math.round(price) }));
export const cancelListing = async (saveId: string, id: string) => String(await cloudRpc('market_cancel', { p_save_id: saveId, p_id: id }));
export const loadMarketMine = async (saveId: string) => normaliseMarketMine(await cloudRpc('market_mine', { p_save_id: saveId }));
export const claimMarket = (saveId: string, key: string) => cloudRpc('market_claim', { p_save_id: saveId, p_key: key });
export async function buyListing(me: string, id: string): Promise<string> {
  const r = (await cloudRpc('market_buy', { p_me: me, p_id: id })) as { result?: unknown } | null;
  return String(r?.result ?? '');
}
export type MarketSort = 'new' | 'cheap' | 'dear';
export const browseMarket = async (me: string, f: { models?: string[]; max?: number | null; alliance?: string | null; sort: MarketSort }) =>
  normaliseOffers(await cloudRpc('market_browse', { p_me: me, p_models: f.models?.length ? f.models : null, p_max: f.max ?? null, p_alliance: f.alliance ?? null, p_sort: f.sort }));
