import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
const { cleanFriendCode, formatFriendCode, friendAnswer, normaliseFriends } = await import('./friends');
const { normaliseMyAirlines } = await import('./cloud');

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const card = { airline: 'Alpha Air', code: 'AA', callsign: 'ALPHA', colours: { a: '#112233', b: '#445566' }, stats: { fleet: 7 }, badge: 'a'.repeat(64) };

describe('the friends list from the server', () => {
  it('comes through as sent', () => {
    const d = normaliseFriends({ id: id(1), code: 'BCDF2345', friends: [{ id: id(2), onMap: false, card }], incoming: [{ id: id(3), card }], outgoing: [{ id: id(4), code: 'GHJK6789' }], blocked: [{ id: id(5), label: 'Beta' }] });
    expect(d?.friends[0]).toEqual({ id: id(2), onMap: false, card: { airline: 'Alpha Air', code: 'AA', callsign: 'ALPHA', colours: { a: '#112233', b: '#445566' }, fleet: 7, stats: null, badge: 'a'.repeat(64) } });
    expect(d?.incoming).toHaveLength(1);
    expect(d?.outgoing[0].code).toBe('GHJK6789');
    expect(d?.blocked[0].label).toBe('Beta');
  });

  it.each([[null], ['text'], [{}], [{ id: 'x', code: 'BCDF2345' }], [{ id: id(1), code: 'lowercase' }]])('is refused when it isn’t a list: %j', (x) => {
    expect(normaliseFriends(x)).toBeNull();
  });

  it('survives damaged entries', () => {
    const d = normaliseFriends({ id: id(1), code: 'BCDF2345', friends: [null, 'x', { id: 'not-an-id', card }, { id: id(2), card: 'junk' }], incoming: 'nope', blocked: [{ id: id(5) }] });
    expect(d?.friends).toEqual([{ id: id(2), onMap: true, card: null }]);
    expect(d?.incoming).toEqual([]);
    expect(d?.outgoing).toEqual([]);
    expect(d?.blocked[0].label).toBe('An airline');
  });

  it('never lets a bad colour or badge through', () => {
    const c = normaliseFriends({ id: id(1), code: 'BCDF2345', friends: [{ id: id(2), card: { ...card, colours: { a: 'url(x)', b: 'red;x' }, badge: 'javascript:alert(1)', airline: 'x'.repeat(500) } }] })?.friends[0].card;
    expect(c?.colours).toEqual({ a: '#475569', b: '#94a3b8' });
    expect(c?.badge).toBeNull();
    expect(c?.airline).toHaveLength(40);
  });

  it('keeps the summary stats, checked', () => {
    const stats = { fleet: 7, routes: 12, airports: 9, hubs: 2, weeks: 30.7, founded: '2026-01-02', cash: 999 };
    const c = normaliseFriends({ id: id(1), code: 'BCDF2345', friends: [{ id: id(2), card: { ...card, stats } }] })?.friends[0].card;
    expect(c?.stats).toEqual({ routes: 12, airports: 9, hubs: 2, weeks: 30, founded: '2026-01-02' });
    const bad = normaliseFriends({ id: id(1), code: 'BCDF2345', friends: [{ id: id(2), card: { ...card, stats: { ...stats, routes: 'x', founded: '<b>' } } }] })?.friends[0].card;
    expect(bad?.stats).toBeNull();
  });
});

describe('friend codes', () => {
  it('read in two parts', () => expect(formatFriendCode('BCDF2345')).toBe('BCDF 2345'));
  it('accept spaces, dashes and small letters', () => expect(cleanFriendCode(' bcdf-23 45 ')).toBe('BCDF2345'));
  it('have an answer for everything the server can say', () => {
    for (const r of ['sent', 'accepted', 'not_found', 'self', 'already', 'already_sent', 'too_soon', 'you_blocked', 'limit', 'their_limit', 'too_many_today', 'share_first', 'off']) expect(friendAnswer(r)).not.toMatch(/didn’t work/);
    expect(friendAnswer('something new')).toMatch(/didn’t work/);
  });
});

describe('the player’s shared airlines from the server', () => {
  it('keeps each airline’s own code, mode and map choice', () => {
    const list = normaliseMyAirlines([
      { id: id(1), saveId: 'SAVE-1', airline: 'Alpha Air', code: 'AA', friendCode: 'BCDF2345', mode: 'career', mapOn: true },
      { id: id(2), saveId: 'SAVE-2', airline: 'Beta Air', code: 'BB', friendCode: 'GHJK6789', mode: 'sandbox', mapOn: false },
    ]);
    expect(list.map((a) => [a.saveId, a.friendCode, a.mode, a.mapOn])).toEqual([
      ['SAVE-1', 'BCDF2345', 'career', true],
      ['SAVE-2', 'GHJK6789', 'sandbox', false],
    ]);
  });

  it('leaves out anything malformed, and never has more than ten', () => {
    const many = Array.from({ length: 14 }, (_, i) => ({ id: id(i + 1), saveId: `S${i}`, airline: 'X', friendCode: 'BCDF2345', mode: 'career' }));
    expect(normaliseMyAirlines(many)).toHaveLength(10);
    expect(normaliseMyAirlines([{ id: 'nope', saveId: 'S' }, { id: id(1) }, null, 'x'])).toEqual([]);
    expect(normaliseMyAirlines({})).toEqual([]);
    // An odd mode is treated as Career, an odd code as none
    expect(normaliseMyAirlines([{ id: id(1), saveId: 'S', mode: 'cheat', friendCode: 'AEIOU123' }])[0]).toMatchObject({ mode: 'career', friendCode: '' });
  });

  it('a friends list says which mode the airline plays', () => {
    expect(normaliseFriends({ id: id(1), code: 'BCDF2345', mode: 'sandbox' })?.mode).toBe('sandbox');
    expect(normaliseFriends({ id: id(1), code: 'BCDF2345' })?.mode).toBe('career');
  });

  it('explains a request to the other mode', () => {
    expect(friendAnswer('other_mode')).toMatch(/Career airlines can only be friends with Career/);
  });
});
