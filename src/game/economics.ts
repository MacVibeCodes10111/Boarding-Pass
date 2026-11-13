// ============================================================================
// CABIN LAYOUT, PASSENGER + CARGO DEMAND & FLIGHT ECONOMICS
// ============================================================================
import { cargoDemand, FREIGHT_DAY, freightRate, freightShare, holdTons, PARCEL_DAY, parcelHourAppeal, parcelRate } from './cargo';
import { flightCosts, type FlightCosts } from './costs';
import { crewShareOf } from './subsidiaries';
import { gameMarket, marketDemand, PLAYER_MARKET_SHARE, routeKind, type RouteKind } from './demand';
import { daysOrAll } from './time';
import type { AircraftModel, Airport, CabinConfig, Fares, PlayerAircraft, ScheduledFlight } from './types';

// ----------------------------------------------------------------------------
// Cabin configuration
// ----------------------------------------------------------------------------
const DEFAULT_PITCH = { econPitchIn: 30, premPitchIn: 36, busPitchIn: 48, firstPitchIn: 62 };

export type CabinClass = 'econ' | 'prem' | 'bus' | 'first';
/** The usual seat pitch of each class, inches: what the market fare buys. */
export const STANDARD_PITCH: Record<CabinClass, number> = { econ: 30, prem: 36, bus: 48, first: 62 };
const COMFORT_WEIGHT: Record<CabinClass, number> = { econ: 0.9, prem: 0.6, bus: 0.5, first: 0.4 };

/**
 * What travellers will pay for a seat compared with the market fare (1 = the
 * same): more legroom than usual is worth more, less is worth less, and it
 * matters most on long flights (hardly at all on a one-hour hop).
 */
export function seatComfort(cabin: CabinConfig, cls: CabinClass, blockTimeMin: number): number {
  const pitch = cabin[`${cls}PitchIn` as const];
  const std = STANDARD_PITCH[cls];
  if (!(pitch > 0)) return 1;
  const length = Math.min(1, Math.max(0.25, blockTimeMin / 480));
  return Math.min(1.4, Math.max(0.8, 1 + COMFORT_WEIGHT[cls] * ((pitch - std) / std) * length));
}

export type CabinPreset = 'dense' | 'standard' | 'premium';

export const CABIN_PRESET_LABELS: Record<CabinPreset, { label: string; hint: string }> = {
  dense: { label: 'High density', hint: 'All economy at 29" pitch, the most seats' },
  standard: { label: 'Standard', hint: 'Typical airline mix for this aircraft' },
  premium: { label: 'Premium', hint: 'More business and premium economy, roomier economy' },
};

/** Share of typical seats given to each premium class, per aircraft category. */
const PRESET_MIX: Record<AircraftModel['category'], Record<Exclude<CabinPreset, 'dense'>, { first: number; bus: number; prem: number }>> = {
  turboprop: { standard: { first: 0, bus: 0, prem: 0 }, premium: { first: 0, bus: 0, prem: 0.15 } },
  regional_jet: { standard: { first: 0, bus: 0.12, prem: 0 }, premium: { first: 0, bus: 0.16, prem: 0.12 } },
  narrowbody: { standard: { first: 0, bus: 0.08, prem: 0 }, premium: { first: 0, bus: 0.12, prem: 0.1 } },
  widebody: { standard: { first: 0, bus: 0.12, prem: 0.08 }, premium: { first: 0, bus: 0.18, prem: 0.12 } },
  heavy_widebody: { standard: { first: 0.02, bus: 0.12, prem: 0.08 }, premium: { first: 0.04, bus: 0.18, prem: 0.12 } },
};

/** Seats per row for each class (economy is the aircraft's max abreast). */
export function cabinAbreast(model: AircraftModel) {
  return {
    econ: Math.max(1, model.max_abreast),
    prem: Math.max(2, model.max_abreast - 1),
    bus: Math.max(2, Math.floor(model.max_abreast * 0.66)),
    first: Math.max(1, Math.floor(model.max_abreast * 0.45)),
  };
}

/**
 * Builds a sensible cabin: premium cabins sized as whole rows from the preset
 * mix, then economy filled until the cabin floor or the exit limit is reached.
 */
