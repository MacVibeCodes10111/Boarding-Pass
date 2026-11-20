// ============================================================================
// WINDOW VIEW (v3.5.2)
//
// The 3D map seen from a passenger window of the selected aircraft: the camera
// sits where the aircraft is, at its real height (not the 3D view's 6× one),
// looking out of the left or right side. It banks with the turns (looking out
// sideways, a bank tips the view up or down) and leans with the climb and
// descent. The positions come from the map's own frames (about 20 a second)
// and are carried on in between, so the camera moves every screen frame.
// The sky follows the sun where the aircraft is.
// ============================================================================

export type WindowSide = 'left' | 'right';

export interface WindowSample {
  /** performance.now() of the map frame. */
  t: number;
  lng: number;
  lat: number;
  /** Height above the ground, ft. */
  aglFt: number;
  /** Track, degrees (null: unknown, e.g. parked). */
  heading: number | null;
  gsKts: number;
}

export interface WindowState {
  flightId: string;
  side: WindowSide;
  /** Looking round from straight out (drag): degrees right / up. */
  yaw: number;
  look: number;
  samples: WindowSample[];
  heading: number;
  bank: number;
  attitude: number;
  lastPlace: number;
  lastT: number;
}

export function newWindowState(flightId: string, side: WindowSide, heading = 0): WindowState {
  return { flightId, side, yaw: 0, look: 0, samples: [], heading, bank: 0, attitude: 0, lastPlace: 0, lastT: 0 };
}

const DEG = Math.PI / 180;
const M_PER_DEG = 111_320;
/** Eye height in the cabin above the ground when on the ground, m. */
const EYE_M = 4;
/** Fewer camera moves than screen frames: about 30 a second is smooth and lighter. */
const PLACE_MS = 30;

/** Adds a map frame's position (kept: the last two). */
export function addWindowSample(w: WindowState, s: WindowSample) {
  const last = w.samples[w.samples.length - 1];
  if (last && s.t - last.t < 1) return;
  w.samples.push(s);
  if (w.samples.length > 2) w.samples.shift();
}

const angDiff = (a: number, b: number) => ((a - b + 540) % 360) - 180;

/** Track between two points, degrees (null when they're the same spot). */
function trackBetween(a: WindowSample, b: WindowSample): number | null {
  const dx = (b.lng - a.lng) * Math.cos(((a.lat + b.lat) / 2) * DEG);
  const dy = b.lat - a.lat;
  if (Math.hypot(dx, dy) * M_PER_DEG < 0.3) return null;
  return (Math.atan2(dx, dy) / DEG + 360) % 360;
}

/**
 * Where the camera goes now: the last position carried on at the speed between
 * the last two, the heading eased, the bank and nose angle eased.
 * `mapRate` is map minutes per real minute (the timelapse runs it faster).
 */
export function windowCamera(w: WindowState, t: number, mapRate: number) {
  const [a, b] = w.samples.length > 1 ? w.samples : [w.samples[0], w.samples[0]];
  if (!b) return null;
  const span = Math.max(1, b.t - a.t);
  const ahead = Math.min(1.5, (t - b.t) / span); // never carry on more than 1.5 frames
  const lng = b.lng + (b.lng - a.lng) * ahead;
  const lat = b.lat + (b.lat - a.lat) * ahead;
  const agl = Math.max(0, b.aglFt + (b.aglFt - a.aglFt) * ahead);
  const dt = w.lastT ? Math.min(250, Math.max(0, t - w.lastT)) : 0;
  w.lastT = t;

  const target = b.heading ?? trackBetween(a, b) ?? w.heading;
  const prevHeading = w.heading;
  const e = 1 - Math.exp(-dt / 220);
  w.heading = (w.heading + angDiff(target, w.heading) * (dt ? e : 1) + 360) % 360;

  // Bank from the rate of turn (map time): a 3°/s turn is about 25°
  const mapSecs = (dt / 1000) * Math.max(1, mapRate);
  const turnRate = mapSecs > 0 ? angDiff(w.heading, prevHeading) / mapSecs : 0;
  const airborne = agl > 20;
  const bankTarget = airborne ? Math.max(-25, Math.min(25, turnRate * 8.3)) : 0;
  // Nose up in the climb, a little down in the descent, a few degrees up in cruise
  const mapMin = (span / 60_000) * Math.max(1, mapRate);
  const fpm = mapMin > 0 ? (b.aglFt - a.aglFt) / mapMin : 0;
  const attTarget = airborne ? 2.5 + Math.max(-3.5, Math.min(6, (fpm / 2500) * 5)) : 0;
  const k = 1 - Math.exp(-dt / 900);
  w.bank += (bankTarget - w.bank) * k;
  w.attitude += (attTarget - w.attitude) * k;

  const s = w.side === 'right' ? 1 : -1;
  const base = 86 - 6 * Math.min(1, agl / 8000); // level from the ground, a little down from up high
  const pitch = Math.max(50, Math.min(98, base + w.look - s * w.bank));
  const bearing = (w.heading + s * 90 + w.yaw + 360) % 360;
  const roll = s * w.attitude;
  const gsKts = b.gsKts;
  return { lng, lat, altM: agl * 0.3048 + EYE_M, bearing, pitch, roll, aglFt: agl, gsKts };
}

