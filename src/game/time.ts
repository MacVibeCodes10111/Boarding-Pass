// ============================================================================
// Time, day-of-week and formatting helpers
// ============================================================================
import type { WeekDays } from './types';

export const MIN_PER_DAY = 1440;
export const MIN_PER_WEEK = 7 * MIN_PER_DAY;
export const DAY_NAMES_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
export const ALL_DAYS: WeekDays = [true, true, true, true, true, true, true];

/** Wraps any minute value into 0..1439. */
export function wrapMin(totalMin: number): number {
  return ((totalMin % MIN_PER_DAY) + MIN_PER_DAY) % MIN_PER_DAY;
}

export function snapToFiveMin(totalMin: number): number {
  const snapped = Math.round(wrapMin(totalMin) / 5) * 5;
  return snapped >= MIN_PER_DAY ? 0 : snapped;
}

export function formatDurationHm(totalMin: number): string {
  const m = Math.max(0, Math.round(totalMin));
  const hrs = Math.floor(m / 60);
  const mins = m % 60;
  return hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
}

export function formatClockShort(totalMin: number): string {
  const norm = wrapMin(Math.floor(totalMin));
  const hh = Math.floor(norm / 60).toString().padStart(2, '0');
  const mm = (norm % 60).toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

export function formatClock(totalMin: number): string {
  return `${formatClockShort(totalMin)} UTC`;
}

/** Day index 0..6 (Mon..Sun) for a 1-based sim day (Day 1 = Monday). */
export function dayIndexOf(simDay: number): number {
  return (((simDay - 1) % 7) + 7) % 7;
}

/** Normalises possibly-missing day arrays from old saves. */
export function daysOrAll(days?: WeekDays | null): WeekDays {
  return days && days.length === 7 ? days : ALL_DAYS;
}

/**
 * Rotates a day pattern forward by `n` days. Used when a leg departs after
 * midnight relative to the leg it follows (Mon 23:00 → Tue 01:00).
 */
export function shiftDays(days: WeekDays, n: number): WeekDays {
  const k = ((n % 7) + 7) % 7;
  if (k === 0) return [...days];
  return [0, 1, 2, 3, 4, 5, 6].map((d) => days[(d - k + 7) % 7]);
}

export function formatMoneyM(usd: number, digits = 1): string {
  return `$${(usd / 1_000_000).toFixed(digits)}M`;
}