export function buildCabinPreset(model: AircraftModel, preset: CabinPreset): CabinConfig {
  const pitch = { ...DEFAULT_PITCH, econPitchIn: preset === 'dense' ? 29 : preset === 'premium' ? 31 : 30 };
  if (model.is_cargo) return { econSeats: 0, premSeats: 0, busSeats: 0, firstSeats: 0, ...pitch };

  const ab = cabinAbreast(model);
  const tiny = model.typical_seats < 40; // commuter aircraft stay single-class
  const mix = preset === 'dense' || tiny ? { first: 0, bus: 0, prem: 0 } : PRESET_MIX[model.category][preset];
  const wholeRows = (share: number, abreast: number) => (share > 0 ? Math.max(1, Math.round((model.typical_seats * share) / abreast)) * abreast : 0);

  let cabin: CabinConfig = {
    econSeats: 0,
    premSeats: wholeRows(mix.prem, ab.prem),
    busSeats: wholeRows(mix.bus, ab.bus),
    firstSeats: wholeRows(mix.first, ab.first),
    ...pitch,
  };
  // Premium cabins that don't fit at all (tiny aircraft) fall back to economy only
  if (!calculateCabinUsage(model, { ...cabin, econSeats: 1 }).isValid) cabin = { ...cabin, premSeats: 0, busSeats: 0, firstSeats: 0 };

  // Economy: High density fills the cabin; Standard aims for the aircraft's
  // typical seat count, Premium for ~88% of it (roomier). Never past what fits.
  const premiumSeats = cabin.premSeats + cabin.busSeats + cabin.firstSeats;
  const target =
    preset === 'dense' ? Infinity : Math.max(ab.econ, Math.round(model.typical_seats * (preset === 'premium' ? 0.88 : 1)) - premiumSeats);
  const fits = (econ: number) => econ <= target && calculateCabinUsage(model, { ...cabin, econSeats: econ }).isValid;
  let econ = 0;
  while (fits(econ + ab.econ)) econ += ab.econ;
  // High density, and small commuter cabins (odd seat counts like 9 or 19), top up seat by seat
  if (preset === 'dense' || tiny) while (fits(econ + 1)) econ += 1;
  return { ...cabin, econSeats: econ };
}

export function getDefaultCabinForModel(model: AircraftModel): CabinConfig {
  return buildCabinPreset(model, 'standard');
}

export function cabinSeatTotal(cabin: CabinConfig): number {
  return cabin.econSeats + cabin.premSeats + cabin.busSeats + cabin.firstSeats;
}

export function calculateCabinUsage(model: AircraftModel, cabin: CabinConfig) {
  if (model.is_cargo) {
    return {
      usedMeters: model.usable_cabin_length_m,
      maxMeters: model.usable_cabin_length_m,
      totalSeats: 0,
      maxExitLimit: 0,
      isValid: true,
    };
  }
  const rows = (seats: number, abreast: number) => Math.ceil(seats / Math.max(1, abreast));
  const ab = cabinAbreast(model);
  const totalInches =
    rows(cabin.econSeats, ab.econ) * cabin.econPitchIn +
    rows(cabin.premSeats, ab.prem) * cabin.premPitchIn +
    rows(cabin.busSeats, ab.bus) * cabin.busPitchIn +
    rows(cabin.firstSeats, ab.first) * cabin.firstPitchIn;

  const usedMeters = totalInches * 0.0254 + 1.8; // + galleys / lavs
  const totalSeats = cabinSeatTotal(cabin);
  return {
    usedMeters: Math.round(usedMeters * 100) / 100,
    maxMeters: model.usable_cabin_length_m,
    totalSeats,
    maxExitLimit: model.max_exit_limit,
    isValid: totalSeats > 0 && usedMeters <= model.usable_cabin_length_m && totalSeats <= model.max_exit_limit,
  };
}

// ----------------------------------------------------------------------------
// Route demand with hub & connecting-feed bonuses. Passengers come from the
// real-world model in demand.ts (once network.json is loaded); before that,
// and for an airport it doesn't know, the old size-based estimate.
// ----------------------------------------------------------------------------
function fallbackPax(origin: Airport, destination: Airport, distanceNm: number) {
  return (12.5 * origin.demand_weight * destination.demand_weight) / Math.pow(Math.max(80, distanceNm), 0.85);
}

/**
 * Share of a route's travellers in each class. Short flights are nearly all
 * economy; long ones have more premium economy, business and a little first.
 * Business routes have more people at the front, holiday routes fewer.
 */
