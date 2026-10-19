// ============================================================================
// OTHER AIRLINES: DEPARTURES AND ARRIVALS
//   AI aircraft fly the same takeoff, departure, arrival pattern and final
//   approach as your own fleet (see buildTerminalPaths in navdata.ts), joined
//   by the great circle in between. To stay cheap with ~7,000 aircraft in the
//   air, the procedures are only built for aircraft that are actually drawn
//   and near an airport, a limited number per redraw, and kept per flight.
//
//   Timing never depends on whether a procedure was built yet: every flight
//   has fixed departure and arrival phases (from the route's terminal
//   distances), so cruising aircraft are in the same place either way and the
//   only change when a procedure arrives is the exact track near the airport.
// ============================================================================
import { calcBearingDeg, calcCoordDistanceNm, offsetLatLonNm, type LonLat } from './geo';
import { buildTerminalPaths, landingRollNm, terminalDistances, type TerminalPaths } from './navdata';
import { aiDepartureDay, aiTaxiMin, type AiAirport, type AiFlight, type AiPosition, type AiTraffic } from './aiTraffic';
import { MIN_PER_DAY } from './time';
import type { Airport } from './types';

type Vec = [number, number, number];
const D2R = Math.PI / 180;
const toVec = ([lon, lat]: LonLat): Vec => [Math.cos(lat * D2R) * Math.cos(lon * D2R), Math.cos(lat * D2R) * Math.sin(lon * D2R), Math.sin(lat * D2R)];
function slerp(a: Vec, b: Vec, t: number): LonLat {
  const omega = Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
  if (omega < 1e-9) return [Math.atan2(a[1], a[0]) / D2R, Math.asin(a[2]) / D2R];
  const s = Math.sin(omega);
  const f1 = Math.sin((1 - t) * omega) / s;
  const f2 = Math.sin(t * omega) / s;
  const x = f1 * a[0] + f2 * b[0];
  const y = f1 * a[1] + f2 * b[1];
  const z = f1 * a[2] + f2 * b[2];
  return [Math.atan2(y, x) / D2R, Math.atan2(z, Math.hypot(x, y)) / D2R];
}

const EARTH_NM = 3440.065;
const toLL = (v: Vec): LonLat => [Math.atan2(v[1], v[0]) / D2R, Math.atan2(v[2], Math.hypot(v[0], v[1])) / D2R];
/** Point on the great circle a→b at t, pushed `sideNm` towards `pole` (the circle's pole). */
function slerpSide(a: Vec, b: Vec, t: number, pole: Vec, sideNm: number): LonLat {
  const omega = Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
  let x: number, y: number, z: number;
  if (omega < 1e-9) [x, y, z] = a;
  else {
    const s = Math.sin(omega);
    const f1 = Math.sin((1 - t) * omega) / s;
    const f2 = Math.sin(t * omega) / s;
    x = f1 * a[0] + f2 * b[0];
    y = f1 * a[1] + f2 * b[1];
    z = f1 * a[2] + f2 * b[2];
  }
  if (sideNm !== 0) {
    const k = sideNm / EARTH_NM;
    x += pole[0] * k;
    y += pole[1] * k;
    z += pole[2] * k;
  }
  return toLL([x, y, z]);
}

/** A polyline with distance and time shares (0..1) from a speed profile. */
interface Track {
  pts: LonLat[];
  cumNm: number[];
  cumT: number[];
  lenNm: number;
}

function makeTrack(pts: LonLat[], speedAt: (alongNm: number, lenNm: number) => number): Track {
  const cumNm = [0];
  for (let i = 1; i < pts.length; i++) cumNm.push(cumNm[i - 1] + Math.max(0.01, calcCoordDistanceNm(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1])));
  const lenNm = cumNm[cumNm.length - 1];
  const t = [0];
  for (let i = 1; i < pts.length; i++) t.push(t[i - 1] + (cumNm[i] - cumNm[i - 1]) / speedAt((cumNm[i] + cumNm[i - 1]) / 2, lenNm));
  return { pts, cumNm, cumT: t.map((x) => x / t[t.length - 1]), lenNm };
}

