// ============================================================================
// REAL-WORLD ROUTE DEMAND
//
// How many people want to fly between two airports each day, one way, from
// the real airline network (public/data/network.json, made by
// tools/build-network.mjs): which airlines fly from each airport and on each
// route, and how many people live around each airport (GeoNames).
//
// The model, checked against the real traffic of 48 routes (from the
// world's busiest, Seoul–Jeju, to Boston–Rutland) gets most within ×2:
//
//   size(airport) = (airline routes + 1)^0.2 × (people in millions + 0.3)^0.15
//   demand        = K × size(A) × size(B)
//                   × ground   (short trips go by car or train instead)
//                   × distance (fewer people go further)
//                   × islands  (no road or rail: everyone flies)
//                   × border   (crossing a border: fewer trips)
//                   × airlines (routes many airlines fly are the big ones)
//                   × quiet end (an airport with few flights has thin routes)
//
// Routes nobody flies today still have some demand, about a fifth of a route
// one airline flies. Airports a few kilometres apart (the same city) have none.
// ============================================================================

export interface NetAirport {
  iata: string;
  name: string;
  city: string;
  cc: string;
  region: string;
  lat: number;
  lon: number;
  elevFt: number;
  tz: string;
  /** Airline routes leaving the airport (one per airline per destination). */
  carrierRoutes: number;
  /** People living around the airport, thousands. */
  popK: number;
}

export interface NetCarrier {
  code: string;
  name: string;
}

export interface NetRoute {
  o: string;
  d: string;
  km: number;
  min: number;
  /** Indexes into carriers. */
  carriers: number[];
}

export interface NetworkData {
  built: string;
  airports: Map<string, NetAirport>;
  carriers: NetCarrier[];
  routes: NetRoute[];
  /** Airlines flying a pair, either way: key "AAA|BBB" with AAA < BBB. */
  pairCarriers: Map<string, number[]>;
  /** Airline routes in each country (the size of its air network). */
  countryRoutes: Map<string, number>;
  neighbours: Map<string, Set<string>>;
}

type RawNetwork = {
  v: number;
  built: string;
  airports: [string, string, string, string, string, number, number, number, string, number, number][];
  carriers: [string, string][];
  routes: number[][];
  neighbours: Record<string, string>;
};

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export function parseNetwork(json: unknown): NetworkData {
  const raw = json as RawNetwork;
  if (!raw || !Array.isArray(raw.airports) || !Array.isArray(raw.routes)) throw new Error('network.json is not in the expected format');
  const list: NetAirport[] = raw.airports.map((a) => ({
    iata: a[0],
    name: a[1],
    city: a[2],
    cc: a[3],
    region: a[4],
    lat: a[5],
    lon: a[6],
    elevFt: a[7],
    tz: a[8],
    carrierRoutes: a[9],
    popK: a[10],
  }));
  const airports = new Map(list.map((a) => [a.iata, a]));
  const carriers = raw.carriers.map(([code, name]) => ({ code, name }));
  const routes: NetRoute[] = [];
  const pairCarriers = new Map<string, number[]>();
  for (const r of raw.routes) {
    const o = list[r[0]]?.iata;
    const d = list[r[1]]?.iata;
    if (!o || !d) continue;
    const cs = r.slice(4);
    routes.push({ o, d, km: r[2], min: r[3], carriers: cs });
    const k = pairKey(o, d);
    const prev = pairCarriers.get(k);
    if (!prev) pairCarriers.set(k, [...cs]);
    else for (const c of cs) if (!prev.includes(c)) prev.push(c);
  }
  const countryRoutes = new Map<string, number>();
  for (const a of list) countryRoutes.set(a.cc, (countryRoutes.get(a.cc) ?? 0) + a.carrierRoutes);
  const neighbours = new Map(Object.entries(raw.neighbours ?? {}).map(([cc, s]) => [cc, new Set(s.split(',').filter(Boolean))]));
  return { built: raw.built, airports, carriers, routes, pairCarriers, countryRoutes, neighbours };
}

// The loaded network (null until network.json arrives)
let current: NetworkData | null = null;
export function setNetwork(n: NetworkData | null) {
  current = n;
  demandCache.clear();
}
export function getNetwork(): NetworkData | null {
  return current;
}

