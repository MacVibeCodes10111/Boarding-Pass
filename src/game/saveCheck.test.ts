import { describe, expect, it } from 'vitest';
import { ECONOMY_RATE } from './clock';
import { MIN_PER_WEEK } from './time';
import { NORMAL_RATE, judgeSave } from './saveCheck';
import type { SaveStats } from './saveStats';

const HOUR = 3_600_000;
const base: SaveStats = { mode: 'career', cash: 100_000_000, debt: 0, fleet: 10, econMin: 10 * MIN_PER_WEEK };

describe('server save check', () => {
  it('uses the game’s normal speed', () => expect(NORMAL_RATE).toBe(ECONOMY_RATE.normal));

  it('passes honest play', () => {
    // A real day: one game week, a strong airline banks $15M a plane
    const next = { ...base, econMin: base.econMin! + MIN_PER_WEEK, cash: base.cash! + 150_000_000 };
    expect(judgeSave(base, next, 24 * HOUR)).toEqual([]);
  });

  it('flags game time running faster than real time', () => {
    const next = { ...base, econMin: base.econMin! + 4 * MIN_PER_WEEK };
    expect(judgeSave(base, next, HOUR)).toContain('time');
  });

  it('flags cash flights could not earn', () => {
    const next = { ...base, econMin: base.econMin! + 60, cash: 50_000_000_000 };
    expect(judgeSave(base, next, HOUR)).toEqual(['cash']);
  });

  it('allows loans, sales, rewards and grants', () => {
    expect(judgeSave(base, { ...base, cash: base.cash! + 2_000_000_000, debt: 2_200_000_000 }, HOUR)).toEqual([]);
    expect(judgeSave(base, { ...base, fleet: 6, cash: base.cash! + 2_500_000_000 }, HOUR)).toEqual([]);
    expect(judgeSave(base, { ...base, cash: base.cash! + 900_000_000 }, HOUR)).toEqual([]);
    expect(judgeSave(base, { ...base, cash: base.cash! + 5_000_000_000 }, HOUR, 5_000_000_000)).toEqual([]);
  });

  it('flags an edited save, and leaves Sandbox alone otherwise', () => {
    expect(judgeSave(base, { ...base, tampered: true }, HOUR)).toEqual(['edited']);
    expect(judgeSave(base, { ...base, mode: 'sandbox', cash: 1e14, econMin: 1e9 }, HOUR)).toEqual([]);
  });

  it('judges a first look against the whole career', () => {
    expect(judgeSave(null, { ...base, cash: 5_000_000_000 }, null)).toEqual([]);
    expect(judgeSave(null, { ...base, cash: 500_000_000_000 }, null)).toEqual(['cash']);
  });
});
