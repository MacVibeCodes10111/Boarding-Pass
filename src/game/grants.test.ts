import { describe, expect, it } from 'vitest';
import { normaliseGrants, withGrants, MAX_GRANT_IDS } from './grantSave';
import { grantActions, grantLetter, parseGrants } from './grants';

const A = '2868d63e-33ff-47e9-a62c-3290503ff41f';
const B = 'f6fdbb14-cbf4-4063-91de-3f15d808c11f';
const C = '0b7e1c52-9d0a-4f43-8a51-6f3c2a1d9e77';

describe('admin grants', () => {
  it('old saves and junk load as nothing applied', () => {
    expect(normaliseGrants(undefined)).toEqual({ applied: [] });
    expect(normaliseGrants({ applied: [A, A, 'nope', 5, null, B] })).toEqual({ applied: [A, B] });
    expect(normaliseGrants('x')).toEqual({ applied: [] });
  });

  it('keeps only the newest ids', () => {
    let g = { applied: [] as string[] };
    for (let i = 0; i < MAX_GRANT_IDS + 5; i++) g = withGrants(g, [`${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`]);
    expect(g.applied.length).toBe(MAX_GRANT_IDS);
    expect(g.applied[g.applied.length - 1]).toBe(`${String(MAX_GRANT_IDS + 4).padStart(8, '0')}-0000-4000-8000-000000000000`);
  });

  it('drops malformed grants from the server', () => {
    const list = parseGrants([
      { id: A, kind: 'cash', amount: 5_000_000, reason: 'outage', at: 'x' },
      { id: 'bad', kind: 'cash', amount: 5 },
      { id: B, kind: 'cash', amount: 0 },
      { id: C, kind: 'cash', amount: 'lots' },
      null,
    ]);
    expect(list.map((g) => g.id)).toEqual([A]);
    expect(parseGrants(null)).toEqual([]);
  });

  it('applies each grant once, claims ones applied before, and leaves unknown kinds', () => {
    const list = parseGrants([
      { id: A, kind: 'cash', amount: 5_000_000, reason: 'r' },
      { id: B, kind: 'cash', amount: -1000, reason: 'r' },
      { id: C, kind: 'gems', amount: 50, reason: 'r' },
    ]);
    const first = grantActions(list, { applied: [] });
    expect(first.apply.map((g) => g.id)).toEqual([A, B]);
    expect(first.claim).toEqual([]);
    const again = grantActions(list, { applied: [A] });
    expect(again.apply.map((g) => g.id)).toEqual([B]);
    expect(again.claim).toEqual([A]);
  });

  it('writes a letter with the amount and reason', () => {
    const [give, take] = parseGrants([
      { id: A, kind: 'cash', amount: 5_000_000, reason: 'Sorry about the outage' },
      { id: B, kind: 'cash', amount: -1000, reason: '' },
    ]);
    const l = grantLetter(give, 'Jet Air', 100, false);
    expect(l.subject).toBe('$5,000,000 added to your account');
    expect(l.body.join(' ')).toContain('Reason: Sorry about the outage');
    expect(l.reward).toBeUndefined();
    const t = grantLetter(take, 'Jet Air', 100, true);
    expect(t.subject).toBe('$1,000 taken from your account');
    expect(t.body.join(' ')).toContain('Sandbox');
  });
});
