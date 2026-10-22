// ============================================================================
// FLEET OPERATIONS (v2.38+): replacing aircraft and scheduling several at once
// ============================================================================
import { calcBlockTimeMin } from './geo';
import { buildDispatchLegs, findScheduleConflict, flightsForTail, planRouteDispatch, type DispatchRequest, type PlanResult } from './scheduling';
import { airportRestrictionFor } from './tiers';
import { DAY_NAMES_SHORT, MIN_PER_DAY, daysOrAll, formatClockShort } from './time';
import type { AircraftModel, PlayerAircraft, ScheduledFlight } from './types';

export interface ReplacementCheck {
  /** The old aircraft's flights re-timed for the new type (only those it can fly). */
  flights: ScheduledFlight[];
  /** Flights the new type can't fly, with why. */
  dropped: { flight: ScheduledFlight; reason: string }[];
  /** Timing problems among the flights it can fly (the schedule no longer fits a day). */
  clashes: string[];
}

/**
 * What happens to an aircraft's schedule if a `model` takes it over: each
 * flight keeps its departure time and gets the new type's block time; flights
 * it can't fly (range, runway) are dropped (with their return flight), and any
 * flight that now runs into the next one (with the new turnaround) is a clash.
 */
export function checkReplacement(old: PlayerAircraft, model: AircraftModel, schedule: ScheduledFlight[]): ReplacementCheck {
  const own = flightsForTail(schedule, old.tailNumber);
  const dropped: ReplacementCheck['dropped'] = [];
  const reasonFor = (fl: ScheduledFlight) =>
    fl.distanceNm > model.range_nm
      ? `${fl.distanceNm.toLocaleString()} nm is beyond its ${model.range_nm.toLocaleString()} nm range`
      : airportRestrictionFor(model, fl.origin) ?? airportRestrictionFor(model, fl.destination);
  const badPairs = new Set<string>();
  for (const fl of own) {
    const r = reasonFor(fl);
    if (r) {
      dropped.push({ flight: fl, reason: r });
      if (fl.pairId) badPairs.add(fl.pairId);
    }
  }
  // A round trip goes as a pair: drop the other half too
  for (const fl of own)
    if (fl.pairId && badPairs.has(fl.pairId) && !dropped.some((d) => d.flight.id === fl.id)) dropped.push({ flight: fl, reason: 'the other half of its round trip can’t be flown' });
  const droppedIds = new Set(dropped.map((d) => d.flight.id));

  const flights = own
    .filter((fl) => !droppedIds.has(fl.id))
    .map((fl) => {
      const blockTimeMin = calcBlockTimeMin(fl.distanceNm, model.cruise_speed_kts);
      return { ...fl, blockTimeMin, arrTimeMin: (fl.depTimeMin + blockTimeMin) % MIN_PER_DAY };
    });

  // Each flight against the ones before it, with the new turnaround
  const clashes: string[] = [];
  const placed: ScheduledFlight[] = [];
  for (const fl of [...flights].sort((a, b) => a.depTimeMin - b.depTimeMin)) {
    const c = findScheduleConflict(placed, [{ flightNumber: fl.flightNumber, depTimeMin: fl.depTimeMin, blockTimeMin: fl.blockTimeMin, daysOfWeek: daysOrAll(fl.daysOfWeek) }], model.turnaround_min);
    if (c) clashes.push(`${fl.flightNumber} ${fl.origin.iata_code}→${fl.destination.iata_code} at ${formatClockShort(fl.depTimeMin)}: ${c}`);
    placed.push(fl);
  }
  return { flights, dropped, clashes };
}

/** Plain-language summary of a replacement check. */
export function replacementSummary(c: ReplacementCheck): string {
  const parts: string[] = [];
  if (c.flights.length) parts.push(`${c.flights.length} flights carry over`);
  if (c.dropped.length) parts.push(`${c.dropped.length} can't be flown`);
  if (c.clashes.length) parts.push(`${c.clashes.length} no longer fit the day`);
  return parts.join(', ') || 'no flights to carry over';
}

export interface BulkScheduleResult {
  results: { tail: string; result: PlanResult; depMin: number }[];
  flights: ScheduledFlight[];
}

/**
 * Schedules the same route for several aircraft: the first departs at the
 * chosen time, each next one `spacingMin` later (so they don't all leave at
 * once), each with its own flight numbers. Aircraft that can't fly it are
 * reported and skipped.
 */
export function planBulkDispatch(base: Omit<DispatchRequest, 'aircraft'>, aircraft: PlayerAircraft[], spacingMin: number): BulkScheduleResult {
  let schedule = base.schedule;
  const results: BulkScheduleResult['results'] = [];
  const flights: ScheduledFlight[] = [];
  aircraft.forEach((ac, i) => {
    const depMin = ((((base.depMin + i * spacingMin) % MIN_PER_DAY) + MIN_PER_DAY) % MIN_PER_DAY);
    const req: DispatchRequest = { ...base, aircraft: ac, schedule, depMin, flightNumber: i === 0 ? base.flightNumber : '' };
    const result = planRouteDispatch(req);
    results.push({ tail: ac.tailNumber, result, depMin });
    if (result.ok) {
      flights.push(...result.flights);
      schedule = [...schedule, ...result.flights];
    }
  });
  return { results, flights };
}

/** Preview legs for one aircraft of a bulk schedule (for the timeline). */
export const bulkPreviewLegs = (req: DispatchRequest) => buildDispatchLegs(req).legs;

export const dayList = (days: boolean[]) =>
  days.every(Boolean) ? 'daily' : days.map((d, i) => (d ? DAY_NAMES_SHORT[i] : '')).filter(Boolean).join(' ');
