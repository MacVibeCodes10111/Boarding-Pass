import { describe, expect, it } from 'vitest';
import { DEFAULT_PALETTE, THEME_PRESETS, buildPalette, friendsColourOf } from './theme';

describe('friends’ aircraft colour', () => {
  it('each theme has its own, all different from that theme’s highlight and aircraft', () => {
    const seen = new Set<string>();
    for (const p of THEME_PRESETS) {
      expect(p.friends).toMatch(/^#[0-9a-f]{6}$/);
      expect(p.friends).not.toBe(p.accent);
      expect(p.friends).not.toBe(p.fleet ?? p.accent);
      seen.add(p.friends!);
      expect(buildPalette(p).friends).toBe(p.friends);
    }
    expect(seen.size).toBe(THEME_PRESETS.length);
  });

  it('a chosen colour wins; a theme saved before there was a choice gets its template’s', () => {
    const cockpit = THEME_PRESETS.find((p) => p.preset === 'cockpit')!;
    expect(friendsColourOf({ ...cockpit, friends: '#123456' })).toBe('#123456');
    expect(friendsColourOf({ preset: 'cockpit', base: cockpit.base, accent: cockpit.accent, fleet: cockpit.fleet })).toBe(cockpit.friends);
    expect(friendsColourOf({ preset: 'custom', base: '#000000', accent: '#ffffff', fleet: null })).toBe(DEFAULT_PALETTE.friends);
    expect(friendsColourOf({ preset: 'custom', base: '#000000', accent: '#ffffff', fleet: null, friends: 'nonsense' })).toBe(DEFAULT_PALETTE.friends);
  });
});