/** Moves the map's camera to the window (at most ~30 times a second). */
export function placeWindowCamera(map: any, w: WindowState, t: number, mapRate: number): boolean {
  if (t - w.lastPlace < PLACE_MS) return false;
  const cam = windowCamera(w, t, mapRate);
  if (!cam) return false;
  w.lastPlace = t;
  try {
    if ((map.getMaxPitch?.() ?? 85) < 100) map.setMaxPitch?.(100);
    const opts = map.calculateCameraOptionsFromCameraLngLatAltRotation?.([cam.lng, cam.lat], cam.altM, cam.bearing, cam.pitch, cam.roll);
    if (opts) map.jumpTo(opts);
  } catch {
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// The sun and the sky
// ---------------------------------------------------------------------------

/** Height of the sun above the horizon, degrees (a good approximation). */
export function sunElevationDeg(lat: number, lng: number, ms: number): number {
  const d = ms / 86_400_000 - 10_957.5; // days since 2000-01-01 12:00 UTC
  const g = (357.529 + 0.98560028 * d) * DEG;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG;
  const eps = (23.439 - 0.00000036 * d) * DEG;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(eps) * Math.sin(L));
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24;
  const ha = (gmst * 15 + lng) * DEG - ra;
  const el = Math.asin(Math.sin(lat * DEG) * Math.sin(dec) + Math.cos(lat * DEG) * Math.cos(dec) * Math.cos(ha));
  return el / DEG;
}

const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const mix = (a: string, b: string, f: number) => {
  const x = hex(a), y = hex(b);
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * Math.max(0, Math.min(1, f))).toString(16).padStart(2, '0')).join('')}`;
};

export interface WindowLight {
  sky: string;
  horizon: string;
  fog: string;
  /** Wing top and its darker leading edge. */
  wing: string;
  wingDark: string;
  /** Cabin wall. */
  wall: string;
  wallShade: string;
  /** 0 day … 1 night. */
  night: number;
}

/** Colours for a sun height: day, sunset, night. */
export function windowLight(sunEl: number): WindowLight {
  const day = { sky: '#4f86d4', horizon: '#cfe2f4', fog: '#dbe7f2', wing: '#d5dae1', wingDark: '#9aa3ae', wall: '#e8e5de', wallShade: '#bdb8ae' };
  const dusk = { sky: '#4c5f99', horizon: '#f0a66e', fog: '#d9a684', wing: '#b9a99c', wingDark: '#7d7069', wall: '#d9d2c6', wallShade: '#a59c8f' };
  const night = { sky: '#070c18', horizon: '#18233b', fog: '#121a2c', wing: '#2b313b', wingDark: '#1a1e25', wall: '#3b3a37', wallShade: '#252422' };
  // day above 8°, sunset round 0°, night below -8°
  const pick = (k: keyof typeof day) =>
    sunEl >= 8 ? day[k] : sunEl >= 0 ? mix(dusk[k], day[k], sunEl / 8) : sunEl >= -8 ? mix(night[k], dusk[k], (sunEl + 8) / 8) : night[k];
  return {
    sky: pick('sky'),
    horizon: pick('horizon'),
    fog: pick('fog'),
    wing: pick('wing'),
    wingDark: pick('wingDark'),
    wall: pick('wall'),
    wallShade: pick('wallShade'),
    night: Math.max(0, Math.min(1, (2 - sunEl) / 10)),
  };
}

/** The map engine's sky for a light. */
export function skyFor(l: WindowLight) {
  return {
    'sky-color': l.sky,
    'horizon-color': l.horizon,
    'fog-color': l.fog,
    'sky-horizon-blend': 0.55,
    'horizon-fog-blend': 0.7,
    'fog-ground-blend': 0.35,
    'atmosphere-blend': 0,
  };
}
