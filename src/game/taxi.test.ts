// Freighters park on the cargo ramp, not at the terminals (2026-11-13).
import { describe, expect, it } from 'vitest';
import { setCargoAreasForTests } from './cargoAprons';
import type { LonLat } from './geo';
import { buildTaxiNetwork, type AerowayFeature, type GateRequest } from './taxi';

const LON0 = 10;
const LAT0 = 50;
const ll = (x: number, y: number): LonLat => [LON0 + x / (111_320 * Math.cos((LAT0 * Math.PI) / 180)), LAT0 + y / 111_320];
const line = (pts: [number, number][], cls = 'taxiway'): AerowayFeature => ({ cls, ref: '', kind: 'line', coords: pts.map(([x, y]) => ll(x, y)) });
const along = (x0: number, x1: number, y: number) => Array.from({ length: Math.round((x1 - x0) / 50) + 1 }, (_, i) => [x0 + i * 50, y] as [number, number]);
const down = (x: number, y0: number, y1: number) => Array.from({ length: Math.round((y0 - y1) / 50) + 1 }, (_, i) => [x, y0 - i * 50] as [number, number]);

// A terminal with 8 gates on the west, and a cargo apron (no gates on the map) to the south-east
const APRON: [number, number][] = [[400, -60], [850, -60], [850, -320], [400, -320], [400, -60]];
const feats: AerowayFeature[] = [
  line(along(-1000, 1000, 0)),
  line(down(400, 0, -250), 'taxilane'),
  line(along(400, 850, -250), 'taxilane'),
  ...Array.from({ length: 8 }, (_, i): AerowayFeature => ({ cls: 'gate', ref: `A${i + 1}`, kind: 'point', coords: [ll(-800 + i * 60, 70)] })),
];
const req = (n: number, cargo: boolean): GateRequest => ({ key: `k${n}`, visit: `v${n}`, pref: `tail:N${n}`, visitStart: 0, visitEnd: 120, kind: 'arr', rollEndAt: 0, parkUntil: 120, cargo });

describe('cargo stands', () => {
  it('lays stands out on a cargo apron the map has no gates on, and freighters use them', () => {
    setCargoAreasForTests({ TST: { a: [APRON.map(([x, y]) => ll(x, y))] } });
    const net = buildTaxiNetwork('TST', [LON0, LAT0], 3000, feats)!;
    expect(net).not.toBeNull();
    expect(net.stands).toHaveLength(8);
    const onApron = (i: number) => {
      const [x, y] = net.stands[i].g;
      return x > 390 && x < 860 && y < -50 && y > -330;
    };
    // ten freighters all park on the cargo apron
    const cargo = Array.from({ length: 10 }, (_, n) => net.assignGate(req(n, true), 0));
    expect(cargo.every((i) => i >= 0 && onApron(i))).toBe(true);
    expect(new Set(cargo).size).toBe(10);
    // passenger flights still go to the terminal
    const pax = Array.from({ length: 4 }, (_, n) => net.assignGate(req(100 + n, false), 0));
    expect(pax.every((i) => i >= 0 && net.stands[i].ref.startsWith('A'))).toBe(true);
  });

  it('leaves airports with no cargo areas as they were', () => {
    setCargoAreasForTests({});
    const net = buildTaxiNetwork('TST', [LON0, LAT0], 3000, feats)!;
    net.assignGate(req(1, true), 0);
    expect(net.stands).toHaveLength(8);
  });
});
