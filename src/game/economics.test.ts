// The passenger and cargo model: class mix, seat comfort, how several flights
// share a route, and the two kinds of cargo.
import { beforeAll, describe, expect, it } from 'vitest';
import { AIRCRAFT_BY_ID } from './aircraftCatalog';
import { cargoDemand, freightShare, holdTons } from './cargo';
import { parseOurAirportsCsvFiles } from './csv';
import { airlineAirportPositions, applyNetworkWeights, parseNetwork, routeKind, setNetwork } from './demand';
import { buildCabinPreset, classMix, getRouteDemandAndFares, seatComfort, simulateFlightEconomics } from './economics';
import { calcBlockTimeMin, calcDistanceNm } from './geo';
import type { Fares, PlayerAircraft, ScheduledFlight } from './types';
import airportsCsv from '../../public/data/airports.csv?raw';
import networkJson from '../../public/data/network.json?raw';
import runwaysCsv from '../../public/data/runways.csv?raw';

const net = parseNetwork(JSON.parse(networkJson));
const AIRPORTS = new Map(applyNetworkWeights(parseOurAirportsCsvFiles(airportsCsv, runwaysCsv, airlineAirportPositions(net)), net).map((a) => [a.iata_code, a]));

const ap = (c: string) => {
  const a = AIRPORTS.get(c);
  if (!a) throw new Error(`no airport ${c}`);
  return a;
};
const plane = (id: string, tail = 'T1', preset: 'standard' | 'dense' | 'premium' = 'standard'): PlayerAircraft => {
  const model = AIRCRAFT_BY_ID.get(id)!;
  return { tailNumber: tail, model, cabin: buildCabinPreset(model, preset) } as PlayerAircraft;
};
const ALL = [true, true, true, true, true, true, true];
const flight = (ac: PlayerAircraft, o: string, d: string, id: string, days = ALL, depTimeMin = 600, fares?: Partial<Fares>): ScheduledFlight => {
  const A = ap(o);
  const B = ap(d);
  const nm = calcDistanceNm(A, B);
  const block = calcBlockTimeMin(nm, ac.model.cruise_speed_kts);
  const ref = getRouteDemandAndFares(A, B, nm).refFares;
  return { id, flightNumber: `ZZ${id}`, tailNumber: ac.tailNumber, origin: A, destination: B, distanceNm: nm, depTimeMin, arrTimeMin: depTimeMin + block, blockTimeMin: block, daysOfWeek: days, fares: fares ? ({ ...ref, ...fares } as Fares) : ref } as ScheduledFlight;
};
const run = (fl: ScheduledFlight, fleet: PlayerAircraft[], schedule: ScheduledFlight[]) => simulateFlightEconomics(fl, fleet.find((a) => a.tailNumber === fl.tailNumber)!, { hubs: [], schedule, fleet });

beforeAll(() => setNetwork(net));

describe('who flies a route', () => {
  it('splits travellers by class, more at the front on long and business routes', () => {
    for (const nm of [100, 800, 3000, 7000])
      for (const kind of ['mixed', 'business', 'leisure'] as const) {
        const m = classMix(nm, kind);
        expect(m.econ + m.prem + m.bus + m.first).toBeCloseTo(1, 6);
        for (const v of Object.values(m)) expect(v).toBeGreaterThan(0);
      }
    expect(classMix(200).econ).toBeGreaterThan(0.85);
    expect(classMix(5000).first).toBeGreaterThan(classMix(500).first * 3);
    expect(classMix(3000, 'business').bus).toBeGreaterThan(classMix(3000, 'leisure').bus * 2);
  });

  it('tells holiday routes from business ones', () => {
    expect(routeKind('JFK', 'LHR')).toBe('business');
    expect(routeKind('LHR', 'PMI')).toBe('leisure');
    expect(routeKind('XXX', 'LHR')).toBe('mixed');
  });
});

