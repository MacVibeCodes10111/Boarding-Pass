// ============================================================================
// NAVAIDS, RUNWAYS, COSMETIC WEATHER, SID/STAR/ILS GEOMETRY & LIVE POSITIONS
// ============================================================================
import { BUILTIN_NAVAIDS } from './builtinData';
import {
  calcBearingDeg,
  calcCoordDistanceNm,
  calcDistanceNm,
  interpolateCoordPair,
  offsetLatLonNm,
  type LonLat,
} from './geo';
import { MIN_PER_DAY, dayIndexOf, daysOrAll } from './time';
import type { Airport, NavaidWaypoint, RunwayEndPair, ScheduledFlight } from './types';

// ----------------------------------------------------------------------------
// Navaid store (built-in fallback, replaced by /data/navaids.csv when present)
// ----------------------------------------------------------------------------
// Declared first because setGlobalNavaidsMemory() (run at import) clears it.
const geometryCache = new Map<string, FlightProcedureWaypoints>();
const GEOMETRY_CACHE_LIMIT = 600;

export function clearFlightGeometryCache() {
  geometryCache.clear();
}

let globalNavaids: NavaidWaypoint[] = [];
let navaidsByAirportIcao = new Map<string, NavaidWaypoint[]>();
/** 1°×1° grid buckets so corner-post lookups don't scan all ~11k navaids. */
let navaidGrid = new Map<string, NavaidWaypoint[]>();

const gridKey = (lat: number, lon: number) => `${Math.floor(lat)}:${Math.floor(lon)}`;

export function setGlobalNavaidsMemory(navaids: NavaidWaypoint[]) {
  globalNavaids = navaids.length > 0 ? navaids : [...BUILTIN_NAVAIDS];
  navaidsByAirportIcao = new Map();
  navaidGrid = new Map();
  for (const n of globalNavaids) {
    if (n.associated_airport) {
      const list = navaidsByAirportIcao.get(n.associated_airport) ?? [];
      list.push(n);
      navaidsByAirportIcao.set(n.associated_airport, list);
    }
    const key = gridKey(n.latitude_deg, n.longitude_deg);
    const cell = navaidGrid.get(key) ?? [];
    cell.push(n);
    navaidGrid.set(key, cell);
  }
  clearFlightGeometryCache();
}
setGlobalNavaidsMemory(BUILTIN_NAVAIDS);

export function getGlobalNavaidsList(): NavaidWaypoint[] {
  return globalNavaids;
}

function navaidsNear(lat: number, lon: number, latSpan: number, lonSpan: number): NavaidWaypoint[] {
  const out: NavaidWaypoint[] = [];
  for (let la = Math.floor(lat - latSpan); la <= Math.floor(lat + latSpan); la++) {
    for (let lo = Math.floor(lon - lonSpan); lo <= Math.floor(lon + lonSpan); lo++) {
      const wrappedLo = ((((lo + 180) % 360) + 360) % 360) - 180;
      const cell = navaidGrid.get(`${la}:${wrappedLo}`);
      if (cell) out.push(...cell);
    }
  }
  return out;
}

export function formatNavaidFreq(freqKhz: number, type: string): string {
  if (!freqKhz) return '';
  if (type.includes('NDB') || freqKhz < 2000) return `${freqKhz} kHz`;
  return `${(freqKhz / 1000).toFixed(2).replace(/0$/, '')} MHz`;
}

// ----------------------------------------------------------------------------
// Runways (real data from runways.csv, otherwise a deterministic fake layout)
// ----------------------------------------------------------------------------
export function getAirportRunways(airport: Airport): RunwayEndPair[] {
  if (airport.runways && airport.runways.length > 0) return airport.runways;

  const code = (airport.iata_code + '___').slice(0, 3);
  const seed = (code.charCodeAt(0) * 31 + code.charCodeAt(1) * 17 + code.charCodeAt(2) * 13) % 18;
  const num1 = seed + 1;
  const num2 = num1 + 18;
  const hdg1 = num1 * 10;
  const hdg2 = (hdg1 + 180) % 360;
  const lengthFt = airport.max_runway_length_ft || 8000;
  const halfLenNm = (lengthFt / 6076.12) * 0.5;
  const hasParallel = (airport.runway_count || 1) >= 2;

  const makePair = (n1: number, n2: number, h1: number, h2: number, halfNm: number, len: number, sfx: [string, string]): RunwayEndPair => {
    const [leLon, leLat] = offsetLatLonNm(airport.latitude_deg, airport.longitude_deg, h2, halfNm);
    const [heLon, heLat] = offsetLatLonNm(airport.latitude_deg, airport.longitude_deg, h1, halfNm);
    return {
      le_ident: `${String(n1).padStart(2, '0')}${sfx[0]}`,
      he_ident: `${String(n2).padStart(2, '0')}${sfx[1]}`,
      length_ft: len,
      le_lat: leLat,
      le_lon: leLon,
      le_heading_degT: h1,
      he_lat: heLat,
      he_lon: heLon,
      he_heading_degT: h2,
    };
  };

  const list = [makePair(num1, num2, hdg1, hdg2, halfLenNm, lengthFt, hasParallel ? ['R', 'L'] : ['', ''])];

  if ((airport.runway_count || 1) >= 3) {
    const c1 = ((num1 + 6) % 18) + 1;
    const ch1 = c1 * 10;
    list.push(makePair(c1, c1 + 18, ch1, (ch1 + 180) % 360, halfLenNm * 0.85, Math.round(lengthFt * 0.86), ['', '']));
  }
  return list;
}

// ----------------------------------------------------------------------------
// 100% cosmetic weather (deterministic per airport per 3-hour block)
// ----------------------------------------------------------------------------
export interface AirportWeather {
  windDirDeg: number;
  windSpeedKts: number;
  gustKts: number | null;
  tempC: number;
  tempF: number;
  conditionIcon: string;
  conditionLabel: string;
  flightCategory: 'VFR' | 'MVFR' | 'IFR';
  categoryBadge: string;
  categoryColor: string;
  visibilitySm: number;
  ceilingFt: number | null;
  precipIntensity: number; // 0 = dry, 1 = light, 2 = moderate, 3 = heavy
  precipColor: string;
  metarRaw: string;
}

