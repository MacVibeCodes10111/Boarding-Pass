// ============================================================================
// WINDOW VIEW (v3.5.2)
//
// The 3D map seen from a passenger window of the selected aircraft: the camera
// sits where the aircraft is, at its real height (not the 3D view's 6× one),
// looking straight out of the left or right side: fixed to the aircraft, like
// a real window (no looking round, no zoom). It banks with the turns (looking
// out sideways, a bank tips the view up or down) and leans with the climb and
// descent. The positions come from the map's own frames (about 20 a second);
// the camera runs one frame behind them and glides between the two, so it
// moves smoothly every screen frame (on the ground too). The sky follows the
// sun where the aircraft is.
// ============================================================================

import type { RadarIconGroup } from './types';

export type WindowSide = 'left' | 'right';

/** Eye height in a window seat above the ground when parked (m): higher in the big ones. */
const EYE_M_BY_GROUP: Record<RadarIconGroup, number> = {
  commuter: 1.5, prop: 2.3, rj_tail: 2.4, small_jet: 2.9, rear_jet: 2.7, medium_jet: 3.4, long_narrow: 3.7,
  large_jet: 5.2, heavy_twin: 5.6, trijet: 5.4, a340: 5.3, b747: 5.7, a380: 6, high_quad: 3.6,
};
export const windowEyeM = (g: RadarIconGroup | undefined) => (g && EYE_M_BY_GROUP[g]) || 3.4;

/** The wingtip: how each type's wing ends. */
export type WingTip = 'none' | 'blended' | 'scimitar' | 'sharklet' | 'fence' | 'raked' | 'curved' | 'winglet';
/** By the type's name (Boeing 737-800, Airbus A350-900, ATR 72…), first match wins. */
const TIPS: [RegExp, WingTip][] = [
  [/737 ?MAX|737-[789] ?MAX|737-?MAX/i, 'scimitar'], // split tips
  [/777-?(200LR|300ER|8|9|X)|777F|787|767-400|747-8|A220|CS[13]00|-E2\b|E2$/i, 'raked'],
  [/747-400/i, 'winglet'],
  [/737-(600|700|800|900)|737NG|757|767-(200|300)/i, 'blended'],
  [/A350|A330-?(800|900)|A330neo/i, 'curved'],
  [/A330|A340|MD-11|E1[79][05]|E-?Jet|CRJ|Embraer 1[79]/i, 'winglet'],
  [/A380|A318|A310|A300/i, 'fence'],
  [/A319|A320|A321/i, 'sharklet'],
];
export function wingTipFor(typeName: string | undefined, group: RadarIconGroup | undefined): WingTip {
  const t = typeName ?? '';
  if (t) {
    for (const [re, tip] of TIPS) if (re.test(t)) return tip;
    return 'none'; // ATRs, Dash 8s, 717s, MD-80s, classic 737s and 747s, 777-200s…
  }
  // Unknown type: what the group mostly flies with
  const byGroup: Partial<Record<RadarIconGroup, WingTip>> = {
    medium_jet: 'sharklet', long_narrow: 'blended', large_jet: 'raked', heavy_twin: 'raked', a340: 'winglet',
    small_jet: 'winglet', rj_tail: 'winglet', trijet: 'winglet', b747: 'winglet', a380: 'fence',
  };
  return (group && byGroup[group]) || 'none';
}

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
  /** Eye height above the ground when parked, m (the aircraft's size). */
  eyeM: number;
  samples: WindowSample[];
  heading: number;
  bank: number;
  /** The camera after the last smoothing pass: [value, speed] each */
  smooth?: { lng: [number, number]; lat: [number, number]; alt: [number, number]; pitch: [number, number]; bearing: [number, number]; roll: [number, number] };
  attitude: number;
  /** Climb rate (map ft/min) and speed change (kt per map second), eased. */
  fpm: number;
  accel: number;
  /** The wing's moving parts, eased (they move at their own speed). */
  parts: WingParts;
  /** Height, eased. */
  agl: number | null;
  /** Added to the position to hide a jump in it (air to ground and back); fades out. */
  off: { lng: number; lat: number; agl: number };
  /** Touchdown: when the wheels hit (the cabin jolts for a moment). */
  wasAir: boolean;
  shakeAt: number;
  lastPlace: number;
  lastT: number;
  /** The last camera placed (the readout and the wing read it). */
  last?: ReturnType<typeof windowCamera>;
}

