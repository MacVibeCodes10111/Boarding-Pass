// ============================================================================
// THE SCHEDULE A PLAYER SHOWS FRIENDS (Update A, phase A4)
//   Friends' aircraft aren't streamed. A player who turns this on publishes their
//   weekly schedule, and each friend's game works out where the aircraft are, the
//   way it moves other airlines' traffic.
//
//   Careers run at different dates and speeds, so the other player's date means
//   nothing here. Their weekly pattern is flown on the viewer's own clock: the
//   same flight is in a different place on two friends' maps, and that's fine.
//   That's also why the snapshot has no date or game time in it.
//
//   Pure, because the Worker uses checkSnapshot too (it's bundled from this file):
//   every limit is checked again there, and again by whoever reads a snapshot.
//   Airports are codes only, so no text about them comes from another player.
// ============================================================================
import { moderate } from './moderation';

export const MAX_SNAPSHOT_BYTES = 200_000;
export const MAX_FLIGHTS = 3000;
export const MAX_REGS = 600;
const MAX_MODELS = 120;

/** origin, destination, departure (UTC minute of the day), block minutes, days (bit 0 = Monday), model, registration, flight number, livery (0 main, 1 special). */
export type SnapshotFlight = [string, string, number, number, number, number, number, string, number];
export interface ScheduleSnapshot {
  v: 1;
  models: string[];
  regs: string[];
  flights: SnapshotFlight[];
}

const AIRPORT = /^[A-Z0-9]{3}$/;
const MODEL = /^[A-Za-z0-9._-]{1,40}$/;
const REG = /^[A-Z0-9-]{2,12}$/;
const FLIGHT = /^([A-Z0-9]{2,3}?)[0-9]{1,5}[A-Z]?$/;

/**
 * Registrations and flight codes are the game's own, full of digits, and the word filter reads
 * digits as letters (455 as "ass"). Only their letters are checked, or real ones would be caught.
 */
const rude = (code: string) => Boolean(moderate(code.replace(/[0-9]/g, ' ')));

const whole = (x: unknown, lo: number, hi: number): x is number => typeof x === 'number' && Number.isInteger(x) && x >= lo && x <= hi;

/**
 * A snapshot with exactly the known fields, or null if anything about it is wrong. The Worker checks
 * the words too. A viewer doesn't need to, and 20 friends' worth would stall a phone for a moment.
 */
export function checkSnapshot(x: unknown, checkWords = true): ScheduleSnapshot | null {
  if (!x || typeof x !== 'object') return null;
  const { v, models, regs, flights } = x as Partial<ScheduleSnapshot>;
  if (v !== 1 || !Array.isArray(models) || !Array.isArray(regs) || !Array.isArray(flights)) return null;
  if (models.length > MAX_MODELS || regs.length > MAX_REGS || flights.length > MAX_FLIGHTS) return null;
  if (!models.every((m) => typeof m === 'string' && MODEL.test(m))) return null;
  if (!regs.every((r) => typeof r === 'string' && REG.test(r))) return null;
  // A registration is shown to other players, so it has to pass the word filter
  if (checkWords && regs.some(rude)) return null;
  const prefixes = new Set<string>();
  for (const f of flights) {
    if (!Array.isArray(f) || f.length !== 9) return null;
    const [o, d, dep, block, days, model, reg, no, livery] = f as unknown[];
    if (typeof o !== 'string' || !AIRPORT.test(o) || typeof d !== 'string' || !AIRPORT.test(d)) return null;
    if (!whole(dep, 0, 1439) || !whole(block, 1, 2880) || !whole(days, 1, 127)) return null;
    if (!whole(model, 0, models.length - 1) || !whole(reg, 0, regs.length - 1) || !whole(livery, 0, 1)) return null;
    if (typeof no !== 'string') return null;
    if (no) {
      const m = FLIGHT.exec(no);
      if (!m) return null;
      prefixes.add(m[1]);
    }
  }
  if (checkWords) for (const p of prefixes) if (rude(p)) return null;
  return { v: 1, models: models as string[], regs: regs as string[], flights: flights as SnapshotFlight[] };
}

/** What's needed from a career. Anything else in the save never comes near this file. */
export interface SnapshotSource {
  fleet: { tailNumber: string; model: { id: string }; livery?: number }[];
  schedule: {
    tailNumber: string;
    flightNumber: string;
    origin: { iata_code: string };
    destination: { iata_code: string };
    depTimeMin: number;
    blockTimeMin: number;
    daysOfWeek?: readonly boolean[];
  }[];
}

/** The career's weekly schedule, cut down to the limits. Flights it can't describe are left out. */
export function buildSnapshot(s: SnapshotSource): ScheduleSnapshot {
  const aircraft = new Map(s.fleet.map((a) => [a.tailNumber, a]));
  const rows: Row[] = [];
  const goodRegs = new Map<string, boolean>();
  for (const fl of s.schedule) {
    const ac = aircraft.get(fl.tailNumber);
    if (!ac) continue;
    const o = fl.origin?.iata_code;
    const d = fl.destination?.iata_code;
    const reg = fl.tailNumber;
    if (!o || !d || !AIRPORT.test(o) || !AIRPORT.test(d) || !MODEL.test(ac.model.id)) continue;
    if (!goodRegs.has(reg)) goodRegs.set(reg, REG.test(reg) && !rude(reg));
    if (!goodRegs.get(reg)) continue;
    const dep = ((Math.round(fl.depTimeMin) % 1440) + 1440) % 1440;
    const block = Math.round(fl.blockTimeMin);
    if (!Number.isFinite(dep) || !Number.isFinite(block) || block < 1 || block > 2880) continue;
    const days = fl.daysOfWeek ? fl.daysOfWeek.reduce((m, on, i) => (on && i < 7 ? m | (1 << i) : m), 0) : 127;
    if (!days) continue;
    const m = FLIGHT.exec(fl.flightNumber ?? '');
    const no = m && !rude(m[1]) ? fl.flightNumber : '';
    rows.push({ o, d, dep, block, days, model: ac.model.id, reg, no, livery: ac.livery === 1 ? 1 : 0 });
  }
  let n = Math.min(rows.length, MAX_FLIGHTS);
  for (;;) {
    const snap = fromRows(rows.slice(0, n));
    if (n === 0 || JSON.stringify(snap).length <= MAX_SNAPSHOT_BYTES) return snap;
    n = Math.floor(n * 0.9);
  }
}

interface Row {
  o: string;
  d: string;
  dep: number;
  block: number;
  days: number;
  model: string;
  reg: string;
  no: string;
  livery: number;
}

function fromRows(rows: Row[]): ScheduleSnapshot {
  const models: string[] = [];
  const regs: string[] = [];
  const modelAt = new Map<string, number>();
  const regAt = new Map<string, number>();
  const flights: SnapshotFlight[] = [];
  for (const r of rows) {
    if (!modelAt.has(r.model)) {
      if (models.length >= MAX_MODELS) continue;
      modelAt.set(r.model, models.push(r.model) - 1);
    }
    if (!regAt.has(r.reg)) {
      if (regs.length >= MAX_REGS) continue;
      regAt.set(r.reg, regs.push(r.reg) - 1);
    }
    flights.push([r.o, r.d, r.dep, r.block, r.days, modelAt.get(r.model)!, regAt.get(r.reg)!, r.no, r.livery]);
  }
  return { v: 1, models, regs, flights };
}