function airportHash(airport: Airport): number {
  const code = (airport.iata_code + '___').slice(0, 3);
  return code.charCodeAt(0) * 73 + code.charCodeAt(1) * 37 + code.charCodeAt(2) * 19 + airport.id * 11;
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const metarTemp = (c: number) => (c < 0 ? `M${pad2(Math.abs(c))}` : pad2(c));

/** `dayOfMonth` (optional) puts the real UTC date into the METAR string. */
export function getAirportWeather(airport: Airport, simDay = 1, simMin = 720, dayOfMonth?: number): AirportWeather {
  const hash = airportHash(airport);
  const minOfDay = ((Math.floor(simMin) % MIN_PER_DAY) + MIN_PER_DAY) % MIN_PER_DAY;

  // Wind shifts every 3 hours of simulation time
  const weatherEpoch = simDay * 8 + Math.floor(minOfDay / 180);
  const windDirDeg = Math.round(((hash * 29 + weatherEpoch * 43) % 360) / 10) * 10 || 360;
  const windSpeedKts = 5 + ((hash + weatherEpoch * 7) % 18);
  const gustKts = windSpeedKts >= 18 ? windSpeedKts + 7 : null;

  // Latitude + elevation + diurnal temperature curve
  const baseTempC = Math.round(
    28 - Math.abs(airport.latitude_deg) * 0.58 - (airport.elevation_ft || 0) * 0.0019
  );
  const tempC = baseTempC + Math.round(Math.sin(((minOfDay - 360) / MIN_PER_DAY) * Math.PI * 2) * 5);
  const tempF = Math.round(tempC * 1.8 + 32);

  const VFR = { flightCategory: 'VFR' as const, categoryBadge: 'VFR', categoryColor: '#10b981' };
  const MVFR = { flightCategory: 'MVFR' as const, categoryBadge: 'MVFR', categoryColor: '#3b82f6' };
  const IFR = { flightCategory: 'IFR' as const, categoryBadge: 'IFR', categoryColor: '#ef4444' };

  const wxRoll = (hash * 13 + weatherEpoch * 31) % 100;
  let wx: Omit<AirportWeather, 'windDirDeg' | 'windSpeedKts' | 'gustKts' | 'tempC' | 'tempF' | 'metarRaw'> & {
    metarWx: string;
  };

  if (wxRoll < 52) {
    wx = { ...VFR, conditionIcon: '', conditionLabel: 'Clear', visibilitySm: 10, ceilingFt: null, precipIntensity: 0, precipColor: 'transparent', metarWx: 'FEW250' };
  } else if (wxRoll < 74) {
    wx = { ...VFR, conditionIcon: '', conditionLabel: 'Scattered Clouds', visibilitySm: 10, ceilingFt: 4500, precipIntensity: 0, precipColor: 'transparent', metarWx: 'SCT045 BKN120' };
  } else if (wxRoll < 86) {
    const snow = tempC <= 1;
    wx = {
      ...MVFR,
      conditionIcon: '',
      conditionLabel: snow ? 'Light Snow' : 'Light Rain',
      visibilitySm: 4,
      ceilingFt: 2100,
      precipIntensity: 1,
      precipColor: snow ? '#38bdf8' : '#22c55e',
      metarWx: snow ? '-SN OVC018' : '-RA BKN022',
    };
  } else if (wxRoll < 94) {
    const snow = tempC <= 0;
    wx = {
      ...IFR,
      conditionIcon: '',
      conditionLabel: snow ? 'Heavy Snow' : 'Low Fog & Mist',
      visibilitySm: 1.5,
      ceilingFt: 600,
      precipIntensity: 2,
      precipColor: snow ? '#a855f7' : '#eab308',
      metarWx: snow ? '+SN FG VV006' : 'BR OVC005',
    };
  } else {
    wx = { ...IFR, conditionIcon: '', conditionLabel: 'Thunderstorms', visibilitySm: 2, ceilingFt: 1100, precipIntensity: 3, precipColor: '#ef4444', metarWx: '+TSRA BKN011CB' };
  }

  const dd = pad2(dayOfMonth ?? ((simDay - 1) % 28) + 1);
  const hhmm = `${pad2(Math.floor(minOfDay / 60))}${pad2(minOfDay % 60)}`;
  const wind = `${String(windDirDeg).padStart(3, '0')}${pad2(windSpeedKts)}${gustKts ? `G${gustKts}` : ''}KT`;
  const metarRaw = `${airport.icao_code} ${dd}${hhmm}Z ${wind} ${wx.visibilitySm}SM ${wx.metarWx} ${metarTemp(tempC)}/${metarTemp(tempC - 3)} A2992`;

  const { metarWx: _unused, ...rest } = wx;
  return { ...rest, windDirDeg, windSpeedKts, gustKts, tempC, tempF, metarRaw };
}

// ----------------------------------------------------------------------------
// Active runway (best headwind) & approach
// ----------------------------------------------------------------------------
export interface ActiveRunwaySelection {
  ident: string;
  headingDegT: number;
  reciprocalDegT: number;
  thresholdLon: number;
  thresholdLat: number;
  headwindKts: number;
  crosswindKts: number;
  approachType: string;
  associatedNavaid: NavaidWaypoint | null;
  /** Length of the chosen runway, nm. */
  lengthNm: number;
  /**
   * Where landings cross the threshold: the runway end, or further in where the
   * threshold is displaced (v2.29+). Takeoffs still use the whole runway.
   */
  landLon: number;
  landLat: number;
  /** Runway available for landing, from the landing threshold on, nm. */
  landingLengthNm: number;
}

/**
 * Runway in use. Arrivals use the best runway for the wind; departures use a
 * parallel runway facing the same way when the airport has one, so takeoffs
 * and landings don't share the same strip.
 */
export function getActiveRunwayForAirport(airport: Airport, simDay = 1, simMin = 720, purpose: 'arrival' | 'departure' = 'arrival'): ActiveRunwaySelection {
  const wx = getAirportWeather(airport, simDay, simMin);
  let best = { ident: '', hdg: 0, lon: airport.longitude_deg, lat: airport.latitude_deg, headwind: -Infinity, crosswind: 0, lenFt: 8000, dispFt: 0 };

  for (const pair of getAirportRunways(airport)) {
    const ends = [
      { ident: pair.le_ident, hdg: pair.le_heading_degT, lon: pair.le_lon, lat: pair.le_lat, lenFt: pair.length_ft, dispFt: pair.le_displaced_ft ?? 0 },
      { ident: pair.he_ident, hdg: pair.he_heading_degT, lon: pair.he_lon, lat: pair.he_lat, lenFt: pair.length_ft, dispFt: pair.he_displaced_ft ?? 0 },
    ];
    for (const end of ends) {
      const diffRad = ((wx.windDirDeg - end.hdg) * Math.PI) / 180;
      const headwind = wx.windSpeedKts * Math.cos(diffRad);
      // Prefer the longer runway when two give much the same headwind
      if (headwind > best.headwind + 1.5 || (Math.abs(headwind - best.headwind) <= 1.5 && end.lenFt > best.lenFt)) {
        best = { ...end, headwind, crosswind: Math.abs(wx.windSpeedKts * Math.sin(diffRad)) };
      }
    }
  }

  if (purpose === 'departure') {
    // Same direction (within 20°), different runway, the longest of those
    let alt: typeof best | null = null;
    for (const pair of getAirportRunways(airport)) {
      for (const end of [
        { ident: pair.le_ident, hdg: pair.le_heading_degT, lon: pair.le_lon, lat: pair.le_lat, lenFt: pair.length_ft, dispFt: pair.le_displaced_ft ?? 0 },
        { ident: pair.he_ident, hdg: pair.he_heading_degT, lon: pair.he_lon, lat: pair.he_lat, lenFt: pair.length_ft, dispFt: pair.he_displaced_ft ?? 0 },
      ]) {
        if (end.ident === best.ident) continue;
        const d = Math.abs(((end.hdg - best.hdg + 540) % 360) - 180);
        if (d <= 20 && (!alt || end.lenFt > alt.lenFt)) alt = { ...end, headwind: best.headwind, crosswind: best.crosswind };
      }
    }
    if (alt) best = alt;
  }
  // Kept to a tenth of a degree: whole degrees put a long landing roll tens of metres off the centreline
  const headingDegT = Math.round(best.hdg * 10) / 10;
  const lenFt = best.lenFt || 8000;
  const dispFt = Math.max(0, Math.min(best.dispFt || 0, lenFt * 0.5));
  const [landLon, landLat] = dispFt > 0 ? offsetLatLonNm(best.lat, best.lon, headingDegT, dispFt / 6076.12) : [best.lon, best.lat];
  const assocList = navaidsByAirportIcao.get(airport.icao_code) ?? [];
  const associatedNavaid =
    assocList.find((n) => n.type.includes('VOR') || n.type === 'DME') ?? assocList[0] ?? null;

  const isCatII = wx.flightCategory === 'IFR' && airport.max_runway_length_ft >= 8000;
  const approachType =
    airport.max_runway_length_ft >= 6000
      ? `ILS${isCatII ? ' Cat II' : ''} Rwy ${best.ident}`
      : `RNAV (GPS) Rwy ${best.ident}`;

  return {
    ident: best.ident,
    headingDegT,
    reciprocalDegT: Math.round(((headingDegT + 180) % 360) * 10) / 10,
    thresholdLon: best.lon,
    thresholdLat: best.lat,
    headwindKts: Math.round(best.headwind),
    crosswindKts: Math.round(best.crosswind),
    approachType,
    associatedNavaid,
    lengthNm: Math.max(0.5, lenFt / 6076.12),
    landLon,
    landLat,
    landingLengthNm: Math.max(0.4, (lenFt - dispFt) / 6076.12),
  };
}

// ----------------------------------------------------------------------------
// Flight path: takeoff, SID, cruise, STAR, approach pattern, landing
//   Terminal legs are laid out in a flat local frame (nm east/north of the
//   airport) and every corner is rounded with a turn of realistic radius, so
//   aircraft climb out on runway heading, turn smoothly onto course, and on
//   arrival either fly straight in or join a downwind/base leg to intercept
//   the final approach course. The cruise between them is a great circle.
// ----------------------------------------------------------------------------
export interface FlightProcedureWaypoints {
  points: LonLat[];
  cumulativeNm: number[];
  /** Share of the block time used up at each point (0..1), from a speed profile. */
  cumulativeT: number[];
  totalTrackNm: number;
  /** Track distance at the end of the departure procedure / start of the arrival / start of final. */
  sidEndNm: number;
  starStartNm: number;
  finalStartNm: number;
  /** Lift-off and touchdown distance along the track. */
  liftoffNm: number;
  touchdownNm: number;
  depRwy: ActiveRunwaySelection;
  arrRwy: ActiveRunwaySelection;
  sidCode: string;
  starCode: string;
  navaidSummary: string;
}

type XY = [number, number];
const D2R = Math.PI / 180;

/** Flat frame around an airport, good to well under 0.5% within ~80 nm. */
function localFrame(lat0: number, lon0: number) {
  const k = Math.cos(lat0 * D2R) * 60;
  return {
    toXY: ([lon, lat]: LonLat): XY => {
      let dLon = lon - lon0;
      while (dLon > 180) dLon -= 360;
      while (dLon < -180) dLon += 360;
      return [dLon * k, (lat - lat0) * 60];
    },
    toLL: ([x, y]: XY): LonLat => [lon0 + x / k, lat0 + y / 60],
  };
}
const unitFromHdg = (hdg: number): XY => [Math.sin(hdg * D2R), Math.cos(hdg * D2R)];
const add = (a: XY, b: XY, k = 1): XY => [a[0] + b[0] * k, a[1] + b[1] * k];
const sub = (a: XY, b: XY): XY => [a[0] - b[0], a[1] - b[1]];
const len = (a: XY) => Math.hypot(a[0], a[1]);
const norm = (a: XY): XY => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l];
};

