import { describe, expect, it } from 'vitest';
import { importDaysLeft, isOldImport } from './cloud';

const NOW = Date.parse('2026-12-01T00:00:00Z');
const ov = { oldBefore: '2026-11-17T17:43:02Z', importUntil: '2027-02-15T17:42:18Z' };

describe('importing airlines from before online play', () => {
  it('counts the days left, rounded up, and 0 once it has passed', () => {
    expect(importDaysLeft(ov.importUntil, NOW)).toBe(77);
    expect(importDaysLeft(ov.importUntil, Date.parse('2027-03-01T00:00:00Z'))).toBe(0);
    expect(importDaysLeft(null, NOW)).toBeNull();
  });
  it('an airline started before the release can come in past the limit, until the deadline', () => {
    expect(isOldImport('SAVE-1763251200000', ov, NOW)).toBe(true);
    expect(isOldImport('SAVE-1763251200000', ov, Date.parse('2027-03-01T00:00:00Z'))).toBe(false);
  });
  it('a new airline, an odd id, or no rules from the server never does', () => {
    expect(isOldImport(`SAVE-${Date.parse('2026-11-20T00:00:00Z')}`, ov, NOW)).toBe(false);
    expect(isOldImport('my-save', ov, NOW)).toBe(false);
    expect(isOldImport('SAVE-1763251200000', null, NOW)).toBe(false);
    expect(isOldImport('SAVE-1763251200000', { importUntil: ov.importUntil }, NOW)).toBe(false);
  });
});
