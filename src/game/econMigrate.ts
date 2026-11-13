// ============================================================================
// SAVES FROM BEFORE THE 2026-11 ECONOMY REWORK
//   Economy version 1 (no econVersion in the save): lease rents from the
//   catalog, cargo rates 460 + 0.9 nm (parcels) and 220 + 0.42 nm (freight).
//   Version 2: rents 0.25% of the list price a week, new cargo rates. On first
//   load an old career gets the new rents, its cargo prices moved to the same
//   place against the new guide prices, a letter from the bank explaining it
//   all, and four weeks in which an overdrawn account can't make it insolvent.
// ============================================================================
import { freightRate, parcelRate } from './cargo';
import { economyLetter } from './career';
import { MAX_FARE_MULT } from './economics';
import { leaseBaseDaily, leaseOption } from './leasing';
import { MIN_PER_WEEK } from './time';
import type { CareerState, PlayerAircraft, SaveGameState, ScheduledFlight } from './types';

export const ECON_VERSION = 2;
export const ECON_GRACE_WEEKS = 4;

const oldParcelRate = (nm: number) => Math.round(460 + nm * 0.9);
const oldFreightRate = (nm: number) => Math.round(220 + nm * 0.42);

/** True when this career already runs on the current economy. */
export function economyIsCurrent(save: Pick<SaveGameState, 'econVersion'>, career?: Pick<CareerState, 'econGraceUntilMin'>): boolean {
  // An older copy of the game re-saving a migrated career drops econVersion but keeps the career's own fields
  return (save.econVersion ?? 1) >= ECON_VERSION || career?.econGraceUntilMin !== undefined;
}

function rerateLease(ac: PlayerAircraft): PlayerAircraft {
  if (ac.acquisition !== 'leased' || !ac.lease) return ac;
  return { ...ac, lease: { ...ac.lease, dailyRate: Math.round(leaseBaseDaily(ac.model) * leaseOption(ac.lease.termWeeks).rateMult) } };
}

/** A cargo price moved to the same place against the new guide price (10% over stays 10% over), within the cap. */
function moveRate(v: number | undefined, oldRef: number, newRef: number): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return v;
  if (!(oldRef > 0)) return newRef;
  return Math.max(0, Math.min(Math.round((v * newRef) / oldRef), Math.round(newRef * MAX_FARE_MULT)));
}

function moveCargoFares(fl: ScheduledFlight): ScheduledFlight {
  const f = fl.fares;
  if (!f || (f.parcelPerTon === undefined && f.cargoPerTon === undefined)) return fl;
  const nm = fl.distanceNm;
  if (!(nm > 0)) return { ...fl, fares: { ...f, parcelPerTon: f.parcelPerTon === undefined ? undefined : parcelRate(0), cargoPerTon: f.cargoPerTon === undefined ? undefined : freightRate(0) } };
  return {
    ...fl,
    fares: { ...f, parcelPerTon: moveRate(f.parcelPerTon, oldParcelRate(nm), parcelRate(nm)), cargoPerTon: moveRate(f.cargoPerTon, oldFreightRate(nm), freightRate(nm)) },
  };
}

/**
 * Brings a hydrated save and its career onto the current economy. Pure: returns
 * the same objects when the save is already current. `econMin` = the save's
 * economy clock.
 */
export function normaliseEconomy(save: SaveGameState, career: CareerState, econMin: number): { save: SaveGameState; career: CareerState; migrated: boolean } {
  if (economyIsCurrent(save, career)) return { save, career, migrated: false };
  const next: SaveGameState = { ...save, fleet: save.fleet.map(rerateLease), schedule: save.schedule.map(moveCargoFares), econVersion: ECON_VERSION };
  // A career already declared insolvent is left as it is (the settlement is still to come)
  const grace = career.insolvent ? {} : { overdrawnWeeks: 0 };
  const letters = save.gameMode === 'standard' ? [economyLetter(save.airlineName, econMin), ...career.letters] : career.letters;
  return { save: next, career: { ...career, ...grace, econGraceUntilMin: econMin + ECON_GRACE_WEEKS * MIN_PER_WEEK, letters }, migrated: true };
}