describe('seat comfort', () => {
  const cabin = buildCabinPreset(AIRCRAFT_BY_ID.get('b777-300er')!, 'standard');
  it('leaves the usual seats at the market fare', () => {
    for (const c of ['econ', 'prem', 'bus', 'first'] as const) expect(seatComfort(cabin, c, 600)).toBe(1);
  });
  it('is worth more with more room, most of all on long flights', () => {
    const roomy = { ...cabin, econPitchIn: 34, busPitchIn: 78 };
    const tight = { ...cabin, econPitchIn: 28 };
    expect(seatComfort(roomy, 'econ', 600)).toBeGreaterThan(1.08);
    expect(seatComfort(roomy, 'econ', 60)).toBeLessThan(seatComfort(roomy, 'econ', 600));
    expect(seatComfort(roomy, 'bus', 600)).toBeGreaterThan(1.25);
    expect(seatComfort(tight, 'econ', 600)).toBeLessThan(0.97);
    expect(seatComfort({ ...cabin, econPitchIn: 500 }, 'econ', 600)).toBeLessThanOrEqual(1.4);
    expect(seatComfort({ ...cabin, econPitchIn: NaN }, 'econ', 600)).toBe(1);
  });
  it('lets a roomy cabin charge more without losing travellers', () => {
    const ac = plane('b777-300er');
    const roomy = { ...ac, cabin: { ...ac.cabin, busPitchIn: 78 } } as PlayerAircraft;
    const ref = getRouteDemandAndFares(ap('JFK'), ap('LHR'), calcDistanceNm(ap('JFK'), ap('LHR'))).refFares;
    const dear = { bus: Math.round(ref.bus * 2.2) };
    const a = flight(ac, 'JFK', 'LHR', 'A', ALL, 1380, dear);
    const b = flight(roomy, 'JFK', 'LHR', 'A', ALL, 1380, dear);
    expect(run(b, [roomy], [b]).sold.bus).toBeGreaterThan(run(a, [ac], [a]).sold.bus);
  });
});

describe('several flights on one route', () => {
  it('share the travellers of the days they both fly, not of the whole week', () => {
    const a = plane('a320neo', 'T1');
    const b = plane('a320neo', 'T2');
    const weekdays = [true, true, true, true, true, false, false];
    const weekend = [false, false, false, false, false, true, true];
    // a thin route, so demand (not seats) decides
    const alone = flight(a, 'BOS', 'BTV', 'A', weekdays);
    const soldAlone = run(alone, [a, b], [alone]).totalPax;
    const other = flight(b, 'BOS', 'BTV', 'B', weekend);
    expect(run(alone, [a, b], [alone, other]).totalPax).toBe(soldAlone);
    const clash = flight(b, 'BOS', 'BTV', 'B', weekdays);
    expect(run(alone, [a, b], [alone, clash]).totalPax).toBeLessThan(soldAlone);
  });

  it('sells economy seats to people who wanted a class nobody offers', () => {
    const dense = plane('a320neo', 'T1', 'dense');
    const fl = flight(dense, 'BOS', 'BTV', 'A');
    const demand = getRouteDemandAndFares(fl.origin, fl.destination, fl.distanceNm);
    const e = run(fl, [dense], [fl]);
    expect(e.cap.bus).toBe(0);
    expect(e.sold.econ).toBeLessThanOrEqual(Math.floor(e.cap.econ * 0.97));
    // more than its share of the economy travellers alone would give
    const std = plane('a320neo', 'T1');
    const flStd = flight(std, 'BOS', 'BTV', 'A');
    expect(e.sold.econ).toBeGreaterThanOrEqual(run(flStd, [std], [flStd]).sold.econ);
    expect(demand.dailyPax.econ + demand.dailyPax.prem + demand.dailyPax.bus + demand.dailyPax.first).toBeGreaterThan(0);
  });
});

