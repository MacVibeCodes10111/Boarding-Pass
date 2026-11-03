// ============================================================================
// ICAO SIZE CODES (v2.65)
//   Which aircraft fit which airports, by the ICAO aerodrome reference code
//   letter: an aircraft's letter comes from its wingspan, an airport's from
//   the largest aircraft its gates and taxiways take. A type can use an
//   airport whose letter is the same or later in the alphabet.
//
//     A  under 15 m      Cessna 402, Islander
//     B  15 to 24 m      Twin Otter, ERJ-145, CRJ-200, Saab 340
//     C  24 to 36 m      ATR, Dash 8, E-Jets, A320 family, 737
//     D  36 to 52 m      757, 767, A300/A310, MD-11, Tu-204
//     E  52 to 65 m      A330, A340, A350, 787, 777, 747-400
//     F  65 to 80 m      A380, 747-8, An-124
//
//   Nobody publishes gate sizes for every airport, so an airport's letter is
//   worked out: a list of the airports that take the A380 or 747-8 (F), then
//   its longest airline route (only widebodies fly the longest), its size and
//   its runway. Saved routes that no longer fit keep flying, but new ones
//   can't be scheduled.
// ============================================================================
import { getNetwork, type NetworkData } from './demand';
import type { AircraftModel, Airport } from './types';

export type GateCode = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
export const GATE_CODES: GateCode[] = ['A', 'B', 'C', 'D', 'E', 'F'];
/** 1 (A) to 6 (F). */
export const gateRank = (c: GateCode) => GATE_CODES.indexOf(c) + 1;

/** What each letter takes, in a few words. */
export const GATE_CODE_INFO: Record<GateCode, { span: string; examples: string; label: string }> = {
  A: { span: 'under 15 m', examples: 'Cessna 402, Islander', label: 'Small props' },
  B: { span: '15 to 24 m', examples: 'Twin Otter, ERJ-145, CRJ-200', label: 'Commuters and small jets' },
  C: { span: '24 to 36 m', examples: 'ATR 72, E175, A320, 737', label: 'Regional and narrowbody' },
  D: { span: '36 to 52 m', examples: '757, 767, A310, MD-11', label: 'Large narrowbody and small widebody' },
  E: { span: '52 to 65 m', examples: '787, 777, A330, A350, 747-400', label: 'Widebody' },
  F: { span: '65 to 80 m', examples: 'A380, 747-8', label: 'Superjumbo' },
};

export function codeForSpan(m: number): GateCode {
  if (m < 15) return 'A';
  if (m < 24) return 'B';
  if (m < 36) return 'C';
  if (m < 52) return 'D';
  if (m < 65) return 'E';
  return 'F';
}

