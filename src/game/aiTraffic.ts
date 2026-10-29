// ============================================================================
// COSMETIC AI TRAFFIC
//   Built at startup from the real airline network (public/data/network.json):
//   every airline's real routes today. The route data has no times or
//   frequencies, so a believable weekly schedule is made from each route's
//   demand (demand.ts), shared between the airlines flying it, with an
//   aircraft from the airline's own fleet (aiAirlines.ts) and local-time
//   departure banks. Everything is seeded, so the same flights appear every
//   week. AI traffic never affects your economy.
//
//   The older OpenFlights files (/public/data/openflights/, routes from about
//   2014) still work as a fallback when network.json is missing.
// ============================================================================
import { AI_ARR_ROLL_MIN, AI_DEP_ROLL_MIN, bookInterval, earliestFit, runwayOccupancy, type RunwayInterval } from './runwayUse';
import { aiCruiseAltitudeFt } from './altitude';
import { AI_AIRLINES, KNOWN_CALLSIGNS, airlineNameCore, type AiAirlineDef, type AiRegion } from './aiAirlines';
import { AI_TYPES, GENERIC_FLEETS } from './aiFleets';
import { splitCsvLine } from './csv';
import { marketDemand, type NetworkData } from './demand';
import { calcBearingDeg, type LonLat } from './geo';
import { MIN_PER_DAY, dayIndexOf } from './time';
import type { RadarIconGroup } from './types';

export interface AiAirport {
  iata: string;
  name: string;
  city: string;
  country: string;
  lat: number;
  lon: number;
  elevFt: number;
  tz: string;
  tzHours: number;
  /** Unit vector, precomputed for fast great-circle interpolation. */
  v: [number, number, number];
}

export interface AiFlight {
  id: number;
  airline: number; // index into AiTraffic.airlines
  flightNumber: string;
  o: number; // index into AiTraffic.airports
  d: number;
  depUtcMin: number;
  blockMin: number;
  /** Bit i set = operates on weekday i (0 = Monday), in UTC departure days. */
  daysMask: number;
  typeCode: string;
  group: RadarIconGroup;
  cruiseKts: number;
  distanceNm: number;
  /** Taxi minutes at each end, fixed at generation so runway sequencing holds. */
  taxiMin?: number;
  /** Which of the runways in use it takes off from / lands on, at busy airports (0 = the first). */
  depLane?: number;
  arrLane?: number;
}

export interface AiTraffic {
  airlines: AiAirlineDef[];
  airports: AiAirport[];
  flights: AiFlight[];
  typeNames: Map<string, string>;
  stats: { routes: number; flightsPerWeek: number; avgPerDay: number; skippedRoutes: number; buildMs: number };
}

// ---------------------------------------------------------------------------
// Aircraft types: OpenFlights IATA type code → silhouette group + name fallback
// ---------------------------------------------------------------------------
const TYPE_NAMES: Record<string, string> = {
  '32A': 'Airbus A320 (sharklets)', '32B': 'Airbus A321 (sharklets)', '32S': 'Airbus A318/319/320/321', '73H': 'Boeing 737-800 (winglets)',
  '73W': 'Boeing 737-700 (winglets)', '73J': 'Boeing 737-900 (winglets)', '73Q': 'Boeing 737-400 Combi', '73C': 'Boeing 737-300 (winglets)',
  '74E': 'Boeing 747-400 Combi', '74H': 'Boeing 747-8I', '74N': 'Boeing 747-8F', '74Y': 'Boeing 747-400F', '76W': 'Boeing 767-300 (winglets)',
  '76F': 'Boeing 767 Freighter', '77X': 'Boeing 777 Freighter', '33X': 'Airbus A330-200F', 'CRJ': 'Bombardier CRJ', 'ERJ': 'Embraer ERJ',
  'EMJ': 'Embraer E-Jet', 'DH8': 'De Havilland Dash 8', 'M80': 'McDonnell Douglas MD-80', 'M1F': 'McDonnell Douglas MD-11F',
  'BE1': 'Beechcraft 1900', 'L4T': 'Let L-410', '388': 'Airbus A380-800', '380': 'Airbus A380',
  ...Object.fromEntries(Object.entries(AI_TYPES).map(([k, v]) => [k, v.name])),
};

// OpenFlights equipment codes (IATA aircraft codes) → silhouette family
const COMMUTER = /^(BE1|BEH|BE9|DHT|DH6|L4T|SWM|J31|J32|CNA|CNC|D28|DHP|S20|BNI|PN6|TWN)$/;
const PROP = /^(AT\d|ATR|DH\d|DH8|F50|F27|SF3|SH\d|J41|AN4|AN6|ANF|MA6|EM2|EMB|D38)$/;
const RJ_TAIL = /^(CR\w|CRJ|ER\d|ERD|ERJ|E35|E45|EP\w|F70|F100|100|J5\w|ARJ|AJ2)$/;
const SMALL_JET = /^(E\d\d|E7W|E75|E90|E95|EMJ|SU9|SU1|221|223|290|295|E2\w|CS1|CS3|BCS|146|14\w|AR\d|RJ\w)$/;
const REAR_JET = /^(M8\d|M9\d|M80|M90|717|D9\w|DC9|TU5|T54|YK2|YK4)$/;
const LONG_NARROW = /^(75\w|757|T20|T24|TU2)$/;
const TRIJET = /^(M11|M1F|M1M|D10|D1\w|L10|L11|L15|TU5X)$/;