/**
 * Rounds every corner of a polyline with an arc of the given radius (nm), so
 * the aircraft turns instead of pivoting. Radii shrink where legs are short.
 */
export function filletPath(pts: XY[], radii: number[]): XY[] {
  if (pts.length < 3) return pts.slice();
  const out: XY[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const P = pts[i];
    const inLen = len(sub(P, out[out.length - 1]));
    const outLen = len(sub(pts[i + 1], P));
    const a = norm(sub(out[out.length - 1], P));
    const b = norm(sub(pts[i + 1], P));
    const cosPhi = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1]));
    const phi = Math.acos(cosPhi); // angle between the legs
    const turn = Math.PI - phi;
    if (turn < 3 * D2R || inLen < 1e-6 || outLen < 1e-6) {
      out.push(P);
      continue;
    }
    let r = radii[i] ?? 2;
    let t = r * Math.tan(turn / 2);
    const tMax = 0.48 * Math.min(inLen, outLen);
    if (t > tMax) {
      t = tMax;
      r = t / Math.tan(turn / 2);
    }
    const S = add(P, a, t);
    const E = add(P, b, t);
    const bis = norm(add(a, b));
    const C = add(P, bis, r / Math.sin(phi / 2));
    const a0 = Math.atan2(S[1] - C[1], S[0] - C[0]);
    let a1 = Math.atan2(E[1] - C[1], E[0] - C[0]);
    let sweep = a1 - a0;
    while (sweep > Math.PI) sweep -= 2 * Math.PI;
    while (sweep < -Math.PI) sweep += 2 * Math.PI;
    a1 = a0 + sweep;
    const steps = Math.max(2, Math.ceil(Math.abs(sweep) / (12 * D2R)));
    for (let k = 0; k <= steps; k++) {
      const ang = a0 + (sweep * k) / steps;
      out.push([C[0] + r * Math.cos(ang), C[1] + r * Math.sin(ang)]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** Real navaid within `maxOffNm` of a point, to name the SID/STAR after. */
function navaidNear(ll: LonLat, maxOffNm: number): NavaidWaypoint | null {
  let best: NavaidWaypoint | null = null;
  let bestD = maxOffNm;
  for (const nav of navaidsNear(ll[1], ll[0], 1, 1.2)) {
    const d = calcCoordDistanceNm(ll[0], ll[1], nav.longitude_deg, nav.latitude_deg);
    if (d < bestD) {
      bestD = d;
      best = nav;
    }
  }
  return best;
}

const procDigit = (a: string, b: string) => 1 + ((a.charCodeAt(0) * 7 + a.charCodeAt(2) * 3 + b.charCodeAt(1)) % 9);

/**
 * Builds the full path. Results are cached per (origin, destination, 3-hour
 * weather block) because the inputs are deterministic and the map asks for
 * the same geometry many times per second.
 */
export function buildFlightProcedureGeometry(
  origin: Airport,
  destination: Airport,
  simDay = 1,
  simMin = 720,
  /** Arrival time (sim day + minute, may run past 1440); defaults to the departure time. */
  arrDay?: number,
  arrMin?: number
): FlightProcedureWaypoints {
  const minOfDay = ((Math.floor(simMin) % MIN_PER_DAY) + MIN_PER_DAY) % MIN_PER_DAY;
  const arr = normalizeSimTime(arrDay ?? simDay, arrMin ?? minOfDay);
  const key = `${origin.iata_code}>${destination.iata_code}@${simDay}:${Math.floor(minOfDay / 180)}>${arr.day}:${Math.floor(arr.min / 180)}`;
  const cached = geometryCache.get(key);
  if (cached) return cached;

  const result = computeProcedureGeometry(origin, destination, simDay, minOfDay, arr.day, arr.min);
  if (geometryCache.size >= GEOMETRY_CACHE_LIMIT) {
    const oldest = geometryCache.keys().next().value;
    if (oldest !== undefined) geometryCache.delete(oldest);
  }
  geometryCache.set(key, result);
  return result;
}

/** Folds minutes past midnight into the next sim day. */
function normalizeSimTime(day: number, min: number) {
  const extra = Math.floor(min / MIN_PER_DAY);
  return { day: day + extra, min: min - extra * MIN_PER_DAY };
}

/** Departure: takeoff roll, climb-out on runway heading, smooth turn onto course to the SID exit. */
function departureLegs(origin: Airport, rwy: ActiveRunwaySelection, exit: LonLat, beyond: LonLat, scale: number) {
  const f = localFrame(origin.latitude_deg, origin.longitude_deg);
  const u = unitFromHdg(rwy.headingDegT);
  const T = f.toXY([rwy.thresholdLon, rwy.thresholdLat]);
  const liftoff = add(T, u, liftoffNm(rwy));
  const climbOut = add(liftoff, u, Math.max(1.6, 4 * scale)); // ~1,500–2,000 ft before turning
  const X = f.toXY(exit);
  // Big course reversals get an extra point so the turn is a wide arc, not a hairpin
  const toExit = norm(sub(X, climbOut));
  const reversal = u[0] * toExit[0] + u[1] * toExit[1] < -0.35;
  const mid: XY[] = [];
  if (reversal) {
    const side: XY = [u[1], -u[0]]; // right of runway heading
    const crossSign = side[0] * toExit[0] + side[1] * toExit[1] >= 0 ? 1 : -1;
    mid.push(add(add(climbOut, u, 2.5 * scale + 1), side, crossSign * 4 * Math.max(0.6, scale)));
  }
  // `beyond` (the next point on the route) lets the turn at the exit be rounded too; it is dropped after
  const raw: XY[] = [T, liftoff, climbOut, ...mid, X, f.toXY(beyond)];
  const radii = raw.map((_, i) => (i <= 2 ? 1.6 + scale : 3 + 2 * scale));
  const pts = filletPath(raw, radii).slice(0, -1);
  return { pts: pts.map(f.toLL), liftoffIdx: 1 };
}

/**
 * Arrival from the STAR entry point: straight in when arriving roughly along
 * the runway, otherwise a base or downwind join, then final and the landing roll.
 */
function arrivalLegs(dest: Airport, rwy: ActiveRunwaySelection, entry: LonLat, before: LonLat, scale: number) {
  const f = localFrame(dest.latitude_deg, dest.longitude_deg);
  const u = unitFromHdg(rwy.headingDegT); // landing direction
  const v: XY = [u[1], -u[0]]; // right of the landing direction
  const T = f.toXY([rwy.landLon, rwy.landLat]); // landing threshold
  const E = f.toXY(entry);
  const inbound = norm(sub(T, E));
  const along = inbound[0] * u[0] + inbound[1] * u[1]; // 1 = arriving straight along the runway
  const side = (E[0] - T[0]) * v[0] + (E[1] - T[1]) * v[1] >= 0 ? 1 : -1;
  const s = Math.max(0.45, scale);
  const finalLen = 8 * s + 2; // intercept the localiser ~6–10 nm out
  const FI = add(T, u, -finalLen);
  const FAF = add(T, u, -Math.min(5, finalLen * 0.6));
  const legs: XY[] = [f.toXY(before), E];
  let pattern: 'straight' | 'base' | 'downwind';
  if (along > 0.55) {
    pattern = 'straight';
    // Intercept at ≤30°: a point a little further out on the extended centreline
    legs.push(add(add(T, u, -(finalLen + 4 * s)), v, side * 2.5 * s));
  } else if (along > -0.4) {
    pattern = 'base';
    legs.push(add(add(T, u, -(finalLen + 2 * s)), v, side * 6 * s));
  } else {
    pattern = 'downwind';
    legs.push(add(add(T, u, 4 * s), v, side * 5.5 * s)); // join downwind abeam the far end
    legs.push(add(add(T, u, -(finalLen + 1.5 * s)), v, side * 5.5 * s)); // end of downwind
  }
  const finalIdx = legs.length; // FI index in raw
  // Over the threshold at ~50 ft, touchdown at the aiming point, then the landing roll to the turn-off
  const TD = add(T, u, touchdownOffsetNm(rwy));
  legs.push(FI, FAF, T, TD, add(TD, u, landingRollNm(rwy)));
  const radii = legs.map((_, i) => (i === 1 ? 4 + 2 * s : 2.2 * s + 0.6));
  const pts = filletPath(legs, radii).slice(1); // `before` only shapes the turn at the entry
  return { pts: pts.map(f.toLL), pattern, finalIdxRaw: finalIdx, threshold: f.toLL(T), finalPoint: f.toLL(FI) };
}

/**
 * Touchdown: the aiming point, 1,000 ft past the landing threshold (less on a
 * short runway), where a 3° glide path that crosses the threshold at 50 ft meets
 * the ground.
 */
export const touchdownOffsetNm = (rwy: ActiveRunwaySelection) => Math.min(1000 / 6076.12, rwy.landingLengthNm * 0.18);
/**
 * Landing roll from touchdown to where the aircraft turns off, nm: about
 * 1,300 m on a long runway (an airliner slowing to exit speed), less on a short
 * one. The taxi network then picks the nearest exit there.
 */
export const landingRollNm = (rwy: ActiveRunwaySelection) =>
  Math.max(0.3, Math.min(0.7, (rwy.landingLengthNm - touchdownOffsetNm(rwy)) * 0.5));
/** Takeoff run to lift-off, nm: about 1,800 m on a long runway, at most 62% of a short one. */
export const liftoffNm = (rwy: ActiveRunwaySelection) => Math.min(rwy.lengthNm * 0.62, 1.0);

/** Where the landing roll on a runway ends. */
export function rolloutEndPoint(rwy: ActiveRunwaySelection): LonLat {
  return offsetLatLonNm(rwy.landLat, rwy.landLon, rwy.headingDegT, touchdownOffsetNm(rwy) + landingRollNm(rwy));
}

/**
 * Minutes your aircraft spend taxiing out and in. The scheduled block time
 * already includes 20 minutes of taxiing (see calcBlockTimeMin).
 */
export function playerTaxiMin(blockMin: number): { out: number; in: number } {
  const k = Math.min(1, blockMin / 40);
  return { out: 12 * k, in: 8 * k };
}

/** Speed (kt) assumed at a point, for spreading the block time along the path. */
function speedAt(alongNm: number, p: { liftoff: number; sidEnd: number; starStart: number; touchdown: number; total: number }, cruiseKts = 450) {
  if (alongNm < p.liftoff) return 70;
  if (alongNm > p.touchdown) return 50;
  const climbEnd = p.sidEnd + (p.starStart - p.sidEnd) * 0.15;
  if (alongNm < p.sidEnd) return 160 + (Math.min(1, (alongNm - p.liftoff) / Math.max(1, p.sidEnd - p.liftoff)) * 90);
  if (alongNm < climbEnd) return 250 + ((alongNm - p.sidEnd) / Math.max(1, climbEnd - p.sidEnd)) * (cruiseKts - 250);
  if (alongNm < p.starStart) return cruiseKts;
  const t = Math.min(1, (alongNm - p.starStart) / Math.max(1, p.touchdown - p.starStart));
  return 250 - t * 110;
}

export interface TerminalPaths {
  /** Runway threshold → takeoff roll → climb-out → turn → SID exit (on the great circle). */
  dep: LonLat[];
  /** STAR entry (on the great circle) → pattern → final → threshold → end of landing roll. */
  arr: LonLat[];
  exit: LonLat;
  entry: LonLat;
  exitNm: number;
  entryNm: number;
  directDistNm: number;
  liftoffIdx: number;
  /** Arrival point where the final approach starts. */
  finalPoint: LonLat;
  depRwy: ActiveRunwaySelection;
  arrRwy: ActiveRunwaySelection;
  sidName: string;
  starName: string;
}

/** Where the departure ends and the arrival starts on the great circle, for a route. */
export function terminalDistances(directDistNm: number) {
  const scale = Math.min(1, Math.max(0.3, directDistNm / 160));
  let exitNm = 28 * scale + 4;
  let entryNm = 38 * scale + 6;
  if (exitNm + entryNm > directDistNm * 0.8) {
    const k = (directDistNm * 0.8) / (exitNm + entryNm);
    exitNm *= k;
    entryNm *= k;
  }
  return { scale, exitNm, entryNm };
}

/**
 * The departure and arrival procedures of a route, without the cruise. The
 * departure runway follows the weather at departure time, the arrival runway
 * the weather at arrival time. Used for your flights and for other airlines'.
 */
export function buildTerminalPaths(
  origin: Airport,
  destination: Airport,
  depDay: number,
  depMin: number,
  arrDay: number,
  arrMin: number
): TerminalPaths {
  const directDistNm = calcDistanceNm(origin, destination);
  // Times may run past midnight; weather (and so the runway) is looked up on the right day
  const dT = normalizeSimTime(depDay, depMin);
  const aT = normalizeSimTime(arrDay, arrMin);
  const depRwy = getActiveRunwayForAirport(origin, dT.day, dT.min, 'departure');
  const arrRwy = getActiveRunwayForAirport(destination, aT.day, aT.min);
  const oLL: LonLat = [origin.longitude_deg, origin.latitude_deg];
  const dLL: LonLat = [destination.longitude_deg, destination.latitude_deg];
  const courseOut = calcBearingDeg(oLL, dLL);
  const courseIn = calcBearingDeg(dLL, oLL); // from the destination back towards the origin
  const { scale, exitNm, entryNm } = terminalDistances(directDistNm);
  const exit = offsetLatLonNm(origin.latitude_deg, origin.longitude_deg, courseOut, exitNm);
  const entry = offsetLatLonNm(destination.latitude_deg, destination.longitude_deg, courseIn, entryNm);
  // A point a little further along the route on each side shapes the turn onto / off the airway
  const k = Math.min(0.25, 40 / Math.max(1, directDistNm - exitNm - entryNm));
  const beyond = interpolateCoordPair(exit, entry, k);
  const before = interpolateCoordPair(exit, entry, 1 - k);
  const dep = departureLegs(origin, depRwy, exit, beyond, scale);
  const arr = arrivalLegs(destination, arrRwy, entry, before, scale);

  const sidNav = navaidNear(exit, 12);
  const starNav = navaidNear(entry, 12);
  const sidName = `${(sidNav?.ident ?? origin.iata_code).toUpperCase()}${procDigit(origin.iata_code, destination.iata_code)}`;
  const starName = `${(starNav?.ident ?? destination.iata_code).toUpperCase()}${procDigit(destination.iata_code, origin.iata_code)}`;
  return {
    dep: dep.pts,
    arr: arr.pts,
    exit,
    entry,
    exitNm,
    entryNm,
    directDistNm,
    liftoffIdx: dep.liftoffIdx,
    finalPoint: arr.finalPoint,
    depRwy,
    arrRwy,
    sidName,
    starName,
  };
}

function computeProcedureGeometry(
  origin: Airport,
  destination: Airport,
  simDay: number,
  simMin: number,
  arrDay: number,
  arrMin: number
): FlightProcedureWaypoints {
  const tp = buildTerminalPaths(origin, destination, simDay, simMin, arrDay, arrMin);
  const { exit, entry, directDistNm, depRwy, arrRwy } = tp;
  const cruise: LonLat[] = [];
  const CRUISE_SEGMENTS = Math.max(2, Math.min(32, Math.round(directDistNm / 60)));
  for (let i = 1; i < CRUISE_SEGMENTS; i++) cruise.push(interpolateCoordPair(exit, entry, i / CRUISE_SEGMENTS));
  const dep = { pts: tp.dep, liftoffIdx: tp.liftoffIdx };
  const arr = { pts: tp.arr, finalPoint: tp.finalPoint };

  const points: LonLat[] = [...dep.pts, ...cruise, ...arr.pts].map((p) => [p[0], p[1]]);
  // Unwrap antimeridian jumps so the line (and plane) stays continuous
  for (let i = 1; i < points.length; i++) {
    let lon = points[i][0];
    const prevLon = points[i - 1][0];
    while (lon - prevLon > 180) lon -= 360;
    while (lon - prevLon < -180) lon += 360;
    points[i][0] = lon;
  }

  const cumulativeNm = [0];
  for (let i = 1; i < points.length; i++) {
    cumulativeNm.push(cumulativeNm[i - 1] + Math.max(0.01, calcCoordDistanceNm(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1])));
  }
  const total = cumulativeNm[cumulativeNm.length - 1];
  const sidEndNm = cumulativeNm[dep.pts.length - 1];
  const starStartNm = cumulativeNm[dep.pts.length + cruise.length];
  const liftoffNm = cumulativeNm[dep.liftoffIdx];
  const touchdownNm = total - landingRollNm(arrRwy);
  // Start of final: the arc into the final approach course ends at FI
  let finalStartNm = touchdownNm - 6;
  const fiLL = arr.finalPoint;
  let bestD = Infinity;
  for (let i = dep.pts.length + cruise.length; i < points.length; i++) {
    const d = calcCoordDistanceNm(points[i][0], points[i][1], fiLL[0], fiLL[1]);
    if (d < bestD) {
      bestD = d;
      finalStartNm = cumulativeNm[i];
    }
  }

  // Time share per segment from a simple speed profile (slow near the ground)
  const prof = { liftoff: liftoffNm, sidEnd: sidEndNm, starStart: starStartNm, touchdown: touchdownNm, total };
  const t = [0];
  for (let i = 1; i < points.length; i++) {
    const mid = (cumulativeNm[i] + cumulativeNm[i - 1]) / 2;
    t.push(t[i - 1] + (cumulativeNm[i] - cumulativeNm[i - 1]) / speedAt(mid, prof));
  }
  const cumulativeT = t.map((x) => x / t[t.length - 1]);

  const { sidName, starName } = tp;
  const nav = arrRwy.associatedNavaid;
  const navaidSummary = nav ? `${nav.ident} ${nav.type} (${formatNavaidFreq(nav.frequency_khz, nav.type)})` : `${starName} RNAV`;

  return {
    points,
    cumulativeNm,
    cumulativeT,
    totalTrackNm: Math.max(1, total),
    sidEndNm,
    starStartNm,
    finalStartNm,
    liftoffNm,
    touchdownNm,
    depRwy,
    arrRwy,
    sidCode: `${sidName} departure`,
    starCode: `${starName} arrival`,
    navaidSummary,
  };
}

/**
 * The geometry a specific departure uses. Keyed to the departure time so the
 * path (and runway choice) stays fixed for the whole flight instead of
 * jumping when the weather block changes mid-flight.
 */
export function getFlightGeometryForDeparture(flight: ScheduledFlight, depSimDay: number) {
  return buildFlightProcedureGeometry(flight.origin, flight.destination, depSimDay, flight.depTimeMin, depSimDay, flight.depTimeMin + flight.blockTimeMin);
}

/**
 * Position after `progress` (0..1) of the block time, plus the segment it is
 * on. Time is spread along the path by the speed profile, so aircraft move
 * slowly on the runway and approach and fast in cruise.
 */
export function pointAlongPath(proc: FlightProcedureWaypoints, progress: number): { segIdx: number; coordinates: LonLat; alongNm: number } {
  const target = Math.max(0, Math.min(1, progress));
  const T = proc.cumulativeT;
  let lo = 0;
  let hi = T.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (T[m] <= target) lo = m;
    else hi = m;
  }
  const segIdx = Math.min(lo, proc.points.length - 2);
  const t0 = T[segIdx];
  const t1 = T[segIdx + 1] ?? 1;
  const localT = t1 > t0 ? Math.max(0, Math.min(1, (target - t0) / (t1 - t0))) : 0;
  const pA = proc.points[segIdx];
  const pB = proc.points[segIdx + 1] ?? pA;
  const alongNm = proc.cumulativeNm[segIdx] + ((proc.cumulativeNm[segIdx + 1] ?? proc.cumulativeNm[segIdx]) - proc.cumulativeNm[segIdx]) * localT;
  return { segIdx, coordinates: [pA[0] + (pB[0] - pA[0]) * localT, pA[1] + (pB[1] - pA[1]) * localT], alongNm };
}

