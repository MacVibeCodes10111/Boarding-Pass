import { describe, expect, it } from 'vitest';
import { MAX_LIVERY_CHARS, buildProfile, liveryFromProfile, logoBytes, logoHash, profileKey } from './profile';
import { sha256Hex } from './sha256';
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

// A 1×1 PNG: the picture's bytes are what get hashed, not the data URL
const PICTURE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==';
const withLogo = () =>
  save({ liveries: [{ v: 2, name: 'Main', badge: 'a', logos: { a: PICTURE, unused: LOGO }, layers: [layer({ kind: 'fill', colour: '#ffffff' }), layer({ kind: 'logo', frame: 'fin', logo: 'a', x: 0.5, y: 0.5, size: 1, rot: 0 })] } as unknown as Livery] });

describe('logos in a profile', () => {
  it('names a logo by its picture’s hash, the way the Worker does', () => {
    expect(logoHash(PICTURE)).toBe(sha256Hex(logoBytes(PICTURE)));
    expect(logoHash(PICTURE)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('shares logos by name only, so pictures never go to the database', () => {
    const p = buildProfile(withLogo(), { logos: true });
    const h = logoHash(PICTURE);
    const shared = p.liveries[0] as { layers: { kind: string; logo?: string }[]; badge?: string };
    expect(shared.badge).toBe(h);
    expect(shared.layers.find((l) => l.kind === 'logo')?.logo).toBe(h);
    expect(JSON.stringify(p.liveries)).not.toContain('data:');
  });

  it('only uploads logos the liveries actually use', () => {
    expect(Object.keys(buildProfile(withLogo(), { logos: true }).logos)).toEqual([logoHash(PICTURE)]);
  });

  it('leaves logos out when they’re switched off', () => {
    const p = buildProfile(withLogo());
    expect(p.logos).toEqual({});
    expect(JSON.stringify(p.liveries)).not.toContain(logoHash(PICTURE));
    expect(p.liveries[0]).not.toHaveProperty('badge');
  });

  it('notices when a logo is swapped, though the layout is the same', () => {
    const other = withLogo();
    other.liveries![0].logos.a = 'data:image/png;base64,AAAA';
    expect(profileKey(buildProfile(other, { logos: true }))).not.toBe(profileKey(buildProfile(withLogo(), { logos: true })));
  });

  it('comes back as a livery that can be painted', () => {
    const shared = buildProfile(withLogo(), { logos: true }).liveries[0];
    const l = liveryFromProfile(shared, { [logoHash(PICTURE)]: PICTURE })!;
    const logo = l.layers.find((x) => x.kind === 'logo') as Extract<Livery['layers'][number], { kind: 'logo' }>;
    expect(l.logos[logo.logo]).toBe(PICTURE);
    expect(l.badge).toBe(logo.logo);
    expect(new Set(l.layers.map((x) => x.id)).size).toBe(l.layers.length);
  });

  it('draws a livery without a logo that’s waiting for review', () => {
    const shared = buildProfile(withLogo(), { logos: true }).liveries[0];
    const l = liveryFromProfile(shared, {})!;
    expect(l.layers.map((x) => x.kind)).toEqual(['fill']);
    expect(l.badge).toBeUndefined();
  });

  it('won’t take a picture that isn’t a real logo from another player', () => {
    const shared = buildProfile(withLogo(), { logos: true }).liveries[0];
    const l = liveryFromProfile(shared, { [logoHash(PICTURE)]: 'https://example.com/x.png' })!;
    expect(l.layers.map((x) => x.kind)).toEqual(['fill']);
  });
});

describe('sha256', () => {
  const text = (s: string) => new TextEncoder().encode(s);
  it('matches the published test values', () => {
    expect(sha256Hex(text(''))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex(text('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex(text('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });
  it('matches the browser’s own at every padding length', async () => {
    for (const n of [55, 56, 63, 64, 65, 119, 120, 16384]) {
      const b = new Uint8Array(n).map((_, i) => i * 31);
      const real = [...new Uint8Array(await crypto.subtle.digest('SHA-256', b))].map((x) => x.toString(16).padStart(2, '0')).join('');
      expect(sha256Hex(b)).toBe(real);
    }
  });
});
