import { describe, expect, it } from 'vitest';
import { MAX_LIVERY_CHARS, buildProfile, profileKey } from './profile';
import type { Livery } from './livery';
import type { SaveGameState } from './types';

const LOGO = 'data:image/png;base64,AAAA';
const layer = (o: Record<string, unknown>) => ({ id: 'x', name: 'My secret layer name', opacity: 1, region: 'fuselage', ...o });
const livery = (layers: unknown[]): Livery => ({ v: 2, name: 'Main', layers, logos: { a: LOGO }, badge: 'a' }) as unknown as Livery;
const save = (o: Partial<SaveGameState> = {}): SaveGameState =>
  ({
    saveId: 'SAVE-1790000000000',
    airlineName: '  Test Air ',
    airlineIata: 'ta',
    airlineCallsign: 'TESTER',
    hubIata: 'JFK',
    hubs: ['JFK', 'LHR'],
    gameMode: 'standard',
    cash: 987654321,
    simDay: 1,
    simMin: 0,
    econMin: 10080 * 3 + 5,
    fleet: [{ tailNumber: 'N1' }, { tailNumber: 'N2' }],
    schedule: [
      { origin: { iata_code: 'JFK' }, destination: { iata_code: 'LHR' } },
      { origin: { iata_code: 'LHR' }, destination: { iata_code: 'JFK' } },
      { origin: { iata_code: 'JFK' }, destination: { iata_code: 'BOS' } },
    ],
    liveries: [livery([layer({ kind: 'fill', colour: '#FFFFFF' })])],
    ...o,
  }) as unknown as SaveGameState;

describe('the profile', () => {
  it('has the airline’s details, tidied', () => {
    const p = buildProfile(save());
    expect(p).toMatchObject({ airline: 'Test Air', code: 'TA', callsign: 'TESTER', colours: { a: '#1d4e89', b: '#f5a623' } });
  });

  it('counts a route once in both directions, and sums up the airline', () => {
    expect(buildProfile(save()).stats).toEqual({ fleet: 2, routes: 2, airports: 3, hubs: 2, weeks: 4, founded: '2026-09-21' });
  });

  it('never carries anything private from the save', () => {
    const text = JSON.stringify(buildProfile(save({ career: { loans: [{ id: 'SECRETLOAN' }] } as never })));
    for (const secret of ['987654321', 'SECRETLOAN', 'tailNumber', 'N1', 'My secret layer name']) expect(text).not.toContain(secret);
  });

  it('leaves out logo pictures until they are in the cloud (A2)', () => {
    const p = buildProfile(save({ liveries: [livery([layer({ kind: 'fill', colour: '#ffffff' }), layer({ kind: 'logo', frame: 'fin', logo: 'a', x: 0, y: 0, size: 1, rot: 0 })])] }));
    const text = JSON.stringify(p);
    expect(text).not.toContain('data:');
    expect(text).not.toContain('"logo"');
    expect((p.liveries[0] as { layers: unknown[] }).layers).toHaveLength(1);
  });

  it('leaves out hidden layers', () => {
    const p = buildProfile(save({ liveries: [livery([layer({ kind: 'fill', colour: '#ffffff' }), layer({ kind: 'text', frame: 'body', text: 'draft', hidden: true })])] }));
    expect(JSON.stringify(p)).not.toContain('draft');
  });

  it('gives the same key every time for a career with no livery yet', () => {
    expect(profileKey(buildProfile(save({ liveries: undefined })))).toBe(profileKey(buildProfile(save({ liveries: undefined }))));
  });

  it('gives a career from before liveries the standard one', () => {
    const p = buildProfile(save({ liveries: undefined }));
    expect((p.liveries[0] as { layers: unknown[] }).layers.length).toBeGreaterThan(0);
  });

  it('copes with an old save’s missing fields', () => {
    const p = buildProfile(save({ schedule: undefined as never, fleet: undefined as never, hubs: undefined, econMin: undefined, saveId: 'old' }));
    expect(p.stats).toEqual({ fleet: 0, routes: 0, airports: 0, hubs: 1, weeks: 1 });
  });

  it('drops brush painting when liveries would be too big to share', () => {
    const strokes = Array.from({ length: 300 }, () => ({ colour: '#000000', width: 0.05, pts: Array.from({ length: 200 }, (_, i) => i / 300 + 0.123456) }));
    const p = buildProfile(save({ liveries: [livery([layer({ kind: 'fill', colour: '#ffffff' }), layer({ kind: 'paint', frame: 'body', strokes })])] }));
    expect(JSON.stringify(p.liveries).length).toBeLessThan(MAX_LIVERY_CHARS);
    expect(JSON.stringify(p)).not.toContain('strokes');
  });
});

describe('the profile’s key', () => {
  it('stays the same for the same airline, and changes when something shared changes', () => {
    const a = profileKey(buildProfile(save()));
    expect(profileKey(buildProfile(save()))).toBe(a);
    expect(profileKey(buildProfile(save({ cash: 5 })))).toBe(a);
    expect(profileKey(buildProfile(save({ airlineName: 'Other Air' })))).not.toBe(a);
  });
});