export function groupForType(code: string): { group: RadarIconGroup; cruiseKts: number } {
  const c = code.toUpperCase();
  if (/^(38\d|380|A38)$/.test(c)) return { group: 'a380', cruiseKts: 490 };
  if (/^74/.test(c)) return { group: 'b747', cruiseKts: 490 };
  if (/^(IL7|IL76|A4F|A40|A12|AN2|A22)$/.test(c)) return { group: 'high_quad', cruiseKts: 430 };
  if (/^(34\w|IL9|I93|IL96)$/.test(c)) return { group: 'a340', cruiseKts: 475 };
  if (TRIJET.test(c)) return { group: 'trijet', cruiseKts: 480 };
  if (/^77\w$/.test(c)) return { group: 'heavy_twin', cruiseKts: 490 };
  if (/^(33\w|35\w|359|351|78\w|76\w|AB\d|31[0-3]|30\d)$/.test(c)) return { group: 'large_jet', cruiseKts: 480 };
  if (COMMUTER.test(c)) return { group: 'commuter', cruiseKts: 220 };
  if (PROP.test(c)) return { group: 'prop', cruiseKts: 280 };
  if (RJ_TAIL.test(c)) return { group: 'rj_tail', cruiseKts: 430 };
  if (SMALL_JET.test(c)) return { group: 'small_jet', cruiseKts: 440 };
  if (REAR_JET.test(c)) return { group: 'rear_jet', cruiseKts: 440 };
  if (LONG_NARROW.test(c)) return { group: 'long_narrow', cruiseKts: 460 };
  return { group: 'medium_jet', cruiseKts: 450 };
}

/** Rough bigness used to pick the main aircraft when a route lists several. */
const GROUP_RANK: Record<RadarIconGroup, number> = {
  commuter: 0, prop: 1, rj_tail: 2, small_jet: 3, rear_jet: 4, medium_jet: 5, long_narrow: 6,
  large_jet: 7, trijet: 8, heavy_twin: 9, a340: 10, high_quad: 11, b747: 12, a380: 13,
};

// ---------------------------------------------------------------------------
// Seeded helpers
// ---------------------------------------------------------------------------
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const tzCache = new Map<string, number | null>();
/** Current UTC offset (minutes) of an IANA zone, DST included. Null if unknown. */
export function tzOffsetMinutes(tz: string, atMs: number): number | null {
  const key = `${tz}|${Math.floor(atMs / 86_400_000)}`;
  if (tzCache.has(key)) return tzCache.get(key)!;
  let result: number | null = null;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
    }).formatToParts(new Date(atMs));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
    result = Math.round((asUtc - Math.floor(atMs / 60_000) * 60_000) / 60_000);
  } catch {
    result = null;
  }
  tzCache.set(key, result);
  return result;
}

const rotateMask = (mask: number, by: number) => {
  const k = ((by % 7) + 7) % 7;
  return ((mask << k) | (mask >>> (7 - k))) & 0x7f;
};

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------
const nullish = (v: string | undefined) => !v || v === '\\N';

export function parseOpenFlightsAirports(text: string): Map<string, Omit<AiAirport, 'v'>> {
  const out = new Map<string, Omit<AiAirport, 'v'>>();
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    const c = splitCsvLine(line);
    const iata = c[4];
    const lat = Number(c[6]);
    const lon = Number(c[7]);
    if (nullish(iata) || iata.length !== 3 || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    out.set(iata, {
      iata,
      name: c[1],
      city: c[2],
      country: c[3],
      lat,
      lon,
      elevFt: Number(c[8]) || 0,
      tz: nullish(c[11]) ? '' : c[11],
      tzHours: Number(c[9]) || 0,
    });
  }
  return out;
}

export function parseOpenFlightsPlanes(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    const c = splitCsvLine(line);
    if (!nullish(c[1])) out.set(c[1], c[0]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Schedule generation
// ---------------------------------------------------------------------------
const EARTH_NM = 3440.065;
const toVec = (lat: number, lon: number): [number, number, number] => {
  const la = (lat * Math.PI) / 180;
  const lo = (lon * Math.PI) / 180;
  return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
};
const angleBetween = (a: [number, number, number], b: [number, number, number]) =>
  Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));

/** Departures per week for one airline on one route. */
export function weeklyFrequency(degO: number, degD: number, distanceNm: number): number {
  const score = Math.sqrt(degO * degD);
  const distFactor = distanceNm < 300 ? 1.1 : distanceNm < 1200 ? 1 : distanceNm < 2500 ? 0.7 : distanceNm < 4500 ? 0.45 : 0.35;
  const cap = distanceNm < 1200 ? 12 : distanceNm < 2500 ? 6 : distanceNm < 4500 ? 3 : 2;
  const perDay = Math.min(cap, (score / 70) * distFactor);
  return Math.max(2, Math.min(cap * 7, Math.round(perDay * 7)));
}

// Relative departures per local hour (index = hour). Short/medium-haul flying
// peaks 06:00–20:00 but never stops completely; long-haul leans to the evening
// and red-eye slots. Keeps every region populated around the clock.
const HOURLY_SHORT = [0.35, 0.22, 0.16, 0.16, 0.24, 0.55, 1, 1.1, 1.1, 1, 1, 1, 1, 1, 1, 1, 1, 1.1, 1.1, 1, 0.9, 0.75, 0.55, 0.38];
const HOURLY_LONG = [0.75, 0.65, 0.45, 0.35, 0.3, 0.35, 0.4, 0.5, 0.65, 0.8, 0.9, 0.9, 0.8, 0.7, 0.7, 0.7, 0.8, 0.9, 1, 1, 1, 1, 1, 0.9];
const cdfOf = (w: number[]) => {
  const total = w.reduce((a, b) => a + b, 0);
  let acc = 0;
  return w.map((x) => (acc += x / total));
};
const CDF_SHORT = cdfOf(HOURLY_SHORT);
const CDF_LONG = cdfOf(HOURLY_LONG);

/** Local minute-of-day at quantile q (0..1) of an hourly profile. */
function quantileMinute(cdf: number[], q: number): number {
  let h = 0;
  while (h < 23 && cdf[h] < q) h++;
  const lo = h === 0 ? 0 : cdf[h - 1];
  const frac = (q - lo) / Math.max(1e-9, cdf[h] - lo);
  return h * 60 + Math.max(0, Math.min(59.9, frac * 60));
}