/**
 * Each flight cruises a little to one side of the airway (up to 4 nm, fading
 * out towards both ends), so two of your aircraft on the same route at the
 * same time don't sit on top of each other. Positive = right of track.
 */
export function cruiseOffsetNm(flightId: string, proc: FlightProcedureWaypoints, alongNm: number): number {
  const cruiseLen = proc.starStartNm - proc.sidEndNm;
  if (cruiseLen <= 20 || alongNm <= proc.sidEndNm || alongNm >= proc.starStartNm) return 0;
  let h = 0;
  for (let i = 0; i < flightId.length; i++) h = (Math.imul(h, 31) + flightId.charCodeAt(i)) | 0;
  const side = ((((h >>> 0) % 1000) / 999) * 2 - 1) * Math.min(4, cruiseLen / 60);
  return side * Math.sin((Math.PI * (alongNm - proc.sidEndNm)) / cruiseLen);
}

/** Splits a flight's path at the aircraft: the part already flown and the part still ahead. */
export function splitFlightPath(flight: ScheduledFlight, depSimDay: number, progress: number): { flown: LonLat[]; remaining: LonLat[] } {
  const proc = getFlightGeometryForDeparture(flight, depSimDay);
  const { segIdx, coordinates, alongNm } = pointAlongPath(proc, progress);
  // The same sideways cruise offset as the aircraft, so the trail runs through it
  const shifted = proc.points.map((p, i): LonLat => {
    const off = cruiseOffsetNm(flight.id, proc, proc.cumulativeNm[i]);
    if (Math.abs(off) <= 0.05) return p;
    const q = proc.points[Math.min(i + 1, proc.points.length - 1)];
    const r = proc.points[Math.max(i - 1, 0)];
    return offsetLatLonNm(p[1], p[0], calcBearingDeg(r, q) + 90, off);
  });
  const offHere = cruiseOffsetNm(flight.id, proc, alongNm);
  const pA = proc.points[segIdx];
  const pB = proc.points[segIdx + 1] ?? pA;
  const here = Math.abs(offHere) > 0.05 ? offsetLatLonNm(coordinates[1], coordinates[0], calcBearingDeg(pA, pB) + 90, offHere) : coordinates;
  return {
    flown: [...shifted.slice(0, segIdx + 1), here],
    remaining: [here, ...shifted.slice(segIdx + 1)],
  };
}

