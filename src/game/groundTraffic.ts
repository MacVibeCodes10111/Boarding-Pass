// ============================================================================
// WHO IS ON THE GROUND AT AN AIRPORT
//   Turns schedules into ground movements for the taxi engine (taxi.ts):
//   other airlines' flights park ~40 min before departure and ~30 min after
//   arrival; your aircraft stay at their gate between an arrival and their
//   next departure from the same airport.
//   The departure and arrival runways are looked up exactly as the flight
//   paths do, so taxiing hands over seamlessly to the takeoff roll and from
//   the landing roll.
// ============================================================================
import { aiTaxiMin, type AiFlight, type AiTraffic } from './aiTraffic';
import { getActiveRunwayForAirport, getFlightGeometryForDeparture, playerTaxiMin, rolloutEndPoint, type RunwaySlots } from './navdata';
import { dayIndexOf, daysOrAll, MIN_PER_DAY } from './time';
import type { Airport, RadarIconGroup, ScheduledFlight } from './types';
import { ARR_PLAN_AHEAD_MIN, type GroundMove, type RunwayPoint } from './taxi';

/** Aircraft length per silhouette group, metres (parking distance, drawing at true scale). */
export const GROUP_LENGTH_M: Record<RadarIconGroup, number> = {
  commuter: 15,
  prop: 25,
  rj_tail: 31,
  small_jet: 30,
  rear_jet: 36,
  medium_jet: 38,
  long_narrow: 44,
  large_jet: 47,
  heavy_twin: 62,
  trijet: 56,
  a340: 66,
  b747: 70,
  a380: 73,
  high_quad: 50,
};

export const AI_PARK_BEFORE_MIN = 40;
export const AI_PARK_AFTER_MIN = 30;
/** Your aircraft board for this long before a departure that doesn't follow an arrival. */
const PLAYER_BOARD_MIN = 30;

const norm = (day: number, min: number) => {
  const extra = Math.floor(min / MIN_PER_DAY);
  return { day: day + extra, min: min - extra * MIN_PER_DAY };
};

// The runway in use only changes with the weather (3-hour blocks), so lookups are cached
const rwyCache = new Map<string, RunwayPoint>();
function cachedRunway(kind: 'd' | 'a', ap: Airport, day: number, min: number, lane: number, make: (d: number, m: number) => RunwayPoint): RunwayPoint {
  const t = norm(day, min);
  const key = `${kind}:${ap.iata_code}:${ap.id}:${t.day}:${Math.floor(t.min / 180)}:${lane}`;
  let r = rwyCache.get(key);
  if (!r) {
    if (rwyCache.size > 20_000) rwyCache.clear();
    r = make(t.day, t.min);
    rwyCache.set(key, r);
  }
  return r;
}

export function depRunway(ap: Airport, day: number, min: number, lane = 0): RunwayPoint {
  return cachedRunway('d', ap, day, min, lane, (d, m) => {
    const r = getActiveRunwayForAirport(ap, d, m, 'departure', lane);
    return { ident: r.ident, lon: r.thresholdLon, lat: r.thresholdLat, hdg: r.headingDegT };
  });
}

export function arrStop(ap: Airport, day: number, min: number, lane = 0): RunwayPoint {
  return cachedRunway('a', ap, day, min, lane, (d, m) => {
    const r = getActiveRunwayForAirport(ap, d, m, 'arrival', lane);
    const [lon, lat] = rolloutEndPoint(r);
    return { ident: r.ident, lon, lat, hdg: r.headingDegT };
  });
}

/** AI flights by airport index, built once per traffic set. */
export interface AiAirportIndex {
  deps: AiFlight[][];
  arrs: AiFlight[][];
}

export function buildAiAirportIndex(t: AiTraffic): AiAirportIndex {
  const deps: AiFlight[][] = t.airports.map(() => []);
  const arrs: AiFlight[][] = t.airports.map(() => []);
  for (const f of t.flights) {
    deps[f.o].push(f);
    arrs[f.d].push(f);
  }
  return { deps, arrs };
}

/** Ground movement of an AI flight leaving `airport` (its origin) on `depDay`. */
export function aiDepartureMove(t: AiTraffic, f: AiFlight, depDay: number, airport: Airport): GroundMove {
  const G = depDay * MIN_PER_DAY + f.depUtcMin;
  const T = G + aiTaxiMin(f);
  const parkFrom = G - AI_PARK_BEFORE_MIN;
  const key = `a:${f.id}:${depDay}:d`;
  return {
    key,
    visit: key,
    pref: t.airlines[f.airline]?.code ?? String(f.airline),
    halfLen: GROUP_LENGTH_M[f.group] / 2,
    kind: 'dep',
    // The runway in use at takeoff
    rwy: depRunway(airport, depDay, f.depUtcMin + aiTaxiMin(f), f.depLane ?? 0),
    parkFrom,
    pushAt: G,
    takeoffAt: T,
    visitStart: parkFrom,
    visitEnd: T,
  };
}

