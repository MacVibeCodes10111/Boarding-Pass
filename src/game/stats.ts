// ============================================================================
// YOUR AIRLINE IN NUMBERS
//   Everything the Stats page shows, worked out from the schedule as it stands
//   (one scheduled week) plus the economy's closed weeks. Pure functions, no UI.
// ============================================================================
import { ledgerCashFlow, ledgerNet, type WeekLedger } from './clock';
import type { FlightEconomics } from './economics';
import { calcAircraftScheduleUsage } from './scheduling';
import { daysOrAll } from './time';
import type { Airport, PlayerAircraft, ScheduledFlight } from './types';

export interface Slice {
  label: string;
  value: number;
}

export interface RouteStat {
  /** "BOS–LAX" (alphabetical pair, both directions together). */
  label: string;
  a: string;
  b: string;
  distanceNm: number;
  departures: number;
  pax: number;
  seats: number;
  revenue: number;
  profit: number;
}

export interface AirlineStats {
  // Headline numbers for one scheduled week
  fleet: number;
  owned: number;
  leased: number;
  routes: number;
  destinations: number;
  countries: number;
  continents: number;
  departures: number;
  pax: number;
  seats: number;
  loadFactorPct: number;
  cargoTons: number;
  revenue: number;
  paxRevenue: number;
  cargoRevenue: number;
  cost: number;
  profit: number;
  /** Seat-nautical-miles offered and flown (ASM/RPM in nm). */
  seatNm: number;
  paxNm: number;
  /** Distance flown by the whole fleet. */
  nmFlown: number;
  blockHours: number;
  /** Fleet average share of the week in use (flying + turnarounds), percent. */
  avgUtilisationPct: number;
  // Breakdowns
  fleetByFamily: Slice[];
  fleetByManufacturer: Slice[];
  departuresByHub: Slice[];
  seatsByCabin: Slice[];
  routesByLength: Slice[];
  topRoutes: RouteStat[];
  worstRoutes: RouteStat[];
  utilisation: { tail: string; model: string; usedPct: number; hoursPerDay: number }[];
  weekly: { week: number; net: number; cashFlow: number; partial: boolean }[];
  // Records
  longestRoute: RouteStat | null;
  busiestRoute: RouteStat | null;
  busiestAirport: { iata: string; city: string; departures: number } | null;
  biggestAircraft: { tail: string; model: string; seats: number } | null;
  bestWeek: { week: number; net: number } | null;
}

/** Folds everything after the first `keep` slices (largest first) into "Other". */
export function topSlices(map: Map<string, number>, keep = 6): Slice[] {
  const all = [...map.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const out: Slice[] = all.slice(0, keep).map(([label, value]) => ({ label, value }));
  const rest = all.slice(keep).reduce((s, [, v]) => s + v, 0);
  if (rest > 0) out.push({ label: 'Other', value: rest });
  return out;
}

const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);