/** Local departure minutes for `n` flights a day, spread along the hourly profile. */
function localDepartures(n: number, distanceNm: number, rand: () => number): number[] {
  const snap = (m: number) => (Math.round(m / 5) * 5) % MIN_PER_DAY;
  const cdf = distanceNm > 2500 ? CDF_LONG : CDF_SHORT;
  const phase = rand();
  return Array.from({ length: n }, (_, k) => {
    const q = (k + phase * 0.6 + 0.2 + (rand() - 0.5) * 0.3) / n;
    return snap(quantileMinute(cdf, Math.min(0.9999, Math.max(0, q))));
  });
}

// ---------------------------------------------------------------------------
// Regional balance
//   The OpenFlights route list is lopsided (huge Chinese and European
//   networks, thin Africa/Oceania/South America). Weekly frequencies are scaled
//   per region so the sky looks evenly busy the way a radar site does.
// ---------------------------------------------------------------------------
export type AiZone = 'NAm' | 'SAm' | 'Eur' | 'ME' | 'Afr' | 'China' | 'Asia' | 'Oce';
export const AI_ZONE_SHARE: Record<AiZone, number> = { NAm: 0.25, Eur: 0.22, China: 0.11, Asia: 0.14, SAm: 0.08, ME: 0.06, Afr: 0.07, Oce: 0.07 };

export function aiZoneOf(lat: number, lon: number, country: string): AiZone {
  if (country === 'China') return 'China';
  if (lon < -30) return lat > 13 ? 'NAm' : 'SAm';
  if (lon < 60) {
    if (lat > 36 || (lat > 34 && lon < 30)) return 'Eur';
    return lat > 12 && lon > 34 ? 'ME' : 'Afr';
  }
  if (lat < -10 || lon > 155) return 'Oce';
  return 'Asia';
}

export interface GenerateAiOptions {
  airportsText: string;
  routesText: string;
  planesText?: string;
  airlines?: AiAirlineDef[];
  /** Used for time-zone offsets (DST) — defaults to now. */
  nowMs?: number;
  /** More (or fewer) flights on every route: 1 = the normal schedule. */
  frequencyScale?: number;
}

export function generateAiTraffic(opts: GenerateAiOptions): AiTraffic {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const airlines = opts.airlines ?? AI_AIRLINES;
  const nowMs = opts.nowMs ?? Date.now();
  const scale = Math.max(0.1, opts.frequencyScale ?? 1);
  const apInfo = parseOpenFlightsAirports(opts.airportsText);
  const planeNames = opts.planesText ? parseOpenFlightsPlanes(opts.planesText) : new Map<string, string>();
  const typeNames = new Map<string, string>([...Object.entries(TYPE_NAMES), ...planeNames]);

  const airlineIdx = new Map<string, number>();
  airlines.forEach((a, i) => {
    airlineIdx.set(a.code, i);
    a.mergeFrom?.forEach((m) => airlineIdx.set(m, i));
  });

  // Airport size = number of (non-codeshare) routes touching it, across all airlines
  const degree = new Map<string, number>();
  const wanted: { airline: number; o: string; d: string; equipment: string[] }[] = [];
  const seenPair = new Set<string>();
  for (const line of opts.routesText.split(/\r?\n/)) {
    if (!line) continue;
    const c = line.split(',');
    if (c.length < 9 || c[6] === 'Y' || c[7] !== '0') continue;
    const [o, d] = [c[2], c[4]];
    degree.set(o, (degree.get(o) ?? 0) + 1);
    degree.set(d, (degree.get(d) ?? 0) + 1);
    const ai = airlineIdx.get(c[0]);
    if (ai === undefined) continue;
    const key = `${ai}|${o}|${d}`;
    if (seenPair.has(key)) continue; // merged airlines often listed the same route twice
    seenPair.add(key);
    wanted.push({ airline: ai, o, d, equipment: c[8].trim().split(/\s+/).filter(Boolean) });
  }

  const airports: AiAirport[] = [];
  const apIndex = new Map<string, number>();
  const ensureAirport = (iata: string) => {
    let i = apIndex.get(iata);
    if (i !== undefined) return i;
    const info = apInfo.get(iata);
    if (!info) return -1;
    i = airports.length;
    airports.push({ ...info, v: toVec(info.lat, info.lon) });
    apIndex.set(iata, i);
    return i;
  };

  const flights: AiFlight[] = [];
  const usedNumbers = new Set<string>();
  let skippedRoutes = 0;

  // Pass 1: route geometry, aircraft and unbalanced weekly frequency
  type Leg = { r: (typeof wanted)[number]; oi: number; di: number; distanceNm: number; typeCode: string; group: RadarIconGroup; cruiseKts: number; blockMin: number; weekly: number; zone: AiZone; cap: number };
  const legs: Leg[] = [];
  const zoneWeekly = new Map<AiZone, number>();
  for (const r of wanted) {
    const oi = ensureAirport(r.o);
    const di = ensureAirport(r.d);
    if (oi < 0 || di < 0 || oi === di) {
      skippedRoutes++;
      continue;
    }
    const O = airports[oi];
    const D = airports[di];
    const distanceNm = angleBetween(O.v, D.v) * EARTH_NM;
    if (distanceNm < 30) {
      skippedRoutes++;
      continue;
    }

    // Biggest listed type as the main aircraft (or the only one)
    const types = r.equipment.length ? r.equipment : ['320'];
    const typeCode = types.reduce((best, t) => (GROUP_RANK[groupForType(t).group] > GROUP_RANK[groupForType(best).group] ? t : best), types[0]);
    const { group, cruiseKts } = groupForType(typeCode);
    const blockMin = Math.max(30, Math.ceil(((distanceNm / cruiseKts) * 60 + 25) / 5) * 5);

    const weekly = weeklyFrequency(degree.get(r.o) ?? 1, degree.get(r.d) ?? 1, distanceNm);
    const zone = aiZoneOf(O.lat, O.lon, O.country);
    const cap = distanceNm < 1200 ? 12 : distanceNm < 2500 ? 6 : distanceNm < 4500 ? 3 : 2;
    legs.push({ r, oi, di, distanceNm, typeCode, group, cruiseKts, blockMin, weekly, zone, cap });
    zoneWeekly.set(zone, (zoneWeekly.get(zone) ?? 0) + weekly);
  }

  // Pass 2: scale each region towards its share of the same total, then schedule
  const totalWeekly = [...zoneWeekly.values()].reduce((a, b) => a + b, 0);
  const zoneFactor = new Map<AiZone, number>();
  for (const [z, w] of zoneWeekly) zoneFactor.set(z, Math.max(0.3, Math.min(4, (AI_ZONE_SHARE[z] * totalWeekly) / Math.max(1, w))));

  for (const leg of legs) {
    const { r, oi, di, distanceNm, typeCode, group, cruiseKts, blockMin } = leg;
    const O = airports[oi];
    const rand = rng(hash32(`${airlines[r.airline].code}${r.o}${r.d}`));
    const factor = zoneFactor.get(leg.zone) ?? 1;
    // Fractional part decided by the route's own seed, so totals stay on target
    const scaled = leg.weekly * factor * scale;
    const weekly = Math.max(1, Math.min(Math.ceil(leg.cap * Math.max(1, factor) * scale) * 7, Math.floor(scaled) + (rand() < scaled % 1 ? 1 : 0)));
    const perDay = weekly >= 7 ? Math.round(weekly / 7) : 1;
    // Fewer than daily: pick that many weekdays, deterministically
    let localMask = 0x7f;
    if (weekly < 7) {
      const order = [0, 1, 2, 3, 4, 5, 6];
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      localMask = order.slice(0, weekly).reduce((m, d) => m | (1 << d), 0);
    }

    const tzOffset = O.tz ? tzOffsetMinutes(O.tz, nowMs) : null;
    const offset = tzOffset ?? Math.round(O.tzHours * 60);
    for (const localDep of localDepartures(perDay, distanceNm, rand)) {
      const utcRaw = localDep - offset;
      const dayShift = Math.floor(utcRaw / MIN_PER_DAY);
      const depUtcMin = ((utcRaw % MIN_PER_DAY) + MIN_PER_DAY) % MIN_PER_DAY;

      // Long-haul gets 1–999, everything else 1000–9999; probe for the next free number
      const code = airlines[r.airline].code;
      const [lo, hi] = distanceNm > 2500 ? [1, 999] : [1000, 9999];
      const span = hi - lo + 1;
      let num = lo + Math.floor(rand() * span);
      let flightNumber = `${code}${num}`;
      for (let tries = 0; usedNumbers.has(flightNumber) && tries < 9999; tries++) {
        num = tries < span ? lo + ((num - lo + 1) % span) : 1 + ((num + 1) % 9999);
        flightNumber = `${code}${num}`;
      }
      usedNumbers.add(flightNumber);

      flights.push({
        id: flights.length,
        airline: r.airline,
        flightNumber,
        o: oi,
        d: di,
        depUtcMin,
        blockMin,
        daysMask: rotateMask(localMask, dayShift),
        typeCode,
        group,
        cruiseKts,
        distanceNm: Math.round(distanceNm),
      });
    }
  }

  sequenceRunways(flights);

  const flightsPerWeek = flights.reduce((s, f) => s + popcount(f.daysMask), 0);
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return {
    airlines,
    airports,
    flights,
    typeNames,
    stats: {
      routes: wanted.length - skippedRoutes,
      flightsPerWeek,
      avgPerDay: Math.round(flightsPerWeek / 7),
      skippedRoutes,
      buildMs: Math.round(t1 - t0),
    },
  };
}