describe('cargo', () => {
  it('has parcels and freight on every route, and pays about twice as much for parcels', () => {
    for (const [o, d] of [['JFK', 'LHR'], ['BOS', 'BTV'], ['MEM', 'ANC'], ['MAD', 'BCN']]) {
      const r = getRouteDemandAndFares(ap(o), ap(d), calcDistanceNm(ap(o), ap(d)));
      expect(r.cargo.parcels).toBeGreaterThan(0);
      expect(r.cargo.freight).toBeGreaterThan(0);
      expect(r.dailyCargoTons).toBeCloseTo(r.cargo.parcels + r.cargo.freight, 1);
      expect(r.refFares.parcelPerTon / r.refFares.cargoPerTon).toBeGreaterThan(1.9);
    }
  });

  it('sends more freight out of factory countries than back, and more through cargo hubs', () => {
    const nm = calcDistanceNm(ap('PVG'), ap('LAX'));
    expect(cargoDemand(ap('PVG'), ap('LAX'), nm).freight).toBeGreaterThan(cargoDemand(ap('LAX'), ap('PVG'), nm).freight * 1.5);
    const hub = cargoDemand(ap('MEM'), ap('JFK'), calcDistanceNm(ap('MEM'), ap('JFK')));
    const city = cargoDemand(ap('BNA'), ap('JFK'), calcDistanceNm(ap('BNA'), ap('JFK')));
    expect(hub.freight).toBeGreaterThan(city.freight * 2);
    expect(hub.parcels).toBeGreaterThan(city.parcels * 2);
    // lorries take short hops over land
    expect(cargoDemand(ap('MAD'), ap('BCN'), 261).freight).toBeLessThan(cargoDemand(ap('MAD'), ap('JFK'), 3100).freight);
  });

  it('loads freight by the kind of hold', () => {
    expect(freightShare(AIRCRAFT_BY_ID.get('b777f')!)).toBe(1);
    expect(freightShare(AIRCRAFT_BY_ID.get('b777-300er')!)).toBe(1);
    expect(freightShare(AIRCRAFT_BY_ID.get('a320neo')!)).toBe(0.5);
    const big = plane('b777f');
    const fl = flight(big, 'HKG', 'ANC', 'A');
    const e = run(fl, [big], [fl]);
    expect(e.soldParcelTons).toBeGreaterThan(0);
    expect(e.soldFreightTons).toBeGreaterThan(e.soldParcelTons);
    expect(e.soldCargoTons).toBeLessThanOrEqual(e.maxCargoTons + 0.05);
    expect(e.cargoRevenue).toBe(e.parcelRevenue + e.freightRevenue);
    expect(e.profit).toBeGreaterThan(0);
    const small = plane('a320neo');
    const fs = flight(small, 'JFK', 'LAX', 'B');
    const es = run(fs, [small], [fs]);
    expect(es.soldFreightTons).toBeLessThanOrEqual(es.maxCargoTons * 0.5 + 0.05);
    expect(es.soldParcelTons + es.soldFreightTons).toBeLessThanOrEqual(es.maxCargoTons + 0.05);
  });

  it('sells more parcels on an overnight flight than at midday', () => {
    const ac = plane('b737-800bcf');
    // SDF is at about -86° east: 04:00 UTC is 22:15 there, 17:00 UTC is 11:15
    const night = flight(ac, 'SDF', 'MEM', 'N', ALL, 240);
    const noon = flight(ac, 'SDF', 'MEM', 'D', ALL, 1020);
    expect(run(night, [ac], [night]).soldParcelTons).toBeGreaterThan(run(noon, [ac], [noon]).soldParcelTons);
  });

  it('carries less in a passenger hold near the end of its range, a freighter the same', () => {
    const pax = AIRCRAFT_BY_ID.get('b787-9')!;
    expect(holdTons(pax, pax.range_nm * 0.5)).toBe(pax.cargo_cap_tons);
    expect(holdTons(pax, pax.range_nm)).toBeCloseTo(pax.cargo_cap_tons * 0.6, 1);
    const f = AIRCRAFT_BY_ID.get('b777f')!;
    expect(holdTons(f, f.range_nm)).toBe(f.cargo_cap_tons);
  });

  it('uses the market rate for a flight saved before parcels had their own rate', () => {
    const ac = plane('b777f');
    const fl = flight(ac, 'HKG', 'ANC', 'A');
    const old = { ...fl, fares: { econ: 1, prem: 1, bus: 1, first: 1, cargoPerTon: fl.fares.cargoPerTon } } as ScheduledFlight;
    const e = run(old, [ac], [old]);
    expect(e.parcelRevenue).toBe(run(fl, [ac], [fl]).parcelRevenue);
    expect(Number.isFinite(e.profit)).toBe(true);
  });
});
