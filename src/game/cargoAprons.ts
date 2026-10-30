// ============================================================================
// CARGO APRONS (v2.61)
//   Where freighters park: cargo aprons and cargo stands at the game's
//   airports, from OpenStreetMap (public/data/cargo-aprons.json, built by
//   tools/build-cargo-aprons.mjs). Loaded once in the background; airports
//   with no cargo areas mapped send freighters to their remote stands instead.
// ============================================================================
import type { LonLat } from './geo';

export interface CargoAreas {
  /** Cargo apron outlines (lon/lat rings). */
  a: LonLat[][];
  /** Cargo building outlines (stands beside them are cargo stands). */
  b?: LonLat[][];
  /** Single cargo stands. */
  p?: LonLat[];
}

let data: Record<string, CargoAreas> | null = null;
let started = false;

export function loadCargoAprons(): void {
  if (started) return;
  started = true;
  fetch('/data/cargo-aprons.json')
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      data = j && typeof j === 'object' && j.airports && typeof j.airports === 'object' ? j.airports : {};
    })
    .catch(() => {
      data = {};
    });
}

/** The airport's cargo areas; null when none are mapped, undefined while still loading. */
export function cargoAreasFor(iata: string): CargoAreas | null | undefined {
  if (!data) return undefined;
  return data[iata] ?? null;
}

/** Is the point inside the ring (even-odd rule, lon/lat treated as flat over an apron)? */
export function inRing(p: LonLat, ring: LonLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Metres from the point to the nearest edge of the ring. */
export function metresToRing(p: LonLat, ring: LonLat[]): number {
  const kx = Math.cos((p[1] * Math.PI) / 180) * 111_320;
  const ky = 111_320;
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const ax = (ring[j][0] - p[0]) * kx;
    const ay = (ring[j][1] - p[1]) * ky;
    const dx = (ring[i][0] - p[0]) * kx - ax;
    const dy = (ring[i][1] - p[1]) * ky - ay;
    const t = dx || dy ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy))) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}