// ---------------------------------------------------------------------------
// Schedule from the real network (network.json)
// ---------------------------------------------------------------------------
export interface GenerateNetworkOptions {
  network: NetworkData;
  /** Airlines with their own name, callsign and fleet (defaults to AI_AIRLINES). */
  airlines?: AiAirlineDef[];
  nowMs?: number;
  /** More (or fewer) flights on every route: 1 = the normal schedule. */
  frequencyScale?: number;
  /**
   * Runways each airport uses at once (navdata.runwayLanes): busy airports
   * spread their flights over them; with a single runway, takeoffs and
   * landings are sequenced together, one at a time.
   */
  runwayLanes?: (iata: string) => RunwayLaneCount;
}

/** Region of an airport, for airlines without their own entry. */
function regionAt(lat: number, lon: number): AiRegion {
  if (lon < -30) return lat > 13 ? 'NA' : 'SA';
  if (lon < 60) {
    if (lat > 36 || (lat > 34 && lon < 30)) return 'EU';
    return lat > 12 && lon > 34 ? 'ME' : 'AF';
  }
  if (lat < -10 || lon > 155) return 'OC';
  return 'AS';
}

/**
 * Radio callsign for an airline without one listed: its real one when known
 * (KNOWN_CALLSIGNS), otherwise its name without "Airlines" and company words,
 * cut at a whole word (v2.57; it used to cut mid-word, "CORSAIR INTERNATIONA").
 */
function callsignFromName(name: string, code = '') {
  if (KNOWN_CALLSIGNS[code]) return KNOWN_CALLSIGNS[code];
  const words = (airlineNameCore(name) || name.toLowerCase())
    .replace(/\b(international|limited|services|service|s a|jsc|llc|pjsc|ojsc|de aviacion|de aviacao)\b/g, ' ')
    .toUpperCase()
    .split(/\s+/)
    .filter(Boolean);
  let out = '';
  for (const w of words) {
    const next = out ? `${out} ${w}` : w;
    if (next.length > 20) break;
    out = next;
  }
  return out || name.toUpperCase().slice(0, 20);
}

/** Most departures an airline puts on one route in a day, by distance. */
const maxPerDay = (nm: number) => (nm < 500 ? 16 : nm < 1500 ? 10 : nm < 3000 ? 5 : 3);
/** Average share of seats filled. */
const LOAD_FACTOR = 0.8;
/**
 * Travellers the schedule is built for, from the route's demand. The demand
 * model is fitted to the world's well-known routes, so on the many thin
 * routes it is generous; for the flights on the map those are thinned out,
 * which keeps the whole world at about the real number of flights a day
 * (~90,000) while the big routes keep their real frequency.
 */
