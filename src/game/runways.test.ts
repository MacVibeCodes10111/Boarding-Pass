import { describe, expect, it } from 'vitest';
import { getAirportRunways, rememberRunways } from './navdata';
import type { Airport, RunwayEndPair } from './types';

const rw = (le: string, he: string): RunwayEndPair => ({ le_ident: le, he_ident: he, length_ft: 13000, le_lat: 30.1, le_lon: 31.4, le_heading_degT: 50, he_lat: 30.13, he_lon: 31.43, he_heading_degT: 230 });
const cai = (runways?: RunwayEndPair[]) => ({ iata_code: 'CAI', ident: 'HECA', name: 'Cairo', latitude_deg: 30.12, longitude_deg: 31.41, iso_country: 'EG', type: 'large_airport', runway_count: 4, ...(runways ? { runways } : {}) }) as unknown as Airport;

describe('runways', () => {
  it('an airport copy without runways (from a save, or the built-in list) uses the real ones once the airport list is in', () => {
    rememberRunways([]);
    const made = getAirportRunways(cai()).map((r) => r.le_ident);
    rememberRunways([cai([rw('05L', '23R'), rw('05R', '23L')])]);
    expect(getAirportRunways(cai()).map((r) => r.le_ident)).toEqual(['05L', '05R']);
    expect(made).not.toEqual(['05L', '05R']);
  });
});
