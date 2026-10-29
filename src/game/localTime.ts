// ============================================================================
// LOCAL TIMES (v2.55)
//   Schedules run on UTC. These helpers turn a UTC time of day into the local
//   time at an airport (from its time zone in network.json, daylight saving
//   as it is today) or on this computer. Airports without a known time zone
//   get no local time rather than a guess.
// ============================================================================
import { tzOffsetMinutes } from './aiTraffic';
import { getNetwork } from './demand';
import { MIN_PER_DAY, formatClockShort } from './time';

/** The airport's UTC offset today in minutes (null when its time zone isn't known). */
export function airportOffsetMin(iata: string | undefined, atMs = Date.now()): number | null {
  if (!iata) return null;
  const tz = getNetwork()?.airports.get(iata.toUpperCase())?.tz;
  return tz ? tzOffsetMinutes(tz, atMs) : null;
}

/** This computer's UTC offset in minutes. */
export const deviceOffsetMin = (atMs = Date.now()) => -new Date(atMs).getTimezoneOffset();

/** "UTC−4", "UTC+5:30", "UTC" */
export function offsetLabel(off: number): string {
  if (off === 0) return 'UTC';
  const sign = off > 0 ? '+' : '−';
  const a = Math.abs(off);
  return `UTC${sign}${Math.floor(a / 60)}${a % 60 ? `:${String(a % 60).padStart(2, '0')}` : ''}`;
}

/** A UTC time of day shifted by an offset: the clock text, and −1/0/+1 for the day it falls on. */
export function shiftClock(utcMin: number, off: number): { text: string; dayShift: number } {
  const t = utcMin + off;
  const dayShift = Math.floor(t / MIN_PER_DAY) - Math.floor(utcMin / MIN_PER_DAY);
  return { text: formatClockShort(((t % MIN_PER_DAY) + MIN_PER_DAY) % MIN_PER_DAY), dayShift };
}

/** "04:00" local at the airport, with "(+1)" / "(−1)" when it's another day there; null if unknown. */
export function airportLocalClock(utcMin: number, iata: string | undefined): string | null {
  const off = airportOffsetMin(iata);
  if (off === null) return null;
  const { text, dayShift } = shiftClock(utcMin, off);
  return dayShift ? `${text} (${dayShift > 0 ? '+' : '−'}${Math.abs(dayShift)})` : text;
}

/** "AUA 04:00 → JFK 08:30 local", or the part that is known; '' when neither is. */
export function legLocalText(depUtcMin: number, arrUtcMin: number, from: string, to: string): string {
  const d = airportLocalClock(depUtcMin, from);
  const a = airportLocalClock(arrUtcMin, to);
  if (!d && !a) return '';
  return `${d ? `${from} ${d}` : from} → ${a ? `${to} ${a}` : to} local`;
}