/** Point at a distance (nm) along a track, and its heading. */
function atDistance(tr: Track, nm: number): { at: LonLat; brg: number } {
  const C = tr.cumNm;
  const d = Math.max(0, Math.min(tr.lenNm, nm));
  let lo = 0;
  let hi = C.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (C[m] <= d) lo = m;
    else hi = m;
  }
  const a = tr.pts[lo];
  const b = tr.pts[lo + 1] ?? a;
  const span = (C[lo + 1] ?? C[lo]) - C[lo];
  const k = span > 0 ? (d - C[lo]) / span : 0;
  return { at: [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k], brg: a[0] !== b[0] || a[1] !== b[1] ? calcBearingDeg(a, b) : 0 };
}

/** Per-flight constants that don't depend on weather (cached by flight id). */
interface AiPlan {
  gcNm: number;
  exitNm: number;
  entryNm: number;
  exit: LonLat;
  entry: LonLat;
  vO: Vec;
  vExit: Vec;
  vEntry: Vec;
  vD: Vec;
  /** Minutes of the airborne window spent in the departure / arrival phase. */
  tDep: number;
  tArr: number;
  windowMin: number;
  cruiseAlt: number;
  /** Sideways offset from the great circle at mid-cruise, nm (fades out towards both ends). */
  lateralNm: number;
  /** Unit pole of the cruise great circle (the sideways direction). */
  pole: Vec;
}

/** Procedures built for one departure of one flight. */
interface AiProc {
  tp: TerminalPaths;
  dep: Track;
  arr: Track;
  liftoffNm: number;
  touchdownNm: number; // along the arrival track
  finalNm: number; // along the arrival track
  /**
   * Absolute timing (minutes) for the parts where aircraft follow each other
   * on the same runway: takeoff roll and initial climb, final approach and
   * landing roll. Equal speeds there keep the runway spacing on screen.
   */
  depRollT: number;
  depClimbT: number;
  depClimbEndNm: number;
  arrPreT: number;
  arrFinalT: number;
  arrRollT: number;
  rollNm: number;
}

/** How many new procedures a redraw may build, and until when (performance.now() ms). */
export interface BuildBudget {
  left: number;
  until?: number;
}
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export interface AiDetailedPosition extends AiPosition {
  phaseLabel: string;
  /** True when the aircraft is flying its built procedure (not the plain great circle). */
  procedural: boolean;
}

const PLAN_LIMIT = 70_000;
const PROC_LIMIT = 12_000;

/** Synthetic airport for an OpenFlights airport that isn't in the OurAirports list. */
function airportFromAi(ap: AiAirport, i: number): Airport {
  return {
    id: -1 - i,
    iata_code: ap.iata,
    icao_code: '',
    name: ap.name,
    municipality: ap.city,
    iso_country: '',
    country_name: ap.country,
    continent: '',
    type: 'large_airport',
    latitude_deg: ap.lat,
    longitude_deg: ap.lon,
    elevation_ft: ap.elevFt,
    runway_count: 2,
    max_runway_length_ft: 9000,
    demand_weight: 60,
    hourly_slot_limit: 60,
  };
}

export class AiPathModel {
  private plans = new Map<number, AiPlan>();
  private procs = new Map<string, AiProc>();
  /** Airport per AI airport index (real OurAirports data where available). */
  readonly airports: Airport[];
  /** Procedures built so far (for tests and the stats line). */
  built = 0;

  constructor(private traffic: AiTraffic, resolve: (iata: string) => Airport | undefined) {
    this.airports = traffic.airports.map((ap, i) => resolve(ap.iata) ?? airportFromAi(ap, i));
  }