/** Wingspan in metres (with the winglets or sharklets the type is usually built with; the 777X with its tips folded on the ground). */
export const WINGSPAN_M: Record<string, number> = {
  // Airbus
  'a220-100': 35.1, 'a220-300': 35.1, 'a318-100': 34.1, 'a319-100': 35.8, 'a319neo': 35.8, 'a320-200': 35.8, 'a320neo': 35.8,
  'a320-p2f': 34.1, 'a321-200': 35.8, 'a321-100': 34.1, 'a321neo': 35.8, 'a321lr': 35.8, 'a321xlr': 35.8, 'a321-p2f': 34.1,
  'a310-300': 43.9, 'a300-600r': 44.8, 'a300-600f': 44.8, 'a330-200': 60.3, 'a330-200f': 60.3, 'a330-300p2f': 60.3, 'a330-300': 60.3,
  'a330-800neo': 64.0, 'a330-900neo': 64.0, 'a350-900': 64.75, 'a350-900ulr': 64.75, 'a350-1000': 64.75, 'a350-1000ulr': 64.75,
  'a350f': 64.75, 'a340-300': 60.3, 'a340-500': 63.45, 'a340-600': 63.45, 'a380-800': 79.75,
  // Boeing
  'b717-200': 28.4, 'b737-200': 28.35, 'b737-300': 28.9, 'b737-300sf': 28.9, 'b737-400': 28.9, 'b737-400sf': 28.9, 'b737-500': 28.9,
  'b737-700': 35.8, 'b737-800': 35.8, 'b737-800bcf': 35.8, 'b737-max7': 35.9, 'b737-max8': 35.9, 'b737-max8-200': 35.9,
  'b737-900': 35.8, 'b737-900er': 35.8, 'b737-max9': 35.9, 'b737-max10': 35.9, 'b727-200f': 32.9, 'b757-200': 41.1,
  'b757-200pcf': 38.05, 'b757-300': 41.1, 'b767-200er': 47.6, 'b767-200f': 47.6, 'b767-300er': 50.9, 'b767-300f': 47.6,
  'b767-400er': 51.9, 'b787-8': 60.1, 'b787-9': 60.1, 'b787-10': 60.1, 'b777-200': 60.9, 'b777-200er': 60.9, 'b777-200lr': 64.8,
  'b777f': 64.8, 'b777-300': 60.9, 'b777-300er': 64.8, 'b777-300ersf': 64.8, 'b777-9': 64.85, 'b777-8f': 64.85,
  'b747-200b': 59.6, 'b747-400': 64.4, 'b747-400d': 59.6, 'b747-400f': 64.4, 'b747-8i': 68.4, 'b747-8f': 68.4,
  // Embraer, Bombardier, ATR, De Havilland
  'emb-110': 15.3, 'emb-120': 19.8, 'erj-135': 20.0, 'erj-140': 20.0, 'erj-145': 20.0, 'erj-145xr': 20.0, 'e170': 26.0, 'e175': 26.0,
  'e175lr': 26.0, 'e190': 28.7, 'e190f': 28.7, 'e195': 28.7, 'e190-e2': 33.7, 'e195-e2': 35.1, 'crj-200': 21.2, 'crj-550': 23.2,
  'crj-700': 23.2, 'crj-705': 24.9, 'crj-900': 24.9, 'crj-1000': 26.2, 'atr-42-300f': 24.6, 'atr-42-500': 24.6, 'atr-42-600': 24.6,
  'atr-72-500': 27.05, 'atr-72-500f': 27.05, 'atr-72-600': 27.05, 'atr-72-600f': 27.05, 'dhc6-400': 19.8, 'dash8-100': 25.9,
  'dash8-200': 25.9, 'dash8-300': 27.4, 'dash8-q400': 28.4, 'dash8-q400pf': 28.4,
  // McDonnell Douglas
  'md-82': 32.9, 'md-83': 32.9, 'md-88': 32.9, 'md-90': 32.9, 'md-11': 51.97, 'md-11f': 51.97, 'md-10f': 50.4,
  // China, Russia and Ukraine
  'xian-ma60': 29.2, 'comac-c909': 27.3, 'comac-c909ccf': 27.3, 'comac-c919-std': 35.8, 'comac-c919': 35.8, 'an-24rv': 29.2,
  'an-26b': 29.2, 'il-114-300': 30.0, 'an-12bk': 38.0, 'sj-100': 27.8, 'tu-204-100': 41.8, 'tu-204c': 41.8, 'tu-214': 41.8,
  'mc-21-310': 35.9, 'il-96-300': 60.1, 'il-96-400t': 60.1, 'il-76td-90': 50.5, 'an-124-100': 73.3,
  // Europe and smaller types
  'saab-340b': 21.4, 'saab-340bf': 21.4, 'saab-2000': 24.8, 'bae146-100': 26.2, 'bae146-200': 26.2, 'bae146-300': 26.2,
  'avro-rj70': 26.2, 'avro-rj85': 26.2, 'avro-rj100': 26.2, 'jetstream-32': 15.85, 'jetstream-41': 18.3, 'fokker-70': 28.1,
  'fokker-100': 28.1, 'do-228ng': 16.97, 'do-328-100': 20.98, 'l-382g': 40.4, 'c402c': 13.45, 'c208b-ex': 15.88, 'c208b-cargo': 15.88,
  'c408': 22.0, 'tecnam-p2012': 14.0, 'bn2-islander': 14.9, 'beech-1900d': 17.67, 'beech-1900c-cargo': 16.6, 'pilatus-pc12': 16.28,
  'l-410-uvp': 19.98, 'metro-23': 17.37, 'metro-3-cargo': 17.37,
};