export function classMix(distanceNm: number, kind: RouteKind = 'mixed'): Record<CabinClass, number> {
  const t = Math.min(1, Math.max(0, (distanceNm - 300) / 2700));
  const far = Math.min(1, Math.max(0, (distanceNm - 1500) / 2500));
  const k = kind === 'business' ? { first: 1.25, bus: 1.3, prem: 1.1 } : kind === 'leisure' ? { first: 0.5, bus: 0.5, prem: 0.8 } : { first: 1, bus: 1, prem: 1 };
  const first = (0.004 + 0.026 * far) * k.first;
  const bus = (0.06 + 0.04 * t) * k.bus;
  const prem = (0.04 + 0.08 * t) * k.prem;
  return { first, bus, prem, econ: 1 - first - bus - prem };
}
/** Where the schedule flies to from each airport (worked out once per schedule). */
const destinationsCache = new WeakMap<ScheduledFlight[], Map<string, Set<string>>>();
function destinationsFrom(schedule: ScheduledFlight[]) {
  let m = destinationsCache.get(schedule);
  if (!m) {
    m = new Map();
    for (const fl of schedule) {
      const set = m.get(fl.origin.iata_code);
      if (set) set.add(fl.destination.iata_code);
      else m.set(fl.origin.iata_code, new Set([fl.destination.iata_code]));
    }
    destinationsCache.set(schedule, m);
  }
  return m;
}

export function getRouteDemandAndFares(
  origin: Airport,
  destination: Airport,
  distanceNm: number,
  playerHubs: string[] = [],
  allSchedule: ScheduledFlight[] = []
) {
  const raw = marketDemand(origin.iata_code, destination.iata_code);
  const market = raw === null ? null : gameMarket(raw);
  const baseRawPax = market === null ? fallbackPax(origin, destination, distanceNm) : market * PLAYER_MARKET_SHARE;

  const kind = routeKind(origin.iata_code, destination.iata_code);
  const mix = classMix(distanceNm, kind);
  const cargoBase = cargoDemand(origin, destination, distanceNm);

  const origIsHub = playerHubs.includes(origin.iata_code);
  const destIsHub = playerHubs.includes(destination.iata_code);
  const isHubToHub = origIsHub && destIsHub;
  const hubBonusMult = isHubToHub ? 0.25 : 0;

  // Each distinct spoke reachable from a hub end of this route adds 3% (max 30%)
  let connectingFeedCount = 0;
  if (origIsHub || destIsHub) {
    const from = destinationsFrom(allSchedule);
    const spokes = new Set<string>();
    for (const hub of [origIsHub ? origin.iata_code : '', destIsHub ? destination.iata_code : ''])
      for (const spoke of from.get(hub) ?? []) if (spoke !== origin.iata_code && spoke !== destination.iata_code) spokes.add(spoke);
    connectingFeedCount = spokes.size;
  }
  const connectingBoostMult = Math.min(0.3, connectingFeedCount * 0.03);

  const totalMult = 1 + hubBonusMult + connectingBoostMult;
  const boostedTotalPax = baseRawPax * totalMult;

  return {
    isHubToHub,
    origIsHub,
    destIsHub,
    /** Everyone flying the route each day today, all airlines (null: not known). */
    marketPax: market === null ? null : Math.round(market),
    basePax: Math.round(baseRawPax),
    hubBonusPax: Math.round(baseRawPax * hubBonusMult),
    connectingPax: Math.round(baseRawPax * connectingBoostMult),
    hubBonusPct: Math.round(hubBonusMult * 100),
    connectingBoostPct: Math.round(connectingBoostMult * 100),
    /** Who flies it: 'business', 'leisure' or 'mixed'. */
    kind,
    dailyPax: {
      econ: Math.round(boostedTotalPax * mix.econ),
      prem: Math.round(boostedTotalPax * mix.prem),
      bus: Math.round(boostedTotalPax * mix.bus),
      first: Math.round(boostedTotalPax * mix.first),
      total: Math.round(boostedTotalPax),
    },
    /** Parcels and freight you can win a day, tonnes. */
    cargo: {
      parcels: Math.round(cargoBase.parcels * totalMult * 10) / 10,
      freight: Math.round(cargoBase.freight * totalMult * 10) / 10,
      direction: cargoBase.direction,
      hubs: cargoBase.hubs,
    },
    dailyCargoTons: Math.round((cargoBase.parcels + cargoBase.freight) * totalMult * 10) / 10,
    refFares: {
      econ: Math.round(45 + distanceNm * 0.14),
      prem: Math.round(85 + distanceNm * 0.24),
      bus: Math.round(190 + distanceNm * 0.52),
      first: Math.round(380 + distanceNm * 0.95),
      cargoPerTon: freightRate(distanceNm),
      parcelPerTon: parcelRate(distanceNm),
    } as Required<Fares>,
  };
}

