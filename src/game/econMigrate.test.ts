// Careers from before the 2026-11 economy rework.
import { describe, expect, it } from 'vitest';
import { AIRCRAFT_BY_ID } from './aircraftCatalog';
import { freightRate, parcelRate } from './cargo';
import { INSOLVENCY_WEEKS, availableCredit, freshCareer, hydrateCareer, settleCareerAdvance } from './career';
import { ECON_GRACE_WEEKS, ECON_VERSION, normaliseEconomy } from './econMigrate';
import { dailyLeaseOf, leaseBaseDaily } from './leasing';
import { isValidSave } from './saves';
import { MIN_PER_WEEK } from './time';
import type { Airport, CareerState, PlayerAircraft, SaveGameState, ScheduledFlight } from './types';

const neo = AIRCRAFT_BY_ID.get('a320neo')!;
const NOW = 30 * MIN_PER_WEEK;
const leased = (i: number, withTerms = true): PlayerAircraft =>
  ({
    tailNumber: `N${i}`, model: neo, acquisition: 'leased', hubIata: 'JFK', cabin: {} as PlayerAircraft['cabin'],
    ...(withTerms ? { lease: { termWeeks: 52, dailyRate: 9_000, startMin: 1234 + i, deposit: 504_000 } } : {}),
  }) as PlayerAircraft;
const ap = (c: string) => ({ iata_code: c }) as Airport;
const fl = (fares: ScheduledFlight['fares'], nm = 1000): ScheduledFlight =>
  ({ id: 'F1', flightNumber: 'ZZ1', tailNumber: 'N0', origin: ap('JFK'), destination: ap('ORD'), distanceNm: nm, depTimeMin: 600, arrTimeMin: 720, blockTimeMin: 120, daysOfWeek: [], fares }) as ScheduledFlight;
const save = (fleet: PlayerAircraft[], schedule: ScheduledFlight[] = [], extra: Partial<SaveGameState> = {}): SaveGameState =>
  ({ saveId: 'S', airlineName: 'Old Air', airlineIata: 'OA', airlineCallsign: 'OLD', hubIata: 'JFK', gameMode: 'standard', cash: 1e8, simMin: 0, simDay: 1, fleet, schedule, savedAt: '', econMin: NOW, ...extra }) as SaveGameState;

describe('a career from before the economy rework', () => {
  it('re-rates its leases, keeps deposits and start times, gets one letter and four weeks’ grace', () => {
    const career = { ...freshCareer(), overdrawnWeeks: 1 };
    const r = normaliseEconomy(save([leased(0), leased(1), leased(2)]), career, NOW);
    expect(r.migrated).toBe(true);
    expect(r.save.econVersion).toBe(ECON_VERSION);
    r.save.fleet.forEach((a, i) => {
      expect(a.lease!.dailyRate).toBe(Math.round(leaseBaseDaily(neo) * 0.92));
      expect(a.lease!.deposit).toBe(504_000);
      expect(a.lease!.startMin).toBe(1234 + i);
    });
    expect(r.career.letters.filter((l) => l.subject.startsWith('Changes to how airlines'))).toHaveLength(1);
    expect(r.career.econGraceUntilMin).toBe(NOW + ECON_GRACE_WEEKS * MIN_PER_WEEK);
    expect(r.career.overdrawnWeeks).toBe(0);
  });

  it('changes nothing the second time, even after an older copy of the game re-saved it', () => {
    const once = normaliseEconomy(save([leased(0)]), freshCareer(), NOW);
    const twice = normaliseEconomy(once.save, once.career, NOW);
    expect(twice.migrated).toBe(false);
    expect(twice.save).toBe(once.save);
    expect(twice.career).toBe(once.career);
    // an older version drops econVersion from the save but keeps the career's own fields
    const resaved = { ...once.save, econVersion: undefined };
    expect(normaliseEconomy(resaved, hydrateCareer(JSON.parse(JSON.stringify(once.career))), NOW).migrated).toBe(false);
  });

  it('keeps all 60 leased aircraft of an airline far over its credit line', () => {
    const fleet = Array.from({ length: 60 }, (_, i) => leased(i));
    const r = normaliseEconomy(save(fleet), freshCareer(), NOW);
    expect(r.save.fleet).toHaveLength(60);
    expect(availableCredit(r.career, r.save.fleet)).toBe(0);
  });

  it('charges a lease with no terms the new base rate', () => {
    const r = normaliseEconomy(save([leased(0, false)]), freshCareer(), NOW);
    expect(r.save.fleet[0].lease).toBeUndefined();
    expect(dailyLeaseOf(r.save.fleet[0])).toBe(leaseBaseDaily(neo));
  });

  it('loads a save with no career at all', () => {
    const r = normaliseEconomy(save([leased(0)]), hydrateCareer(undefined), NOW);
    expect(r.migrated).toBe(true);
    expect(r.career.loans).toEqual([]);
  });

  it('keeps cargo prices in the same place against the guide price', () => {
    const nm = 1000;
    const oldParcel = 460 + 0.9 * nm;
    const oldFreight = 220 + 0.42 * nm;
    const r = normaliseEconomy(save([], [fl({ econ: 100, prem: 200, bus: 400, first: 800, parcelPerTon: Math.round(oldParcel * 1.1), cargoPerTon: Math.round(oldFreight * 0.9) }, nm)]), freshCareer(), NOW);
    expect(r.save.schedule[0].fares.parcelPerTon! / parcelRate(nm)).toBeCloseTo(1.1, 2);
    expect(r.save.schedule[0].fares.cargoPerTon! / freightRate(nm)).toBeCloseTo(0.9, 2);
    expect(r.save.schedule[0].fares.econ).toBe(100);
    // a flight with no cargo prices of its own keeps using the guide price
    const plain = normaliseEconomy(save([], [fl({ econ: 1, prem: 1, bus: 1, first: 1 })]), freshCareer(), NOW);
    expect(plain.save.schedule[0].fares.parcelPerTon).toBeUndefined();
  });

  it('is a valid save with or without the version', () => {
    expect(isValidSave(save([]))).toBe(true);
    expect(isValidSave(save([], [], { econVersion: 2 }))).toBe(true);
  });

  it('can’t go insolvent during the grace weeks, and can after', () => {
    const r = normaliseEconomy(save([]), freshCareer(), NOW);
    const week = Math.floor(NOW / MIN_PER_WEEK) + 1;
    const closed = (w: number) => ({ week: w, flightProfit: 0, leaseCost: 1e6, cashEnd: -5e6 });
    const run = (c: CareerState, w: number) => settleCareerAdvance(c, { econMin: w * MIN_PER_WEEK, loans: [], finishedLoans: [], closedWeeks: [closed(w)] }, -5e6, 'Old Air');
    let c = r.career;
    for (let w = week; w < week + ECON_GRACE_WEEKS; w++) c = run(c, w);
    expect(c.insolvent ?? null).toBeNull();
    expect(c.overdrawnWeeks).toBe(0);
    for (let w = week + ECON_GRACE_WEEKS; w < week + ECON_GRACE_WEEKS + INSOLVENCY_WEEKS; w++) c = run(c, w);
    expect(c.insolvent).not.toBeNull();
  });

  it('leaves a current save alone', () => {
    const s = save([leased(0)], [], { econVersion: 2 });
    const c = freshCareer();
    const r = normaliseEconomy(s, c, NOW);
    expect(r.save).toBe(s);
    expect(r.career).toBe(c);
    expect(r.save.fleet[0].lease!.dailyRate).toBe(9_000);
  });
});
