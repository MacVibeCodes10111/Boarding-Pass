import { afterEach, describe, expect, it, vi } from 'vitest';
import { anchorClock, awayMs, clockAnchored, resetClock, trustedNow } from './trustedClock';

afterEach(() => {
  resetClock();
  vi.restoreAllMocks();
});

describe('trusted clock', () => {
  it('uses the device clock until the server answers', () => {
    expect(clockAnchored()).toBe(false);
    expect(Math.abs(trustedNow() - Date.now())).toBeLessThan(50);
  });

  it('runs by the server, ignoring a device clock moved ahead', () => {
    const server = 1_800_000_000_000;
    let steady = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => steady);
    anchorClock(server, 200);
    expect(trustedNow()).toBe(server + 100);
    // The player moves the device clock forward a week: nothing changes
    vi.spyOn(Date, 'now').mockReturnValue(server + 7 * 86_400_000);
    steady += 60_000;
    expect(trustedNow()).toBe(server + 100 + 60_000);
  });

  it('ignores nonsense from the server', () => {
    anchorClock(NaN);
    anchorClock(42);
    expect(clockAnchored()).toBe(false);
  });

  it('never counts more away time than since the server last had the save', () => {
    const now = 1_800_000_000_000;
    expect(awayMs(now, now - 3_600_000)).toBe(3_600_000);
    // The save claims it was left a month ago, but the server had it ten minutes ago
    expect(awayMs(now, now - 30 * 86_400_000, now - 600_000)).toBe(600_000);
    expect(awayMs(now, now + 5000)).toBe(0);
    expect(awayMs(now, undefined)).toBe(0);
  });
});
