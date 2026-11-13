// ============================================================================
// CARGO DEMAND
//
// Two kinds of cargo move between airports:
//
//   Small parcels  mail, express and loose cargo: they travel in any hold,
//                  passenger aircraft included (the only cargo those carry).
//                  They come with the travellers (a little on short flights,
//                  much more on long ones) and through the express carriers'
//                  hubs (Memphis, Louisville, Leipzig, …), and travel best
//                  overnight.
//   Big parcels    pallets and containers: freighters only. They follow the
//                  airports' real cargo tonnage, concentrate on the biggest
//                  cargo airports, go by road over short distances, and run
//                  stronger one way than the other (factories out, empties
//                  back). A few named lanes (flowers, fish, fruit) are added.
//
// Tonnes are what the player's airline can win a day, one way. Airport
// tonnage is from public airport figures (CARGO_KT), so a route with no cargo
// shows none.
// ============================================================================
import { gameMarket, getNetwork, kmBetween, marketDemand, routeCrossesWater, type NetAirport, type NetworkData } from './demand';
import type { AircraftModel, Airport } from './types';

export interface CargoDemand {
  /** Small parcels, tonnes a day, one way. */
  parcels: number;
  /** Big parcels (freighters only), tonnes a day, one way. */
  freight: number;
  /** Big parcels this way compared with the way back: above 1 = the heavy direction. */
  direction: number;
  /** The ends that are cargo or parcel hubs (for the route's notes). */
  hubs: string[];
}

const CARGO = {
  bellyBase: 2.5, // kg of small parcels per traveller in the market: 2.5 short haul …
  bellyFar: 22, // … up to 24.5 long haul
  paxShare: 0.85, // player's share of belly parcels
  expressShare: 0.6, // player's share of express-hub parcels
  bigShare: 0.65, // player's share of big parcels (tuned from 0.6)
  generalShare: 0.55, // part of an airport's non-express tonnage that is big parcels
  heavyShare: 0.85, // the same at freighter-led airports
  gamma: 1.5, // big parcels concentrate on the biggest partner airports
  vanKm: 450, // express parcels go by van under about this
  truckKm: 900, // big parcels go by lorry under about this
  roadPower: 2.5,
  minKm: 60,
  unlistedMax: 250_000,
};

/** Thousand tonnes a year: [all cargo, the part moved by the express parcel carriers]. */
const CARGO_KT: Record<string, [number, number]> = {
  HKG: [4330, 500], MEM: [3880, 3500], PVG: [3440, 400], ANC: [3380, 500], ICN: [2740, 300], SDF: [2730, 2500],
  MIA: [2530, 200], DOH: [2360, 0], LAX: [2130, 250], TPE: [2110, 150], CAN: [2030, 500], FRA: [1930, 150],
  NRT: [1900, 150], ORD: [1900, 250], CDG: [1870, 600], DXB: [1810, 100], SIN: [1760, 200], SZX: [1600, 500],
  CVG: [1500, 1200], IST: [1480, 100], LHR: [1430, 100], JFK: [1400, 150], LEJ: [1390, 1200], AMS: [1380, 50],
  BKK: [1140, 80], PEK: [1120, 100], IND: [1000, 850], LGG: [1000, 500], DEL: [1000, 120], LUX: [900, 0],
  CGN: [860, 650], HND: [800, 50], BOM: [800, 80], DFW: [800, 200], EHU: [800, 700], BOG: [770, 0],
  ONT: [750, 550], KIX: [750, 150], EWR: [700, 350], BRU: [700, 250], HAN: [700, 50], HGH: [700, 300],
  MXP: [670, 100], KUL: [660, 100], MAD: [640, 100], ATL: [600, 80], CGK: [600, 50], MNL: [600, 80],
  CGO: [600, 50], AUH: [600, 0], DWC: [600, 50], SGN: [550, 50], MEX: [550, 60], SFO: [500, 60],
  IAH: [500, 60], PHL: [500, 300], OAK: [500, 400], YYZ: [500, 80], SYD: [500, 80], GRU: [500, 50],
  YHM: [500, 400], BLR: [440, 80], SEA: [420, 80], EMA: [400, 350], JNB: [400, 40], SCL: [400, 0],
  ZRH: [400, 30], RUH: [400, 30], JED: [400, 30], BAH: [400, 250], NBO: [380, 0], CAI: [350, 20],
  RFD: [350, 300], VCP: [300, 150], LIM: [300, 0], ADD: [300, 0], UIO: [200, 0],
  // Express and freighter airports from the game's earlier tables
  AFW: [150, 140], BGY: [150, 140], BLQ: [150, 80], GDL: [150, 120], HHN: [300, 0], LCK: [380, 0], SHJ: [240, 0], VIT: [150, 120], ZAZ: [300, 0],
};

