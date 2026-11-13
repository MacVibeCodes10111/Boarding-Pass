// Regional and cargo brands (2026-11).
import { describe, expect, it } from 'vitest';
import { AIRCRAFT_BY_ID } from './aircraftCatalog';
import { flightCosts } from './costs';
import { standardLivery } from './livery';
import { hydrateSave } from './saves';
import { brandAllows, brandBlocker, checkBrandNames, crewShareOf, normaliseSubsidiaries, suggestedBrandName, tidyFleetBrands } from './subsidiaries';
import type { PlayerAircraft, SaveGameState, Subsidiary } from './types';

const m = (id: string) => AIRCRAFT_BY_ID.get(id)!;
const ac = (id: string, brand?: PlayerAircraft['brand']): PlayerAircraft =>
  ({ tailNumber: `N-${id}`, model: m(id), acquisition: 'owned', hubIata: 'JFK', cabin: {} as PlayerAircraft['cabin'], ...(brand ? { brand } : {}) }) as PlayerAircraft;
const both: Subsidiary[] = [
  { kind: 'regional', name: 'Old Air Connection', callsign: 'OLD CONNECT' },
  { kind: 'cargo', name: 'Old Air Cargo', callsign: 'OLD CARGO' },
];

describe('subsidiaries', () => {
  it('the regional brand flies regional jets and turboprops of up to 100 seats; the cargo brand freighters', () => {
    for (const id of ['e175', 'crj-900', 'dash8-q400', 'atr-72-600', 'e190', 'c208b-ex']) expect(brandAllows('regional', m(id))).toBe(true);
    for (const id of ['a320neo', 'e195-e2', 'e190-e2', 'atr-72-600f', 'b777f']) expect(brandAllows('regional', m(id))).toBe(false);
    for (const id of ['b777f', 'atr-72-600f', 'e190f']) expect(brandAllows('cargo', m(id))).toBe(true);
    for (const id of ['a320neo', 'e175']) expect(brandAllows('cargo', m(id))).toBe(false);
    expect(brandBlocker('regional', m('a320neo'))).toMatch(/too big/);
    expect(brandBlocker('cargo', m('a320neo'))).toMatch(/freighters only/);
    expect(brandBlocker('regional', m('e175'))).toBeNull();
  });

  it('regional crews cost 20% less, and nothing else changes', () => {
    const f = { blockMin: 90, seatsFitted: 76, cargoTons: 1, ticketRevenue: 10_000 };
    const main = flightCosts(m('e175'), f);
    const regional = flightCosts(m('e175'), { ...f, crewShare: crewShareOf(ac('e175', 'regional')) });
    expect(regional.crew).toBe(Math.round(main.crew * 0.8));
    expect(regional.total - regional.crew).toBe(main.total - main.crew);
    expect(crewShareOf(ac('b777f', 'cargo'))).toBe(1);
    expect(crewShareOf(ac('e175'))).toBe(1);
  });

  it('loads one of each kind at most, with bad names and kinds dropped', () => {
    const subs = normaliseSubsidiaries([
      { kind: 'cargo', name: 'Old Air Cargo', callsign: 'old cargo', livery: standardLivery() },
      { kind: 'regional', name: 'Old Air Connection', callsign: 'OLD CONNECT' },
      { kind: 'regional', name: 'Second Regional', callsign: 'TWO' },
      { kind: 'charter', name: 'Charter', callsign: 'CHARTER' },
      { kind: 'cargo', name: '<script>', callsign: 'X' },
      'junk',
    ]);
    expect(subs.map((s) => s.kind)).toEqual(['regional', 'cargo']);
    expect(subs[1].callsign).toBe('OLD CARGO');
    expect(subs[1].livery?.v).toBe(2);
    expect(subs[0].livery).toBeUndefined();
    expect(normaliseSubsidiaries(undefined)).toEqual([]);
    expect(checkBrandNames('A', 'OK')).toHaveProperty('error');
  });

  it('aircraft leave a brand that is gone or can’t fly their type', () => {
    const fleet = [ac('e175', 'regional'), ac('b777f', 'cargo'), ac('a320neo', 'regional'), ac('a320neo')];
    const tidy = tidyFleetBrands(fleet, both);
    expect(tidy.map((a) => a.brand)).toEqual(['regional', 'cargo', undefined, undefined]);
    expect(tidyFleetBrands(tidy, both)).toBe(tidy);
    expect(tidyFleetBrands(tidy, [both[1]]).map((a) => a.brand)).toEqual([undefined, 'cargo', undefined, undefined]);
  });

  it('saves keep their brands; old saves load with none', () => {
    const save = (extra: Partial<SaveGameState>) =>
      ({ saveId: 'S', airlineName: 'Old Air', airlineIata: 'OA', airlineCallsign: 'OLD', hubIata: 'JFK', gameMode: 'standard', cash: 1e8, simMin: 0, simDay: 1, schedule: [], savedAt: '', ...extra }) as SaveGameState;
    const s = hydrateSave(JSON.parse(JSON.stringify(save({ subsidiaries: both, fleet: [ac('e175', 'regional'), ac('b777f', 'cargo')] }))), new Map());
    expect(s.subsidiaries).toHaveLength(2);
    expect(s.fleet.map((a) => a.brand)).toEqual(['regional', 'cargo']);
    const old = hydrateSave(JSON.parse(JSON.stringify(save({ fleet: [ac('e175', 'regional')] }))), new Map());
    expect(old.subsidiaries).toEqual([]);
    expect(old.fleet[0].brand).toBeUndefined();
  });

  it('suggests names under the airline’s own', () => {
    expect(suggestedBrandName('regional', 'Northwind Airlines')).toBe('Northwind Connection');
    expect(suggestedBrandName('cargo', 'Test Econ Air')).toBe('Test Econ Air Cargo');
  });
});
