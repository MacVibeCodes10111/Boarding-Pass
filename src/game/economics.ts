// ============================================================================
// CABIN LAYOUT, PASSENGER + CARGO DEMAND & FLIGHT ECONOMICS
// ============================================================================
import { gameMarket, marketDemand, PLAYER_MARKET_SHARE } from './demand';
import { daysOrAll } from './time';
import type { AircraftModel, Airport, CabinConfig, Fares, PlayerAircraft, ScheduledFlight } from './types';

// ----------------------------------------------------------------------------
// Cabin configuration
// ----------------------------------------------------------------------------
const DEFAULT_PITCH = { econPitchIn: 30, premPitchIn: 36, busPitchIn: 48, firstPitchIn: 62 };

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
  if (preset === 'dense') while (fits(econ + 1)) econ += 1;
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

  const cargoWeight = (ap: Airport) =>
    ap.demand_weight * 0.16 + (ap.runway_count || 1) * 4.5 + (ap.max_runway_length_ft >= 9000 ? 12 : 4);
  const baseRawCargoTons =
    (0.85 * cargoWeight(origin) * cargoWeight(destination)) / Math.pow(Math.max(90, distanceNm), 0.65);

  const origIsHub = playerHubs.includes(origin.iata_code);
  const destIsHub = playerHubs.includes(destination.iata_code);
  const isHubToHub = origIsHub && destIsHub;
  const hubBonusMult = isHubToHub ? 0.25 : 0;

  // Each distinct spoke reachable from a hub end of this route adds 3% (max 30%)
  let connectingFeedCount = 0;
  if (origIsHub || destIsHub) {
    const spokes = new Set<string>();
    for (const fl of allSchedule) {
      const fromHubEnd =
        (origIsHub && fl.origin.iata_code === origin.iata_code) ||
        (destIsHub && fl.origin.iata_code === destination.iata_code);
      const spoke = fl.destination.iata_code;
      if (fromHubEnd && spoke !== origin.iata_code && spoke !== destination.iata_code) spokes.add(spoke);
    }
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
    dailyPax: {
      econ: Math.round(boostedTotalPax * 0.76),
      prem: Math.round(boostedTotalPax * 0.12),
      bus: Math.round(boostedTotalPax * 0.09),
      first: Math.round(boostedTotalPax * 0.03),
      total: Math.round(boostedTotalPax),
    },
    dailyCargoTons: Math.max(1.5, Math.round(baseRawCargoTons * totalMult * 10) / 10),
    refFares: {
      econ: Math.round(45 + distanceNm * 0.14),
      prem: Math.round(85 + distanceNm * 0.24),
      bus: Math.round(190 + distanceNm * 0.52),
      first: Math.round(380 + distanceNm * 0.95),
      cargoPerTon: Math.round(220 + distanceNm * 0.42),
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
  const totals = { econ: 0, prem: 0, bus: 0, first: 0, seats: 0, cargo: 0, flights: 0 };

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
    totals.cargo += (ac.model.cargo_cap_tons || 0) * freq;
  }

  return {
    flightCount: totals.flights,
    dailySeats: Math.round(totals.seats),
    dailyCargoTons: Math.round(totals.cargo * 10) / 10,
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
  soldCargoTons: number;
  maxCargoTons: number;
  cargoRevenue: number;
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
/** Relative demand by weekday (Mon..Sun): Fridays and Sundays busiest. */
const DAY_DEMAND = [0.97, 0.88, 0.88, 0.95, 1.06, 0.92, 1.04];

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
export function flightAppeal(flight: Pick<ScheduledFlight, 'id' | 'depTimeMin' | 'daysOfWeek' | 'origin' | 'flightNumber'>) {
  const localMin = (((flight.depTimeMin + Math.round((flight.origin.longitude_deg / 15) * 60)) % 1440) + 1440) % 1440;
  const h = Math.floor(localMin / 60);
  const frac = (localMin % 60) / 60;
  const hour = HOUR_DEMAND[h] * (1 - frac) + HOUR_DEMAND[(h + 1) % 24] * frac;
  const days = daysOrAll(flight.daysOfWeek);
  const n = days.filter(Boolean).length || 7;
  const day = days.reduce((s, on, i) => s + (on ? DAY_DEMAND[i] : 0), 0) / n;
  const luck = seeded(flight.flightNumber + flight.origin.iata_code);
  return { demand: hour * day * (0.9 + 0.12 * luck), maxLoad: 0.88 + 0.09 * seeded(flight.id + 'lf'), hour };
}

/**
 * A "through" leg continues a chain A→B→C on the same aircraft within 4h of
 * landing at B. Simple out-and-back legs (A→B→A) do not qualify.
 */
export function isThroughFlight(flight: ScheduledFlight, aircraft: PlayerAircraft, schedule: ScheduledFlight[]) {
  const currDays = daysOrAll(flight.daysOfWeek);
  const turn = aircraft.model.turnaround_min;
  return schedule.some((prev) => {
    if (prev.id === flight.id || prev.tailNumber !== flight.tailNumber) return false;
    if (prev.destination.iata_code !== flight.origin.iata_code) return false;
    if (prev.origin.iata_code === flight.destination.iata_code) return false;
    const prevDays = daysOrAll(prev.daysOfWeek);
    if (!prevDays.some((d, i) => d && currDays[i])) return false;
    const groundMin = (((flight.depTimeMin - prev.arrTimeMin) % 1440) + 1440) % 1440;
    return groundMin >= turn && groundMin <= turn + 240;
  });
}

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

  // Several of your flights on the same route share its daily demand
  // in proportion to the capacity each one brings.
  const served = calcRouteServedCapacity(origin.iata_code, destination.iata_code, ctx.schedule, ctx.fleet);
  const mySeats = isCargoPlane ? 0 : cabinSeatTotal(aircraft.cabin);
  const paxShare = mySeats > 0 && served.dailySeats > 0 ? Math.min(1, mySeats / served.dailySeats) : 1;
  const myCargo = aircraft.model.cargo_cap_tons || 0;
  const cargoShare = myCargo > 0 && served.dailyCargoTons > 0 ? Math.min(1, myCargo / served.dailyCargoTons) : 1;

  // Not every departure fills: time of day, the days it flies and the flight
  // itself make some flights busier than others, and even a sold-out route
  // averages a few empty seats across the week.
  const appeal = flightAppeal(flight);
  const sell = (cls: 'econ' | 'prem' | 'bus' | 'first') =>
    isCargoPlane
      ? 0
      : Math.min(
          Math.floor(aircraft.cabin[`${cls}Seats` as const] * appeal.maxLoad),
          Math.round(demand.dailyPax[cls] * throughMult * paxShare * appeal.demand * priceElasticity(fares[cls], demand.refFares[cls]))
        );
  const sold = { econ: sell('econ'), prem: sell('prem'), bus: sell('bus'), first: sell('first') };
  const cap = isCargoPlane
    ? { econ: 0, prem: 0, bus: 0, first: 0 }
    : {
        econ: aircraft.cabin.econSeats,
        prem: aircraft.cabin.premSeats,
        bus: aircraft.cabin.busSeats,
        first: aircraft.cabin.firstSeats,
      };

  const cargoFare = fares.cargoPerTon || demand.refFares.cargoPerTon;
  const effCargoTons = demand.dailyCargoTons * throughMult * cargoShare;
  const soldCargoTons =
    Math.round(Math.min(myCargo, effCargoTons * priceElasticity(cargoFare, demand.refFares.cargoPerTon)) * 10) / 10;

  const paxRevenue =
    sold.econ * fares.econ + sold.prem * fares.prem + sold.bus * fares.bus + sold.first * fares.first;
  const cargoRevenue = Math.round(soldCargoTons * cargoFare);
  const revenue = paxRevenue + cargoRevenue;

  const flightHours = blockTimeMin / 60;
  const fuelCost = flightHours * aircraft.model.fuel_burn_kg_hr * 0.82;
  const landingFee = (aircraft.model.mtow_kg / 1000) * 14.5;
  const maintCrewCost = flightHours * Math.max(45, aircraft.model.typical_seats || myCargo * 3) * 4.2;
  const cost = Math.round(fuelCost + landingFee + maintCrewCost);

  return {
    sold,
    cap,
    soldCargoTons,
    maxCargoTons: myCargo,
    cargoRevenue,
    paxRevenue: Math.round(paxRevenue),
    isHubToHub: demand.isHubToHub,
    hubBonusPct: demand.hubBonusPct,
    connectingBoostPct: demand.connectingBoostPct,
    isThroughFlight: through,
    throughBonusPct: through ? 15 : 0,
    demandShare: paxShare,
    totalPax: sold.econ + sold.prem + sold.bus + sold.first,
    totalCap: cap.econ + cap.prem + cap.bus + cap.first,
    revenue: Math.round(revenue),
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