/** Freighter-led airports: more of their cargo is big parcels. */
const HEAVY = new Set(['ANC', 'LUX', 'LGG', 'HHN', 'CGO', 'LCK', 'ZAZ', 'DWC', 'NBO', 'BOG', 'UIO', 'ADD', 'DOH']);

/** Big-parcel flows the tonnage alone misses (flowers, fish, fruit): tonnes a day one way; the way back gets 30%. */
const TRADE_LANES: [string, string, number][] = [
  ['BOG', 'MIA', 180], ['UIO', 'MIA', 120], ['NBO', 'AMS', 110], ['NBO', 'LGG', 60],
  ['ADD', 'LGG', 70], ['SCL', 'MIA', 90], ['LIM', 'MIA', 80],
];

/**
 * How much a country sends out by air compared with what it brings in:
 * factories, flowers and fish above 1, shoppers and holiday islands below.
 */
const EXPORTS: Record<string, number> = {
  CN: 1.5, HK: 1.4, VN: 1.4, TW: 1.4, BD: 1.3, KR: 1.3, TH: 1.2, MY: 1.2, JP: 1.15, IN: 1.1, SG: 1.1,
  DE: 1.2, NL: 1.1, IE: 1.1, KE: 1.3, ET: 1.2, CO: 1.25, EC: 1.3, CL: 1.2, PE: 1.2, MX: 1.1, NZ: 1.1,
  US: 0.85, GB: 0.85, CA: 0.9, AU: 0.85, RU: 0.85, AE: 0.9, SA: 0.7, QA: 0.8, KW: 0.7, NG: 0.7, AO: 0.7,
  MV: 0.55, BS: 0.6, FJ: 0.65, SC: 0.6, MU: 0.7, PF: 0.6, BB: 0.6, JM: 0.65, DO: 0.7, CU: 0.7, GL: 0.6, IS: 0.9,
};

/** Tonnes a year through an airport, and the express part. */
const tonnesOf = (a: NetAirport) => {
  const listed = CARGO_KT[a.iata];
  return listed ? listed[0] * 1000 : Math.min(CARGO.unlistedMax, 60 * a.carrierRoutes ** 1.6);
};
const expressOf = (a: NetAirport) => (CARGO_KT[a.iata]?.[1] ?? 0) * 1000;
/** Big-parcel tonnes a year. */
const bigOf = (a: NetAirport) => Math.max(0, tonnesOf(a) - expressOf(a)) * (HEAVY.has(a.iata) ? CARGO.heavyShare : CARGO.generalShare);

let totalsFor: NetworkData | null = null;
let totals = { sumQ: 1, sumA: 1 };
function networkTotals(net: NetworkData) {
  if (totalsFor !== net) {
    let sumQ = 0;
    let sumA = 0;
    for (const a of net.airports.values()) {
      sumQ += tonnesOf(a);
      sumA += bigOf(a) ** CARGO.gamma;
    }
    totals = { sumQ: sumQ || 1, sumA: sumA || 1 };
    totalsFor = net;
  }
  return totals;
}

function tradeLane(o: string, d: string): number {
  let t = 0;
  for (const [a, b, tons] of TRADE_LANES) {
    if (a === o && b === d) t += tons;
    else if (a === d && b === o) t += tons * 0.3;
  }
  return t;
}

/** Share of the cargo that flies rather than going by road, by distance. */
const byAir = (km: number, water: boolean, roadKm: number) => (km < CARGO.minKm ? 0 : water ? 1 : 1 / (1 + (roadKm / km) ** CARGO.roadPower));
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const cache = new Map<string, CargoDemand>();
let cacheFor: unknown = null;