// ----------------------------------------------------------------------------
// Geography the model needs
// ----------------------------------------------------------------------------
/** Island regions inside larger countries (no road or rail to the rest of the country). */
const ISLAND_REGIONS = new Set([
  'KR-49', 'US-HI', 'ES-CN', 'ES-IB', 'PT-20', 'PT-30', 'IT-82', 'IT-88', 'FR-20R', 'FR-COR', 'GR-M', 'GR-L', 'GR-F', 'GR-K',
  'JP-01', 'JP-47', 'DK-GL', 'NO-21', 'CA-NL', 'CA-PE', 'US-AK', 'IN-AN', 'MY-12', 'MY-13', 'CN-HI', 'CN-46', 'TW-PEN',
  'TW-KIN', 'EC-W', 'CL-VS', 'AU-TAS', 'RU-SAK', 'RU-KAM',
]);
/** Island regions made of several islands (flights inside them cross water). */
const ARCHIPELAGO_REGIONS = new Set(['US-HI', 'ES-CN', 'ES-IB', 'PT-20', 'PT-30', 'GR-M', 'GR-L', 'GR-F', 'GR-K', 'IN-AN', 'FR-20R', 'DK-GL']);
/** Island countries. */
const ISLAND_COUNTRIES = new Set([
  'ID', 'PH', 'JP', 'GR', 'NZ', 'MV', 'FJ', 'BS', 'PF', 'SB', 'VU', 'KI', 'CV', 'FO', 'IS', 'HR', 'TO', 'WS', 'NC', 'KM', 'SC',
  'MU', 'LK', 'CU', 'JM', 'TT', 'BB', 'PR', 'DO', 'HT', 'MT', 'CY', 'IE', 'GB', 'TW', 'HK', 'MO', 'SG', 'BH', 'BN', 'TL', 'PG',
  'MH', 'FM', 'PW', 'CK', 'NR', 'TV',
]);
/** Big islands with roads all over (Britain, Ireland, Honshu): not "flying is the only way". */
const MAINLAND_ISLANDS = new Set(['GB', 'IE', 'JP']);
/** Countries with fast trains that take a big share of trips up to ~900 km. */
const FAST_TRAINS = new Set(['FR', 'DE', 'ES', 'IT', 'GB', 'NL', 'BE', 'CH', 'AT', 'JP', 'CN', 'KR', 'TW']);
/** European countries joined by rail (the Channel Tunnel counts): short hops between them are like land. */
const EUROPE_RAIL = new Set(['GB', 'FR', 'BE', 'NL', 'DE', 'LU', 'CH', 'AT', 'IT', 'ES', 'PT', 'DK', 'SE', 'NO', 'PL', 'CZ', 'SK', 'HU', 'SI', 'HR']);