/** Average daily seats/cargo the player flies on one directed route. */
export function calcRouteServedCapacity(
  originIata: string,
  destIata: string,
  allSchedule: ScheduledFlight[],
  fleet: PlayerAircraft[]
) {
  const byTail = new Map(fleet.map((a) => [a.tailNumber, a]));
  const totals = { econ: 0, prem: 0, bus: 0, first: 0, seats: 0, cargo: 0, freight: 0, flights: 0 };

  for (const fl of allSchedule) {
    if (fl.origin.iata_code !== originIata || fl.destination.iata_code !== destIata) continue;
    const ac = byTail.get(fl.tailNumber);
    if (!ac) continue;
    totals.flights++;
    const freq = daysOrAll(fl.daysOfWeek).filter(Boolean).length / 7;
    if (!ac.model.is_cargo) {
      totals.econ += ac.cabin.econSeats * freq;
      totals.prem += ac.cabin.premSeats * freq;
      totals.bus += ac.cabin.busSeats * freq;
      totals.first += ac.cabin.firstSeats * freq;
      totals.seats += cabinSeatTotal(ac.cabin) * freq;
    }
    const hold = holdTons(ac.model, fl.distanceNm);
    totals.cargo += hold * freq;
    totals.freight += hold * freightShare(ac.model) * freq;
  }

  return {
    flightCount: totals.flights,
    dailySeats: Math.round(totals.seats),
    /** Hold space a day, tonnes (parcels can use all of it). */
    dailyCargoTons: Math.round(totals.cargo * 10) / 10,
    /** The part of it that can take freight. */
    dailyFreightTons: Math.round(totals.freight * 10) / 10,
    byClass: {
      econ: Math.round(totals.econ),
      prem: Math.round(totals.prem),
      bus: Math.round(totals.bus),
      first: Math.round(totals.first),
    },
  };
}

// ----------------------------------------------------------------------------
// Per-flight economics
// ----------------------------------------------------------------------------
export interface FlightEconomics {
  sold: { econ: number; prem: number; bus: number; first: number };
  cap: { econ: number; prem: number; bus: number; first: number };
  /** Parcels and freight together. */
  soldCargoTons: number;
  /** Hold space on this flight, tonnes (less near the aircraft's full range). */
  maxCargoTons: number;
  cargoRevenue: number;
  soldParcelTons: number;
  soldFreightTons: number;
  parcelRevenue: number;
  freightRevenue: number;
  paxRevenue: number;
  isHubToHub: boolean;
  hubBonusPct: number;
  connectingBoostPct: number;
  isThroughFlight: boolean;
  throughBonusPct: number;
  /** Share of the route's daily demand this departure can capture (0..1). */
  demandShare: number;
  totalPax: number;
  totalCap: number;
  revenue: number;
  /** The five cost lines (see costs.ts); `cost` is their total. */
  costs: Omit<FlightCosts, 'total'>;
  cost: number;
  profit: number;
}

export interface EconomicsContext {
  hubs: string[];
  schedule: ScheduledFlight[];
  fleet: PlayerAircraft[];
}

/**
 * Share of travellers who still buy at a fare. Above the market fare fewer and
 * fewer do, and at three times it nobody does: a huge fare earns nothing.
 */
export const priceElasticity = (actual: number, ref: number) => {
  const r = Math.max(1, actual) / Math.max(1, ref);
  return Math.min(1, Math.pow(1 / r, 1.8)) * Math.max(0, 1 - Math.max(0, r - 1) / 2);
};
/** The highest fare the game accepts: five times the market fare. */
export const MAX_FARE_MULT = 5;