  private plan(f: AiFlight): AiPlan {
    let p = this.plans.get(f.id);
    if (p) return p;
    const O = this.traffic.airports[f.o];
    const D = this.traffic.airports[f.d];
    const oLL: LonLat = [O.lon, O.lat];
    const dLL: LonLat = [D.lon, D.lat];
    const gcNm = f.distanceNm;
    const { exitNm, entryNm } = terminalDistances(gcNm);
    const exit = offsetLatLonNm(O.lat, O.lon, calcBearingDeg(oLL, dLL), exitNm);
    const entry = offsetLatLonNm(D.lat, D.lon, calcBearingDeg(dLL, oLL), entryNm);
    const windowMin = Math.max(5, f.blockMin - 2 * aiTaxiMin(f));
    // Departure ~200 kt average incl. the takeoff roll, arrival ~190 kt incl. the pattern
    let tDep = ((exitNm + 3) / 200) * 60;
    let tArr = ((entryNm + 12) / 190) * 60;
    if (tDep + tArr > windowMin * 0.75) {
      const k = (windowMin * 0.75) / (tDep + tArr);
      tDep *= k;
      tArr *= k;
    }
    // Semicircular rule: eastbound odd thousands, westbound even, a few levels apart per flight
    const base = gcNm < 180 ? 17000 : gcNm < 450 ? 27000 : gcNm < 1200 ? 34000 : 37000;
    const east = calcBearingDeg(oLL, dLL) < 180;
    const h = Math.imul(f.id + 17, 0x9e3779b1) >>> 0;
    const level = Math.floor(base / 1000) + ((h & 3) - 1) * 2; // -2, 0, +2, +4 thousand
    const cruiseAlt = (level % 2 === (east ? 1 : 0) ? level : level + 1) * 1000;
    // Slightly different track per flight in cruise so aircraft on the same airway don't stack
    const lateralNm = ((((h >>> 8) & 0xff) / 255) * 2 - 1) * Math.min(4, gcNm / 120);
    const vExit = toVec(exit);
    const vEntry = toVec(entry);
    const cx = vExit[1] * vEntry[2] - vExit[2] * vEntry[1];
    const cy = vExit[2] * vEntry[0] - vExit[0] * vEntry[2];
    const cz = vExit[0] * vEntry[1] - vExit[1] * vEntry[0];
    const cl = Math.hypot(cx, cy, cz) || 1;
    const pole: Vec = [cx / cl, cy / cl, cz / cl];
    p = { gcNm, exitNm, entryNm, exit, entry, vO: O.v, vExit, vEntry, vD: D.v, tDep, tArr, windowMin, cruiseAlt, lateralNm, pole };
    if (this.plans.size >= PLAN_LIMIT) this.plans.clear();
    this.plans.set(f.id, p);
    return p;
  }

  private proc(f: AiFlight, depDay: number, budget: BuildBudget): AiProc | null {
    const key = `${f.id}:${depDay}`;
    const hit = this.procs.get(key);
    if (hit) return hit;
    if (budget.left <= 0 || (budget.until !== undefined && now() > budget.until)) return null;
    budget.left--;
    const arrMin = f.depUtcMin + f.blockMin - aiTaxiMin(f);
    const tp = buildTerminalPaths(this.airports[f.o], this.airports[f.d], depDay, f.depUtcMin, depDay, arrMin);
    const liftIdx = tp.liftoffIdx;
    const dep = makeTrack(tp.dep, (s) => (s < 0.6 ? 70 : 160 + Math.min(1, s / 30) * 90));
    const liftoffNm = dep.cumNm[liftIdx] ?? 0;
    const rollNm = landingRollNm(tp.arrRwy);
    const arr = makeTrack(tp.arr, (s, len) => (s > len - rollNm ? 50 : 250 - Math.min(1, s / Math.max(1, len - rollNm)) * 110));
    let finalNm = arr.lenNm - rollNm - 8;
    let best = Infinity;
    for (let i = 0; i < arr.pts.length; i++) {
      const d = calcCoordDistanceNm(arr.pts[i][0], arr.pts[i][1], tp.finalPoint[0], tp.finalPoint[1]);
      if (d < best) {
        best = d;
        finalNm = arr.cumNm[i];
      }
    }
    const plan = this.plan(f);
    const touchdownNm = arr.lenNm - rollNm;
    // Takeoff roll and landing roll take a fixed minute (lift-off and touchdown then happen exactly
    // on the sequenced runway times); initial climb 180 kt for 5 nm; final approach 150 kt
    const depClimbEndNm = Math.min(dep.lenNm, liftoffNm + 5);
    let depRollT = 1;
    let depClimbT = ((depClimbEndNm - liftoffNm) / 180) * 60;
    if (depRollT + depClimbT > plan.tDep * 0.8) {
      const k = (plan.tDep * 0.8) / (depRollT + depClimbT);
      depRollT *= k;
      depClimbT *= k;
    }
    let arrFinalT = ((touchdownNm - finalNm) / 150) * 60;
    let arrRollT = 1;
    if (arrFinalT + arrRollT > plan.tArr * 0.8) {
      const k = (plan.tArr * 0.8) / (arrFinalT + arrRollT);
      arrFinalT *= k;
      arrRollT *= k;
    }
    const pr: AiProc = {
      tp,
      dep,
      arr,
      liftoffNm,
      touchdownNm,
      finalNm,
      depRollT,
      depClimbT,
      depClimbEndNm,
      arrPreT: plan.tArr - arrFinalT - arrRollT,
      arrFinalT,
      arrRollT,
      rollNm,
    };
    if (this.procs.size >= PROC_LIMIT) {
      // Drop the oldest quarter (Map keeps insertion order)
      let n = PROC_LIMIT / 4;
      for (const k of this.procs.keys()) {
        if (n-- <= 0) break;
        this.procs.delete(k);
      }
    }
    this.procs.set(key, pr);
    this.built++;
    return pr;
  }

