import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
const { ALLIANCE_NAME, allianceAnswer, cleanTag, normaliseAlliances, validTag } = await import('./alliances');

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const card = (name: string) => ({ airline: name, code: 'AA', callsign: 'ALPHA', colours: { a: '#112233', b: '#445566' }, stats: { fleet: 4 }, badge: null });
const alliance = {
  id: id(9), name: 'Star Union', tag: 'SU', colours: { a: '#0b6e4f', b: '#f5a623' }, description: 'Flying together', logo: null,
  createdAt: '2026-11-07T10:00:00Z', role: 'leader', max: 20, count: 3,
  members: [{ id: id(1), role: 'leader', joinedAt: '2026-11-07T10:00:00Z', me: true, card: card('Alpha Air') }, { id: id(2), role: 'member', joinedAt: '2026-11-07T11:00:00Z', me: false, card: card('Beta Air') }],
  invited: [{ id: id(3), at: '2026-11-07T12:00:00Z', card: card('Gamma Air') }],
};

describe('the Alliances screen from the server', () => {
  it('comes through as sent', () => {
    const d = normaliseAlliances({ mode: 'career', alliance, invites: [] });
    expect(d?.alliance?.name).toBe('Star Union');
    expect(d?.alliance?.role).toBe('leader');
    expect(d?.alliance?.members.map((m) => m.card?.airline)).toEqual(['Alpha Air', 'Beta Air']);
    expect(d?.alliance?.count).toBe(3); // one hidden by a block still counts
    expect(d?.alliance?.invited[0].card?.airline).toBe('Gamma Air');
  });

  it('with no alliance, lists the invites', () => {
    const d = normaliseAlliances({ mode: 'sandbox', alliance: null, invites: [{ alliance: { ...alliance, members: 3 }, from: card('Alpha Air'), at: '2026-11-07T12:00:00Z' }, { alliance: { tag: 'bad' } }] });
    expect(d?.mode).toBe('sandbox');
    expect(d?.alliance).toBeNull();
    expect(d?.invites).toHaveLength(1);
    expect(d?.invites[0].alliance).toMatchObject({ tag: 'SU', members: 3 });
  });

  it('never lets bad text, colours or ids through', () => {
    const d = normaliseAlliances({ mode: 'career', alliance: { ...alliance, colours: { a: 'url(x)', b: '#000000' }, description: 'x'.repeat(900), logo: 'javascript:1', members: [...alliance.members, { id: 'nope', role: 'leader' }], role: 'boss' }, invites: 'x' });
    expect(d?.alliance?.colours.a).toBe('#475569');
    expect(d?.alliance?.description).toHaveLength(300);
    expect(d?.alliance?.logo).toBeNull();
    expect(d?.alliance?.members).toHaveLength(2);
    expect(d?.alliance?.role).toBe('member');
    expect(d?.invites).toEqual([]);
  });

  it('a bad tag means no alliance', () => {
    expect(normaliseAlliances({ alliance: { ...alliance, tag: '<script>' } })?.alliance).toBeNull();
    expect(normaliseAlliances(null)).toBeNull();
  });
});

describe('what players type', () => {
  it('tags are capitals and digits, 2 to 4', () => {
    expect(cleanTag('st-u 9x')).toBe('STU9');
    expect(validTag('SU')).toBe(true);
    expect(validTag('S')).toBe(false);
  });
  it('names', () => {
    expect(ALLIANCE_NAME.test('Star Union')).toBe(true);
    expect(ALLIANCE_NAME.test('Sky & Sea')).toBe(true);
    expect(ALLIANCE_NAME.test('Ünion Aérea')).toBe(true);
    expect(ALLIANCE_NAME.test('<b>Star</b>')).toBe(false);
    expect(ALLIANCE_NAME.test('Hi')).toBe(false);
  });
  it('every server answer has words', () => {
    for (const a of ['bad_name', 'bad_tag', 'name_taken', 'tag_taken', 'not_friend', 'other_mode', 'full', 'in_alliance']) expect(allianceAnswer(a)).not.toBe('');
    expect(allianceAnswer('created')).toBe('');
    expect(allianceAnswer('???')).toMatch(/didn’t work/);
  });
});