/** Ground movement of an AI flight arriving at `airport` (its destination), departed on `depDay`. */
export function aiArrivalMove(t: AiTraffic, f: AiFlight, depDay: number, airport: Airport): GroundMove {
  const taxi = aiTaxiMin(f);
  const arrMin = f.depUtcMin + f.blockMin - taxi;
  const R = depDay * MIN_PER_DAY + arrMin;
  const parkUntil = R + taxi + AI_PARK_AFTER_MIN;
  const key = `a:${f.id}:${depDay}:a`;
  return {
    key,
    visit: key,
    pref: t.airlines[f.airline]?.code ?? String(f.airline),
    halfLen: GROUP_LENGTH_M[f.group] / 2,
    kind: 'arr',
    rwy: arrStop(airport, depDay, arrMin, f.arrLane ?? 0),
    flowRwy: depRunway(airport, depDay, arrMin),
    rollEndAt: R,
    parkUntil,
    visitStart: R,
    visitEnd: parkUntil,
  };
}

export interface AiGroundInfo {
  flight: AiFlight;
  depDay: number;
  kind: 'dep' | 'arr';
}

/**
 * Ground movements of other airlines at one airport at (day, min). `airport`
 * must be the same Airport object the AI flight paths use (AiPathModel.airports).
 */
export function aiGroundMoves(
  t: AiTraffic,
  index: AiAirportIndex,
  apIdx: number,
  airport: Airport,
  day: number,
  min: number,
  keep: (f: AiFlight) => boolean,
  info?: Map<string, AiGroundInfo>,
  /** Flight-days that don't operate (they give way to yours, runwaySequence.ts). */
  skip?: (f: AiFlight, depDay: number) => boolean
): GroundMove[] {
  const now = day * MIN_PER_DAY + min;
  const out: GroundMove[] = [];
  for (const f of index.deps[apIdx]) {
    if (!keep(f)) continue;
    for (let dd = -1; dd <= 1; dd++) {
      const depDay = day + dd;
      if (!(f.daysMask & (1 << dayIndexOf(depDay)))) continue;
      // Times first (cheap); the move (runway lookups) only for those on the ground now.
      // Long taxis may push back up to 10 minutes early
      const G = depDay * MIN_PER_DAY + f.depUtcMin;
      if (now < G - AI_PARK_BEFORE_MIN - 10 || now >= G + aiTaxiMin(f) || skip?.(f, depDay)) continue;
      const m = aiDepartureMove(t, f, depDay, airport);
      out.push(m);
      info?.set(m.key, { flight: f, depDay, kind: 'dep' });
    }
  }
  for (const f of index.arrs[apIdx]) {
    if (!keep(f)) continue;
    for (let dd = -2; dd <= 0; dd++) {
      const depDay = day + dd;
      if (!(f.daysMask & (1 << dayIndexOf(depDay)))) continue;
      // Included before landing so its taxi in is planned ahead (it is drawn from the end of
      // the landing roll); a long taxi-in can run past parkUntil, so it is kept a little longer
      const taxi = aiTaxiMin(f);
      const R = depDay * MIN_PER_DAY + f.depUtcMin + f.blockMin - taxi;
      if (now < R - ARR_PLAN_AHEAD_MIN || now > R + taxi + AI_PARK_AFTER_MIN + 15 || skip?.(f, depDay)) continue;
      const m = aiArrivalMove(t, f, depDay, airport);
      out.push(m);
      info?.set(m.key, { flight: f, depDay, kind: 'arr' });
    }
  }
  return out;
}

export interface PlayerGroundInfo {
  flight: ScheduledFlight;
  depDay: number;
  kind: 'dep' | 'arr';
}

/**
 * Ground movements of your own fleet, grouped by airport IATA code. An
 * arrival and the same aircraft's next departure from that airport (within
 * 6 hours) share one gate visit, so the aircraft stays put in between.
 */