  /**
   * Where an AI flight is at (day, min). `budget` limits how many new
   * procedures may be built (count and time); aircraft without one fly the
   * plain great circle near the airport until a later redraw builds it.
   */
  position(f: AiFlight, day: number, min: number, budget: BuildBudget): AiDetailedPosition | null {
    const depDay = aiDepartureDay(f, day, min);
    if (depDay === null) return null;
    const p = this.plan(f);
    const start = f.depUtcMin + aiTaxiMin(f);
    const e = min + (day - depDay) * MIN_PER_DAY - start; // minutes into the airborne window
    const W = p.windowMin;
    const inDep = e < p.tDep;
    const inArr = e > W - p.tArr;
    let proc: AiProc | null = null;
    // Cruising aircraft don't need their procedures; cached ones are reused for free
    if (inDep || inArr) proc = this.proc(f, depDay, budget);
    return this.locate(f, p, proc, e, W, inDep, inArr);
  }

  private locate(f: AiFlight, p: AiPlan, proc: AiProc | null, e: number, W: number, inDep: boolean, inArr: boolean): AiDetailedPosition {
    const progress = Math.max(0, Math.min(1, e / W));
    const remainingMin = Math.max(0, Math.round(W - e)); // to touchdown
    const cruiseNm = Math.max(1, p.gcNm - p.exitNm - p.entryNm);
    const depLen = proc ? proc.dep.lenNm : p.exitNm;
    const arrLen = proc ? proc.touchdownNm : p.entryNm;
    let at: LonLat;
    let bearing: number;
    let sinceLiftoff: number;
    let toTouchdown: number;
    // Altitude runs on the plan's own distances (exit leg, cruise, entry leg) so
    // it carries on smoothly from one phase to the next, whether or not the
    // departure/arrival procedures are built (theirs are longer, and the cruise
    // phase doesn't use them; mixing the two made a 4,000 ft dip after takeoff)
    let climbNm: number;
    let descendNm: number;
    let phaseLabel: string;
    let groundSpeedKts: number;

    if (inDep) {
      const q = Math.max(0, e / p.tDep);
      if (proc) {
        // Roll (accelerating), initial climb at a fixed speed, then the rest of the departure
        const restT = Math.max(1e-6, p.tDep - proc.depRollT - proc.depClimbT);
        const along =
          e < proc.depRollT
            ? proc.liftoffNm * (e / proc.depRollT) ** 2
            : e < proc.depRollT + proc.depClimbT
            ? proc.liftoffNm + ((e - proc.depRollT) / proc.depClimbT) * (proc.depClimbEndNm - proc.liftoffNm)
            : proc.depClimbEndNm + Math.min(1, (e - proc.depRollT - proc.depClimbT) / restT) * (proc.dep.lenNm - proc.depClimbEndNm);
        const o = { ...atDistance(proc.dep, along), alongNm: along };
        at = o.at;
        bearing = o.brg;
        sinceLiftoff = o.alongNm - proc.liftoffNm;
        toTouchdown = proc.dep.lenNm - o.alongNm + cruiseNm + arrLen;
        climbNm = (Math.max(0, sinceLiftoff) / Math.max(1e-6, proc.dep.lenNm - proc.liftoffNm)) * p.exitNm;
        descendNm = p.exitNm - climbNm + cruiseNm + p.entryNm;
        phaseLabel = sinceLiftoff <= 0 ? `Taking off from runway ${proc.tp.depRwy.ident}` : `Departing runway ${proc.tp.depRwy.ident}`;
        groundSpeedKts = sinceLiftoff <= 0 ? Math.round(60 + (o.alongNm / Math.max(0.1, proc.liftoffNm)) * 90) : Math.round(170 + Math.min(1, o.alongNm / depLen) * 80);
      } else {
        at = slerp(p.vO, p.vExit, q);
        bearing = calcBearingDeg(at, p.exit);
        sinceLiftoff = q * p.exitNm;
        toTouchdown = (1 - q) * p.exitNm + cruiseNm + arrLen;
        climbNm = sinceLiftoff;
        descendNm = (1 - q) * p.exitNm + cruiseNm + p.entryNm;
        phaseLabel = 'Departing';
        groundSpeedKts = Math.round(170 + q * 80);
      }
    } else if (inArr) {
      const q = Math.min(1, (e - (W - p.tArr)) / p.tArr);
      if (proc) {
        // Pattern at its own pace, then final approach and roll-out at fixed speeds
        const e2 = e - (W - p.tArr);
        const pre = Math.max(1e-6, proc.arrPreT);
        const along =
          e2 < pre
            ? (e2 / pre) * proc.finalNm
            : e2 < pre + proc.arrFinalT
            ? proc.finalNm + ((e2 - pre) / Math.max(1e-6, proc.arrFinalT)) * (proc.touchdownNm - proc.finalNm)
            : proc.touchdownNm + proc.rollNm * (1 - (1 - Math.min(1, (e2 - pre - proc.arrFinalT) / Math.max(1e-6, proc.arrRollT))) ** 2);
        const o = { ...atDistance(proc.arr, along), alongNm: along };
        at = o.at;
        bearing = o.brg;
        toTouchdown = proc.touchdownNm - o.alongNm;
        sinceLiftoff = depLen - (proc?.liftoffNm ?? 0) + cruiseNm + o.alongNm;
        descendNm = (Math.max(0, toTouchdown) / Math.max(1e-6, proc.touchdownNm)) * p.entryNm;
        climbNm = p.exitNm + cruiseNm + p.entryNm - descendNm;
        const rwy = proc.tp.arrRwy.ident;
        phaseLabel = toTouchdown <= 0 ? `Landed on runway ${rwy}` : o.alongNm >= proc.finalNm ? `Final approach, runway ${rwy}` : `Arriving, vectored for runway ${rwy}`;
        groundSpeedKts = toTouchdown <= 0 ? 60 : o.alongNm >= proc.finalNm ? 140 : Math.round(250 - Math.min(1, o.alongNm / Math.max(1, proc.finalNm)) * 80);
      } else {
        at = slerp(p.vEntry, p.vD, q);
        const D = this.traffic.airports[f.d];
        bearing = calcBearingDeg(at, [D.lon, D.lat]);
        toTouchdown = (1 - q) * p.entryNm;
        sinceLiftoff = depLen + cruiseNm + q * p.entryNm;
        descendNm = toTouchdown;
        climbNm = p.exitNm + cruiseNm + q * p.entryNm;
        phaseLabel = 'Arriving';
        groundSpeedKts = Math.round(250 - q * 100);
      }
    } else {
      const q = (e - p.tDep) / Math.max(1e-6, W - p.tDep - p.tArr);
      at = slerpSide(p.vExit, p.vEntry, q, p.pole, p.lateralNm * Math.sin(Math.PI * q));
      bearing = calcBearingDeg(at, p.entry);
      sinceLiftoff = depLen - (proc?.liftoffNm ?? 0) + q * cruiseNm;
      toTouchdown = (1 - q) * cruiseNm + arrLen;
      climbNm = p.exitNm + q * cruiseNm;
      descendNm = (1 - q) * cruiseNm + p.entryNm;
      phaseLabel = '';
      groundSpeedKts = f.cruiseKts;
    }

    // ~3 nm per 1,000 ft climbing, ~3.2 nm descending, 3° glide on final
    const onGround = sinceLiftoff <= 0 || toTouchdown <= 0;
    const climbAlt = (climbNm / 3) * 1000;
    // On final the real distance to touchdown sets a 3° glide
    const descentAlt = Math.min(descendNm * 312, inArr && proc ? Math.max(0, toTouchdown) * 318 : Infinity);
    const altitudeFt = onGround ? 0 : Math.max(0, Math.round(Math.min(p.cruiseAlt, climbAlt, descentAlt) / 100) * 100);
    if (!phaseLabel) {
      phaseLabel = altitudeFt >= p.cruiseAlt ? 'Cruising' : climbAlt < descentAlt ? 'Climbing' : 'Descending';
      if (altitudeFt < p.cruiseAlt) groundSpeedKts = Math.round(250 + (altitudeFt / p.cruiseAlt) * (f.cruiseKts - 250));
    }
    return {
      coordinates: at,
      bearing: Math.round(bearing),
      progress,
      remainingMin,
      altitudeFt,
      groundSpeedKts,
      phaseLabel,
      procedural: Boolean(proc),
    };
  }