export function newWindowState(flightId: string, side: WindowSide, heading = 0): WindowState {
  return { flightId, side, eyeM: 3.4, samples: [], heading, bank: 0, attitude: 0, fpm: 0, accel: 0, agl: null, parts: { flaps: 0, spoilers: 0, aileron: 0 }, wasAir: false, shakeAt: -1e9, off: { lng: 0, lat: 0, agl: 0 }, lastPlace: 0, lastT: 0 };
}

/** The wing's moving parts: 0 … 1 (aileron −1 down … 1 up). */
export interface WingParts {
  flaps: number;
  spoilers: number;
  aileron: number;
}

const DEG = Math.PI / 180;
const M_PER_DEG = 111_320;
/** The camera moves every screen frame (at most ~120 a second). */
const PLACE_MS = 7;
/**
 * The camera shows where the aircraft was this long ago, between two known
 * positions: the map's frames come every 50–100 ms (less often when busy), and
 * gliding between them instead of guessing ahead keeps the motion even.
 */
const BEHIND_MS = 130;
/** How long the camera's last smoothing pass takes to catch up (seconds): position, and angles. */
const SMOOTH_POS_S = 0.35;
const SMOOTH_ANGLE_S = 0.3;

/**
 * One step of a critically damped spring (the usual "smooth damp"): `v` is
 * [value, speed], eased toward `target` over about `time` seconds, steady for any step.
 */
function damp(v: [number, number], target: number, time: number, dt: number) {
  const omega = 2 / time;
  const x = omega * dt;
  const ex = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = v[0] - target;
  const temp = (v[1] + omega * change) * dt;
  v[1] = (v[1] - omega * temp) * ex;
  v[0] = target + (change + temp) * ex;
}

