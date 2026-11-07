import { describe, expect, it, vi } from 'vitest';
import type { AiTraffic } from './aiTraffic';
import type { Airport } from './types';

vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
const { mergeFriendAnswer, withFriends } = await import('./friendsMap');
const { aiDepartureDay, aiFlightPosition, findAirborneAi, toVec } = await import('./aiTraffic');

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const snapshot = { v: 1 as const, models: ['a320-200', 'from-a-newer-game'], regs: ['G-ABCD', 'G-EFGH'], flights: [['LHR', 'JFK', 600, 480, 127, 0, 0, 'BP1', 1], ['JFK', 'CDG', 60, 420, 1, 1, 1, '', 0], ['LHR', 'ZZZ', 60, 60, 127, 0, 0, 'BP2', 0]] as [string, string, number, number, number, number, number, string, number][] };
const friend = (n: number, over = {}) => ({ id: id(n), airline: `Friend ${n}`, code: 'FR', callsign: 'FRIEND', colours: { a: '#112233', b: '#445566' }, updatedAt: 't', version: 1, snapshot, ...over });

const ap = (iata: string, lat: number, lon: number) => ({ iata, name: iata, city: iata, country: 'X', lat, lon, elevFt: 0, tz: 'UTC', tzHours: 0, v: toVec(lat, lon) });
const base = (): AiTraffic => ({
  airlines: [{ code: 'XX', name: 'Other', callsign: 'OTHER', region: 'EU' }],
  airports: [ap('LHR', 51.47, -0.45), ap('JFK', 40.64, -73.78)],
  flights: [{ id: 0, airline: 0, flightNumber: 'XX1', o: 0, d: 1, depUtcMin: 100, blockMin: 400, daysMask: 127, typeCode: '320', group: 'medium_jet', cruiseKts: 450, distanceNm: 3000 }],
  typeNames: new Map([['320', 'A320']]),
  stats: { routes: 1, flightsPerWeek: 7, avgPerDay: 1, skippedRoutes: 0, buildMs: 0 },
});
const cdg = { iata_code: 'CDG', name: 'Charles de Gaulle', municipality: 'Paris', country_name: 'France', latitude_deg: 49, longitude_deg: 2.5, elevation_ft: 390 } as Airport;
const game = new Map([['CDG', cdg]]);

describe('joining friends onto the traffic', () => {
  it('returns the same traffic with no friends', () => {
    const b = base();
    expect(withFriends(b, [], game)).toBe(b);
  });

  it('leaves the other airlines exactly as they were, and doesn’t change the list it was given', () => {
    const b = base();
    const t = withFriends(b, [friend(1)], game);
    expect(t.flights[0]).toBe(b.flights[0]);
    expect(b.flights).toHaveLength(1);
    expect(b.airlines).toHaveLength(1);
    expect(b.airports).toHaveLength(2);
    expect(b.typeNames.size).toBe(1);
    expect(t.friendsFrom).toBe(1);
  });

  it('gives each flight its place in the list as its id', () => {
    const t = withFriends(base(), [friend(1), friend(2)], game);
    t.flights.forEach((f, i) => expect(f.id).toBe(i));
    expect(t.airlines.map((a) => a.name)).toEqual(['Other', 'Friend 1', 'Friend 2']);
  });

  it('keeps friends out of the codes real airlines use', () => {
    const t = withFriends(base(), [friend(1)], game);
    expect(t.airlines[1].code.startsWith('~')).toBe(true);
  });

  it('adds airports only this game knows, and leaves out flights to any it doesn’t', () => {
    const t = withFriends(base(), [friend(1)], game);
    expect(t.airports.map((a) => a.iata)).toEqual(['LHR', 'JFK', 'CDG']);
    expect(t.flights.filter((f) => f.friend)).toHaveLength(2);
  });

  it('describes the aircraft, and copes with one from a newer game', () => {
    const [, known, unknown] = withFriends(base(), [friend(1)], game).flights;
    expect(known.friend).toEqual({ owner: id(1), reg: 'G-ABCD', modelId: 'a320-200', livery: 1 });
    expect(known.cruiseKts).toBeGreaterThan(300);
    expect(unknown.friend?.modelId).toBe('from-a-newer-game');
    expect(unknown.cruiseKts).toBeGreaterThan(120);
    expect(unknown.flightNumber).toBe('G-EFGH');
  });

  it('flies on the viewer’s clock: a weekly pattern, whatever day the viewer’s game is on', () => {
    const t = withFriends(base(), [friend(1)], game);
    const f = t.flights[1];
    for (const day of [1, 4, 8, 400, 12345]) {
      expect(aiDepartureDay(f, day, 800)).toBe(day);
      expect(aiFlightPosition(t, f, day, 800)?.progress).toBeCloseTo((800 - 600) / 480, 0);
      expect(findAirborneAi(t, day, 800, 1)).toContain(f);
    }
  });

  it('only flies on the days in the schedule', () => {
    const t = withFriends(base(), [friend(1)], game);
    const mondayOnly = t.flights[2];
    expect(aiDepartureDay(mondayOnly, 1, 100)).toBe(1); // Day 1 is a Monday
    expect(aiDepartureDay(mondayOnly, 2, 100)).toBeNull();
  });
});

describe('the answer from the Worker', () => {
  const entry = (n: number, over = {}) => ({ id: id(n), airline: `F${n}`, code: 'FR', callsign: 'C', colours: { a: '#112233', b: '#445566' }, updatedAt: 't', version: 2, snapshot, ...over });

  it('takes new schedules', () => {
    const r = mergeFriendAnswer([], { airlines: [entry(1)] });
    expect(r[0].version).toBe(2);
    expect(r[0].snapshot.flights).toHaveLength(3);
  });

  it('keeps a schedule that hasn’t changed, with the airline’s new name', () => {
    const had = [friend(1, { version: 2 })];
    const { snapshot: _unused, ...withoutFile } = entry(1, { airline: 'Renamed' });
    const r = mergeFriendAnswer(had, { airlines: [withoutFile] });
    expect(r[0].snapshot).toBe(snapshot);
    expect(r[0].airline).toBe('Renamed');
  });

  it('takes a friend off the map as soon as they’re missing from the answer', () => {
    expect(mergeFriendAnswer([friend(1)], { airlines: [] })).toEqual([]);
  });

  it('keeps what’s showing when the answer makes no sense', () => {
    const had = [friend(1)];
    expect(mergeFriendAnswer(had, null)).toEqual(had);
    expect(mergeFriendAnswer(had, { nope: 1 })).toEqual(had);
  });

  it('doesn’t reuse an old schedule for a newer version', () => {
    const { snapshot: _unused, ...withoutFile } = entry(1, { version: 9 });
    expect(mergeFriendAnswer([friend(1, { version: 2 })], { airlines: [withoutFile] })).toEqual([]);
  });

  it('leaves out bad entries and keeps the rest', () => {
    const r = mergeFriendAnswer([], { airlines: [null, 'x', { id: 'not-an-id' }, entry(2, { snapshot: { v: 1, models: [], regs: ['<b>'], flights: [] } }), entry(3)] });
    expect(r.map((f) => f.id)).toEqual([id(3)]);
  });

  it('never shows more than 20 airlines, and never a bad colour', () => {
    const r = mergeFriendAnswer([], { airlines: Array.from({ length: 30 }, (_, i) => entry(i + 1, { colours: { a: 'url(x)' } })) });
    expect(r).toHaveLength(20);
    expect(r[0].colours.a).toBe('#475569');
  });
});
