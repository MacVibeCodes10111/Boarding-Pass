// ============================================================================
// 3D AIRCRAFT
//   Aircraft drawn as solid shapes floating at their height above the ground
//   (MapLibre fill-extrusions with a raised base), a thin line down to their
//   shadow, and the selected aircraft's route as a ribbon at altitude with a
//   curtain beneath it. Works on the flat map and on the globe.
//
//   Sizes are in screen pixels and turned into metres for the current zoom (and
//   the aircraft's own latitude on the flat map), so aircraft stay readable at
//   every zoom and don't balloon near the poles. Heights use one fixed vertical
//   scale (HEIGHT_SCALE) at every zoom: an aircraft stays at the same height
//   above the earth while you zoom, and different cruise levels stay apart.
// ============================================================================
import type { LonLat } from './geo';
import type { Aircraft3d } from './aircraftLayer';
import { aircraftMeshBounds } from './aircraftMeshes';
import type { RadarIconGroup } from './types';

/**
 * Vertical exaggeration, the same at every zoom. A real airliner at 35,000 ft
 * is only 11 km up; ×6 puts it 64 km up, clear of the map when zoomed out but
 * still below the camera down to about zoom 10.
 */
export const HEIGHT_SCALE = 6;
const FT_TO_M = 0.3048;
/** The flat map stops at ±85°; aircraft beyond would stretch to infinity. */
const MAX_LAT = 84;
/**
 * Body thickness follows the on-screen size, but never more than this: zoomed
 * out over the world an aircraft is drawn 1,000 km long, and a matching
 * thickness (and a 3.6× tail fin) made towering slabs at low angles.
 */
const MAX_THICK_M = 2500;
const thickFor = (mpp: number, half: number) => Math.min(MAX_THICK_M, Math.max(mpp * 1.6, half * 0.13));
/** Other airlines' aircraft drawn in 3D at most (each is a few hundred vertices). */
export const AI_3D_MAX = 3000;

export interface Scale3d {
  /** Metres per screen pixel at the view centre. */
  mpp: number;
  /** Vertical exaggeration (fixed). */
  exag: number;
  zoom: number;
  /** Globe: one scale everywhere. Flat map: metres per pixel shrink with latitude. */
  globe: boolean;
}