const AI_THIN_ROUTE = 4000;
const AI_THIN_EXP = 1.3;
const AI_PAX_SCALE = 0.95;
/**
 * Countries whose real flight count the demand model misses. Big connecting
 * hubs (America's, the Gulf, Istanbul, Singapore, Addis Ababa) carry far
 * more passengers changing planes than the travel between two cities alone;
 * Chinese routes have many airlines each flying a few times a week. Tuned
 * against each country's real departures.
 */
const COUNTRY_AI_BIAS: Record<string, number> = {
  US: 2.1, CA: 1.3, GB: 1.3, AE: 2, QA: 2.5, SG: 1.4, HK: 1.4, ET: 2, AU: 1.8, BR: 1.8, CO: 1.6, CL: 1.5, AR: 1.5, PE: 1.5, MX: 1.3, JP: 1.3, CN: 0.4,
};
const scheduledPax = (market: number) => AI_PAX_SCALE * market * Math.min(1, Math.pow(market / AI_THIN_ROUTE, AI_THIN_EXP));

/**
 * Departures a day the airline would like on a route carrying `pax` of its
 * travellers a day: more people, more flights (and bigger aircraft), with
 * American airlines and short routes leaning to frequency.
 */
function preferredPerDay(pax: number, nm: number, region: AiRegion) {
  const base = nm < 800 ? 50 : nm < 1500 ? 70 : nm < 2500 ? 110 : nm < 5000 ? 220 : 300;
  const bias = nm > 1500 ? 1 : region === 'NA' ? 1.8 : region === 'EU' && nm < 1000 ? 1.2 : 1;
  return Math.max(0.3, Math.min(maxPerDay(nm), Math.pow(pax / base, 0.55) * bias));
}