  /** Runway to runway: departure, cruise (with its sideways offset) and arrival, longitudes unwrapped. */
  private pathPoints(p: AiPlan, proc: AiProc): LonLat[] {
    const N = Math.max(2, Math.min(48, Math.round(p.gcNm / 80)));
    const cruise: LonLat[] = [];
    for (let i = 1; i < N; i++) {
      // Same sideways offset as the aircraft flies in cruise
      cruise.push(slerpSide(p.vExit, p.vEntry, i / N, p.pole, p.lateralNm * Math.sin((Math.PI * i) / N)));
    }
    const pts: LonLat[] = [...proc.dep.pts, ...cruise, ...proc.arr.pts].map((q) => [q[0], q[1]]);
    for (let i = 1; i < pts.length; i++) {
      while (pts[i][0] - pts[i - 1][0] > 180) pts[i][0] -= 360;
      while (pts[i][0] - pts[i - 1][0] < -180) pts[i][0] += 360;
    }
    return pts;
  }

  /** The whole flight path from takeoff roll to the end of the landing roll, for a given departure day. */
  fullPath(f: AiFlight, depDay: number): LonLat[] {
    return this.pathPoints(this.plan(f), this.proc(f, depDay, { left: 1 })!);
  }

  /** Whole path of a flight split at its position (procedures are built if missing). */
  trail(f: AiFlight, day: number, min: number): { flown: LonLat[]; remaining: LonLat[] } | null {
    const depDay = aiDepartureDay(f, day, min);
    if (depDay === null) return null;
    const p = this.plan(f);
    const proc = this.proc(f, depDay, { left: 1 })!;
    const pos = this.position(f, day, min, { left: 1 });
    if (!pos) return null;
    const pts = this.pathPoints(p, proc);
    // Split at the aircraft: nearest vertex, then whether the plane is already past it
    const here: LonLat = [pos.coordinates[0], pos.coordinates[1]];
    const kx = Math.cos(here[1] * D2R);
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < pts.length; i++) {
      let lon = here[0];
      while (lon - pts[i][0] > 180) lon -= 360;
      while (lon - pts[i][0] < -180) lon += 360;
      const d = Math.hypot((lon - pts[i][0]) * kx, here[1] - pts[i][1]);
      if (d < bestD) {
        bestD = d;
        best = i;
        here[0] = lon;
      }
    }
    const nxt = pts[best + 1];
    const past = nxt ? (nxt[0] - pts[best][0]) * kx * (here[0] - pts[best][0]) * kx + (nxt[1] - pts[best][1]) * (here[1] - pts[best][1]) > 0 : true;
    const cut = past ? best + 1 : best;
    return { flown: [...pts.slice(0, cut), here], remaining: [here, ...pts.slice(cut)] };
  }
}