/** Cargo the player's airline can win from origin to destination each day. */
export function cargoDemand(origin: Airport, destination: Airport, distanceNm: number): CargoDemand {
  const net = getNetwork();
  if (cacheFor !== net) {
    cache.clear();
    cacheFor = net;
  }
  const key = `${origin.iata_code}>${destination.iata_code}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const A = net?.airports.get(origin.iata_code);
  const B = net?.airports.get(destination.iata_code);
  let out: CargoDemand;
  if (!net || !A || !B) {
    // Not in the airline network (or it hasn't loaded yet): a guess from the airports' size
    const w = (ap: Airport) => ap.demand_weight * 0.16 + (ap.runway_count || 1) * 4.5 + (ap.max_runway_length_ft >= 9000 ? 12 : 4);
    const t = (0.2 * w(origin) * w(destination)) / Math.pow(Math.max(90, distanceNm), 0.65);
    out = { parcels: round1(t * 0.1), freight: round1(t * 0.2), direction: 1, hubs: [] };
  } else {
    const { sumQ, sumA } = networkTotals(net);
    const km = kmBetween(A, B);
    const water = routeCrossesWater(A, B);
    const nm = distanceNm > 0 ? distanceNm : km / 1.852;

    // Small parcels: with the travellers, plus what the express hubs send everywhere
    const far = clamp((nm - 300) / 3500, 0, 1);
    const belly = (gameMarket(marketDemand(A.iata, B.iata) ?? 0) * (CARGO.bellyBase + CARGO.bellyFar * far)) / 1000;
    const express = ((expressOf(A) * tonnesOf(B) + expressOf(B) * tonnesOf(A)) / (730 * sumQ)) * byAir(km, water, CARGO.vanKm);

    // Big parcels: between the big cargo airports, heavier out of factory countries
    const direction = clamp((EXPORTS[A.cc] ?? 1) / (EXPORTS[B.cc] ?? 1), 0.55, 1.7);
    const qa = bigOf(A);
    const qb = bigOf(B);
    const big =
      ((qa * qb ** CARGO.gamma + qb * qa ** CARGO.gamma) / (2 * 730 * sumA)) * byAir(km, water, CARGO.truckKm) * direction * CARGO.bigShare +
      (km < CARGO.minKm ? 0 : tradeLane(A.iata, B.iata));

    const isHub = (x: NetAirport) => expressOf(x) > 0 || HEAVY.has(x.iata) || tonnesOf(x) >= 1_000_000;
    out = {
      parcels: round1(belly * CARGO.paxShare + express * CARGO.expressShare),
      freight: round1(big),
      direction: Math.round(direction * 100) / 100,
      hubs: [A, B].filter(isHub).map((x) => x.iata),
    };
  }
  cache.set(key, out);
  return out;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/** Market rates per tonne. */
export const parcelRate = (distanceNm: number) => Math.round(600 + distanceNm * 0.7);
export const freightRate = (distanceNm: number) => Math.round(290 + distanceNm * 0.42);

/** Share of an aircraft's hold that can take big parcels: freighters only. */
export function freightShare(model: Pick<AircraftModel, 'is_cargo'>): number {
  return model.is_cargo ? 1 : 0;
}

/** What the hold takes, in a few words (for the aircraft's details). */
export function holdTakes(model: Pick<AircraftModel, 'is_cargo'>): string {
  return model.is_cargo ? 'Small and big parcels' : 'Small parcels only';
}

/** Share of a passenger aircraft's hold left for cargo once the travellers' bags are in. */
export const PAX_HOLD_FOR_CARGO = 0.28;

/**
 * Tonnes of cargo the hold can take on a flight this long. In a passenger
 * aircraft the bags come first (PAX_HOLD_FOR_CARGO is what's left), and the
 * hold is full up to three quarters of its range, then takes less (fuel takes
 * the weight), down to 60% at its full range. A freighter's range is already
 * the distance it flies fully loaded.
 */
export function holdTons(model: Pick<AircraftModel, 'cargo_cap_tons' | 'range_nm' | 'is_cargo'>, distanceNm: number): number {
  if (model.is_cargo) return model.cargo_cap_tons || 0;
  const cap = (model.cargo_cap_tons || 0) * PAX_HOLD_FOR_CARGO;
  const r = model.range_nm > 0 ? distanceNm / model.range_nm : 0;
  const k = r <= 0.75 ? 1 : Math.max(0.6, 1 - (r - 0.75) * 1.6);
  return Math.round(cap * k * 10) / 10;
}

/** Share of a route's parcels that want this local departure hour: overnight is best. */
const PARCEL_HOUR = [1, 1, 1, 0.95, 0.85, 0.75, 0.6, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.55, 0.6, 0.7, 0.85, 0.95, 1, 1, 1, 1];
/** Parcels and freight by weekday (Mon..Sun): quiet weekends. */
export const PARCEL_DAY = [1, 1.05, 1.05, 1.05, 1, 0.6, 0.5];
export const FREIGHT_DAY = [1, 1, 1, 1, 1.05, 0.85, 0.75];

export function parcelHourAppeal(localMin: number): number {
  const h = Math.floor(localMin / 60) % 24;
  const frac = (localMin % 60) / 60;
  return PARCEL_HOUR[h] * (1 - frac) + PARCEL_HOUR[(h + 1) % 24] * frac;
}