export function generateNetworkTraffic(opts: GenerateNetworkOptions): AiTraffic {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const net = opts.network;
  const nowMs = opts.nowMs ?? Date.now();
  const scale = Math.max(0.1, opts.frequencyScale ?? 1);
  const curated = new Map((opts.airlines ?? AI_AIRLINES).map((a) => [a.code, a]));
  const typeNames = new Map<string, string>(Object.entries(TYPE_NAMES));

  const airports: AiAirport[] = [];
  const apIndex = new Map<string, number>();
  const ensureAirport = (iata: string) => {
    let i = apIndex.get(iata);
    if (i !== undefined) return i;
    const a = net.airports.get(iata);
    if (!a) return -1;
    i = airports.length;
    airports.push({
      iata,
      name: a.name,
      city: a.city,
      country: a.cc,
      lat: a.lat,
      lon: a.lon,
      elevFt: a.elevFt,
      tz: a.tz,
      tzHours: Math.round(a.lon / 15),
      v: toVec(a.lat, a.lon),
    });
    apIndex.set(iata, i);
    return i;
  };

  // Each airline's routes, to give unlisted airlines a region and a fleet
  const byCarrier = new Map<number, typeof net.routes>();
  for (const r of net.routes)
    for (const c of r.carriers) {
      const list = byCarrier.get(c);
      if (list) list.push(r);
      else byCarrier.set(c, [r]);
    }

  const airlines: AiAirlineDef[] = [];
  const airlineOf = new Map<number, number>();
  const fleetOf: { code: string; seats: number; rangeNm: number }[][] = [];
  for (const [ci, routes] of byCarrier) {
    const c = net.carriers[ci];
    // Trains and coaches sold with flight numbers (e.g. "9G Rail") aren't aircraft (v2.57)
    if (!c?.code || /\b(rail|bahn|train|bus|coach)\b/i.test(c.name)) continue;
    let def = curated.get(c.code);
    if (!def) {
      // Region where it flies most from; fleet from how far it flies
      const count = new Map<string, number>();
      for (const r of routes) count.set(r.o, (count.get(r.o) ?? 0) + 1);
      const home = net.airports.get([...count].sort((a, b) => b[1] - a[1])[0][0]);
      const km = routes.map((r) => r.km).sort((a, b) => a - b);
      const medianKm = km[Math.floor(km.length / 2)];
      const longest = km[km.length - 1];
      const fleet = medianKm < 450 && longest < 1500 ? GENERIC_FLEETS.regional : longest > 6000 ? GENERIC_FLEETS.network : GENERIC_FLEETS.mainline;
      def = { code: c.code, name: c.name, callsign: callsignFromName(c.name, c.code), region: home ? regionAt(home.lat, home.lon) : 'EU', fleet };
    }
    airlineOf.set(ci, airlines.length);
    airlines.push(def);
    fleetOf.push(
      (def.fleet ?? GENERIC_FLEETS.mainline)
        .split(/\s+/)
        .filter((t) => AI_TYPES[t])
        .map((t) => ({ code: t, ...AI_TYPES[t] }))
        .sort((a, b) => a.seats - b.seats)
    );
  }

  const flights: AiFlight[] = [];
  const usedNumbers = new Set<string>();
  let skippedRoutes = 0;
  let routeCount = 0;

  for (const r of net.routes) {
    if (r.carriers.length === 0) continue;
    const oi = ensureAirport(r.o);
    const di = ensureAirport(r.d);
    if (oi < 0 || di < 0 || oi === di) {
      skippedRoutes++;
      continue;
    }
    const O = airports[oi];
    const D = airports[di];
    const distanceNm = angleBetween(O.v, D.v) * EARTH_NM;
    if (distanceNm < 8) {
      skippedRoutes++;
      continue;
    }
    routeCount++;
    // The route's travellers, shared between the airlines flying it
    const bias = Math.sqrt((COUNTRY_AI_BIAS[O.country] ?? 1) * (COUNTRY_AI_BIAS[D.country] ?? 1));
    const share = Math.max(4, scheduledPax(marketDemand(r.o, r.d, net) ?? 20) * bias) / r.carriers.length;

    for (const ci of r.carriers) {
      const ai = airlineOf.get(ci);
      if (ai === undefined) continue;
      const airline = airlines[ai];
      const rand = rng(hash32(`${airline.code}${r.o}${r.d}`));

      // Aircraft: from those that can fly the distance, the one whose size
      // gives the airline about the number of flights it would like
      const fleet = fleetOf[ai].length ? fleetOf[ai] : [{ code: '320', ...AI_TYPES['320'] }];
      let usable = fleet.filter((t) => t.rangeNm >= distanceNm * 1.05);
      if (!usable.length) usable = [fleet.reduce((a, b) => (b.rangeNm > a.rangeNm ? b : a))];
      // The biggest long-haul aircraft stay on long-haul, except on Asia's packed domestic trunks
      if (distanceNm < 1500 && airline.region !== 'AS' && usable.some((t) => t.seats < 350)) usable = usable.filter((t) => t.seats < 350);
      const wantPerDay = preferredPerDay(share, distanceNm, airline.region);
      const idealSeats = share / (wantPerDay * LOAD_FACTOR);
      const type = usable.reduce((best, t) => (Math.abs(Math.log(t.seats / idealSeats)) < Math.abs(Math.log(best.seats / idealSeats)) ? t : best), usable[0]);

      const perDayRaw = Math.min(maxPerDay(distanceNm), share / (type.seats * LOAD_FACTOR)) * scale;
      const weeklyRaw = perDayRaw * 7;
      const weekly = Math.max(2, Math.min(maxPerDay(distanceNm) * 7 * Math.max(1, scale), Math.floor(weeklyRaw) + (rand() < weeklyRaw % 1 ? 1 : 0)));
      const perDay = weekly >= 7 ? Math.round(weekly / 7) : 1;
      let localMask = 0x7f;
      if (weekly < 7) {
        const order = [0, 1, 2, 3, 4, 5, 6];
        for (let i = order.length - 1; i > 0; i--) {
          const j = Math.floor(rand() * (i + 1));
          [order[i], order[j]] = [order[j], order[i]];
        }
        localMask = order.slice(0, weekly).reduce((m, d) => m | (1 << d), 0);
      }

      const { group, cruiseKts } = groupForType(type.code);
      // The timetable's flight time when the data has it
      const computed = Math.max(30, Math.ceil(((distanceNm / cruiseKts) * 60 + 25) / 5) * 5);
      const blockMin = r.min >= 20 && r.min < computed * 1.6 && r.min > computed * 0.6 ? Math.ceil(r.min / 5) * 5 : computed;

      const tzOffset = O.tz ? tzOffsetMinutes(O.tz, nowMs) : null;
      const offset = tzOffset ?? O.tzHours * 60;
      for (const localDep of localDepartures(perDay, distanceNm, rand)) {
        const utcRaw = localDep - offset;
        const dayShift = Math.floor(utcRaw / MIN_PER_DAY);
        const depUtcMin = ((utcRaw % MIN_PER_DAY) + MIN_PER_DAY) % MIN_PER_DAY;

        // Long-haul 1–999, the rest 1000–9999, each number used once
        const [lo, hi] = distanceNm > 2500 ? [1, 999] : [1000, 9999];
        const span = hi - lo + 1;
        let num = lo + Math.floor(rand() * span);
        let flightNumber = `${airline.code}${num}`;
        for (let tries = 0; tries < 24 && usedNumbers.has(flightNumber); tries++) {
          num = lo + Math.floor(rand() * span);
          flightNumber = `${airline.code}${num}`;
        }
        // Still taken: the next free number after it, then any free number up to 9999
        for (let k = 1; usedNumbers.has(flightNumber) && k < 9999; k++) flightNumber = `${airline.code}${k < span ? lo + ((num - lo + k) % span) : 1 + ((num + k) % 9999)}`;
        usedNumbers.add(flightNumber);

        flights.push({
          id: flights.length,
          airline: ai,
          flightNumber,
          o: oi,
          d: di,
          depUtcMin,
          blockMin,
          daysMask: rotateMask(localMask, dayShift),
          typeCode: type.code,
          group,
          cruiseKts,
          distanceNm: Math.round(distanceNm),
        });
      }
    }
  }

  sequenceRunways(flights, opts.runwayLanes ? (i) => opts.runwayLanes!(airports[i].iata) : undefined);

  const flightsPerWeek = flights.reduce((s, f) => s + popcount(f.daysMask), 0);
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return {
    airlines,
    airports,
    flights,
    typeNames,
    stats: { routes: routeCount, flightsPerWeek, avgPerDay: Math.round(flightsPerWeek / 7), skippedRoutes, buildMs: Math.round(t1 - t0) },
  };
}

// ---------------------------------------------------------------------------
// Runway sequencing
//   Without it, flights scheduled in the same 5-minute slot took off and
//   landed on top of each other. Like a tower, each airport's departures are
//   queued so that only one aircraft is on the runway at a time (line-up to
//   lift-off, see runwayUse.ts) and at least `gap` minutes apart; arrivals the
//   same way on final, with a short delay (vectoring/holding) added to the
//   flight. Where takeoffs and landings share one runway, arrivals are fitted
//   between the departures. The gap shrinks at very busy airports, which in
//   reality have more runways.
// ---------------------------------------------------------------------------
function runwayGap(dailyMovements: number) {
  return Math.max(1, Math.min(2, (1440 * 0.6) / Math.max(1, dailyMovements)));
}

const DEP_OCC = runwayOccupancy('dep', AI_DEP_ROLL_MIN);
/**
 * Longest wait for the runway. The network schedules more flights at a few
 * airports than their runways can take at the busiest hours (Naples, Catania…);
 * a flight that still has no turn after this wait is left out of the schedule.
 */
const MAX_DEP_DELAY_MIN = 30;
const MAX_ARR_DELAY_MIN = 15;
const ARR_OCC = runwayOccupancy('arr', AI_ARR_ROLL_MIN);

export interface RunwayLaneCount {
  dep: number;
  arr: number;
  shared: boolean;
}
const ONE_LANE: RunwayLaneCount = { dep: 1, arr: 1, shared: false };

