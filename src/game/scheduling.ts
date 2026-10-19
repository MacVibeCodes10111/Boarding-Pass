// ============================================================================
// WEEKLY BLOCK SCHEDULE: conflicts, spatial continuity, circuits & route planning
// ============================================================================
import { getRouteDemandAndFares } from './economics';
import { calcBlockTimeMin, calcDistanceNm } from './geo';
import { airportRestrictionFor } from './tiers';
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

/** Lowest free flight number ≥ 101 for this airline, skipping `alsoTaken`. */
export function nextFreeFlightNumber(
  schedule: ScheduledFlight[],
  airlineIata: string,
  alsoTaken: string[] = []
): string {
  const prefix = airlineIata.toUpperCase();
  const taken = new Set([...schedule.map((f) => f.flightNumber.toUpperCase()), ...alsoTaken.map((s) => s.toUpperCase())]);
  for (let n = 101; n < 100000; n++) {
    const candidate = `${prefix}${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${prefix}${Date.now() % 100000}`;
}

export function nextFreeTailNumber(fleet: PlayerAircraft[], airlineIata: string): string {
  const taken = new Set(fleet.map((a) => a.tailNumber.toUpperCase()));
  const suffix = airlineIata.toUpperCase() || 'XX';
  for (let n = 101; n < 100000; n++) {
    const candidate = `N${n}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `N${Date.now() % 100000}${suffix}`;
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
export function getAircraftLocationAtTime(
  aircraft: PlayerAircraft,
  allSchedule: ScheduledFlight[],
  depTimeMin: number
): string {
  const sorted = flightsForTail(allSchedule, aircraft.tailNumber);
  if (sorted.length === 0) return aircraft.hubIata;
  const prior = [...sorted].reverse().find((fl) => fl.depTimeMin <= depTimeMin);
  // Before the first departure of the day the aircraft is where it ended yesterday.
  return (prior ?? sorted[sorted.length - 1]).destination.iata_code;
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
  ].sort((a, b) => a.depTimeMin - b.depTimeMin);

  for (let dayIdx = 0; dayIdx < 7; dayIdx++) {
    const dayLegs = combined.filter((l) => l.daysOfWeek[dayIdx]);
    for (let i = 1; i < dayLegs.length; i++) {
      const prev = dayLegs[i - 1];
      const curr = dayLegs[i];
      if (prev.destIata !== curr.originIata) {
        return `Spatial Continuity Error (${DAY_NAMES_SHORT[dayIdx]}): Aircraft lands at ${prev.destIata} on ${prev.label}, so ${curr.label} must depart from ${prev.destIata} (cannot teleport to ${curr.originIata}).`;
      }
    }
  }
  return null;
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
    req.flightNumber.trim().toUpperCase() || nextFreeFlightNumber(req.schedule, req.airlineIata);

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
      flightNumber: nextFreeFlightNumber(req.schedule, req.airlineIata, [outFlightNumber]),
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
    const expected = getAircraftLocationAtTime(ac, schedule, outDepMin);
    if (origin.iata_code !== expected) {
      return {
        ...fail(
          `${ac.tailNumber} is at ${expected} then`,
          `At ${formatClockShort(outDepMin)} UTC ${ac.tailNumber} is parked at ${expected}, so it can't depart from ${origin.iata_code}.`,
          `The departure airport has been switched to ${expected}.`,
          'warning'
        ),
        lockOriginIata: expected,
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
      'Runway too short',
      `The ${ac.model.name} needs ${ac.model.min_runway_ft.toLocaleString()} ft of runway.`,
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
  const flightNumber = nextFreeFlightNumber(schedule, airlineIata);
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
    const flightNumber = nextFreeFlightNumber(schedule, airlineIata, usedNumbers);
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
