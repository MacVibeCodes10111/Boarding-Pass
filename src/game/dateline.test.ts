import { describe, expect, it } from 'vitest';
import { nearLon } from './geo';
import { splitFlightPath } from './navdata';
import type { Airport, ScheduledFlight } from './types';

const ap = (iata: string, lat: number, lon: number): Airport => ({ iata_code: iata, ident: iata, name: iata, municipality: iata, type: 'large_airport', latitude_deg: lat, longitude_deg: lon, iso_country: 'XX' }) as unknown as Airport;
const LAX = ap('LAX', 33.94, -118.41);
const KIX = ap('KIX', 34.43, 135.24);
const flight = (o: Airport, d: Airport, id: string): ScheduledFlight =>
  ({ id, flightNumber: 'T1', tailNumber: 'N1', origin: o, destination: d, depTimeMin: 600, arrTimeMin: 0, distanceNm: 4700, blockTimeMin: 700, daysOfWeek: [true, true, true, true, true, true, true], fares: { econ: 1, prem: 1, bus: 1, first: 1 } }) as unknown as ScheduledFlight;

const jumps = (line: [number, number][]) => line.slice(1).filter((p, i) => Math.abs(p[0] - line[i][0]) > 180).length;

describe('flights across the date line', () => {
  it('nearLon moves a point by whole turns only', () => {
    expect(nearLon([170, 10], -200)).toEqual([-190, 10]);
    expect(nearLon([-170, 10], 200)).toEqual([190, 10]);
    expect(nearLon([10, 10], 20)).toEqual([10, 10]);
  });

  it('the flown and remaining lines never jump round the world', () => {
    for (const [o, d] of [[LAX, KIX], [KIX, LAX]]) {
      for (let i = 0; i < 12; i++) {
        for (const progress of [0.05, 0.3, 0.5, 0.7, 0.95]) {
          const { flown, remaining } = splitFlightPath(flight(o, d, `F${i}`), 1, progress);
          expect(jumps(flown as [number, number][])).toBe(0);
          expect(jumps(remaining as [number, number][])).toBe(0);
        }
      }
    }
  });
});