// ----------------------------------------------------------------------------
// Live position & telemetry
// ----------------------------------------------------------------------------
export interface LiveFlightPosition {
  coordinates: LonLat;
  bearing: number;
  progress: number;
  remainingMin: number;
  phaseLabel: string;
  altitudeFt: number;
  altitudeText: string;
  groundSpeedKts: number;
  depRunway: string;
  arrRunway: string;
  sidCode: string;
  starCode: string;
  approachType: string;
  navaidSummary: string;
  /** Sim day the flight departed (yesterday for overnight legs). */
  depSimDay: number;
  /** Taxiing out to the runway or in to the gate (position is then the runway end). */
  ground?: 'out' | 'in';
}

/** Returns the sim day the flight is currently airborne from, or null if on the ground. */
export function getAirborneDepartureDay(flight: ScheduledFlight, simMin: number, simDay: number): number | null {
  const days = daysOrAll(flight.daysOfWeek);
  const todayIdx = dayIndexOf(simDay);
  const yesterdayIdx = dayIndexOf(simDay - 1);
  const dep = flight.depTimeMin;
  const end = dep + flight.blockTimeMin;

  if (days[todayIdx] && simMin >= dep && simMin <= end) return simDay;
  if (days[yesterdayIdx] && end > MIN_PER_DAY && simMin <= end - MIN_PER_DAY) return simDay - 1;
  return null;
}

