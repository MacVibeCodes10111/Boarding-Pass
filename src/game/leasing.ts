// ============================================================================
// LEASES (v2.38+)
//
// A lease runs for a set number of game weeks. Longer leases are cheaper per
// day. Signing takes a security deposit of eight weeks' payments, refunded
// when the aircraft goes back after the term. Returning it early gives up part
// of the deposit: the share of the term still to run. After the term the lease
// carries on week to week and the aircraft can go back at any time with the
// whole deposit. A leased aircraft can be bought out: the list price less half
// the lease paid so far, but never under 80% of the list price (so buying out
// and selling straight on never makes money), and the deposit comes back.
// ============================================================================
import { MIN_PER_WEEK } from './time';
import type { AircraftModel, LeaseTerms, PlayerAircraft } from './types';

export interface LeaseOption {
  weeks: number;
  label: string;
  /** Daily rate as a share of the aircraft's standard lease rate. */
  rateMult: number;
}

export const LEASE_OPTIONS: LeaseOption[] = [
  { weeks: 13, label: '13 weeks', rateMult: 1.15 },
  { weeks: 26, label: '26 weeks', rateMult: 1 },
  { weeks: 52, label: '1 year', rateMult: 0.92 },
  { weeks: 104, label: '2 years', rateMult: 0.85 },
];
export const DEFAULT_LEASE_WEEKS = 26;
export const DEPOSIT_WEEKS = 8;
/** Buy-outs never cost less than this share of the list price. */
export const BUYOUT_FLOOR = 0.8;

export const leaseOption = (weeks: number) => LEASE_OPTIONS.find((o) => o.weeks === weeks) ?? LEASE_OPTIONS[1];

/** Terms for a new lease of `model`. */
export function leaseQuote(model: AircraftModel, weeks: number, econMin: number): LeaseTerms {
  const o = leaseOption(weeks);
  const dailyRate = Math.round(model.daily_lease_usd * o.rateMult);
  return { termWeeks: o.weeks, dailyRate, startMin: econMin, deposit: dailyRate * 7 * DEPOSIT_WEEKS };
}

/** Daily lease payment of an aircraft (0 when owned). Leases from before v2.38 pay the standard rate. */
export const dailyLeaseOf = (ac: PlayerAircraft) => (ac.acquisition === 'leased' ? ac.lease?.dailyRate ?? ac.model.daily_lease_usd : 0);

export function leaseStatus(ac: PlayerAircraft, econMin: number) {
  const l = ac.lease;
  if (ac.acquisition !== 'leased' || !l) return { weeksDone: 0, weeksLeft: 0, ended: true, legacy: ac.acquisition === 'leased', paid: 0 };
  const weeksDone = Math.max(0, (econMin - l.startMin) / MIN_PER_WEEK);
  const weeksLeft = Math.max(0, l.termWeeks - weeksDone);
  return { weeksDone, weeksLeft, ended: weeksLeft <= 0, legacy: false, paid: weeksDone * 7 * l.dailyRate };
}

/** What returning a leased aircraft now gives back. */
export function returnTerms(ac: PlayerAircraft, econMin: number) {
  const l = ac.lease;
  const st = leaseStatus(ac, econMin);
  if (!l) return { deposit: 0, refund: 0, forfeit: 0, early: false, weeksLeft: 0 };
  const shareLeft = l.termWeeks > 0 ? st.weeksLeft / l.termWeeks : 0;
  const forfeit = Math.round(l.deposit * shareLeft);
  return { deposit: l.deposit, refund: l.deposit - forfeit, forfeit, early: st.weeksLeft > 0, weeksLeft: st.weeksLeft };
}

/** Price to buy a leased aircraft now (the deposit is refunded on top). */
export function buyoutPrice(ac: PlayerAircraft, econMin: number) {
  const list = ac.model.base_price_usd;
  const paid = leaseStatus(ac, econMin).paid;
  return Math.round(Math.max(list * BUYOUT_FLOOR, list - paid * 0.5));
}

export const weeksText = (w: number) => {
  if (w <= 0) return 'term ended';
  if (w < 1) return 'under a week left';
  const n = Math.ceil(w);
  return `${n} ${n === 1 ? 'week' : 'weeks'} left`;
};