// ----------------------------------------------------------------------------
// How full a departure gets (v2.38+)
// ----------------------------------------------------------------------------
/** Share of a route's travellers who want this local departure hour (0..1). */
const HOUR_DEMAND = [0.45, 0.35, 0.3, 0.3, 0.4, 0.65, 0.85, 1, 1, 0.95, 0.85, 0.82, 0.82, 0.82, 0.85, 0.9, 0.95, 1, 1, 0.95, 0.85, 0.75, 0.62, 0.52];
/**
 * Relative demand by weekday (Mon..Sun). Most routes: Fridays and Sundays
 * busiest. Business routes: the working week, quiet Saturdays. Holiday
 * routes: the weekend.
 */
const DAY_DEMAND: Record<RouteKind, number[]> = {
  mixed: [0.97, 0.88, 0.88, 0.95, 1.06, 0.92, 1.04],
  business: [1.05, 0.96, 0.96, 1.02, 1.08, 0.7, 0.93],
  leisure: [0.9, 0.82, 0.82, 0.9, 1.04, 1.12, 1.1],
};
export const dayDemand = (kind: RouteKind = 'mixed') => DAY_DEMAND[kind];

function seeded(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10007) / 10007;
}

/**
 * How appealing a departure is: `demand` scales the travellers it can win
 * (local time of day, the weekdays it flies, and a little of its own luck),
 * `maxLoad` is the share of seats it fills even when the route has more than
 * enough travellers (88–97% across the week).
 */
export function flightAppeal(flight: Pick<ScheduledFlight, 'id' | 'depTimeMin' | 'daysOfWeek' | 'origin' | 'flightNumber'>, kind: RouteKind = 'mixed') {
  const localMin = (((flight.depTimeMin + Math.round((flight.origin.longitude_deg / 15) * 60)) % 1440) + 1440) % 1440;
  const h = Math.floor(localMin / 60);
  const frac = (localMin % 60) / 60;
  let hour = HOUR_DEMAND[h] * (1 - frac) + HOUR_DEMAND[(h + 1) % 24] * frac;
  // Holidaymakers mind the hour less than people with a meeting to get to
  if (kind === 'leisure') hour = 0.35 + 0.65 * hour;
  const days = daysOrAll(flight.daysOfWeek);
  const n = days.filter(Boolean).length || 7;
  const day = days.reduce((s, on, i) => s + (on ? DAY_DEMAND[kind][i] : 0), 0) / n;
  const luck = 0.9 + 0.12 * seeded(flight.flightNumber + flight.origin.iata_code);
  return { demand: hour * day * luck, maxLoad: 0.88 + 0.09 * seeded(flight.id + 'lf'), hour, luck, localMin };
}

/**
 * A "through" leg continues a chain A→B→C on the same aircraft within 4h of
 * landing at B. Simple out-and-back legs (A→B→A) do not qualify.
 */
const flightsByTailCache = new WeakMap<ScheduledFlight[], Map<string, ScheduledFlight[]>>();
export function isThroughFlight(flight: ScheduledFlight, aircraft: PlayerAircraft, schedule: ScheduledFlight[]) {
  const currDays = daysOrAll(flight.daysOfWeek);
  const turn = aircraft.model.turnaround_min;
  let byTail = flightsByTailCache.get(schedule);
  if (!byTail) {
    byTail = new Map();
    for (const fl of schedule) {
      const list = byTail.get(fl.tailNumber);
      if (list) list.push(fl);
      else byTail.set(fl.tailNumber, [fl]);
    }
    flightsByTailCache.set(schedule, byTail);
  }
  return (byTail.get(flight.tailNumber) ?? []).some((prev) => {
    if (prev.id === flight.id) return false;
    if (prev.destination.iata_code !== flight.origin.iata_code) return false;
    if (prev.origin.iata_code === flight.destination.iata_code) return false;
    const prevDays = daysOrAll(prev.daysOfWeek);
    if (!prevDays.some((d, i) => d && currDays[i])) return false;
    const groundMin = (((flight.depTimeMin - prev.arrTimeMin) % 1440) + 1440) % 1440;
    return groundMin >= turn && groundMin <= turn + 240;
  });
}

// ----------------------------------------------------------------------------
// What the airline offers on each route, day by day
// ----------------------------------------------------------------------------
const CLASSES: CabinClass[] = ['econ', 'prem', 'bus', 'first'];
interface RouteLoad {
  /** Seats offered on each weekday (Mon..Sun), by class. */
  seats: Record<CabinClass, number[]>;
  /** Hold space on each weekday, tonnes, and the part that takes freight. */
  hold: number[];
  freight: number[];
}
const week = () => [0, 0, 0, 0, 0, 0, 0];
const emptyLoad = (): RouteLoad => ({ seats: { econ: week(), prem: week(), bus: week(), first: week() }, hold: week(), freight: week() });
const routeLoadCache = new WeakMap<ScheduledFlight[], { fleet: PlayerAircraft[]; byRoute: Map<string, RouteLoad> }>();