const altText = (ft: number, arrow: string) =>
  ft >= 18000 ? `FL${Math.round(ft / 100)}${arrow ? ` ${arrow}` : ''}` : `${Math.round(ft / 100) * 100} ft${arrow ? ` ${arrow}` : ''}`;

export function getLiveFlightPosition(
  flight: ScheduledFlight,
  simMin: number,
  simDay: number,
  cruiseSpeedKts = 450
): LiveFlightPosition | null {
  const depSimDay = getAirborneDepartureDay(flight, simMin, simDay);
  if (depSimDay === null) return null;

  const elapsed = simMin + (simDay - depSimDay) * MIN_PER_DAY - flight.depTimeMin;
  const dur = Math.max(1, flight.blockTimeMin);
  const remainingMin = Math.max(0, Math.round(dur - elapsed));
  // Taxi out and in at both ends of the block; the flight itself fills the rest
  const taxi = playerTaxiMin(dur);
  const airMin = Math.max(1, dur - taxi.out - taxi.in);
  const progress = Math.max(0, Math.min(1, (elapsed - taxi.out) / airMin));

  const proc = getFlightGeometryForDeparture(flight, depSimDay);
  if (elapsed < taxi.out || elapsed > dur - taxi.in) {
    // On the ground. The live map moves the aircraft along the real taxiways
    // when it has them for this airport; otherwise it waits at the runway end.
    const out = elapsed < taxi.out;
    const rwy = out ? proc.depRwy : proc.arrRwy;
    return {
      coordinates: out ? proc.points[0] : proc.points[proc.points.length - 1],
      bearing: Math.round(rwy.headingDegT),
      progress: out ? 0 : 1,
      remainingMin,
      phaseLabel: out ? `Taxiing to runway ${rwy.ident}` : 'Taxiing to the gate',
      altitudeFt: out ? flight.origin.elevation_ft || 0 : flight.destination.elevation_ft || 0,
      altitudeText: 'Ground',
      groundSpeedKts: 15,
      depRunway: proc.depRwy.ident,
      arrRunway: proc.arrRwy.ident,
      sidCode: proc.sidCode,
      starCode: proc.starCode,
      approachType: proc.arrRwy.approachType,
      navaidSummary: proc.navaidSummary,
      depSimDay,
      ground: out ? 'out' : 'in',
    };
  }
  const { segIdx, coordinates: onTrackPos, alongNm } = pointAlongPath(proc, progress);
  const pA = proc.points[segIdx];
  const pB = proc.points[segIdx + 1] ?? pA;
  const off = cruiseOffsetNm(flight.id, proc, alongNm);
  const coordinates = Math.abs(off) > 0.05 ? offsetLatLonNm(onTrackPos[1], onTrackPos[0], calcBearingDeg(pA, pB) + 90, off) : onTrackPos;

  const bearing =
    pA[0] !== pB[0] || pA[1] !== pB[1]
      ? calcBearingDeg(pA, pB)
      : calcBearingDeg(
          [flight.origin.longitude_deg, flight.origin.latitude_deg],
          [flight.destination.longitude_deg, flight.destination.latitude_deg]
        );

  // Altitude by distance: ~3 nm per 1,000 ft climbing, ~3.2 nm per 1,000 ft descending
  const cruiseAlt =
    flight.distanceNm < 180 ? 18000 : flight.distanceNm < 450 ? 28000 : flight.distanceNm < 1200 ? 35000 : 38000;
  const originElev = flight.origin.elevation_ft || 50;
  const destElev = flight.destination.elevation_ft || 20;
  const airborneNm = Math.max(1, proc.touchdownNm - proc.liftoffNm);
  let climbNm = (cruiseAlt / 1000) * 3;
  let descentNm = (cruiseAlt / 1000) * 3.2;
  if (climbNm + descentNm > airborneNm * 0.95) {
    const k = (airborneNm * 0.95) / (climbNm + descentNm);
    climbNm *= k;
    descentNm *= k;
  }
  const sinceLiftoff = alongNm - proc.liftoffNm;
  const toTouchdown = proc.touchdownNm - alongNm;
  const peak = Math.min(cruiseAlt, Math.max(3000, Math.min(sinceLiftoff + toTouchdown, climbNm + descentNm) * 300));

  let altitudeFt: number;
  let arrow = '';
  if (sinceLiftoff <= 0 || toTouchdown <= 0) {
    altitudeFt = sinceLiftoff <= 0 ? originElev : destElev;
  } else if (sinceLiftoff < climbNm && sinceLiftoff / climbNm < toTouchdown / descentNm) {
    altitudeFt = originElev + (sinceLiftoff / climbNm) * (peak - originElev);
    arrow = '↑';
  } else if (toTouchdown < descentNm) {
    // Even descent, then the 3° glide path on final (~318 ft per nm)
    const linear = destElev + (toTouchdown / descentNm) * (peak - destElev);
    altitudeFt = alongNm >= proc.finalStartNm ? Math.min(linear, destElev + toTouchdown * 318) : linear;
    arrow = '↓';
  } else {
    altitudeFt = peak;
  }
  altitudeFt = Math.round(altitudeFt);
  const onGround = sinceLiftoff <= 0 || toTouchdown <= 0;

  // Groundspeed: rough profile matching the timing
  let groundSpeedKts = cruiseSpeedKts;
  if (onGround) groundSpeedKts = sinceLiftoff <= 0 ? Math.round(40 + Math.max(0, alongNm / Math.max(0.1, proc.liftoffNm)) * 110) : 60;
  else if (alongNm < proc.sidEndNm) groundSpeedKts = Math.round(170 + (sinceLiftoff / Math.max(1, proc.sidEndNm - proc.liftoffNm)) * 80);
  else if (arrow === '↑') groundSpeedKts = Math.round(250 + (altitudeFt / Math.max(1, peak)) * (cruiseSpeedKts - 250));
  else if (alongNm >= proc.finalStartNm) groundSpeedKts = 140;
  else if (alongNm >= proc.starStartNm) groundSpeedKts = Math.round(170 + Math.min(1, (proc.finalStartNm - alongNm) / Math.max(1, proc.finalStartNm - proc.starStartNm)) * 80);
  else if (arrow === '↓') groundSpeedKts = Math.round(250 + (altitudeFt / Math.max(1, peak)) * (cruiseSpeedKts - 250));

  let phaseLabel = 'Cruising';
  if (sinceLiftoff <= 0) phaseLabel = `Taking off from runway ${proc.depRwy.ident}`;
  else if (toTouchdown <= 0) phaseLabel = `Landed on runway ${proc.arrRwy.ident}`;
  else if (alongNm < proc.sidEndNm) phaseLabel = `Departing runway ${proc.depRwy.ident} on the ${proc.sidCode}`;
  else if (alongNm >= proc.finalStartNm) phaseLabel = `Final approach, ${proc.arrRwy.approachType}`;
  else if (alongNm >= proc.starStartNm) phaseLabel = `On the ${proc.starCode}, vectored for runway ${proc.arrRwy.ident}`;
  else if (arrow === '↑') phaseLabel = `Climbing to ${altText(peak, '')}`;
  else if (arrow === '↓') phaseLabel = `Descending towards ${flight.destination.iata_code}`;

  const altitudeText = onGround ? 'Ground' : altitudeFt < 18000 ? `${Math.round(altitudeFt / 100) * 100} ft${arrow ? ` ${arrow}` : ''}` : altText(altitudeFt, arrow);

  return {
    coordinates,
    bearing: Math.round(bearing),
    progress,
    remainingMin,
    phaseLabel,
    altitudeFt,
    altitudeText,
    groundSpeedKts,
    depRunway: proc.depRwy.ident,
    arrRunway: proc.arrRwy.ident,
    sidCode: proc.sidCode,
    starCode: proc.starCode,
    approachType: proc.arrRwy.approachType,
    navaidSummary: proc.navaidSummary,
    depSimDay,
  };
}
