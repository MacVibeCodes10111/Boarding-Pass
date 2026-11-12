// ============================================================================
// CARGO DEMAND
//
// Two kinds of cargo move between airports:
//
//   Parcels  mail and express: small, urgent, well paid. They follow people
//            (busy passenger routes have more) and the express carriers' hubs
//            (Memphis, Louisville, Leipzig, …). Any aircraft can carry them,
//            and they travel best overnight.
//   Freight  pallets and containers: heavy, cheaper per tonne. It follows
//            trade: big cities, the cargo hubs, long distances (short ones go
//            by lorry) and it runs stronger one way than the other (factories
//            out, empties back). Freighters and widebody holds take it fully,
//            smaller holds only loose freight.
//
// Tonnes are what the player's airline can win a day, one way.
// ============================================================================
import { gameMarket, getNetwork, kmBetween, marketDemand, routeCrossesWater, type NetAirport } from './demand';
import type { AircraftModel, Airport } from './types';

export interface CargoDemand {
  /** Tonnes a day, one way. */
  parcels: number;
  freight: number;
  /** Freight this way compared with the way back: above 1 = the heavy direction. */
  direction: number;
  /** The ends that are cargo or parcel hubs (for the route's notes). */
  hubs: string[];
}

/** Express carriers' hubs: how much of a parcel hub the airport is (0..1). */
const PARCEL_HUBS: Record<string, number> = {
  MEM: 1, SDF: 1, CVG: 0.8, IND: 0.6, ANC: 0.7, AFW: 0.6, RFD: 0.5, ONT: 0.5, OAK: 0.4, PHL: 0.4, EWR: 0.4, MIA: 0.4, DFW: 0.3, YHM: 0.5,
  LEJ: 0.9, CGN: 0.8, LGG: 0.7, EMA: 0.6, CDG: 0.5, BRU: 0.4, BGY: 0.4, VIT: 0.3, BLQ: 0.2, MAD: 0.2, IST: 0.3,
  EHU: 0.8, HKG: 0.6, CAN: 0.5, SZX: 0.5, HGH: 0.4, PVG: 0.4, ICN: 0.4, KIX: 0.3, NRT: 0.3, SIN: 0.3, KUL: 0.2, DEL: 0.3, BLR: 0.2,
  DXB: 0.4, BAH: 0.3, GDL: 0.3, VCP: 0.4, SYD: 0.2,
};

/** Freight hubs: how many times more freight than the city's size alone says. */
const FREIGHT_HUBS: Record<string, number> = {
  MEM: 5, SDF: 4.5, ANC: 5, CVG: 3.5, IND: 2.5, LCK: 2.5, RFD: 2.5, ONT: 1.8, OAK: 1.5, MIA: 2.2, LAX: 1.6, ORD: 1.8, JFK: 1.4, DFW: 1.4, ATL: 1.4, YHM: 2,
  LEJ: 4, LGG: 4, CGN: 3, LUX: 3.5, EMA: 3, HHN: 2, FRA: 1.9, AMS: 1.7, CDG: 1.6, LHR: 1.4, BRU: 1.6, MXP: 1.5, ZAZ: 2, IST: 1.6,
  HKG: 3, PVG: 2.6, EHU: 3, CGO: 2.5, CAN: 1.8, SZX: 1.8, ICN: 2.2, NRT: 1.9, KIX: 1.5, TPE: 2, SIN: 1.8, BKK: 1.4, KUL: 1.3, DEL: 1.3, BOM: 1.3,
  DXB: 2.2, DWC: 2.2, DOH: 2.2, SHJ: 1.6, BAH: 1.4, NBO: 1.8, ADD: 1.6, JNB: 1.3, BOG: 1.8, UIO: 1.8, VCP: 2, GRU: 1.4, SCL: 1.4, LIM: 1.3, MEX: 1.3,
};

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

const cargoSize = (a: NetAirport) => (a.carrierRoutes + 1) ** 0.35 * (a.popK / 1000 + 0.3) ** 0.3;

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
    out = { parcels: round1(Math.max(0.2, t * 0.2)), freight: round1(Math.max(0.3, t * 0.8)), direction: 1, hubs: [] };
  } else {
    const km = kmBetween(A, B);
    const water = routeCrossesWater(A, B);
    const sA = cargoSize(A);
    const sB = cargoSize(B);
    const pA = PARCEL_HUBS[A.iata] ?? 0;
    const pB = PARCEL_HUBS[B.iata] ?? 0;

    // Parcels: with the travellers, plus what the express hubs pull in from everywhere
    const market = gameMarket(marketDemand(A.iata, B.iata) ?? 0);
    const vans = water ? 1 : Math.min(1, km / 300);
    const parcels = (0.02 * market ** 0.75 + 1.5 * (pA * sB + pB * sA) + 25 * pA * pB) * vans;

    // Freight: trade between the two cities, the further the better
    const far = km / (km + 1500);
    const lorries = water ? 1 : Math.min(1, km / 800);
    const islands = water && km < 1800 ? 2.5 : 1;
    const direction = Math.min(1.7, Math.max(0.55, (EXPORTS[A.cc] ?? 1) / (EXPORTS[B.cc] ?? 1)));
    const trade = 0.34 * sA * sB * far * lorries * islands * (FREIGHT_HUBS[A.iata] ?? 1) * (FREIGHT_HUBS[B.iata] ?? 1) * direction;
    // The very biggest lanes are shared with many other cargo airlines
    const freight = trade > 300 ? 300 + (trade - 300) * 0.5 : trade;

    const hubs = [A, B].filter((x) => (FREIGHT_HUBS[x.iata] ?? 0) >= 1.5 || (PARCEL_HUBS[x.iata] ?? 0) >= 0.4).map((x) => x.iata);
    out = { parcels: round1(Math.max(0.2, parcels)), freight: round1(Math.max(0.3, freight)), direction: Math.round(direction * 100) / 100, hubs };
  }
  cache.set(key, out);
  return out;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/** Market rates per tonne. Parcels pay about twice what freight does. */
export const freightRate = (distanceNm: number) => Math.round(220 + distanceNm * 0.42);
export const parcelRate = (distanceNm: number) => Math.round(460 + distanceNm * 0.9);

/**
 * Share of an aircraft's hold that can take freight. Freighters and widebodies
 * load pallets and containers; narrowbody and regional holds are loaded by
 * hand, so only loose freight fits; turboprop holds carry parcels and bags.
 */
export function freightShare(model: Pick<AircraftModel, 'is_cargo' | 'category'>): number {
  if (model.is_cargo) return 1;
  switch (model.category) {
    case 'widebody':
    case 'heavy_widebody':
      return 1;
    case 'narrowbody':
      return 0.5;
    case 'regional_jet':
      return 0.25;
    default:
      return 0;
  }
}

/** What the hold takes, in a few words (for the aircraft's details). */
export function holdTakes(model: Pick<AircraftModel, 'is_cargo' | 'category'>): string {
  const f = freightShare(model);
  return f >= 1 ? 'parcels, freight' : f > 0 ? 'parcels, some freight' : 'parcels only';
}

/**
 * Tonnes the hold can take on a flight this long. A passenger aircraft's hold
 * is full up to three quarters of its range, then takes less (fuel takes the
 * weight), down to 60% at its full range. A freighter's range is already the
 * distance it flies fully loaded.
 */
export function holdTons(model: Pick<AircraftModel, 'cargo_cap_tons' | 'range_nm' | 'is_cargo'>, distanceNm: number): number {
  const cap = model.cargo_cap_tons || 0;
  if (model.is_cargo) return cap;
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