/** Sequences every airport's runways; flights that can't get a turn are removed (ids are renumbered). */
function sequenceRunways(flights: AiFlight[], lanesOf?: (airportIdx: number) => RunwayLaneCount) {
  for (const f of flights) f.taxiMin = Math.min(12, f.blockMin * 0.15);
  const overflow = new Set<AiFlight>();
  const perDay = (f: AiFlight) => popcount(f.daysMask) / 7;
  const depTime = (f: AiFlight) => (f.depUtcMin + f.taxiMin!) % MIN_PER_DAY;
  const arrTime = (f: AiFlight) => (f.depUtcMin + f.blockMin - f.taxiMin!) % MIN_PER_DAY;
  /**
   * One queue on the 24-hour clock, over `lanes` runways (each flight takes the
   * one free first). It starts at the quietest moment of the day, so delays
   * never spill over midnight into the early movements. `fixed` are runway
   * times already taken (time of day, length), on a single runway.
   */
  const queue = (
    list: AiFlight[],
    timeOf: (f: AiFlight) => number,
    occ: [number, number],
    maxDelay: number,
    lanes: number,
    push: (f: AiFlight, by: number, lane: number) => void,
    fixed: number[] = []
  ) => {
    if (!list.length) return;
    // Sharing the runway with departures, arrivals only need the runway free (no extra gap)
    const gap = fixed.length ? 0 : runwayGap(list.reduce((s, f) => s + perDay(f), 0) / lanes);
    list.sort((a, b) => timeOf(a) - timeOf(b) || a.id - b.id);
    let start = 0;
    let widest = -1;
    for (let i = 0; i < list.length; i++) {
      const prev = timeOf(list[(i + list.length - 1) % list.length]);
      const space = list.length < 2 ? MIN_PER_DAY : (timeOf(list[i]) - prev + MIN_PER_DAY) % MIN_PER_DAY;
      if (space > widest) {
        widest = space;
        start = i;
      }
    }
    const t0 = timeOf(list[start]);
    // Runway time already taken, on the queue's clock (and a day either side, for the wrap)
    const booked: RunwayInterval[][] = Array.from({ length: lanes }, () => []);
    for (let i = 0; i < fixed.length; i += 2) {
      const u = (fixed[i] - t0 + MIN_PER_DAY) % MIN_PER_DAY;
      for (const w of [-MIN_PER_DAY, 0, MIN_PER_DAY]) booked[0].push({ from: u + w, to: u + w + fixed[i + 1] });
    }
    booked[0].sort((a, b) => a.from - b.from);
    const last = new Array<number>(lanes).fill(-Infinity);
    for (let k = 0; k < list.length; k++) {
      const f = list[(start + k) % list.length];
      const u0 = (timeOf(f) - t0 + MIN_PER_DAY) % MIN_PER_DAY;
      // The runway that is free first (the first one when equal)
      let lane = 0;
      let u = Infinity;
      for (let l = 0; l < lanes; l++) {
        const ul = Math.max(u0, last[l] + gap);
        const fit = earliestFit(booked[l], ul, occ[0], occ[1], u0 + maxDelay - ul);
        if (Number.isFinite(fit) && ul + fit < u - 1e-9) {
          u = ul + fit;
          lane = l;
        }
      }
      // Busier than the runways can take: the flight doesn't operate
      if (!Number.isFinite(u)) {
        overflow.add(f);
        continue;
      }
      push(f, u - u0, lane);
      last[lane] = u;
      bookInterval(booked[lane], { from: u + occ[0], to: u + occ[1] });
    }
  };
  const byOrigin = new Map<number, AiFlight[]>();
  const byDest = new Map<number, AiFlight[]>();
  for (const f of flights) {
    (byOrigin.get(f.o) ?? byOrigin.set(f.o, []).get(f.o)!).push(f);
    (byDest.get(f.d) ?? byDest.set(f.d, []).get(f.d)!).push(f);
  }
  // Departures: a later push-back (the flight keeps its length)
  for (const [ap, list] of byOrigin) {
    const lanes = (lanesOf?.(ap) ?? ONE_LANE).dep;
    queue(list, depTime, DEP_OCC, MAX_DEP_DELAY_MIN, lanes, (f, by, lane) => {
      if (lanes > 1) f.depLane = lane;
      if (by <= 0) return;
      const t = f.depUtcMin + by;
      if (t >= MIN_PER_DAY) {
        f.depUtcMin = t - MIN_PER_DAY;
        f.daysMask = rotateMask(f.daysMask, 1);
      } else f.depUtcMin = t;
    });
  }
  // Arrivals: a delay added to the flight (it lands later; nothing else moves).
  // On a shared runway, the departures (now fixed) are taken into account.
  for (const [ap, all] of byDest) {
    const list = all.filter((f) => !overflow.has(f));
    const l = lanesOf?.(ap) ?? ONE_LANE;
    const fixed: number[] = [];
    if (l.shared)
      for (const f of byOrigin.get(ap) ?? []) if (!overflow.has(f)) fixed.push((depTime(f) + DEP_OCC[0] + MIN_PER_DAY) % MIN_PER_DAY, DEP_OCC[1] - DEP_OCC[0]);
    // Time of day, so a flight landing after midnight queues with that morning's arrivals
    queue(list, arrTime, ARR_OCC, MAX_ARR_DELAY_MIN, l.shared ? 1 : l.arr, (f, by, lane) => {
      if (l.arr > 1 && !l.shared) f.arrLane = lane;
      if (by > 0) f.blockMin += by;
    }, fixed);
  }
  if (overflow.size) {
    const kept = flights.filter((f) => !overflow.has(f));
    flights.length = 0;
    kept.forEach((f, i) => {
      f.id = i;
      flights.push(f);
    });
  }
}

const popcount = (m: number) => {
  let c = 0;
  for (let x = m; x; x &= x - 1) c++;
  return c;
};

// ---------------------------------------------------------------------------
// Runtime: who is airborne, and where
// ---------------------------------------------------------------------------
/** Minutes spent taxiing at each end of an AI flight (not drawn on the map). */
export const aiTaxiMin = (f: AiFlight) => f.taxiMin ?? Math.min(12, f.blockMin * 0.15);

