// ============================================================================
// CRUISING ALTITUDES (v2.45+)
//
// How high an aircraft cruises, from two real limits:
//  - the type: unpressurised commuters stay around 10,000 ft, pressurised
//    turboprops at FL250 (the Q400 FL270), regional jets FL370-390,
//    narrowbodies FL350-410 by generation, widebodies FL410 (747 FL430);
//  - the route: a short hop never climbs higher than it has room to climb
//    and come down again (about 3 nm per 1,000 ft up, 3.2 nm down) with some
//    cruise in between.
// The level then follows the semicircular rule: eastbound odd thousands
// (FL350, 370), westbound even (FL340, 360). Used by your flights and by
// other airlines' traffic alike, so the two agree.
// ============================================================================
import type { AircraftCategory, AircraftModel, RadarIconGroup } from './types';

/** nm flown per 1,000 ft of climb and of descent (the profiles use the same). */
export const CLIMB_NM_PER_KFT = 3;
export const DESCENT_NM_PER_KFT = 3.2;
/** Share of the airborne distance kept for cruise on short routes. */
const MIN_CRUISE_SHARE = 0.3;
/** Lowest cruising altitude on the shortest hops. */
const FLOOR_FT = 3000;

/** Highest usual cruising altitude of your aircraft types, by ICAO code (ft). */
const BY_ICAO: Record<string, number> = {
  // Unpressurised
  DHC6: 10000,
  // Pressurised turboprops
  AT46: 25000, AT76: 25000, AT45: 25000, AT72: 25000, AT75: 25000, DH8A: 25000, DH8B: 25000, DH8C: 25000, DH8D: 27000,
  MA60: 25000, AN24: 24000, AN26: 24000, SF34: 25000, E120: 25000, JS41: 25000, F50: 25000,
  // Regional jets
  E145: 37000, E135: 37000, CRJ2: 37000, CRJ7: 39000, CRJ9: 39000, CRJX: 39000,
  E170: 39000, E175: 39000, E190: 39000, E195: 39000, E290: 39000, E295: 39000, SU95: 39000, AJ27: 39000,
  // Narrowbodies
  BCS1: 41000, BCS3: 41000, A318: 39000, A319: 39000, A320: 39000, A321: 39000, A19N: 39000, A20N: 39000, A21N: 39000, C919: 39000,
  B732: 35000, B733: 37000, B734: 37000, B735: 37000, B736: 41000, B737: 41000, B738: 41000, B739: 41000,
  B37M: 41000, B38M: 41000, B39M: 41000, B3XM: 41000, B712: 37000, MD88: 37000, MD82: 37000, MD83: 37000,
  B752: 41000, B753: 41000, T204: 39000,
  // Widebodies
  A306: 39000, A310: 39000, A332: 41000, A333: 41000, A338: 41000, A339: 41000, A359: 41000, A35K: 41000,
  A343: 41000, A345: 41000, A346: 41000, A388: 41000, B762: 41000, B763: 41000, B764: 41000,
  B788: 41000, B789: 41000, B78X: 41000, B772: 41000, B77L: 41000, B77W: 41000, B779: 41000, B778: 41000,
  B742: 41000, B744: 43000, B748: 43000, MD11: 41000, IL96: 41000, IL76: 39000, A124: 35000,
};

/** When the type isn't listed: by category. */
const BY_CATEGORY: Partial<Record<AircraftCategory, number>> = {
  turboprop: 25000,
  regional_jet: 37000,
  narrowbody: 39000,
  widebody: 41000,
};

/** Other airlines' types (IATA codes), where they differ from their icon group. */
const BY_IATA: Record<string, number> = {
  // Unpressurised commuters
  CNA: 10000, CNC: 12000, DHT: 10000, DH6: 10000, L4T: 10000, BNI: 8000, PN6: 8000, D28: 10000, DHP: 10000, TWN: 10000,
  SH3: 10000, SH6: 10000,
  // Pressurised commuters and turboprops
  BE1: 25000, BEH: 25000, BE9: 25000, SWM: 25000, J31: 25000, J32: 25000, J41: 25000, S20: 27000, D38: 27000,
  DH4: 27000, AN4: 24000, AN6: 24000, ANF: 24000,
  // Older and smaller jets
  F70: 35000, F100: 35000, '100': 35000, '146': 31000, '141': 31000, '142': 31000, '143': 31000, AR1: 31000, AR8: 31000,
  ER3: 37000, ER4: 37000, ERD: 37000, ERJ: 37000, E45: 37000, E35: 37000, CRJ: 37000, CR1: 37000, CR2: 37000,
  '732': 35000, '733': 37000, '734': 37000, '735': 37000, '73C': 37000, '717': 37000,
  M80: 37000, M81: 37000, M82: 37000, M83: 37000, M87: 37000, M88: 37000, M90: 37000, D9S: 35000, DC9: 35000,
  // Freighters and heavies
  '744': 43000, '74F': 43000, '74Y': 43000, '748': 43000, '74H': 43000, '74N': 43000,
  IL7: 39000, IL76: 39000, A4F: 35000, A40: 35000,
  '300': 39000, '310': 39000, '312': 39000, '313': 39000, AB3: 39000, AB4: 39000, AB6: 39000, ABF: 39000, ABY: 39000,
};

