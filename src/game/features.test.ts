import { beforeEach, describe, expect, it, vi } from 'vitest';

const mem = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
});

const { SHARING_KEY, clearOnlineState, featureOn, onFeaturesChange, readSharing, setFeatures, setSharing } = await import('./features');

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

describe('sharing choices', () => {
  it('are off by default', () => {
    expect(readSharing()).toEqual({ profile: false, map: false });
  });

  it('remember what the player turned on', () => {
    setSharing('profile', true);
    expect(readSharing()).toEqual({ profile: true, map: false });
    setSharing('profile', false);
    expect(readSharing().profile).toBe(false);
  });

  it.each(['not json', '[]', 'null', '{"profile":"true"}', '{"profile":1}'])('stay off with damaged storage: %s', (saved) => {
    mem.set(SHARING_KEY, saved);
    expect(readSharing().profile).toBe(false);
  });

  it('are forgotten on sign-out, along with the flags', () => {
    setSharing('map', true);
    setFeatures([{ feature: 'online', enabled: true }]);
    clearOnlineState();
    expect(readSharing().map).toBe(false);
    expect(featureOn('online')).toBe(false);
  });
});