export function playerGroundMoves(
  schedule: ScheduledFlight[],
  day: number,
  min: number,
  lengthOf: (f: ScheduledFlight) => number,
  turnaroundOf: (f: ScheduledFlight) => number,
  airports: Set<string>,
  info?: Map<string, PlayerGroundInfo>,
  /** Include every movement around now, not only the ones on the ground right now (for routes). */
  all = false,
  /** Waits for the runway (runwaySequence.ts): a later takeoff, a later end of the landing roll. */
  slotsFor?: (f: ScheduledFlight, depDay: number) => RunwaySlots
): Map<string, GroundMove[]> {
  const now = day * MIN_PER_DAY + min;
  interface Occ {
    f: ScheduledFlight;
    depDay: number;
    D: number;
    T: number;
    R: number;
    end: number;
  }
  const occ: Occ[] = [];
  for (const f of schedule) {
    if (!airports.has(f.origin.iata_code) && !airports.has(f.destination.iata_code)) continue;
    const days = daysOrAll(f.daysOfWeek);
    const taxi = playerTaxiMin(f.blockTimeMin);
    for (let dd = -2; dd <= 1; dd++) {
      const depDay = day + dd;
      if (!days[dayIndexOf(depDay)]) continue;
      const D = depDay * MIN_PER_DAY + f.depTimeMin;
      const end = D + f.blockTimeMin;
      if (end + 6 * 60 < now || D - 6 * 60 > now) continue;
      const s = slotsFor?.(f, depDay);
      occ.push({ f, depDay, D, T: D + taxi.out + (s?.dep ?? 0), R: end - taxi.in + Math.min(s?.arr ?? 0, Math.max(0, taxi.in - 0.5)), end });
    }
  }
  const byAirport = new Map<string, GroundMove[]>();
  const push = (iata: string, m: GroundMove) => (byAirport.get(iata) ?? byAirport.set(iata, []).get(iata)!).push(m);
  const deps = occ.filter((o) => airports.has(o.f.origin.iata_code)).sort((a, b) => a.D - b.D);
  const takenDep = new Set<Occ>();

  occ.sort((a, b) => a.R - b.R);
  for (const o of occ) {
    const iata = o.f.destination.iata_code;
    if (!airports.has(iata)) continue;
    // This aircraft's next departure from here
    const next = deps.find(
      (d) => !takenDep.has(d) && d.f.tailNumber === o.f.tailNumber && d.f.origin.iata_code === iata && d.D >= o.end - 5 && d.D - o.end <= 6 * 60
    );
    if (next) takenDep.add(next);
    const visit = next ? `pv:${o.f.tailNumber}:${iata}:${o.D}` : `pa:${o.f.id}:${o.depDay}`;
    const parkUntil = next ? next.D : o.end + turnaroundOf(o.f);
    if (all || (now >= o.R - ARR_PLAN_AHEAD_MIN && now <= Math.max(parkUntil, o.R + 30) + 10)) {
      const proc = getFlightGeometryForDeparture(o.f, o.depDay);
      const last = proc.points[proc.points.length - 1];
      const key = `p:${o.f.id}:${o.depDay}:a`;
      push(iata, {
        key,
        visit,
        pref: `tail:${o.f.tailNumber}`,
        halfLen: lengthOf(o.f) / 2,
        kind: 'arr',
        rwy: { ident: proc.arrRwy.ident, lon: last[0], lat: last[1], hdg: proc.arrRwy.headingDegT },
        flowRwy: depRunway(o.f.destination, o.depDay, o.f.depTimeMin + o.f.blockTimeMin - playerTaxiMin(o.f.blockTimeMin).in),
        rollEndAt: o.R,
        parkUntil,
        visitStart: o.R,
        visitEnd: next ? next.T : parkUntil,
      });
      info?.set(key, { flight: o.f, depDay: o.depDay, kind: 'arr' });
    }
    if (next) addDep(next, visit, o.R, next.T);
  }
  for (const d of deps) if (!takenDep.has(d)) addDep(d, `pd:${d.f.id}:${d.depDay}`, d.D - PLAYER_BOARD_MIN, d.T);

  function addDep(d: Occ, visit: string, visitStart: number, visitEnd: number) {
    if (!all && (now < d.D - PLAYER_BOARD_MIN - 10 || now >= d.T)) return;
    const merged = visit.startsWith('pv:');
    const proc = getFlightGeometryForDeparture(d.f, d.depDay);
    const key = `p:${d.f.id}:${d.depDay}:d`;
    push(d.f.origin.iata_code, {
      key,
      visit,
      pref: `tail:${d.f.tailNumber}`,
      halfLen: lengthOf(d.f) / 2,
      kind: 'dep',
      rwy: { ident: proc.depRwy.ident, lon: proc.points[0][0], lat: proc.points[0][1], hdg: proc.depRwy.headingDegT },
      // After an arrival the aircraft is already parked (drawn by the arrival)
      parkFrom: merged ? d.D : d.D - PLAYER_BOARD_MIN,
      pushAt: d.D,
      takeoffAt: d.T,
      visitStart,
      visitEnd,
    });
    info?.set(key, { flight: d.f, depDay: d.depDay, kind: 'dep' });
  }
  return byAirport;
}
