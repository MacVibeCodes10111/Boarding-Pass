// ============================================================================
// WEEKLY BLOCK SCHEDULE: conflicts, spatial continuity, circuits & route planning
// ============================================================================
import { flightNumberBand, registrationsForNewAircraft } from './registrations';
import { getRouteDemandAndFares } from './economics';
import { calcBlockTimeMin, calcDistanceNm } from './geo';
import { airportRestrictionFor } from './tiers';
import { aircraftGateCode } from './gateCode';
import {
  DAY_NAMES_SHORT,
  MIN_PER_DAY,
  MIN_PER_WEEK,
  daysOrAll,
  formatClockShort,
  shiftDays,
  snapToFiveMin,
} from './time';
import type {
  Airport,
  CandidateLeg,
  Fares,
  GameAlert,
  PlayerAircraft,
  ScheduledFlight,
  WeekDays,
} from './types';

const ceilToFive = (min: number) => Math.ceil(min / 5) * 5;

let idCounter = 0;
/** Unique id even when several flights are created in the same millisecond. */
export function makeId(prefix: string): string {
  idCounter = (idCounter + 1) % 1_000_000;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

export function flightsForTail(schedule: ScheduledFlight[], tailNumber: string): ScheduledFlight[] {
  return schedule
    .filter((f) => f.tailNumber === tailNumber)
    .sort((a, b) => a.depTimeMin - b.depTimeMin);
}

// ----------------------------------------------------------------------------
// Flight-number and tail-number allocation
// ----------------------------------------------------------------------------
export function isFlightNumberTaken(schedule: ScheduledFlight[], flightNumber: string, ignoreId?: string) {
  const fn = flightNumber.trim().toUpperCase();
  return schedule.some((f) => f.id !== ignoreId && f.flightNumber.toUpperCase() === fn);
}

/**
 * Free flight number for this airline, skipping `alsoTaken`. With a distance
 * it comes from the range airlines use for that length (long-haul 1–99,
 * short hops 2000+); for a round trip (`pair`) it is an odd number whose even
 * neighbour is free too, for the return flight.
 */
export function nextFreeFlightNumber(
  schedule: ScheduledFlight[],
  airlineIata: string,
  alsoTaken: string[] = [],
  distanceNm?: number,
  pair = false
): string {
  const prefix = airlineIata.toUpperCase();
  const taken = new Set([...schedule.map((f) => f.flightNumber.toUpperCase()), ...alsoTaken.map((s) => s.toUpperCase())]);
  const free = (n: number) => !taken.has(`${prefix}${n}`);
  const [lo, hi] = flightNumberBand(distanceNm);
  const tryRange = (a: number, b: number) => {
    for (let n = a; n <= b; n++) {
      if (pair && n % 2 === 0) continue;
      if (free(n) && (!pair || free(n + 1))) return `${prefix}${n}`;
    }
    return null;
  };
  return tryRange(lo, hi) ?? tryRange(101, 9998) ?? `${prefix}${Date.now() % 100000}`;
}

/** The return flight's number: the outbound's plus one when that is free. */
export function returnFlightNumber(schedule: ScheduledFlight[], airlineIata: string, outbound: string, distanceNm?: number): string {
  const m = outbound.toUpperCase().match(/^(.*?)(\d+)$/);
  if (m) {
    const next = `${m[1]}${Number(m[2]) + 1}`;
    if (!schedule.some((f) => f.flightNumber.toUpperCase() === next)) return next;
  }
  return nextFreeFlightNumber(schedule, airlineIata, [outbound], distanceNm);
}

/** First free registration for a new aircraft based at a hub in `country` (see registrations.ts). */
export function nextFreeTailNumber(fleet: PlayerAircraft[], airlineIata: string, country = 'US'): string {
  return registrationsForNewAircraft(fleet.map((a) => a.tailNumber), airlineIata, country, 1)[0];
}

// ----------------------------------------------------------------------------
// Circuits (where an aircraft starts and ends its day)
// ----------------------------------------------------------------------------
export interface AircraftCircuitStatus {
  sortedFlights: ScheduledFlight[];
  startIata: string;
  currentEndIata: string;
  isClosedLoop: boolean;
  hasSpatialBreak: boolean;
  spatialBreakMessage: string | null;
  chainPath: string[];
  lastFlight: ScheduledFlight | null;
  /** Earliest snapped departure after the last leg lands and turns. */
  nextReadyDepMin: number;
  /** 1 when nextReadyDepMin falls after midnight relative to the last leg's day. */
  nextReadyDayShift: number;
}

export function getAircraftCircuitStatus(
  aircraft: PlayerAircraft,
  allSchedule: ScheduledFlight[]
): AircraftCircuitStatus {
  const sortedFlights = flightsForTail(allSchedule, aircraft.tailNumber);

  if (sortedFlights.length === 0) {
    return {
      sortedFlights,
      startIata: aircraft.hubIata,
      currentEndIata: aircraft.hubIata,
      isClosedLoop: true,
      hasSpatialBreak: false,
      spatialBreakMessage: null,
      chainPath: [aircraft.hubIata],
      lastFlight: null,
      nextReadyDepMin: 480,
      nextReadyDayShift: 0,
    };
  }

  // Legs sorted by time of day are a loop; the aircraft's day starts somewhere in it. A day that
  // runs past midnight UTC (22:00 out, 00:35 on) starts at the late leg, not at 00:35: pick the
  // start that leaves the chain unbroken, then one at the aircraft's base, then the longest wait.
  if (sortedFlights.length > 1) {
    const n = sortedFlights.length;
    let best = 0;
    let bestScore: [number, number, number] = [Infinity, 0, 0];
    for (let k = 0; k < n; k++) {
      let breaks = 0;
      for (let i = 1; i < n; i++) if (sortedFlights[(k + i - 1) % n].destination.iata_code !== sortedFlights[(k + i) % n].origin.iata_code) breaks++;
      const first = sortedFlights[k];
      const prev = sortedFlights[(k + n - 1) % n];
      const wait = (((first.depTimeMin - prev.depTimeMin - prev.blockTimeMin) % MIN_PER_DAY) + MIN_PER_DAY) % MIN_PER_DAY;
      const score: [number, number, number] = [breaks, first.origin.iata_code === aircraft.hubIata ? 0 : 1, -wait];
      if (score[0] < bestScore[0] || (score[0] === bestScore[0] && (score[1] < bestScore[1] || (score[1] === bestScore[1] && score[2] < bestScore[2])))) {
        best = k;
        bestScore = score;
      }
    }
    if (best) sortedFlights.push(...sortedFlights.splice(0, best));
  }

  const startIata = sortedFlights[0].origin.iata_code;
  const lastFlight = sortedFlights[sortedFlights.length - 1];
  const currentEndIata = lastFlight.destination.iata_code;

  const chainPath = [startIata];
  let spatialBreakMessage: string | null = null;
  sortedFlights.forEach((fl, i) => {
    const prev = sortedFlights[i - 1];
    if (prev && prev.destination.iata_code !== fl.origin.iata_code) {
      spatialBreakMessage = `${prev.flightNumber} lands at ${prev.destination.iata_code}, but ${fl.flightNumber} departs from ${fl.origin.iata_code}`;
      chainPath.push(`(gap) ${fl.origin.iata_code}`);
    }
    chainPath.push(fl.destination.iata_code);
  });

  const readyAbs = ceilToFive(lastFlight.depTimeMin + lastFlight.blockTimeMin + aircraft.model.turnaround_min);

  return {
    sortedFlights,
    startIata,
    currentEndIata,
    isClosedLoop: startIata === currentEndIata,
    hasSpatialBreak: spatialBreakMessage !== null,
    spatialBreakMessage,
    chainPath,
    lastFlight,
    nextReadyDepMin: readyAbs % MIN_PER_DAY,
    nextReadyDayShift: Math.floor(readyAbs / MIN_PER_DAY),
  };
}

/** Airport the aircraft is parked at when a new leg departs at `depTimeMin`. */
/**
 * Where the aircraft is at a moment in the week (minutes from Monday 00:00):
 * the arrival airport of the last leg that departed before then, counting
 * each leg on the days it actually flies (v2.52; before, only the time of day
 * counted, so a round trip on Mon/Wed/Fri made the aircraft look away on
 * Tuesday too). Before its first leg of the week it is where the week ended.
 */
export function getAircraftLocationAtWeekMin(aircraft: PlayerAircraft, allSchedule: ScheduledFlight[], weekMin: number): string {
  const legs = flightsForTail(allSchedule, aircraft.tailNumber).flatMap((fl) =>
    daysOrAll(fl.daysOfWeek).flatMap((on, d) => (on ? [{ at: d * MIN_PER_DAY + fl.depTimeMin, to: fl.destination.iata_code }] : []))
  );
  if (legs.length === 0) return aircraft.hubIata;
  legs.sort((a, b) => a.at - b.at);
  const t = ((weekMin % MIN_PER_WEEK) + MIN_PER_WEEK) % MIN_PER_WEEK;
  let where = legs[legs.length - 1].to; // wraps from the end of the week
  for (const l of legs) {
    if (l.at > t) break;
    where = l.to;
  }
  return where;
}

/**
 * The first selected day on which the aircraft is not at `originIata` at
 * `depMin`, with where it is instead, or null when it is there every day.
 */
export function aircraftAwayOnDays(
  aircraft: PlayerAircraft,
  allSchedule: ScheduledFlight[],
  depMin: number,
  days: WeekDays,
  originIata: string
): { day: number; at: string } | null {
  for (let d = 0; d < 7; d++) {
    if (!days[d]) continue;
    const at = getAircraftLocationAtWeekMin(aircraft, allSchedule, d * MIN_PER_DAY + depMin);
    if (at !== originIata) return { day: d, at };
  }
  return null;
}

/** Where the aircraft is at a time of day on the first of `days` (all days when omitted). */
export function getAircraftLocationAtTime(
  aircraft: PlayerAircraft,
  allSchedule: ScheduledFlight[],
  depTimeMin: number,
  days?: WeekDays
): string {
  const first = Math.max(0, daysOrAll(days).findIndex(Boolean));
  return getAircraftLocationAtWeekMin(aircraft, allSchedule, first * MIN_PER_DAY + depTimeMin);
}

// ----------------------------------------------------------------------------
// Conflict detection
// ----------------------------------------------------------------------------
interface OccupiedInterval {
  start: number;
  end: number;
  dayIdx: number;
  label: string;
}

export function buildWeeklyOccupiedIntervals(
  depTimeMin: number,
  blockTimeMin: number,
  turnaroundMin: number,
  daysOfWeek: WeekDays,
  label: string
): OccupiedInterval[] {
  const intervals: OccupiedInterval[] = [];
  daysOfWeek.forEach((active, dayIdx) => {
    if (!active) return;
    const start = dayIdx * MIN_PER_DAY + depTimeMin;
    const end = start + blockTimeMin + turnaroundMin;
    if (end <= MIN_PER_WEEK) {
      intervals.push({ start, end, dayIdx, label });
    } else {
      // Sunday-night legs wrap into Monday morning
      intervals.push({ start, end: MIN_PER_WEEK, dayIdx, label });
      intervals.push({ start: 0, end: end - MIN_PER_WEEK, dayIdx: 0, label });
    }
  });
  return intervals;
}

/** Returns a human-readable conflict message, or null when the legs fit. */
export function findScheduleConflict(
  existingFlightsForAircraft: ScheduledFlight[],
  candidateLegs: CandidateLeg[],
  turnaroundMin: number,
  ignoreFlightIds: string[] = []
): string | null {
  const existing = existingFlightsForAircraft.filter((fl) => !ignoreFlightIds.includes(fl.id));

  // 1. Time overlap (block + turnaround)
  const occupied: OccupiedInterval[] = existing.flatMap((fl) =>
    buildWeeklyOccupiedIntervals(
      fl.depTimeMin,
      fl.blockTimeMin,
      turnaroundMin,
      daysOrAll(fl.daysOfWeek),
      `${fl.flightNumber} (${fl.origin.iata_code}→${fl.destination.iata_code})`
    )
  );

  for (const leg of candidateLegs) {
    const candIntervals = buildWeeklyOccupiedIntervals(
      leg.depTimeMin,
      leg.blockTimeMin,
      turnaroundMin,
      leg.daysOfWeek,
      leg.flightNumber
    );
    for (const c of candIntervals) {
      const clash = occupied.find((ex) => Math.max(c.start, ex.start) < Math.min(c.end, ex.end));
      if (clash) {
        return `On ${DAY_NAMES_SHORT[c.dayIdx]} it overlaps ${clash.label}, counting the ${turnaroundMin} min turnaround.`;
      }
    }
    occupied.push(...candIntervals);
  }

  // 2. Spatial continuity (no teleporting between airports on the same day)
  if (!candidateLegs.some((l) => l.originIata && l.destIata)) return null;

  const combined = [
    ...existing.map((fl) => ({
      label: fl.flightNumber,
      depTimeMin: fl.depTimeMin,
      originIata: fl.origin.iata_code,
      destIata: fl.destination.iata_code,
      daysOfWeek: daysOrAll(fl.daysOfWeek),
    })),
    ...candidateLegs
      .filter((cl) => cl.originIata && cl.destIata)
      .map((cl) => ({
        label: cl.flightNumber,
        depTimeMin: cl.depTimeMin,
        originIata: cl.originIata as string,
        destIata: cl.destIata as string,
        daysOfWeek: daysOrAll(cl.daysOfWeek),
      })),
  ];

  const gap = findContinuityBreak(combined);
  if (gap) {
    const { prev, curr } = gap;
    return `Spatial Continuity Error (${DAY_NAMES_SHORT[gap.dayIdx]}): Aircraft lands at ${prev.destIata} on ${prev.label}, so ${curr.label} must depart from ${prev.destIata} (cannot teleport to ${curr.originIata}).`;
  }
  return null;
}

interface ChainLeg {
  label: string;
  depTimeMin: number;
  originIata: string;
  destIata: string;
  daysOfWeek: WeekDays;
}

/**
 * The first place an aircraft's legs don't join up, or null. Two legs on the
 * same UTC day must join: the second leaves from where the first landed. The
 * one jump allowed is an unfinished chain's: once a day, back to where the
 * day starts. That is usually overnight, between the last leg of a day and
 * the first of the next; for a day that runs past midnight UTC (22:00 out,
 * 00:35 on) it falls in the middle of the UTC day instead, which used to be
 * refused, so such a chain could never be built.
 */
function findContinuityBreak(legs: ChainLeg[]): { dayIdx: number; prev: ChainLeg; curr: ChainLeg } | null {
  const flown = legs
    .flatMap((leg) => leg.daysOfWeek.flatMap((on, d) => (on ? [{ at: d * MIN_PER_DAY + leg.depTimeMin, d, leg }] : [])))
    .sort((a, b) => a.at - b.at);
  const n = flown.length;
  if (n < 2) return null;
  const breaks: { at: number; d: number; sameDay: boolean; prev: ChainLeg; curr: ChainLeg }[] = [];
  for (let i = 0; i < n; i++) {
    const prev = flown[i];
    const curr = flown[(i + 1) % n];
    if (prev.leg.destIata !== curr.leg.originIata) breaks.push({ at: curr.at, d: curr.d, sameDay: i + 1 < n && prev.d === curr.d, prev: prev.leg, curr: curr.leg });
  }
  const sameDay = breaks.filter((b) => b.sameDay);
  if (!sameDay.length) return null;
  const home = breaks[0].curr.originIata;
  const onceADay = breaks.every((b, i) => {
    const next = breaks[(i + 1) % breaks.length];
    const apart = (((next.at - b.at) % MIN_PER_WEEK) + MIN_PER_WEEK) % MIN_PER_WEEK || MIN_PER_WEEK;
    return b.curr.originIata === home && apart >= MIN_PER_DAY;
  });
  if (onceADay) return null;
  return { dayIdx: sameDay[0].d, prev: sameDay[0].prev, curr: sameDay[0].curr };
}

/** True when an aircraft's flights don't join up (it would have to jump between airports on a day). */
export function hasContinuityBreak(flights: ScheduledFlight[]): boolean {
  return (
    findContinuityBreak(
      flights.map((f) => ({ label: f.flightNumber, depTimeMin: f.depTimeMin, originIata: f.origin.iata_code, destIata: f.destination.iata_code, daysOfWeek: daysOrAll(f.daysOfWeek) }))
    ) !== null
  );
}

/**
 * The flights to cancel when a hub is sold: every flight to or from it (with
 * the other half of its round trip), and the rest of an aircraft's day when
 * what's left no longer joins up.
 */
export function flightsCancelledBySellingHub(schedule: ScheduledFlight[], hub: string): Set<string> {
  const out = new Set<string>();
  const pairs = new Set<string>();
  for (const f of schedule)
    if (f.origin.iata_code === hub || f.destination.iata_code === hub) {
      out.add(f.id);
      if (f.pairId) pairs.add(f.pairId);
    }
  for (const f of schedule) if (f.pairId && pairs.has(f.pairId)) out.add(f.id);
  const tails = new Set(schedule.filter((f) => out.has(f.id)).map((f) => f.tailNumber));
  for (const t of tails) {
    const left = schedule.filter((f) => f.tailNumber === t && !out.has(f.id));
    if (hasContinuityBreak(left)) left.forEach((f) => out.add(f.id));
  }
  return out;
}

export function calcAircraftScheduleUsage(aircraft: PlayerAircraft, allSchedule: ScheduledFlight[]) {
  const acFlights = allSchedule.filter((f) => f.tailNumber === aircraft.tailNumber);
  const weeklyOccupiedMin = acFlights.reduce(
    (sum, fl) =>
      sum + daysOrAll(fl.daysOfWeek).filter(Boolean).length * (fl.blockTimeMin + aircraft.model.turnaround_min),
    0
  );
  const usedPct = Math.min(100, Math.round((weeklyOccupiedMin / MIN_PER_WEEK) * 100));
  return {
    flightCount: acFlights.length,
    weeklyOccupiedMin,
    usedPct,
    avgDailyHours: Math.round((weeklyOccupiedMin / 7 / 60) * 10) / 10,
    color: usedPct >= 85 ? '#f59e0b' : usedPct >= 40 ? '#34d399' : '#38bdf8',
  };
}

// ----------------------------------------------------------------------------
// Route planning (pure functions used by the airport drawer)
// ----------------------------------------------------------------------------
export type RoutingMode = 'roundtrip' | 'chain';

export interface DispatchRequest {
  aircraft: PlayerAircraft;
  schedule: ScheduledFlight[];
  hubs: string[];
  origin: Airport;
  destination: Airport;
  depMin: number;
  days: WeekDays;
  mode: RoutingMode;
  flightNumber: string;
  airlineIata: string;
  fares: Fares;
}

/** Candidate legs (outbound + optional return) for preview and validation. */
export function buildDispatchLegs(req: DispatchRequest) {
  const { aircraft, origin, destination, days, mode } = req;
  const distanceNm = calcDistanceNm(origin, destination);
  const blockMin = calcBlockTimeMin(distanceNm, aircraft.model.cruise_speed_kts);
  const outDepMin = snapToFiveMin(req.depMin);
  const outFlightNumber =
    req.flightNumber.trim().toUpperCase() || nextFreeFlightNumber(req.schedule, req.airlineIata, [], distanceNm, mode === 'roundtrip');

  const legs: (CandidateLeg & { arrTimeMin: number })[] = [
    {
      flightNumber: outFlightNumber,
      depTimeMin: outDepMin,
      blockTimeMin: blockMin,
      arrTimeMin: (outDepMin + blockMin) % MIN_PER_DAY,
      daysOfWeek: [...days],
      originIata: origin.iata_code,
      destIata: destination.iata_code,
    },
  ];

  if (mode === 'roundtrip') {
    const retAbs = ceilToFive(outDepMin + blockMin + aircraft.model.turnaround_min);
    const retDepMin = retAbs % MIN_PER_DAY;
    legs.push({
      flightNumber: returnFlightNumber(req.schedule, req.airlineIata, outFlightNumber, distanceNm),
      depTimeMin: retDepMin,
      blockTimeMin: blockMin,
      arrTimeMin: (retDepMin + blockMin) % MIN_PER_DAY,
      daysOfWeek: shiftDays(days, Math.floor(retAbs / MIN_PER_DAY)),
      originIata: destination.iata_code,
      destIata: origin.iata_code,
    });
  }
  return { distanceNm, blockMin, legs };
}

export interface PlanSuccess {
  ok: true;
  flights: ScheduledFlight[];
  /** Suggested draft values for the next leg the player schedules. */
  next: { originIata: string; depMin: number; days: WeekDays };
  message: string;
}
export interface PlanFailure {
  ok: false;
  alert: GameAlert;
  /** Origin the drawer should snap to (anti-teleport). */
  lockOriginIata?: string;
}
export type PlanResult = PlanSuccess | PlanFailure;

const DAY_NAMES_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const fail = (title: string, message: string, detail?: string, severity: GameAlert['severity'] = 'error'): PlanFailure => ({
  ok: false,
  alert: { title, message, detail, severity },
});

export function planRouteDispatch(req: DispatchRequest): PlanResult {
  const { aircraft: ac, schedule, hubs, origin, destination, days } = req;
  const existing = flightsForTail(schedule, ac.tailNumber);
  const outDepMin = snapToFiveMin(req.depMin);

  if (origin.iata_code === destination.iata_code) {
    return fail('Same airport twice', 'A flight needs a different departure and arrival airport.', undefined, 'warning');
  }

  if (existing.length > 0) {
    const away = aircraftAwayOnDays(ac, schedule, outDepMin, days, origin.iata_code);
    if (away) {
      const dayName = DAY_NAMES_LONG[away.day];
      return {
        ...fail(
          `${ac.tailNumber} is at ${away.at} then`,
          `On ${dayName} at ${formatClockShort(outDepMin)} UTC ${ac.tailNumber} is at ${away.at}, so it can't depart from ${origin.iata_code}.`,
          `Pick days when it's at ${origin.iata_code}, another time, or depart from ${away.at}. The departure airport has been switched to ${away.at}.`,
          'warning'
        ),
        lockOriginIata: away.at,
      };
    }
  } else if (!hubs.includes(origin.iata_code)) {
    return fail(
      'Start from one of your hubs',
      `${ac.tailNumber} has no flights yet, so its first flight has to leave from a hub you own (${hubs.join(', ')}).`,
      `After that it can fly one-way onward through any airport.`,
      'warning'
    );
  }

  if (!days.some(Boolean)) {
    return fail('Pick at least one day', 'Choose which days of the week this flight operates.', undefined, 'warning');
  }

  const { distanceNm, blockMin, legs } = buildDispatchLegs(req);

  if (distanceNm > ac.model.range_nm) {
    return fail(
      'Too far for this aircraft',
      `The ${ac.model.name} can't fly ${origin.iata_code} to ${destination.iata_code} nonstop.`,
      `The route is ${distanceNm.toLocaleString()} nm and its range is ${ac.model.range_nm.toLocaleString()} nm.`
    );
  }

  const restriction = airportRestrictionFor(ac.model, origin) ?? airportRestrictionFor(ac.model, destination);
  if (restriction) {
    return fail(
      'Too big for the airport',
      `The ${ac.model.name} is ICAO Code ${aircraftGateCode(ac.model)}, wider than the gates there take.`,
      restriction
    );
  }

  if (isFlightNumberTaken(schedule, legs[0].flightNumber)) {
    return fail('Flight number taken', `${legs[0].flightNumber} is already used by another flight.`, 'Pick a different number.', 'warning');
  }

  const conflict = findScheduleConflict(existing, legs, ac.model.turnaround_min);
  if (conflict) {
    return fail(`${ac.tailNumber} is busy then`, conflict, 'Try a different departure time or days, or use another aircraft.');
  }

  const pairId = req.mode === 'roundtrip' ? makeId('PAIR') : undefined;
  const flights: ScheduledFlight[] = legs.map((leg, i) => ({
    id: makeId('FL'),
    pairId,
    flightNumber: leg.flightNumber,
    tailNumber: ac.tailNumber,
    origin: i === 0 ? origin : destination,
    destination: i === 0 ? destination : origin,
    depTimeMin: leg.depTimeMin,
    arrTimeMin: leg.arrTimeMin,
    distanceNm,
    blockTimeMin: blockMin,
    daysOfWeek: leg.daysOfWeek,
    fares: { ...req.fares },
  }));

  // Suggest the next departure right after the last new leg lands and turns.
  const last = legs[legs.length - 1];
  const readyAbs = ceilToFive(last.depTimeMin + blockMin + ac.model.turnaround_min);
  const nextDays = shiftDays(last.daysOfWeek, Math.floor(readyAbs / MIN_PER_DAY));

  if (req.mode === 'roundtrip') {
    return {
      ok: true,
      flights,
      next: { originIata: origin.iata_code, depMin: readyAbs % MIN_PER_DAY, days: nextDays },
      message: `Scheduled ${legs[0].flightNumber} and ${legs[1].flightNumber}, ${origin.iata_code}–${destination.iata_code} round trip`,
    };
  }
  return {
    ok: true,
    flights,
    next: { originIata: destination.iata_code, depMin: readyAbs % MIN_PER_DAY, days: nextDays },
    message: `Scheduled ${legs[0].flightNumber} ${origin.iata_code} to ${destination.iata_code}. ${ac.tailNumber} is ready again at ${destination.iata_code} at ${formatClockShort(readyAbs)}.`,
  };
}

interface LoopRequest {
  aircraft: PlayerAircraft;
  schedule: ScheduledFlight[];
  hubs: string[];
  airlineIata: string;
  airportByIata: Map<string, Airport>;
}

/** Adds one nonstop leg from wherever the chain ends back to where it started. */
export function planCloseLoop(req: LoopRequest): PlanResult {
  const { aircraft: ac, schedule, hubs, airlineIata, airportByIata } = req;
  const circuit = getAircraftCircuitStatus(ac, schedule);
  if (circuit.isClosedLoop || !circuit.lastFlight) {
    return fail('Already back home', `${ac.tailNumber} already ends its day where it started.`, undefined, 'info');
  }

  const from = airportByIata.get(circuit.currentEndIata) ?? circuit.lastFlight.destination;
  const home = airportByIata.get(circuit.startIata) ?? circuit.sortedFlights[0].origin;
  const distanceNm = calcDistanceNm(from, home);
  if (distanceNm > ac.model.range_nm) {
    return fail(
      'Too far to fly straight back',
      `The ${ac.model.name} can't fly ${from.iata_code} to ${home.iata_code} nonstop (${distanceNm.toLocaleString()} nm, range ${ac.model.range_nm.toLocaleString()} nm).`,
      'Use "Retrace every stop" to fly back the way it came.'
    );
  }

  const blockMin = calcBlockTimeMin(distanceNm, ac.model.cruise_speed_kts);
  const depMin = circuit.nextReadyDepMin;
  const days = shiftDays(daysOrAll(circuit.lastFlight.daysOfWeek), circuit.nextReadyDayShift);
  const flightNumber = nextFreeFlightNumber(schedule, airlineIata, [], distanceNm);
  const leg: CandidateLeg = {
    flightNumber,
    depTimeMin: depMin,
    blockTimeMin: blockMin,
    daysOfWeek: days,
    originIata: from.iata_code,
    destIata: home.iata_code,
  };

  const conflict = findScheduleConflict(circuit.sortedFlights, [leg], ac.model.turnaround_min);
  if (conflict) return fail(`Can't fly ${ac.tailNumber} straight back`, conflict);

  const arrMin = (depMin + blockMin) % MIN_PER_DAY;
  const readyAbs = ceilToFive(depMin + blockMin + ac.model.turnaround_min);
  return {
    ok: true,
    flights: [
      {
        id: makeId('FL'),
        flightNumber,
        tailNumber: ac.tailNumber,
        origin: from,
        destination: home,
        depTimeMin: depMin,
        arrTimeMin: arrMin,
        distanceNm,
        blockTimeMin: blockMin,
        daysOfWeek: days,
        fares: getRouteDemandAndFares(from, home, distanceNm, hubs, schedule).refFares,
      },
    ],
    next: { originIata: home.iata_code, depMin: readyAbs % MIN_PER_DAY, days: shiftDays(days, Math.floor(readyAbs / MIN_PER_DAY)) },
    message: `Scheduled ${flightNumber} ${from.iata_code} to ${home.iata_code}. ${ac.tailNumber} now ends its day at home.`,
  };
}

/** Retraces every leg of an open chain in reverse to bring the aircraft home. */
export function planPingPong(req: LoopRequest): PlanResult {
  const { aircraft: ac, schedule, hubs, airlineIata } = req;
  const circuit = getAircraftCircuitStatus(ac, schedule);
  if (circuit.isClosedLoop || !circuit.lastFlight) {
    return fail('Already back home', `${ac.tailNumber} already ends its day where it started.`, undefined, 'info');
  }

  const baseDays = daysOrAll(circuit.lastFlight.daysOfWeek);
  // Minutes measured from 00:00 of the last leg's departure day
  let runningAbs = circuit.lastFlight.depTimeMin + circuit.lastFlight.blockTimeMin + ac.model.turnaround_min;
  const usedNumbers: string[] = [];
  const legs: CandidateLeg[] = [];
  const flights: ScheduledFlight[] = [];

  for (const src of [...circuit.sortedFlights].reverse()) {
    const orig = src.destination;
    const dest = src.origin;
    const distanceNm = calcDistanceNm(orig, dest);
    const blockMin = calcBlockTimeMin(distanceNm, ac.model.cruise_speed_kts);
    const depAbs = ceilToFive(runningAbs);
    const depMin = depAbs % MIN_PER_DAY;
    const days = shiftDays(baseDays, Math.floor(depAbs / MIN_PER_DAY));
    const flightNumber = nextFreeFlightNumber(schedule, airlineIata, usedNumbers, distanceNm);
    usedNumbers.push(flightNumber);

    legs.push({ flightNumber, depTimeMin: depMin, blockTimeMin: blockMin, daysOfWeek: days, originIata: orig.iata_code, destIata: dest.iata_code });
    flights.push({
      id: makeId('FL'),
      flightNumber,
      tailNumber: ac.tailNumber,
      origin: orig,
      destination: dest,
      depTimeMin: depMin,
      arrTimeMin: (depMin + blockMin) % MIN_PER_DAY,
      distanceNm,
      blockTimeMin: blockMin,
      daysOfWeek: days,
      fares: getRouteDemandAndFares(orig, dest, distanceNm, hubs, schedule).refFares,
    });
    runningAbs = depAbs + blockMin + ac.model.turnaround_min;
  }

  const conflict = findScheduleConflict(circuit.sortedFlights, legs, ac.model.turnaround_min);
  if (conflict) {
    return fail(`Can't retrace ${ac.tailNumber}'s stops`, conflict, 'The return trip would run past the next day\'s first departure.');
  }

  const readyAbs = ceilToFive(runningAbs);
  return {
    ok: true,
    flights,
    next: { originIata: circuit.startIata, depMin: readyAbs % MIN_PER_DAY, days: shiftDays(baseDays, Math.floor(readyAbs / MIN_PER_DAY)) },
    message: `Added ${flights.length} ${flights.length === 1 ? 'flight' : 'flights'} taking ${ac.tailNumber} back to ${circuit.startIata}.`,
  };
}