/**
 * Sim day the flight departed on, if it is in the air at (day, min); null
 * otherwise. Taxiing aircraft are left out, so airports don't fill up with
 * stacks of parked icons. `day` follows dayIndexOf (Mon = 0).
 */
export function aiDepartureDay(f: AiFlight, day: number, min: number): number | null {
  const taxi = aiTaxiMin(f);
  const start = f.depUtcMin + taxi;
  const end = f.depUtcMin + f.blockMin - taxi;
  if (f.daysMask & (1 << dayIndexOf(day)) && min >= start && min <= end) return day;
  if (end > MIN_PER_DAY && f.daysMask & (1 << dayIndexOf(day - 1)) && min + MIN_PER_DAY >= start && min <= end - MIN_PER_DAY) return day - 1;
  return null;
}

/**
 * Flights in the air at any moment in [min, min + windowMin]. Called every few
 * seconds; per-frame work then only touches this short list. The window must
 * cover the time until the next refresh, or new departures appear late.
 */
export function findAirborneAi(t: AiTraffic, day: number, min: number, windowMin: number): AiFlight[] {
  const out: AiFlight[] = [];
  for (const f of t.flights) {
    // Coarse test: in the air now, at the end of the window, or taking off inside it
    if (aiDepartureDay(f, day, min) !== null || aiDepartureDay(f, day, min + windowMin) !== null) {
      out.push(f);
      continue;
    }
    const start = f.depUtcMin + aiTaxiMin(f);
    const m = min % MIN_PER_DAY;
    if (start >= m && start <= m + windowMin && f.daysMask & (1 << dayIndexOf(day))) out.push(f);
  }
  return out;
}

export interface AiPosition {
  coordinates: LonLat;
  bearing: number;
  progress: number;
  remainingMin: number;
  altitudeFt: number;
  groundSpeedKts: number;
}

function slerpVec(a: [number, number, number], b: [number, number, number], t: number): LonLat {
  const omega = angleBetween(a, b);
  if (omega < 1e-9) return [Math.atan2(a[1], a[0]) * (180 / Math.PI), Math.asin(a[2]) * (180 / Math.PI)];
  const s = Math.sin(omega);
  const f1 = Math.sin((1 - t) * omega) / s;
  const f2 = Math.sin(t * omega) / s;
  const x = f1 * a[0] + f2 * b[0];
  const y = f1 * a[1] + f2 * b[1];
  const z = f1 * a[2] + f2 * b[2];
  return [Math.atan2(y, x) * (180 / Math.PI), Math.atan2(z, Math.sqrt(x * x + y * y)) * (180 / Math.PI)];
}

export function aiFlightPosition(t: AiTraffic, f: AiFlight, day: number, min: number): AiPosition | null {
  const depDay = aiDepartureDay(f, day, min);
  if (depDay === null) return null;
  const elapsed = min + (day - depDay) * MIN_PER_DAY - f.depUtcMin;
  const progress = Math.max(0, Math.min(1, elapsed / f.blockMin));
  const taxi = aiTaxiMin(f) / f.blockMin;
  const airT = Math.max(0, Math.min(1, (progress - taxi) / (1 - 2 * taxi)));
  const O = t.airports[f.o];
  const D = t.airports[f.d];
  const coordinates = slerpVec(O.v, D.v, airT);
  const bearing = airT < 1 ? calcBearingDeg(coordinates, [D.lon, D.lat]) : calcBearingDeg([O.lon, O.lat], [D.lon, D.lat]);

  // Same level as the detailed model would give it (the type's and the route's limits)
  const cruiseAlt = aiCruiseAltitudeFt(f, calcBearingDeg([O.lon, O.lat], [D.lon, D.lat]), Math.max(O.elevFt || 0, D.elevFt || 0));
  const climb = 0.12;
  const descent = 0.15;
  const altitudeFt =
    airT <= 0 || airT >= 1
      ? 0
      : airT < climb
      ? Math.round(O.elevFt + (airT / climb) * (cruiseAlt - O.elevFt))
      : airT > 1 - descent
      ? Math.round(D.elevFt + ((1 - airT) / descent) * (cruiseAlt - D.elevFt))
      : cruiseAlt;
  const groundSpeedKts = airT <= 0 || airT >= 1 ? 15 : Math.round(f.cruiseKts * (altitudeFt < cruiseAlt ? 0.55 + 0.45 * (altitudeFt / cruiseAlt) : 1));

  return { coordinates, bearing: Math.round(bearing), progress, remainingMin: Math.max(0, Math.round(f.blockMin - elapsed)), altitudeFt, groundSpeedKts };
}

/** Great-circle path of an AI flight, split at its current position (for the trail). */
export function aiFlightTrail(t: AiTraffic, f: AiFlight, progress: number): { flown: LonLat[]; remaining: LonLat[] } {
  const taxi = aiTaxiMin(f) / f.blockMin;
  const airT = Math.max(0, Math.min(1, (progress - taxi) / (1 - 2 * taxi)));
  const N = 48;
  const O = t.airports[f.o];
  const D = t.airports[f.d];
  const pts: LonLat[] = [];
  for (let i = 0; i <= N; i++) pts.push(slerpVec(O.v, D.v, i / N));
  for (let i = 1; i < pts.length; i++) {
    while (pts[i][0] - pts[i - 1][0] > 180) pts[i][0] -= 360;
    while (pts[i][0] - pts[i - 1][0] < -180) pts[i][0] += 360;
  }
  const cut = airT * N;
  const k = Math.min(N - 1, Math.floor(cut));
  const frac = cut - k;
  const here: LonLat = [pts[k][0] + (pts[k + 1][0] - pts[k][0]) * frac, pts[k][1] + (pts[k + 1][1] - pts[k][1]) * frac];
  return { flown: [...pts.slice(0, k + 1), here], remaining: [here, ...pts.slice(k + 1)] };
}

/** Stable 0..3 bucket per flight for the density setting. */
export const densityBucket = (f: AiFlight) => (Math.imul(f.id + 1, 2654435761) >>> 30) & 3;
