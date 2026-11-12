// Runway data: every landing and takeoff must stay on the runway as it lies on
// the map, including airports whose listed data is wrong or missing.
import { describe, expect, it } from 'vitest';
import { parseOurAirportsCsvFiles, parseRunwaysExtra } from './csv';
import { airlineAirportPositions, parseNetwork } from './demand';
import { calcBlockTimeMin, calcCoordDistanceNm, calcDistanceNm } from './geo';
import { getAirportRunways, getFlightGeometryForDeparture, rememberRunways } from './navdata';
import type { Airport, ScheduledFlight } from './types';
import airportsCsv from '../../public/data/airports.csv?raw';
import runwaysCsv from '../../public/data/runways.csv?raw';
import networkJson from '../../public/data/network.json?raw';
import runwaysExtraJson from '../../public/data/runways-extra.json?raw';

const net = parseNetwork(JSON.parse(networkJson));
const extra = parseRunwaysExtra(JSON.parse(runwaysExtraJson));
const airports = parseOurAirportsCsvFiles(airportsCsv, runwaysCsv, airlineAirportPositions(net), extra);
const byIata = new Map(airports.map((a) => [a.iata_code, a]));

describe('parseRunwaysExtra', () => {
  it('keeps well-formed runways and drops the rest', () => {
    const m = parseRunwaysExtra({
      airports: {
        AAA: [['07', '25', 8000, 10, 20, 10.01, 20.02], ['xx', '25', 8000, 10, 20, 10.01, 20.02], ['07', '25', 300, 10, 20, 10.01, 20.02], ['07', '25', 8000, 95, 20, 10.01, 20.02], 'junk'],
        'bad code': [['07', '25', 8000, 10, 20, 10.01, 20.02]],
        BBB: 'junk',
      },
    });
    expect([...m.keys()]).toEqual(['AAA']);
    expect(m.get('AAA')).toHaveLength(1);
    expect(parseRunwaysExtra(null).size).toBe(0);
    expect(parseRunwaysExtra({ airports: 5 }).size).toBe(0);
  });

  it('gives the busy airports that had no runway coordinates a real runway', () => {
    for (const code of ['YNT', 'CZX', 'DLU', 'SSA', 'REC']) expect(byIata.get(code)?.runways?.length, code).toBeGreaterThan(0);
  });
});

describe('runways on the map', () => {
  it('has both ends of every runway near its airport and apart', () => {
    for (const a of airports)
      for (const r of a.runways ?? []) {
        const far = Math.max(calcCoordDistanceNm(a.longitude_deg, a.latitude_deg, r.le_lon, r.le_lat), calcCoordDistanceNm(a.longitude_deg, a.latitude_deg, r.he_lon, r.he_lat));
        expect(far, `${a.iata_code} ${r.le_ident}`).toBeLessThan(5);
        expect(calcCoordDistanceNm(r.le_lon, r.le_lat, r.he_lon, r.he_lat) * 6076.12, `${a.iata_code} ${r.le_ident}`).toBeGreaterThan(300);
      }
  });

  it('lands and lifts off within the runway, also where the listed data was wrong', () => {
    rememberRunways(airports);
    const R = Math.PI / 180;
    const along = (p: number[], from: [number, number], hdg: number) => {
      const x = (p[0] - from[0]) * Math.cos(from[1] * R) * 60;
      const y = (p[1] - from[1]) * 60;
      return { along: x * Math.sin(hdg * R) + y * Math.cos(hdg * R), cross: x * Math.cos(hdg * R) - y * Math.sin(hdg * R) };
    };
    const drawnNm = (ap: Airport, ident: string) => {
      for (const r of getAirportRunways(ap)) if (r.le_ident === ident || r.he_ident === ident) return calcCoordDistanceNm(r.le_lon, r.le_lat, r.he_lon, r.he_lat);
      return 0;
    };
    // listed too long (AEY), one end 40 nm away (AVR), both ends at one spot (LRM), from OpenStreetMap (YNT), very short strips (AEM, SAB)
    const pairs = [['KEF', 'AEY'], ['LIS', 'AVR'], ['FCO', 'LRM'], ['PEK', 'YNT'], ['NEI', 'AEM'], ['SXM', 'SAB'], ['LHR', 'JFK']];
    let checked = 0;
    for (const [oc, dc] of pairs) {
      const o = byIata.get(oc);
      const d = byIata.get(dc);
      if (!o || !d || !d.runways?.length || !o.runways?.length) continue;
      for (const [from, to] of [[o, d], [d, o]]) {
        for (const dep of [60, 500, 900, 1300]) {
          const dist = calcDistanceNm(from, to);
          const fl = { id: `${from.iata_code}${to.iata_code}${dep}`, flightNumber: 'ZZ1', tailNumber: 'ZZ', origin: from, destination: to, distanceNm: dist, depTimeMin: dep, blockTimeMin: calcBlockTimeMin(dist, 450), daysOfWeek: [true, true, true, true, true, true, true], fares: { econ: 1, prem: 1, bus: 1, first: 1 } } as ScheduledFlight;
          const proc = getFlightGeometryForDeparture(fl, 3);
          const tag = `${from.iata_code}>${to.iata_code} rwy ${proc.arrRwy.ident}`;
          const P = proc.points;
          const thr: [number, number] = [proc.arrRwy.landLon, proc.arrRwy.landLat];
          const end = along(P[P.length - 1], thr, proc.arrRwy.headingDegT);
          const disp = calcCoordDistanceNm(proc.arrRwy.thresholdLon, proc.arrRwy.thresholdLat, thr[0], thr[1]);
          expect(Math.abs(end.cross), tag).toBeLessThan(0.012);
          expect(end.along, tag).toBeGreaterThan(0);
          expect(end.along, tag).toBeLessThanOrEqual(drawnNm(to, proc.arrRwy.ident) - disp + 0.005);
          const lift = along(P[1], [proc.depRwy.thresholdLon, proc.depRwy.thresholdLat], proc.depRwy.headingDegT);
          expect(Math.abs(lift.cross), `${tag} lift-off`).toBeLessThan(0.012);
          expect(lift.along, `${tag} lift-off`).toBeLessThanOrEqual(drawnNm(from, proc.depRwy.ident) + 0.005);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(20);
  });
});