/** Seats and hold space on every directed route, per weekday (worked out once per schedule). */
function routeLoads(ctx: EconomicsContext): Map<string, RouteLoad> {
  const hit = routeLoadCache.get(ctx.schedule);
  if (hit && hit.fleet === ctx.fleet) return hit.byRoute;
  const byTail = new Map(ctx.fleet.map((a) => [a.tailNumber, a]));
  const byRoute = new Map<string, RouteLoad>();
  for (const fl of ctx.schedule) {
    const ac = byTail.get(fl.tailNumber);
    if (!ac) continue;
    const key = `${fl.origin.iata_code}>${fl.destination.iata_code}`;
    let load = byRoute.get(key);
    if (!load) byRoute.set(key, (load = emptyLoad()));
    const hold = holdTons(ac.model, fl.distanceNm);
    const freight = hold * freightShare(ac.model);
    daysOrAll(fl.daysOfWeek).forEach((on, i) => {
      if (!on) return;
      if (!ac.model.is_cargo) for (const c of CLASSES) load.seats[c][i] += ac.cabin[`${c}Seats` as const];
      load.hold[i] += hold;
      load.freight[i] += freight;
    });
  }
  routeLoadCache.set(ctx.schedule, { fleet: ctx.fleet, byRoute });
  return byRoute;
}

/** Share of travellers who trade down when the class they wanted isn't offered that day. */
const TRADE_DOWN = 0.6;
const NEXT_DOWN: [CabinClass, CabinClass][] = [['first', 'bus'], ['bus', 'prem'], ['prem', 'econ']];