export function computeAirlineStats(args: {
  fleet: PlayerAircraft[];
  schedule: ScheduledFlight[];
  econById: Map<string, FlightEconomics>;
  hubs: string[];
  airportByIata: Map<string, Airport>;
  ledgerHistory: WeekLedger[];
  current: WeekLedger | null;
}): AirlineStats {
  const { fleet, schedule, econById, hubs, airportByIata, ledgerHistory, current } = args;
  const routes = new Map<string, RouteStat>();
  const airports = new Set<string>();
  const depsByAirport = new Map<string, number>();
  const depsByHub = new Map<string, number>();
  let departures = 0, pax = 0, seats = 0, cargoTons = 0, revenue = 0, paxRevenue = 0, cargoRevenue = 0, cost = 0;
  let seatNm = 0, paxNm = 0, nmFlown = 0, blockMin = 0;
  const cabinSeats = { econ: 0, prem: 0, bus: 0, first: 0 };

  for (const fl of schedule) {
    const n = daysOrAll(fl.daysOfWeek).filter(Boolean).length;
    if (!n) continue;
    const e = econById.get(fl.id);
    departures += n;
    nmFlown += fl.distanceNm * n;
    blockMin += fl.blockTimeMin * n;
    airports.add(fl.origin.iata_code);
    airports.add(fl.destination.iata_code);
    add(depsByAirport, fl.origin.iata_code, n);
    add(depsByHub, hubs.includes(fl.origin.iata_code) ? fl.origin.iata_code : 'Outstations', n);
    const [a, b] = [fl.origin.iata_code, fl.destination.iata_code].sort();
    const key = `${a}–${b}`;
    const r = routes.get(key) ?? { label: key, a, b, distanceNm: fl.distanceNm, departures: 0, pax: 0, seats: 0, revenue: 0, profit: 0 };
    r.departures += n;
    if (e) {
      pax += e.totalPax * n;
      seats += e.totalCap * n;
      cargoTons += e.soldCargoTons * n;
      revenue += e.revenue * n;
      paxRevenue += e.paxRevenue * n;
      cargoRevenue += e.cargoRevenue * n;
      cost += e.cost * n;
      seatNm += e.totalCap * fl.distanceNm * n;
      paxNm += e.totalPax * fl.distanceNm * n;
      cabinSeats.econ += e.cap.econ * n;
      cabinSeats.prem += e.cap.prem * n;
      cabinSeats.bus += e.cap.bus * n;
      cabinSeats.first += e.cap.first * n;
      r.pax += e.totalPax * n;
      r.seats += e.totalCap * n;
      r.revenue += e.revenue * n;
      r.profit += e.profit * n;
    }
    routes.set(key, r);
  }

  const countries = new Set<string>();
  const continents = new Set<string>();
  for (const iata of airports) {
    const ap = airportByIata.get(iata);
    if (ap?.iso_country) countries.add(ap.iso_country);
    if (ap?.continent) continents.add(ap.continent);
  }

  const famMap = new Map<string, number>();
  const manMap = new Map<string, number>();
  for (const ac of fleet) {
    add(famMap, ac.model.family || ac.model.name, 1);
    add(manMap, ac.model.manufacturer || ac.model.name.split(' ')[0], 1);
  }

  const lenMap = new Map<string, number>([
    ['Short (under 500 nm)', 0],
    ['Medium (500–1,500 nm)', 0],
    ['Long (1,500–4,000 nm)', 0],
    ['Ultra long (4,000+ nm)', 0],
  ]);
  for (const r of routes.values()) {
    const k = r.distanceNm < 500 ? 'Short (under 500 nm)' : r.distanceNm < 1500 ? 'Medium (500–1,500 nm)' : r.distanceNm < 4000 ? 'Long (1,500–4,000 nm)' : 'Ultra long (4,000+ nm)';
    add(lenMap, k, 1);
  }

  const routeList = [...routes.values()];
  const byProfit = [...routeList].sort((x, y) => y.profit - x.profit);
  const utilisation = fleet
    .map((ac) => {
      const u = calcAircraftScheduleUsage(ac, schedule);
      return { tail: ac.tailNumber, model: ac.model.name, usedPct: u.usedPct, hoursPerDay: u.avgDailyHours };
    })
    .sort((x, y) => y.usedPct - x.usedPct || x.tail.localeCompare(y.tail));

  let busiestAirport: AirlineStats['busiestAirport'] = null;
  for (const [iata, d] of depsByAirport) if (!busiestAirport || d > busiestAirport.departures) busiestAirport = { iata, city: airportByIata.get(iata)?.municipality ?? '', departures: d };

  let biggest: AirlineStats['biggestAircraft'] = null;
  for (const ac of fleet) {
    const s = ac.cabin ? ac.cabin.econSeats + ac.cabin.premSeats + ac.cabin.busSeats + ac.cabin.firstSeats : ac.model.typical_seats;
    if (!biggest || s > biggest.seats) biggest = { tail: ac.tailNumber, model: ac.model.name, seats: s };
  }

  const weekly = [
    ...ledgerHistory.slice(-11).map((w) => ({ week: w.week, net: ledgerNet(w), cashFlow: ledgerCashFlow(w), partial: false })),
    ...(current ? [{ week: current.week, net: ledgerNet(current), cashFlow: ledgerCashFlow(current), partial: true }] : []),
  ];
  let bestWeek: AirlineStats['bestWeek'] = null;
  for (const w of ledgerHistory) if (!bestWeek || ledgerNet(w) > bestWeek.net) bestWeek = { week: w.week, net: ledgerNet(w) };

  const usedTotal = utilisation.reduce((s, u) => s + u.usedPct, 0);
  return {
    fleet: fleet.length,
    owned: fleet.filter((a) => a.acquisition === 'owned').length,
    leased: fleet.filter((a) => a.acquisition === 'leased').length,
    routes: routes.size,
    destinations: airports.size,
    countries: countries.size,
    continents: continents.size,
    departures,
    pax,
    seats,
    loadFactorPct: seats > 0 ? Math.round((pax / seats) * 100) : 0,
    cargoTons: Math.round(cargoTons * 10) / 10,
    revenue,
    paxRevenue,
    cargoRevenue,
    cost,
    profit: revenue - cost,
    seatNm,
    paxNm,
    nmFlown,
    blockHours: Math.round(blockMin / 60),
    avgUtilisationPct: utilisation.length ? Math.round(usedTotal / utilisation.length) : 0,
    fleetByFamily: topSlices(famMap, 6),
    fleetByManufacturer: topSlices(manMap, 6),
    departuresByHub: topSlices(depsByHub, 6),
    seatsByCabin: [
      { label: 'Economy', value: cabinSeats.econ },
      { label: 'Premium economy', value: cabinSeats.prem },
      { label: 'Business', value: cabinSeats.bus },
      { label: 'First', value: cabinSeats.first },
    ].filter((x) => x.value > 0),
    routesByLength: [...lenMap.entries()].map(([label, value]) => ({ label, value })).filter((x) => x.value > 0),
    topRoutes: byProfit.slice(0, 8),
    worstRoutes: byProfit.filter((r) => r.profit < 0).slice(-5).reverse(),
    utilisation,
    weekly,
    longestRoute: routeList.reduce<RouteStat | null>((m, r) => (!m || r.distanceNm > m.distanceNm ? r : m), null),
    busiestRoute: routeList.reduce<RouteStat | null>((m, r) => (!m || r.pax > m.pax ? r : m), null),
    busiestAirport,
    biggestAircraft: biggest,
    bestWeek,
  };
}
