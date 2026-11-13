// Lease rents, and leases sharing the credit line with loans.
import { describe, expect, it } from 'vitest';
import { AIRCRAFT_BY_ID } from './aircraftCatalog';
import { COLLATERAL_SHARE, STAGES, STANDINGS, availableCredit, borrowBlocker, drawLoan, freshCareer, leaseBlocker, maxLeasable, productById } from './career';
import { DEPOSIT_WEEKS, LEASE_CREDIT_SHARE, dailyLeaseOf, leaseCreditUse, leaseQuote } from './leasing';
import { calcAircraftResaleUsd } from './tiers';
import type { AircraftModel, CareerState, PlayerAircraft } from './types';

const neo = AIRCRAFT_BY_ID.get('a320neo')!;
let n = 0;
const ac = (model: AircraftModel, acquisition: 'owned' | 'leased', lease = true): PlayerAircraft =>
  ({ tailNumber: `T${n++}`, model, acquisition, hubIata: 'JFK', cabin: {} as PlayerAircraft['cabin'], ...(acquisition === 'leased' && lease ? { lease: leaseQuote(model, 26, 0) } : {}) }) as PlayerAircraft;
const atStanding = (k: number): CareerState => ({ ...freshCareer(), stagesMet: STAGES.slice(0, k).map((s) => s.stage) });

describe('lease rent', () => {
  it('is 0.25% of the list price a week on a 26-week term, 15% less over two years', () => {
    const week = leaseQuote(neo, 26, 0).dailyRate * 7;
    expect(Math.abs(week - neo.base_price_usd * 0.0025)).toBeLessThanOrEqual(7);
    expect(leaseQuote(neo, 104, 0).dailyRate).toBe(Math.round(leaseQuote(neo, 26, 0).dailyRate * 0.85));
    expect(leaseQuote(neo, 26, 0).deposit).toBe(leaseQuote(neo, 26, 0).dailyRate * 7 * DEPOSIT_WEEKS);
  });

  it('charges an old lease with no terms the standard rate', () => {
    expect(dailyLeaseOf(ac(neo, 'leased', false))).toBe(leaseQuote(neo, 26, 0).dailyRate);
    expect(dailyLeaseOf(ac(neo, 'owned'))).toBe(0);
  });
});

describe('leases and the credit line', () => {
  it('lets each standing lease about 3 / 7 / 18 / 45 / 108 A320neos', () => {
    const expected = [3, 7, 18, 45, 108];
    expected.forEach((want, k) => {
      const got = maxLeasable(atStanding(k), [], neo);
      expect(got).toBe(Math.floor(STANDINGS[k].creditLine / leaseCreditUse(neo)));
      expect(Math.abs(got - want)).toBeLessThanOrEqual(1);
    });
    expect(leaseCreditUse(neo)).toBe(Math.round(neo.base_price_usd * LEASE_CREDIT_SHARE));
  });

  it('shares the line with loans', () => {
    const c = atStanding(2);
    const before = maxLeasable(c, [], neo);
    const { career } = drawLoan(c, productById('fleet'), 50_000_000, 0, 'Test Air');
    const after = maxLeasable(career, [], neo);
    expect(before - after).toBeGreaterThanOrEqual(Math.floor(50_000_000 / leaseCreditUse(neo)));
    expect(before - after).toBeLessThanOrEqual(Math.ceil(50_000_000 / leaseCreditUse(neo)));
  });

  it('grows with aircraft the airline owns', () => {
    const c = freshCareer();
    const owned = [ac(neo, 'owned'), ac(neo, 'owned'), ac(neo, 'owned'), ac(neo, 'owned')];
    expect(availableCredit(c, owned)).toBe(STANDINGS[0].creditLine + Math.round(4 * calcAircraftResaleUsd(neo) * COLLATERAL_SHARE));
    expect(maxLeasable(c, owned, neo)).toBeGreaterThan(maxLeasable(c, [], neo));
  });

  it('blocks new leases and loans, but takes nothing back, when over the line', () => {
    const fleet = Array.from({ length: 10 }, () => ac(neo, 'leased'));
    const c = freshCareer();
    expect(availableCredit(c, fleet)).toBe(0);
    expect(maxLeasable(c, fleet, neo)).toBe(0);
    expect(leaseBlocker(c, fleet, [neo])).toMatch(/^Not enough credit\./);
    expect(borrowBlocker(c, fleet, 10_000_000, 5_000_000)).not.toBeNull();
    expect(fleet).toHaveLength(10);
  });

  it('stops a new airline at its 4th A320neo, though the cash would pay 60 deposits', () => {
    const cash = 150_000_000;
    expect(Math.floor(cash / leaseQuote(neo, 26, 0).deposit)).toBeGreaterThanOrEqual(60);
    const c = freshCareer();
    const fleet: PlayerAircraft[] = [];
    for (let i = 0; i < 3; i++) {
      expect(leaseBlocker(c, fleet, [neo])).toBeNull();
      fleet.push(ac(neo, 'leased'));
    }
    expect(leaseBlocker(c, fleet, [neo])).not.toBeNull();
    // a bulk order is all or nothing
    expect(leaseBlocker(c, [], [neo, neo, neo, neo])).not.toBeNull();
    // swapping one lease for another frees the old one's credit
    expect(leaseBlocker(c, fleet, [neo], leaseCreditUse(neo))).toBeNull();
  });
});