export function simulateFlightEconomics(
  flight: ScheduledFlight,
  aircraft: PlayerAircraft,
  ctx: EconomicsContext
): FlightEconomics {
  const { origin, destination, distanceNm, blockTimeMin, fares } = flight;
  const demand = getRouteDemandAndFares(origin, destination, distanceNm, ctx.hubs, ctx.schedule);
  const isCargoPlane = aircraft.model.is_cargo;

  const through = isThroughFlight(flight, aircraft, ctx.schedule);
  const throughMult = through ? 1.15 : 1;

  // Several of your flights on the same route share its demand, day by day,
  // in proportion to what each one brings on that day.
  const load = routeLoads(ctx).get(`${origin.iata_code}>${destination.iata_code}`) ?? emptyLoad();
  const days = daysOrAll(flight.daysOfWeek);
  const flown = days.filter(Boolean).length || 7;
  const share = (mine: number, offered: number) => (mine > 0 ? mine / Math.max(mine, offered) : 0);

  // Not every departure fills: time of day, the days it flies and the flight
  // itself make some flights busier than others, and even a sold-out route
  // averages a few empty seats across the week.
  const appeal = flightAppeal(flight, demand.kind);
  const dayPax = dayDemand(demand.kind);
  const mySeats = (c: CabinClass) => (isCargoPlane ? 0 : aircraft.cabin[`${c}Seats` as const]);
  const wanted: Record<CabinClass, number> = { econ: 0, prem: 0, bus: 0, first: 0 };
  if (!isCargoPlane) {
    days.forEach((on, i) => {
      if (!on && flown < 7) return;
      // A class nobody offers that day: most of its travellers buy the next one down
      const want = { econ: demand.dailyPax.econ, prem: demand.dailyPax.prem, bus: demand.dailyPax.bus, first: demand.dailyPax.first };
      for (const [from, to] of NEXT_DOWN)
        if (load.seats[from][i] <= 0 && mySeats(from) <= 0 && want[from] > 0) {
          want[to] += want[from] * TRADE_DOWN;
          want[from] = 0;
        }
      for (const c of CLASSES) wanted[c] += (dayPax[i] * want[c] * share(mySeats(c), load.seats[c][i])) / flown;
    });
  }
  const sell = (cls: CabinClass) =>
    isCargoPlane
      ? 0
      : Math.min(
          Math.floor(mySeats(cls) * appeal.maxLoad),
          Math.round(wanted[cls] * throughMult * appeal.hour * appeal.luck * priceElasticity(fares[cls], demand.refFares[cls] * seatComfort(aircraft.cabin, cls, blockTimeMin)))
        );
  const sold = { econ: sell('econ'), prem: sell('prem'), bus: sell('bus'), first: sell('first') };
  const cap = { econ: mySeats('econ'), prem: mySeats('prem'), bus: mySeats('bus'), first: mySeats('first') };
  const mySeatTotal = cap.econ + cap.prem + cap.bus + cap.first;
  let paxShare = 1;
  if (mySeatTotal > 0) {
    let s = 0;
    days.forEach((on, i) => {
      if (on || flown === 7) s += share(mySeatTotal, CLASSES.reduce((t, c) => t + load.seats[c][i], 0)) / flown;
    });
    paxShare = Math.min(1, s);
  }

  // The hold: parcels first (they pay about twice as much), then freight in
  // what is left, as far as this kind of hold can take it.
  const hold = holdTons(aircraft.model, distanceNm);
  const freightCap = hold * freightShare(aircraft.model);
  let parcelsWanted = 0;
  let freightWanted = 0;
  days.forEach((on, i) => {
    if (!on && flown < 7) return;
    parcelsWanted += (PARCEL_DAY[i] * demand.cargo.parcels * share(hold, load.hold[i])) / flown;
    freightWanted += (FREIGHT_DAY[i] * demand.cargo.freight * share(freightCap, load.freight[i])) / flown;
  });
  const parcelFare = fares.parcelPerTon || demand.refFares.parcelPerTon;
  const cargoFare = fares.cargoPerTon || demand.refFares.cargoPerTon;
  const soldParcelTons =
    Math.round(Math.min(hold, parcelsWanted * throughMult * parcelHourAppeal(appeal.localMin) * priceElasticity(parcelFare, demand.refFares.parcelPerTon)) * 10) / 10;
  const soldFreightTons =
    Math.round(Math.max(0, Math.min(hold - soldParcelTons, freightCap, freightWanted * throughMult * priceElasticity(cargoFare, demand.refFares.cargoPerTon))) * 10) / 10;
  const parcelRevenue = Math.round(soldParcelTons * parcelFare);
  const freightRevenue = Math.round(soldFreightTons * cargoFare);

  const paxRevenue =
    sold.econ * fares.econ + sold.prem * fares.prem + sold.bus * fares.bus + sold.first * fares.first;
  const cargoRevenue = parcelRevenue + freightRevenue;
  const revenue = paxRevenue + cargoRevenue;

  const costs = flightCosts(aircraft.model, { blockMin: blockTimeMin, seatsFitted: mySeatTotal, cargoTons: soldParcelTons + soldFreightTons, ticketRevenue: paxRevenue, crewShare: crewShareOf(aircraft) });
  const cost = costs.total;

  return {
    sold,
    cap,
    soldCargoTons: Math.round((soldParcelTons + soldFreightTons) * 10) / 10,
    maxCargoTons: hold,
    cargoRevenue,
    soldParcelTons,
    soldFreightTons,
    parcelRevenue,
    freightRevenue,
    paxRevenue: Math.round(paxRevenue),
    isHubToHub: demand.isHubToHub,
    hubBonusPct: demand.hubBonusPct,
    connectingBoostPct: demand.connectingBoostPct,
    isThroughFlight: through,
    throughBonusPct: through ? 15 : 0,
    demandShare: paxShare,
    totalPax: sold.econ + sold.prem + sold.bus + sold.first,
    totalCap: mySeatTotal,
    revenue: Math.round(revenue),
    costs: { fuel: costs.fuel, crew: costs.crew, maintenance: costs.maintenance, airport: costs.airport, service: costs.service },
    cost,
    profit: Math.round(revenue - cost),
  };
}

/** Economics for every scheduled flight (computed once per schedule change). */
export function computeNetworkEconomics(ctx: EconomicsContext): Map<string, FlightEconomics> {
  const byTail = new Map(ctx.fleet.map((a) => [a.tailNumber, a]));
  const out = new Map<string, FlightEconomics>();
  for (const fl of ctx.schedule) {
    const ac = byTail.get(fl.tailNumber);
    if (ac) out.set(fl.id, simulateFlightEconomics(fl, ac, ctx));
  }
  return out;
}