/** Adds a map frame's position (kept: the last few). */
export function addWindowSample(w: WindowState, s: WindowSample) {
  const last = w.samples[w.samples.length - 1];
  if (last && s.t - last.t < 1) return;
  // A jump (the flight handing over to the taxi, or back): the earlier positions
  // move with it, so there's no hop, and the camera eases across to the true spot
  const prev = w.samples[w.samples.length - 2];
  if (last) {
    const k = prev ? (s.t - last.t) / Math.max(1, last.t - prev.t) : 0;
    const exLng = prev ? (last.lng - prev.lng) * k : 0, exLat = prev ? (last.lat - prev.lat) * k : 0, exAgl = prev ? (last.aglFt - prev.aglFt) * k : 0;
    const dLng = s.lng - last.lng - exLng, dLat = s.lat - last.lat - exLat, dAgl = s.aglFt - last.aglFt - exAgl;
    const kx = Math.cos(s.lat * DEG) * M_PER_DEG;
    const stepM = Math.hypot(exLng * kx, exLat * M_PER_DEG);
    const offM = Math.hypot(dLng * kx, dLat * M_PER_DEG);
    const jumpXY = offM > 12 + stepM * 0.6;
    const jumpZ = Math.abs(dAgl) > 15 + Math.abs(exAgl) * 0.6;
    if (jumpXY || jumpZ) {
      for (const o of w.samples) {
        if (jumpXY) {
          o.lng += dLng;
          o.lat += dLat;
        }
        if (jumpZ) o.aglFt += dAgl;
      }
      if (jumpXY) {
        w.off.lng -= dLng;
        w.off.lat -= dLat;
      }
      if (jumpZ) w.off.agl -= dAgl;
    }
  }
  w.samples.push(s);
  if (w.samples.length > 6) w.samples.shift();
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
 * Where the camera goes now: one map frame behind the newest position, gliding
 * from the one before to it (no guessing ahead, so no jumps when the aircraft
 * slows or turns), the heading, bank and nose angle eased.
 * `mapRate` is map minutes per real minute (the timelapse runs it faster).
 */
export function windowCamera(w: WindowState, t: number, mapRate: number) {
  const ss = w.samples;
  const n = ss.length;
  if (!n) return null;
  const b = ss[n - 1];
  const a = n > 1 ? ss[n - 2] : b;
  const span = Math.max(1, b.t - a.t);
  const rate = Math.max(1, mapRate);
  // The two known positions either side of the moment shown (or carried on a little past the newest)
  const rt = t - BEHIND_MS;
  let i = n - 2;
  while (i > 0 && ss[i].t > rt) i--;
  const p = ss[Math.max(0, i)], q = n > 1 ? ss[Math.max(0, i) + 1] : p;
  const f = q === p ? 0 : Math.max(0, Math.min(1.6, (rt - p.t) / Math.max(1, q.t - p.t)));
  let lng = p.lng + (q.lng - p.lng) * f;
  let lat = p.lat + (q.lat - p.lat) * f;
  let rawAgl = Math.max(0, p.aglFt + (q.aglFt - p.aglFt) * f);
  const dt = w.lastT ? Math.min(250, Math.max(0, t - w.lastT)) : 0;
  w.lastT = t;
  const dtS = dt / 1000;

  // What's left of a jump fades out over a second or two
  const fade = Math.exp(-dt / 1600);
  w.off.lng *= fade;
  w.off.lat *= fade;
  w.off.agl *= fade;
  lng += w.off.lng;
  lat += w.off.lat;
  rawAgl = Math.max(0, rawAgl + w.off.agl);
  // Height eased a little: level-offs and step climbs round off instead of kinking
  const prevAgl = w.agl ?? rawAgl;
  w.agl = rawAgl < 1 ? rawAgl : prevAgl + (rawAgl - prevAgl) * (dt ? 1 - Math.exp(-dt / 450) : 1);
  const agl = w.agl;
  const airborne = agl > 8;

  // Climb rate and speed change in map time, eased
  const mapMinNow = (dtS / 60) * rate;
  if (mapMinNow > 0) w.fpm += ((agl - prevAgl) / mapMinNow - w.fpm) * (1 - Math.exp(-dt / 1500));
  const accelNow = (b.gsKts - a.gsKts) / ((span / 1000) * rate);
  if (dt) w.accel += (accelNow - w.accel) * (1 - Math.exp(-dt / 1200));

  const target = b.heading ?? trackBetween(a, b) ?? w.heading;
  const prevHeading = w.heading;
  // Slower on the ground: taxiway corners are sharp points in the path
  const e = 1 - Math.exp(-dt / (airborne ? 300 : 700));
  w.heading = (w.heading + angDiff(target, w.heading) * (dt ? e : 1) + 360) % 360;

  // Bank from the rate of turn (map time): a 3°/s turn is about 25°
  const mapSecs = dtS * rate;
  const turnRate = mapSecs > 0 ? angDiff(w.heading, prevHeading) / mapSecs : 0;
  const bankTarget = agl > 60 ? Math.max(-25, Math.min(25, turnRate * 8.3)) * Math.min(1, agl / 400) : 0;

  // Nose angle: up on the takeoff roll (rotation), well up in the climb, a little
  // up in cruise and on the approach, a flare just before touchdown, then down
  let attTarget: number;
  if (!airborne) {
    attTarget = b.gsKts > 115 && w.accel > 0.4 ? Math.min(8, ((b.gsKts - 115) / 25) * 8) : 0;
  } else {
    attTarget = 2.5 + Math.min(11, (Math.max(0, w.fpm) / 3000) * 9) + Math.max(-3, (Math.min(0, w.fpm) / 2500) * 3);
    if (agl < 70 && w.fpm < 300) attTarget += (1 - agl / 70) * 3.5; // flare
  }
  w.bank += (bankTarget - w.bank) * (1 - Math.exp(-dt / 1100));
  w.attitude += (attTarget - w.attitude) * (1 - Math.exp(-dt / (airborne ? 1100 : 700)));

  // Touchdown: a short jolt that dies away (and a smaller one at liftoff)
  if (w.wasAir !== airborne && dt) w.shakeAt = airborne ? t - 350 : t;
  w.wasAir = airborne;
  const since = t - w.shakeAt;
  let shakeP = 0, shakeZ = 0, shakeR = 0;
  if (since >= 0 && since < 900) {
    const k = Math.exp(-since / 220);
    shakeP = (Math.sin(since / 17) * 1.1 + Math.sin(since / 7.3) * 0.5) * k;
    shakeR = Math.sin(since / 23 + 1) * 0.6 * k;
    shakeZ = (since < 60 ? -0.25 : Math.sin(since / 31) * 0.12) * k;
  }

  const s = w.side === 'right' ? 1 : -1;
  // Straight out, a touch down: the horizon a little above the middle of the window
  const base = 88 - 4 * Math.min(1, agl / 10_000);

  // A last smoothing pass over everything the camera does: it glides after where
  // it should be (like a spring with no bounce), so small kinks in the path, late
  // positions and wobbles in the readings don't reach the screen. The touchdown
  // jolt is added after it, so it stays sharp.
  const sm = w.smooth;
  const wantPitch = base - s * w.bank;
  const wantBearing = w.heading + s * 90;
  const wantRoll = s * w.attitude;
  const wantAlt = agl * 0.3048 + w.eyeM;
  if (!sm || !dt) {
    w.smooth = { lng: [lng, 0], lat: [lat, 0], alt: [wantAlt, 0], pitch: [wantPitch, 0], bearing: [wantBearing, 0], roll: [wantRoll, 0] };
  } else {
    damp(sm.lng, lng, SMOOTH_POS_S, dtS);
    damp(sm.lat, lat, SMOOTH_POS_S, dtS);
    // Never let it lag far on a long frame or a jump it wasn't told about
    if (Math.abs(sm.lng[0] - lng) > 0.02 || Math.abs(sm.lat[0] - lat) > 0.02) (sm.lng = [lng, 0]), (sm.lat = [lat, 0]);
    damp(sm.alt, wantAlt, agl < 30 ? SMOOTH_POS_S * 0.6 : SMOOTH_POS_S, dtS);
    damp(sm.pitch, wantPitch, SMOOTH_ANGLE_S, dtS);
    // (the heading unwrapped, so turning through north doesn't spin round)
    damp(sm.bearing, sm.bearing[0] + angDiff(wantBearing, sm.bearing[0]), SMOOTH_ANGLE_S, dtS);
    damp(sm.roll, wantRoll, SMOOTH_ANGLE_S, dtS);
  }
  const f2 = w.smooth!;
  lng = f2.lng[0];
  lat = f2.lat[0];
  const pitch = Math.max(50, Math.min(100, f2.pitch[0] + shakeP));
  const bearing = ((f2.bearing[0] % 360) + 360) % 360;
  const roll = f2.roll[0] + shakeR;

  // The wing: flaps out low and slow, spoilers up on the landing roll, ailerons in roll
  const slow = b.gsKts < 230;
  const want: WingParts = {
    flaps: airborne ? (agl < 6000 && slow ? Math.min(1, 0.35 + (1 - agl / 6000) * 0.8) : 0) : b.gsKts > 30 ? 0.45 : 0,
    spoilers: !airborne && b.gsKts > 30 && w.accel < -0.3 ? 1 : 0,
    aileron: Math.max(-1, Math.min(1, (s * (bankTarget - w.bank)) / 8)),
  };
  // Flaps run out slowly, spoilers pop up quickly
  const ease = (k: keyof WingParts, tau: number) => {
    w.parts[k] += (want[k] - w.parts[k]) * (dt ? 1 - Math.exp(-dt / tau) : 1);
  };
  ease('flaps', 4000);
  ease('spoilers', 350);
  ease('aileron', 700);
  const wing: WingParts = { ...w.parts };
  return { lng, lat, altM: Math.max(0.5, Math.max(f2.alt[0], w.eyeM * 0.8) + shakeZ), bearing, pitch, roll, base, aglFt: agl, gsKts: b.gsKts, wing, fpm: w.fpm };
}

/** Moves the map's camera to the window (at most ~30 times a second). */
export function placeWindowCamera(map: any, w: WindowState, t: number, mapRate: number): boolean {
  if (t - w.lastPlace < PLACE_MS) return false;
  const cam = windowCamera(w, t, mapRate);
  if (!cam) return false;
  w.lastPlace = t;
  w.last = cam;
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
    // fog from close in, so the far edge of the ground (where the map stops drawing) melts into haze
    'fog-ground-blend': 0.12,
    'atmosphere-blend': 0,
  };
}
