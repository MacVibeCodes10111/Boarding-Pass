import { describe, expect, it } from 'vitest';
import { AIRCRAFT_BY_ID } from './aircraftCatalog';
import { AIRCRAFT_PHOTOS } from './aircraftPhotos';
import { WINGTIP_TYPES, artIdFor, modelOfArt, normaliseWingtip, wingtipFitUsd, wingtipFuelFactor, wingtipOf, withWingtip } from './wingtips';
import type { PlayerAircraft } from './types';

const ac = (id: string, wingtip?: string) => ({ tailNumber: 'N1', model: AIRCRAFT_BY_ID.get(id)!, acquisition: 'owned', hubIata: 'ORD', cabin: {}, ...(wingtip ? { wingtip } : {}) }) as unknown as PlayerAircraft;

describe('wingtips', () => {
  it('every type with options is in the catalogue and has a picture for each', () => {
    for (const [id, t] of Object.entries(WINGTIP_TYPES)) {
      expect(AIRCRAFT_BY_ID.has(id), id).toBe(true);
      expect(t.options).toContain(t.usual);
      for (const w of t.options) expect(AIRCRAFT_PHOTOS[artIdFor(id, w)], `${id} ${w}`).toBeTruthy();
    }
  });
  it('old saves keep the usual wingtips and the same fuel', () => {
    expect(wingtipOf(ac('b737-800'))).toBe('winglet');
    expect(wingtipFuelFactor(ac('b737-800'), 2000)).toBe(1);
    expect(wingtipFuelFactor(ac('b787-9'), 2000)).toBe(1);
    expect(artIdFor('b737-800', undefined)).toBe('b737-800');
  });
  it('junk and the usual kind are dropped when loading', () => {
    expect(normaliseWingtip(ac('a320-200', 'scimitar')).wingtip).toBeUndefined();
    expect(normaliseWingtip(ac('a320-200', 'fence')).wingtip).toBeUndefined();
    expect(normaliseWingtip(ac('b787-9', 'winglet')).wingtip).toBeUndefined();
    expect(normaliseWingtip(ac('a320-200', 'sharklet')).wingtip).toBe('sharklet');
  });
  it('better wingtips save fuel, more on long flights; none burns more', () => {
    const sh = ac('a320-200', 'sharklet');
    expect(wingtipFuelFactor(sh, 2500)).toBeCloseTo(0.96, 3);
    expect(wingtipFuelFactor(sh, 300)).toBeGreaterThan(0.96);
    expect(wingtipFuelFactor(sh, 300)).toBeLessThan(1);
    expect(wingtipFuelFactor(ac('b737-800', 'none'), 2000)).toBeGreaterThan(1);
    expect(wingtipFuelFactor(ac('b737-800', 'scimitar'), 2000)).toBeLessThan(1);
  });
  it('fitting costs money, scimitars less over blended winglets', () => {
    expect(wingtipFitUsd(ac('b737-800'), 'scimitar')).toBe(800_000);
    expect(wingtipFitUsd(ac('b737-800', 'none'), 'scimitar')).toBe(2_000_000);
    expect(wingtipFitUsd(ac('b737-800'), 'winglet')).toBe(0);
    expect(wingtipFitUsd(ac('a320-200'), 'scimitar')).toBe(0);
  });
  it('saves only what differs from the usual, and pictures map back to their type', () => {
    expect(withWingtip(ac('a320-200', 'sharklet'), 'fence').wingtip).toBeUndefined();
    expect(withWingtip(ac('a320-200'), 'sharklet').wingtip).toBe('sharklet');
    expect(artIdFor('a320-200', 'sharklet')).toBe('a320-200~sharklet');
    expect(modelOfArt('a320-200~sharklet')).toBe('a320-200');
  });
});
