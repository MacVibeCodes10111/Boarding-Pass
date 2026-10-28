// ============================================================================
// RUNWAY USE (v2.47+)
//
// One aircraft on a runway at a time, as a tower runs it. A departure has the
// runway from the moment it crosses the hold-short line to line up until it
// lifts off; an arrival from short final (about a mile out) until it has
// turned off onto the taxiway. These are the times the drawings use: the
// taxi engine's line-up, the takeoff and landing rolls of the flight paths,
// and the turn-off at taxi-out speed.
//
// Other airlines' flights are sequenced once when their schedule is built
// (aiTraffic.ts); yours are fitted around them, and around each other, as the
// map draws them (runwaySequence.ts).
// ============================================================================

/** Minutes from the hold-short line to the start of the takeoff roll. */
export const LINEUP_MIN = 0.35;
/** Other airlines: takeoff roll and landing roll, minutes. */
export const AI_DEP_ROLL_MIN = 0.6;
export const AI_ARR_ROLL_MIN = 0.6;
/** Short final: the runway must be clear before an arrival is this close (minutes before touchdown). */
export const SHORT_FINAL_MIN = 0.25;
/** From the end of the landing roll until past the hold-short line on the exit. */
export const VACATE_MIN = 0.4;
/** A little air between one aircraft leaving the runway and the next using it. */
export const RUNWAY_BUFFER_MIN = 0.05;

/**
 * When a movement has the runway, relative to its reference time: the start of
 * the takeoff roll for a departure, the end of the landing roll for an arrival.
 */
export function runwayOccupancy(kind: 'dep' | 'arr', rollMin: number): [number, number] {
  return kind === 'dep' ? [-LINEUP_MIN, rollMin] : [-(rollMin + SHORT_FINAL_MIN), VACATE_MIN];
}

/** A booked stretch of runway time (absolute minutes). */
export interface RunwayInterval {
  from: number;
  to: number;
}

/**
 * Earliest delay (≥ 0) at which [t + pre, t + post] fits between the booked
 * intervals (sorted by start). Returns Infinity if it can't fit within `maxDelay`.
 */
export function earliestFit(booked: RunwayInterval[], t: number, pre: number, post: number, maxDelay = Infinity): number {
  let d = 0;
  // Booked lists are short around any one time; a linear pass is enough
  for (let guard = 0; guard < 400; guard++) {
    const a = t + d + pre - RUNWAY_BUFFER_MIN;
    const b = t + d + post + RUNWAY_BUFFER_MIN;
    let moved = false;
    for (const iv of booked) {
      if (iv.from >= b) break;
      if (iv.to > a) {
        d = iv.to + RUNWAY_BUFFER_MIN - (t + pre);
        moved = true;
        break;
      }
    }
    if (!moved) return d <= maxDelay ? d : Infinity;
    if (d > maxDelay) return Infinity;
  }
  return Infinity;
}

/** Adds an interval to a list kept sorted by start. */
export function bookInterval(booked: RunwayInterval[], iv: RunwayInterval) {
  let i = booked.length;
  while (i > 0 && booked[i - 1].from > iv.from) i--;
  booked.splice(i, 0, iv);
}
