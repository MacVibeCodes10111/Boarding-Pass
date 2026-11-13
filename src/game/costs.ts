// ============================================================================
// WHAT A FLIGHT COSTS
//
// Five lines, each shown to the player by name:
//   Fuel               block hours × the type's fuel burn
//   Crew               pilots by the hour (bigger aircraft pay more), plus one
//                      flight attendant per 50 seats fitted
//   Maintenance        by the hour and by the flight, per tonne of aircraft,
//                      times an age factor: older designs (cheap for their
//                      size) cost more to keep flying
//   Airport fees       landing fees per tonne, plus handling per tonne of cargo
//   Passenger service  a share of ticket money (catering, booking, card fees)
// ============================================================================
import type { AircraftCategory, AircraftModel } from './types';

export const COST = {
  fuel: 1.0, // × hours × model fuel burn
  cabinCrew: 90, // $ per block hour per flight attendant; one per 50 seats fitted, rounded up
  maintHour: 10, // $ per block hour per MTOW tonne
  maintCycle: 8, // $ per flight per MTOW tonne
  ageRef: 1.25, // $M of list price per MTOW tonne at which the age factor is 1
  ageMin: 0.85,
  ageMax: 2.0,
  landing: 18, // $ per flight per MTOW tonne
  cargoHandling: 40, // $ per tonne of cargo carried
  paxService: 0.15, // share of ticket revenue
};
/** Pilots, $ per block hour for the whole flight deck. */
export const PILOTS: Record<AircraftCategory, number> = { turboprop: 460, regional_jet: 650, narrowbody: 1000, widebody: 1350, heavy_widebody: 1650 };
export const COMMUTER_PILOTS = 110;

type CostModel = Pick<AircraftModel, 'is_cargo' | 'typical_seats' | 'mtow_kg' | 'base_price_usd' | 'fuel_burn_kg_hr' | 'category'>;

export interface FlightCosts {
  fuel: number;
  crew: number;
  maintenance: number;
  airport: number;
  service: number;
  total: number;
}
export type CostLine = Exclude<keyof FlightCosts, 'total'>;
export const COST_LINES: { key: CostLine; label: string }[] = [
  { key: 'fuel', label: 'Fuel' },
  { key: 'crew', label: 'Crew' },
  { key: 'maintenance', label: 'Maintenance' },
  { key: 'airport', label: 'Airport fees' },
  { key: 'service', label: 'Passenger service' },
];

/** Small commuter aircraft: one or two pilots, no cabin crew, no age factor. */
export const isCommuter = (m: CostModel) => (!m.is_cargo && m.typical_seats <= 19) || (m.is_cargo && m.mtow_kg / 1000 < 9);

/** How much more (above 1) or less this type costs to maintain than a current design of its size. */
export function ageFactor(m: CostModel): number {
  if (isCommuter(m)) return 1;
  const t = m.mtow_kg / 1000;
  const priceM = m.base_price_usd / 1e6;
  if (!(t > 0) || !(priceM > 0)) return COST.ageMax;
  return Math.min(COST.ageMax, Math.max(COST.ageMin, COST.ageRef / (priceM / t)));
}

/** The five costs of one flight, whole dollars. */
export function flightCosts(m: CostModel, f: { blockMin: number; seatsFitted: number; cargoTons: number; ticketRevenue: number }): FlightCosts {
  const h = Math.max(0, f.blockMin) / 60;
  const t = m.mtow_kg / 1000;
  const commuter = isCommuter(m);
  const fuel = Math.round(h * m.fuel_burn_kg_hr * COST.fuel);
  const attendants = commuter || m.is_cargo ? 0 : Math.ceil(Math.max(0, f.seatsFitted) / 50);
  const crew = Math.round(h * ((commuter ? COMMUTER_PILOTS : PILOTS[m.category] ?? PILOTS.narrowbody) + attendants * COST.cabinCrew));
  const maintenance = Math.round((h * t * COST.maintHour + t * COST.maintCycle) * ageFactor(m));
  const airport = Math.round(t * COST.landing + Math.max(0, f.cargoTons) * COST.cargoHandling);
  const service = Math.round(COST.paxService * Math.max(0, f.ticketRevenue));
  return { fuel, crew, maintenance, airport, service, total: fuel + crew + maintenance + airport + service };
}
