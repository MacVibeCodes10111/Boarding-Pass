// The trimmed airports and runways files (tools/trim-data.mjs) give the game exactly the same airports.
import { describe, expect, test } from 'vitest';
// @ts-expect-error plain JS build tool
import { records, trim } from '../../tools/trim-data.mjs';
import { parseOurAirportsCsvFiles, parseRunwaysExtra } from './csv';
import { airlineAirportPositions, parseNetwork } from './demand';
import ap from '../../public/data/airports.csv?raw';
import rw from '../../public/data/runways.csv?raw';
import networkJson from '../../public/data/network.json?raw';
import runwaysExtraJson from '../../public/data/runways-extra.json?raw';

describe('trim-data', () => {
  test('reads quoted fields with commas, quotes and line breaks', () => {
    const r = records('a,b\n"x, ""y""",2\r\n"line\nbreak",3\n');
    expect(r.map((x: { fields: string[] }) => x.fields)).toEqual([
      ['a', 'b'],
      ['x, "y"', '2'],
      ['line\nbreak', '3'],
    ]);
  });

  test('the game reads the same airports and runways from the trimmed files', () => {
    const net = parseNetwork(JSON.parse(networkJson));
    const extra = parseRunwaysExtra(JSON.parse(runwaysExtraJson));
    const t = trim(ap, rw)!;
    expect(t.airports.length).toBeLessThan(ap.length / 2);
    const full = parseOurAirportsCsvFiles(ap, rw, airlineAirportPositions(net), extra);
    const small = parseOurAirportsCsvFiles(t.airports, t.runways, airlineAirportPositions(net), extra);
    expect(small.length).toBe(full.length);
    expect(small).toEqual(full);
  }, 60_000);
});