const RAD = Math.PI / 180;
export function kmBetween(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const h = Math.sin(((b.lat - a.lat) * RAD) / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(((b.lon - a.lon) * RAD) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function islandEnd(a: NetAirport) {
  return ISLAND_REGIONS.has(a.region) || (ISLAND_COUNTRIES.has(a.cc) && !MAINLAND_ISLANDS.has(a.cc));
}

/** True when there is no road or rail between the two airports. */
function crossesWater(A: NetAirport, B: NetAirport, km: number, net: NetworkData) {
  if (A.cc !== B.cc) {
    if (EUROPE_RAIL.has(A.cc) && EUROPE_RAIL.has(B.cc) && km < 900 && !ISLAND_REGIONS.has(A.region) && !ISLAND_REGIONS.has(B.region)) return false;
    return !net.neighbours.get(A.cc)?.has(B.cc);
  }
  if (A.region !== B.region && (ISLAND_REGIONS.has(A.region) || ISLAND_REGIONS.has(B.region))) return true;
  if (A.region === B.region && ARCHIPELAGO_REGIONS.has(A.region) && km > 80) return true;
  if (ISLAND_COUNTRIES.has(A.cc) && !MAINLAND_ISLANDS.has(A.cc) && km > 120) return true;
  return false;
}

// ----------------------------------------------------------------------------
// The model
// ----------------------------------------------------------------------------
const K = 185.49;
const NET_EXP = 0.2;
const POP_EXP = 0.15;
const BORDER = 0.5;
const ISLAND_BOOST = 1.5;
const AIRLINES_EXP = 0.5;
const COUNTRY_EXP = 0.3;
/** Routes from an airport with few flights are thinner than its size alone says. */
const QUIET_ROUTES = 30;

/** How big an airport is as a place people fly from and to. */
export function airportSize(a: NetAirport) {
  return (a.carrierRoutes + 1) ** NET_EXP * (a.popK / 1000 + 0.3) ** POP_EXP;
}

const demandCache = new Map<string, number>();

/**
 * People a day wanting to fly from o to d (one way, all airlines together).
 * null when either airport isn't in the network.
 */
export function marketDemand(o: string, d: string, net: NetworkData | null = current): number | null {
  if (!net) return null;
  const A = net.airports.get(o);
  const B = net.airports.get(d);
  if (!A || !B) return null;
  const key = pairKey(o, d);
  const hit = demandCache.get(key);
  if (hit !== undefined && net === current) return hit;

  const km = kmBetween(A, B);
  let v = 0;
  if (km >= 60) {
    const water = crossesWater(A, B, km, net);
    let ground = 1;
    if (!water) {
      const rail = FAST_TRAINS.has(A.cc) && FAST_TRAINS.has(B.cc) && km < 900;
      ground = rail ? 1 / (1 + (520 / km) ** 2.4) : 1 / (1 + (400 / km) ** 2);
    }
    const distance = (Math.max(km, 500) / 1000) ** -0.35;
    const islands = water && km < 1800 && (islandEnd(A) || islandEnd(B)) ? ISLAND_BOOST : 1;
    // Domestic trips: small countries' few big routes carry more of their flying
    const border = A.cc === B.cc ? Math.min(1.6, Math.max(0.6, ((net.countryRoutes.get(A.cc) ?? 3000) / 3000) ** -COUNTRY_EXP)) : BORDER;
    const n = net.pairCarriers.get(key)?.length ?? 0;
    const airlines = n > 0 ? (n + 0.5) ** AIRLINES_EXP : 0.35 * 0.5 ** AIRLINES_EXP;
    // The quieter end's network: Heathrow–Kulusuk has hardly anyone, Heathrow–Milwaukee a few dozen
    const quiet = Math.min(A.carrierRoutes, B.carrierRoutes);
    const quietEnd = (quiet + 1) / (quiet + QUIET_ROUTES);
    v = K * airportSize(A) * airportSize(B) * ground * distance * islands * border * airlines * quietEnd;
  }
  if (net === current) demandCache.set(key, v);
  return v;
}

/** Airlines flying a pair today (either way). */
export function airlinesOnPair(o: string, d: string, net: NetworkData | null = current): NetCarrier[] {
  if (!net) return [];
  return (net.pairCarriers.get(pairKey(o, d)) ?? []).map((i) => net.carriers[i]).filter(Boolean);
}

/**
 * The airport's weight for sorting, map labels and hub prices: about 360 for
 * the world's biggest hubs, 40–60 for a regional airport, ~10 for one with
 * hardly any flights. Same scale the game has always used.
 */
export function networkDemandWeight(a: NetAirport) {
  return Math.round(Math.max(6, 7.2 * airportSize(a) ** 1.9) * 10) / 10;
}

/** Airports that airlines fly to today, with where they are (for the airport list). */
export function airlineAirportPositions(net: NetworkData): Map<string, { lat: number; lon: number }> {
  const out = new Map<string, { lat: number; lon: number }>();
  for (const r of net.routes)
    for (const c of [r.o, r.d]) {
      const a = net.airports.get(c);
      if (a && !out.has(c)) out.set(c, { lat: a.lat, lon: a.lon });
    }
  return out;
}

/**
 * Re-ranks the airports' demand_weight by real traffic. The weights keep
 * the spread they had (so map labels, sorting and hub prices stay on the same
 * scale) but go to the airports in order of their real size: Heathrow above
 * Milwaukee, not the other way round.
 */
export function applyNetworkWeights<T extends { iata_code: string; demand_weight: number }>(airports: T[], net: NetworkData): T[] {
  const weights = airports.map((a) => a.demand_weight).sort((a, b) => b - a);
  const size = (a: T) => {
    const n = net.airports.get(a.iata_code);
    return n ? airportSize(n) : 0;
  };
  const order = [...airports].map((a) => ({ a, s: size(a) })).sort((x, y) => y.s - x.s);
  const weightOf = new Map<string, number>();
  order.forEach(({ a }, i) => weightOf.set(a.iata_code, weights[i]));
  return airports.map((a) => ({ ...a, demand_weight: weightOf.get(a.iata_code) ?? a.demand_weight }));
}

/**
 * The travellers the game offers on a route: the model's estimate raised a
 * little (v2.39), more for thin routes, so a small city pair still has a
 * couple of hundred people a day and the busy ones some 20% more. Same-city
 * pairs stay at none. Other airlines' schedules use the plain estimate.
 */
export const gameMarket = (v: number) => (v > 0 ? 1.2 * v + 200 * (1 - Math.exp(-v / 40)) : 0);

/** Share of a route's travellers a player's airline can win (others fly it too). */
export const PLAYER_MARKET_SHARE = 0.85;