/** MapLibre's 512 px tiles: metres per pixel at a latitude and zoom. */
export function metersPerPixel(lat: number, zoom: number): number {
  return (78_271.517 * Math.cos((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180)) / 2 ** zoom;
}

export function scaleFor(lat: number, zoom: number, globe = false): Scale3d {
  return { mpp: metersPerPixel(lat, zoom), exag: HEIGHT_SCALE, zoom, globe };
}

/** Metres per pixel where something at `lat` is drawn. */
const mppAt = (k: Scale3d, lat: number) => (k.globe ? k.mpp : metersPerPixel(lat, k.zoom));

/** Height in metres where the middle of an aircraft at `aglFt` is drawn (labels go here). */
export function labelHeightM(aglFt: number, sizePx: number, k: Scale3d, lat: number): number {
  const half = (sizePx * mppAt(k, lat)) / 2;
  return drawnHeightM(aglFt, k) + thickFor(mppAt(k, lat), half) / 2;
}

/** Height in metres where an aircraft at `aglFt` above the ground is drawn. */
export const drawnHeightM = (aglFt: number, k: Scale3d) => Math.max(0, aglFt) * FT_TO_M * k.exag;

// Airliner outline, nose at +y, unit half-length (x = right, y = forward)
const BODY: [number, number][] = [
  [0, 1], [0.07, 0.86], [0.08, 0.3], [0.56, -0.02], [0.56, -0.13], [0.08, 0.02], [0.07, -0.6], [0.26, -0.78], [0.26, -0.88], [0, -0.82],
  [-0.26, -0.88], [-0.26, -0.78], [-0.07, -0.6], [-0.08, 0.02], [-0.56, -0.13], [-0.56, -0.02], [-0.08, 0.3], [-0.07, 0.86],
];
// Vertical tail fin: a thin sliver along the centreline at the back
const FIN: [number, number][] = [[0.018, -0.52], [0.018, -0.95], [-0.018, -0.95], [-0.018, -0.52]];

const DEG = Math.PI / 180;
const M_PER_DEG = 111_320;

/** Outline points around a centre, rotated to a heading, sized `halfLenM`. */
function ring(shape: [number, number][], at: LonLat, bearingDeg: number, halfLenM: number): LonLat[] {
  const r = bearingDeg * DEG;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const kx = M_PER_DEG * Math.max(0.05, Math.cos(at[1] * DEG));
  const out: LonLat[] = shape.map(([x, y]) => {
    const e = (x * c + y * s) * halfLenM;
    const n = (-x * s + y * c) * halfLenM;
    return [at[0] + e / kx, at[1] + n / M_PER_DEG];
  });
  out.push(out[0]);
  return out;
}

const poly = (coords: LonLat[], properties: Record<string, unknown>) => ({
  type: 'Feature' as const,
  geometry: { type: 'Polygon' as const, coordinates: [coords] },
  properties,
});

export interface Plane3d {
  at: LonLat;
  bearing: number;
  aglFt: number;
  /** Nose-to-tail length on screen, in pixels. */
  sizePx: number;
  color: string;
  /** Kept on the features so a click can tell which aircraft it was. */
  props: Record<string, unknown>;
}

/**
 * Body and fin of one aircraft (pushed to `bodies`) and its line down to the
 * ground (pushed to `stems`, when given). Aircraft on the ground are skipped:
 * the flat map icons draw those.
 */
export function pushPlane3d(p: Plane3d, k: Scale3d, bodies: unknown[], stems?: unknown[]) {
  if (!(p.aglFt > 0) || (!k.globe && Math.abs(p.at[1]) > MAX_LAT)) return;
  const mpp = mppAt(k, p.at[1]);
  const half = (p.sizePx * mpp) / 2;
  const base = drawnHeightM(p.aglFt, k);
  const thick = thickFor(mpp, half);
  const props = { ...p.props, color: p.color, base, top: base + thick };
  bodies.push(poly(ring(BODY, p.at, p.bearing, half), props));
  bodies.push(poly(ring(FIN, p.at, p.bearing, half), { ...props, top: base + thick * 3.6 }));
  if (stems) {
    const w = mpp * 0.7;
    stems.push(poly(ring([[w, w], [w, -w], [-w, -w], [-w, w]], p.at, 0, 1), { color: p.color, base: 0, top: base }));
  }
}

/** Tallest a detailed aircraft is drawn (fin top to engines), like the simple shapes' fin. */
const MAX_MODEL_H_M = 9000;

/**
 * One aircraft for the detailed 3D layer (aircraftLayer.ts): same place,
 * size and height as pushPlane3d's simple shape, with its belly at the drawn
 * height. Returns null for aircraft on the ground (the flat icons draw those).
 */
export function plane3dInstance(p: Plane3d, k: Scale3d, group: RadarIconGroup, pitchDeg: number, rgb: [number, number, number]): Aircraft3d | null {
  if (!(p.aglFt > 0) || (!k.globe && Math.abs(p.at[1]) > MAX_LAT)) return null;
  const half = (p.sizePx * mppAt(k, p.at[1])) / 2;
  const b = aircraftMeshBounds(group);
  const vScale = Math.min(1, MAX_MODEL_H_M / Math.max(1, (b.maxZ - b.minZ) * half));
  return {
    lng: p.at[0],
    lat: p.at[1],
    elevM: drawnHeightM(p.aglFt, k) - b.minZ * half * vScale,
    halfLenM: half,
    headingDeg: p.bearing,
    pitchDeg,
    rgb,
    vScale,
  };
}

export interface RoutePoint {
  at: LonLat;
  aglFt: number;
}

/**
 * Keeps the points where the height changes and one every few points in level
 * flight, so a long-haul route is a few hundred segments, not thousands.
 */
export function thinRoute<T extends RoutePoint>(points: T[], levelEvery = 6): T[] {
  const out: T[] = [];
  let level = 0;
  points.forEach((p, i) => {
    const prev = out[out.length - 1];
    const last = i === points.length - 1;
    if (!prev || last || Math.abs(p.aglFt - prev.aglFt) >= 1 || points[i + 1]?.aglFt !== p.aglFt || ++level >= levelEvery) {
      out.push(p);
      level = 0;
    }
  });
  return out;
}

/**
 * The route as a ribbon at altitude (`ribbon`) and a curtain down to the
 * ground (`curtain`). Points before `splitIdx` are the part already flown.
 * Each segment is a flat slab, so climbs and descents are split into short
 * steps that read as a smooth slope.
 */
export function pushRoute3d(points: RoutePoint[], splitIdx: number, k: Scale3d, colors: { flown: string; ahead: string }, ribbon: unknown[], curtain: unknown[]) {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (!k.globe && (Math.abs(a.at[1]) > MAX_LAT || Math.abs(b.at[1]) > MAX_LAT)) continue;
    const mpp = mppAt(k, (a.at[1] + b.at[1]) / 2);
    const half = mpp * 1.5;
    const thick = Math.min(MAX_THICK_M, mpp * 1.6);
    const stepM = mpp * 0.6; // at most this much height per slab (smooth slopes)
    const ha = drawnHeightM(a.aglFt, k);
    const hb = drawnHeightM(b.aglFt, k);
    const steps = Math.min(120, Math.max(1, Math.ceil(Math.abs(hb - ha) / stepM)));
    const color = i <= splitIdx ? colors.flown : colors.ahead;
    for (let s = 0; s < steps; s++) {
      const t0 = s / steps;
      const t1 = (s + 1) / steps;
      const p0: LonLat = [a.at[0] + (b.at[0] - a.at[0]) * t0, a.at[1] + (b.at[1] - a.at[1]) * t0];
      const p1: LonLat = [a.at[0] + (b.at[0] - a.at[0]) * t1, a.at[1] + (b.at[1] - a.at[1]) * t1];
      // Skip the antimeridian jump; it would draw a slab round the world
      if (Math.abs(p1[0] - p0[0]) > 180) continue;
      const h = ha + (hb - ha) * ((t0 + t1) / 2);
      const kx = M_PER_DEG * Math.max(0.05, Math.cos(((p0[1] + p1[1]) / 2) * DEG));
      const dx = (p1[0] - p0[0]) * kx;
      const dy = (p1[1] - p0[1]) * M_PER_DEG;
      const len = Math.hypot(dx, dy) || 1;
      // Perpendicular half-width, in degrees
      const ox = ((-dy / len) * half) / kx;
      const oy = ((dx / len) * half) / M_PER_DEG;
      const quad: LonLat[] = [
        [p0[0] + ox, p0[1] + oy],
        [p1[0] + ox, p1[1] + oy],
        [p1[0] - ox, p1[1] - oy],
        [p0[0] - ox, p0[1] - oy],
      ];
      quad.push(quad[0]);
      if (h > 0.5) {
        ribbon.push(poly(quad, { color, base: Math.max(0, h - thick / 2), top: h + thick / 2 }));
        curtain.push(poly(quad, { color, base: 0, top: Math.max(0, h - thick / 2) }));
      }
    }
  }
}

/**
 * Nose up while climbing, down while descending, level in cruise, eased so
 * aircraft tilt smoothly. Follows each aircraft's altitude from one redraw to
 * the next; forgets aircraft not seen for a few seconds.
 */
export class PitchTracker {
  private m = new Map<string | number, { alt: number; target: number; pitch: number; changedAt: number; at: number }>();
  private lastPrune = 0;

  pitch(id: string | number, altFt: number, now: number): number {
    const e = this.m.get(id);
    if (!e) {
      this.m.set(id, { alt: altFt, target: 0, pitch: 0, changedAt: now, at: now });
      return 0;
    }
    const d = altFt - e.alt;
    if (d > 0.5) {
      e.target = 7;
      e.changedAt = now;
    } else if (d < -0.5) {
      e.target = -3;
      e.changedAt = now;
    } else if (now - e.changedAt > 2500) e.target = 0; // level (or the game is paused)
    e.alt = altFt;
    e.pitch += (e.target - e.pitch) * Math.min(1, Math.max(0, now - e.at) / 700);
    e.at = now;
    if (now - this.lastPrune > 5000) {
      this.lastPrune = now;
      for (const [k, v] of this.m) if (now - v.at > 5000) this.m.delete(k);
    }
    return e.pitch;
  }
}