/** When the IATA code isn't listed: by the icon group the game drew it with. */
const BY_GROUP: Record<RadarIconGroup, number> = {
  commuter: 12000,
  prop: 25000,
  rj_tail: 37000,
  small_jet: 39000,
  rear_jet: 37000,
  medium_jet: 39000,
  long_narrow: 41000,
  large_jet: 41000,
  heavy_twin: 41000,
  trijet: 41000,
  a340: 41000,
  b747: 43000,
  a380: 41000,
  high_quad: 37000,
};

/** Highest usual cruising altitude of one of your aircraft types. */
export function typeMaxCruiseFt(model: Pick<AircraftModel, 'icao_code' | 'category'> | null | undefined): number {
  if (!model) return 39000;
  return BY_ICAO[model.icao_code?.toUpperCase()] ?? BY_CATEGORY[model.category] ?? 39000;
}

/** Highest usual cruising altitude of another airline's type (IATA code and icon group). */
export function aiTypeMaxCruiseFt(typeCode: string, group: RadarIconGroup): number {
  return BY_IATA[typeCode.toUpperCase()] ?? BY_GROUP[group] ?? 39000;
}

/** Highest altitude a route of this airborne length has room for (climb, some cruise, descent). */
export function routeMaxCruiseFt(airborneNm: number): number {
  const kft = (Math.max(0, airborneNm) * (1 - MIN_CRUISE_SHARE)) / (CLIMB_NM_PER_KFT + DESCENT_NM_PER_KFT);
  return Math.max(FLOOR_FT, kft * 1000);
}

/**
 * The cruising altitude: the highest flight level under both limits that
 * fits the direction of flight (east odd thousands, west even). `stepDown`
 * (0, 1, 2…) takes that many levels lower, to spread aircraft on the same
 * route over a few levels; it never goes under the floor.
 */
export function cruiseAltitudeFt(opts: { airborneNm: number; maxTypeFt: number; trackDeg: number; stepDown?: number; fieldElevFt?: number }): number {
  // Never lower than 2,000 ft above the higher of the two airports (La Paz is at 13,300 ft)
  const minFt = (opts.fieldElevFt ?? 0) + 2000;
  const cap = Math.max(minFt, Math.min(opts.maxTypeFt, routeMaxCruiseFt(opts.airborneNm)));
  const east = ((opts.trackDeg % 360) + 360) % 360 < 180;
  let k = Math.floor(cap / 1000);
  if (k % 2 !== (east ? 1 : 0)) k -= 1;
  k -= 2 * Math.max(0, Math.floor(opts.stepDown ?? 0));
  const floorK = Math.ceil(FLOOR_FT / 1000);
  while (k < floorK) k += 2;
  // Very short hops under the floor's parity: the lowest level of the right parity
  const level = Math.min(k, Math.max(floorK, Math.floor(cap / 1000)));
  return Math.max(level, Math.ceil(minFt / 1000)) * 1000;
}

/**
 * Another airline's cruising altitude. Both of the game's models of other
 * airlines' flights (the simple one and the one with departure and arrival
 * procedures) use this, so a flight keeps the same level whichever draws it.
 * Flights on the same route spread over the top three levels.
 */
export function aiCruiseAltitudeFt(f: { id: number; typeCode: string; group: RadarIconGroup; distanceNm: number }, trackDeg: number, fieldElevFt = 0): number {
  const h = Math.imul(f.id + 17, 0x9e3779b1) >>> 0;
  return cruiseAltitudeFt({ airborneNm: f.distanceNm, maxTypeFt: aiTypeMaxCruiseFt(f.typeCode, f.group), trackDeg, stepDown: [0, 0, 1, 2][h & 3], fieldElevFt });
}