/** A guess for aircraft without a known wingspan (custom types), from their size class. */
const CATEGORY_CODE: Record<AircraftModel['category'], GateCode> = { turboprop: 'C', regional_jet: 'C', narrowbody: 'C', widebody: 'E', heavy_widebody: 'E' };

export function aircraftGateCode(model: AircraftModel): GateCode {
  const span = WINGSPAN_M[model.id];
  return span ? codeForSpan(span) : CATEGORY_CODE[model.category] ?? 'C';
}

/**
 * Airports that take the A380 or 747-8 (passenger or freighter) at their
 * gates or cargo stands, today or recently.
 */
const CODE_F = new Set(
  (
    // Middle East and Africa
    'DXB DWC AUH DOH JED RUH MED CAI JNB CPT MRU ' +
    // Europe
    'LHR LGW MAN BHX GLA CDG NCE FRA MUC AMS ZRH VIE MAD BCN FCO MXP PRG DME SVO IST LUX LEJ CGN BRU CPH DUB ' +
    // Asia and Oceania
    'ICN NRT HND KIX PEK PKX PVG CAN HKG TPE BKK SIN KUL CGK MNL DEL BOM BLR HYD MAA MLE CMB SYD MEL BNE PER ADL AKL CHC ' +
    // The Americas
    'JFK EWR IAD BOS ORD ATL MIA IAH DFW LAX SFO SEA YYZ YVR ANC SDF CVG MEX GRU GIG'
  ).split(' ')
);

/** Each airport's longest airline route (km), from the real network. */
const longest = new WeakMap<NetworkData, Map<string, number>>();
function longestRouteKm(iata: string): number {
  const net = getNetwork();
  if (!net) return 0;
  let m = longest.get(net);
  if (!m) {
    m = new Map();
    for (const r of net.routes) {
      if (r.km > (m.get(r.o) ?? 0)) m.set(r.o, r.km);
      if (r.km > (m.get(r.d) ?? 0)) m.set(r.d, r.km);
    }
    longest.set(net, m);
  }
  return m.get(iata) ?? 0;
}

const cache = new Map<string, GateCode>();
let cacheFor: NetworkData | null = null;

/** The largest aircraft size an airport takes. */
export function airportGateCode(a: Pick<Airport, 'iata_code' | 'type' | 'max_runway_length_ft'>): GateCode {
  const net = getNetwork();
  if (net !== cacheFor) {
    cache.clear();
    cacheFor = net;
  }
  const hit = cache.get(a.iata_code);
  if (hit) return hit;
  const code = workOut(a);
  cache.set(a.iata_code, code);
  return code;
}

function workOut(a: Pick<Airport, 'iata_code' | 'type' | 'max_runway_length_ft'>): GateCode {
  if (CODE_F.has(a.iata_code)) return 'F';
  const rwy = a.max_runway_length_ft || 0;
  const km = longestRouteKm(a.iata_code);
  const large = a.type === 'large_airport';
  const medium = a.type === 'medium_airport';
  // only widebodies fly the longest routes (the A321XLR tops out near 8,700 km)
  if (km >= 8_800 || (large && rwy >= 10_000) || (km >= 6_500 && rwy >= 7_500) || (large && km >= 5_000 && rwy >= 8_000)) return 'E';
  if (km >= 5_500 || (large && rwy >= 6_000) || (medium && rwy >= 9_000)) return 'D';
  if (medium || rwy >= 6_000 || km >= 1_200) return 'C';
  if (rwy >= 3_000 || km > 0) return 'B';
  return 'A';
}

/** Returns a reason if the aircraft is too big for the airport, else null. */
export function gateRestriction(model: AircraftModel, airport: Airport): string | null {
  const ac = aircraftGateCode(model);
  const ap = airportGateCode(airport);
  return gateRank(ac) > gateRank(ap) ? `${airport.iata_code} takes up to Code ${ap}; the ${model.name} is Code ${ac}` : null;
}
