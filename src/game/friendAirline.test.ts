import { describe, expect, it } from 'vitest';
import { friendAirlineStats, friendRouteMap } from './friendAirline';
import type { ScheduleSnapshot } from './scheduleSnapshot';
import type { Airport } from './types';

const ap = (iata_code: string, latitude_deg: number, longitude_deg: number, municipality = iata_code) => ({ iata_code, latitude_deg, longitude_deg, municipality, name: `${iata_code} Airport` }) as unknown as Airport;
const airports = new Map([ap('LHR', 51.47, -0.45, 'London'), ap('JFK', 40.64, -73.78, 'New York'), ap('CDG', 49.01, 2.55, 'Paris'), ap('NRT', 35.77, 140.39, 'Tokyo'), ap('LAX', 33.94, -118.41, 'Los Angeles')].map((a) => [a.iata_code, a]));

const snap: ScheduleSnapshot = {
  v: 1,
  models: ['a350-900', 'a320-200'],
  regs: ['G-AAAA', 'G-BBBB', 'G-CCCC'],
  flights: [
    ['LHR', 'JFK', 600, 480, 127, 0, 0, 'BP1', 0],
    ['JFK', 'LHR', 1200, 420, 127, 0, 0, 'BP2', 0],
    ['LHR', 'CDG', 420, 70, 0b0011111, 1, 1, 'BP3', 0],
    ['CDG', 'LHR', 560, 70, 0b0011111, 1, 1, 'BP4', 0],
    ['LHR', 'CDG', 900, 70, 1, 1, 2, 'BP5', 1],
    ['LHR', 'XXX', 900, 70, 127, 1, 2, 'BP6', 0],
  ],
};

describe('a friend’s airline at a glance', () => {
  const s = friendAirlineStats(snap, airports);
  it('counts flights, aircraft and places', () => {
    expect(s.weeklyFlights).toBe(7 + 7 + 5 + 5 + 1);
    expect(s.aircraft).toBe(3);
    expect(s.destinations).toBe(3);
  });
  it('joins both directions into one route, busiest first', () => {
    expect(s.routes.map((r) => [r.a, r.b, r.weekly])).toEqual([['JFK', 'LHR', 14], ['CDG', 'LHR', 11]]);
    expect(s.longest?.b).toBe('LHR');
    expect(s.longest?.a).toBe('JFK');
  });
  it('lists the fleet by type and picks the most flown one', () => {
    expect(s.types.map((t) => [t.modelId, t.count])).toEqual([['a320-200', 2], ['a350-900', 1]]);
    expect(s.mainModel).toBe('a350-900');
    expect(s.busiest[0]).toEqual({ iata: 'LHR', name: 'London', weekly: 25 });
  });
  it('skips airports this game doesn’t know', () => {
    expect(s.routes.some((r) => r.a === 'XXX' || r.b === 'XXX')).toBe(false);
  });
  it('is empty for an empty schedule', () => {
    const e = friendAirlineStats({ v: 1, models: [], regs: [], flights: [] }, airports);
    expect(e).toMatchObject({ aircraft: 0, weeklyFlights: 0, destinations: 0, routes: [], longest: null, mainModel: null });
  });
});

describe('the route map', () => {
  it('draws one line per route and fits the airports', () => {
    const m = friendRouteMap(friendAirlineStats(snap, airports).routes, airports);
    expect(m.lines.features).toHaveLength(2);
    expect(m.points.features).toHaveLength(3);
    expect(m.bounds).toEqual([[-73.78, 40.64], [2.55, 51.47]]);
  });
  it('keeps a Pacific route in one piece', () => {
    const m = friendRouteMap([{ a: 'LAX', b: 'NRT', weekly: 7, nm: 4700 }], airports);
    const c = (m.lines.features[0].geometry.coordinates as [number, number][]);
    for (let i = 1; i < c.length; i++) expect(Math.abs(c[i][0] - c[i - 1][0])).toBeLessThan(30);
  });
});
