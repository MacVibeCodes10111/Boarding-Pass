import { describe, expect, it } from 'vitest';
import { AIRCRAFT_BY_ID } from './aircraftCatalog';
import { BUILTIN_AIRPORTS } from './builtinData';
import { getDefaultCabinForModel } from './economics';
import { findScheduleConflict, getAircraftCircuitStatus, hasContinuityBreak, planCloseLoop, planPingPong, planRouteDispatch, type RoutingMode } from './scheduling';
import { ALL_DAYS } from './time';
import type { PlayerAircraft, ScheduledFlight, WeekDays } from './types';

const byIata = new Map(BUILTIN_AIRPORTS.map((a) => [a.iata_code, a]));
const ap = (c: string) => byIata.get(c)!;
const model = AIRCRAFT_BY_ID.get('a320neo')!;
const ac: PlayerAircraft = { tailNumber: 'N1', model, acquisition: 'owned', hubIata: 'JFK', cabin: getDefaultCabinForModel(model) };
const fares = { econ: 200, prem: 300, bus: 600, first: 1000 };

/** A little airline: schedules legs the way the route planner does. */
function airline() {
  let schedule: ScheduledFlight[] = [];
  const go = (o: string, d: string, depMin: number, days: WeekDays = ALL_DAYS, mode: RoutingMode = 'chain') => {
    const r = planRouteDispatch({ aircraft: ac, schedule, hubs: ['JFK'], origin: ap(o), destination: ap(d), depMin, days, mode, flightNumber: '', airlineIata: 'XX', fares });
    if (r.ok) schedule = [...schedule, ...r.flights];
    return r;
  };
  const loopArgs = () => ({ aircraft: ac, schedule, hubs: ['JFK'], airlineIata: 'XX', airportByIata: byIata });
  return { go, loopArgs, add: (f: ScheduledFlight[]) => (schedule = [...schedule, ...f]), get schedule() { return schedule; } };
}

describe('chains that run past midnight UTC', () => {
  it('a daily chain can carry on after midnight, and shows as one open chain', () => {
    const a = airline();
    const first = a.go('JFK', 'ORD', 22 * 60);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.next.depMin).toBeLessThan(120); // ready again just after midnight
    const second = a.go('ORD', 'DEN', first.next.depMin, first.next.days);
    expect(second.ok).toBe(true);
    const c = getAircraftCircuitStatus(ac, a.schedule);
    expect(c.chainPath).toEqual(['JFK', 'ORD', 'DEN']);
    expect(c.isClosedLoop).toBe(false);
    expect(c.hasSpatialBreak).toBe(false);
    expect(c.currentEndIata).toBe('DEN');
  });

  it('flying straight back closes it, and the day then joins up all week', () => {
    const a = airline();
    const first = a.go('JFK', 'ORD', 22 * 60);
    if (!first.ok) throw new Error('first leg');
    a.go('ORD', 'DEN', first.next.depMin, first.next.days);
    const home = planCloseLoop(a.loopArgs());
    expect(home.ok).toBe(true);
    if (!home.ok) return;
    a.add(home.flights);
    const c = getAircraftCircuitStatus(ac, a.schedule);
    expect(c.chainPath).toEqual(['JFK', 'ORD', 'DEN', 'JFK']);
    expect(c.isClosedLoop).toBe(true);
    expect(hasContinuityBreak(a.schedule)).toBe(false);
  });

  it('retracing the stops works too', () => {
    const a = airline();
    const first = a.go('JFK', 'ORD', 22 * 60);
    if (!first.ok) throw new Error('first leg');
    a.go('ORD', 'DEN', first.next.depMin, first.next.days);
    const back = planPingPong(a.loopArgs());
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.flights.map((f) => `${f.origin.iata_code}-${f.destination.iata_code}`)).toEqual(['DEN-ORD', 'ORD-JFK']);
  });

  it('an overnight round trip starts at its base', () => {
    const a = airline();
    expect(a.go('JFK', 'LHR', 23 * 60, ALL_DAYS, 'roundtrip').ok).toBe(true);
    const c = getAircraftCircuitStatus(ac, a.schedule);
    expect(c.chainPath).toEqual(['JFK', 'LHR', 'JFK']);
    expect(c.currentEndIata).toBe('JFK');
  });
});

describe('no jumping between airports', () => {
  const leg = (flightNumber: string, o: string, d: string, depTimeMin: number) => ({ flightNumber, depTimeMin, blockTimeMin: 120, daysOfWeek: ALL_DAYS, originIata: o, destIata: d });

  it('a same-day chain may still end away from where it started', () => {
    const a = airline();
    expect(a.go('JFK', 'ORD', 10 * 60).ok).toBe(true);
    expect(a.go('ORD', 'DEN', 15 * 60).ok).toBe(true);
    expect(hasContinuityBreak(a.schedule)).toBe(false);
  });

  it('a leg that leaves from where the aircraft isn’t is refused', () => {
    const a = airline();
    a.go('JFK', 'ORD', 10 * 60);
    a.go('ORD', 'DEN', 15 * 60);
    // in the middle of the day, from the wrong airport
    expect(findScheduleConflict(a.schedule, [{ ...leg('XX9', 'BOS', 'ORD', 13 * 60 + 30), blockTimeMin: 30 }], 45)).toMatch(/must depart from ORD/);
    // two jumps a day, even back to the same airport
    expect(findScheduleConflict([], [leg('XX1', 'JFK', 'ORD', 8 * 60), leg('XX2', 'JFK', 'BOS', 16 * 60)], 45)).toMatch(/must depart from ORD/);
  });
});
