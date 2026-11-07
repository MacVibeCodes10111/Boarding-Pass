import { beforeEach, describe, expect, it, vi } from 'vitest';

const mem = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
});

const { LEGAL_KEY, acceptLegal, clearOnlineState, featureOn, legalAccepted, onFeaturesChange, setFeatures } = await import('./features');

beforeEach(() => {
  mem.clear();
  setFeatures(null);
});

describe('feature flags', () => {
  it('are all off until the server says otherwise', () => {
    expect(featureOn('online')).toBe(false);
    expect(featureOn('marketplace')).toBe(false);
  });

  it('switch on only what the server enables', () => {
    setFeatures([{ feature: 'online', enabled: true }, { feature: 'friends', enabled: false }]);
    expect(featureOn('online')).toBe(true);
    expect(featureOn('friends')).toBe(false);
  });

  it.each([[null], [undefined], ['yes'], [{ feature: 'online', enabled: true }], [[{ feature: 'online', enabled: 'true' }]], [[{ feature: 'online', enabled: 1 }]], [[null]]])(
    'stay off with a bad answer: %j',
    (bad) => {
      setFeatures(bad);
      expect(featureOn('online')).toBe(false);
    }
  );

  it('ignore features this version doesn’t know', () => {
    setFeatures([{ feature: 'something_new', enabled: true }]);
    expect(featureOn('something_new' as 'online')).toBe(false);
  });

  it('go off again when the server can’t be read', () => {
    setFeatures([{ feature: 'online', enabled: true }]);
    setFeatures(null);
    expect(featureOn('online')).toBe(false);
  });

  it('tell listeners only when something changed', () => {
    const fn = vi.fn();
    const stop = onFeaturesChange(fn);
    setFeatures([{ feature: 'online', enabled: true }]);
    setFeatures([{ feature: 'online', enabled: true }]);
    expect(fn).toHaveBeenCalledTimes(1);
    stop();
  });
});

describe('signing out', () => {
  it('forgets the flags and the old sharing choices', () => {
    mem.set('bp_online_sharing_v1', '{"map":true}');
    setFeatures([{ feature: 'online', enabled: true }]);
    clearOnlineState();
    expect(mem.has('bp_online_sharing_v1')).toBe(false);
    expect(featureOn('online')).toBe(false);
  });
});

describe('agreeing to the legal documents', () => {
  it('starts not agreed, and stays agreed once they have', () => {
    expect(legalAccepted()).toBe(false);
    acceptLegal();
    expect(legalAccepted()).toBe(true);
  });
  it('asks again when the documents change', () => {
    localStorage.setItem(LEGAL_KEY, '2020-01-01');
    expect(legalAccepted()).toBe(false);
  });
  it('is forgotten on sign-out', () => {
    acceptLegal();
    clearOnlineState();
    expect(legalAccepted()).toBe(false);
  });
});
