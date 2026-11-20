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
  /** The weather where it's flying (set from the airports' weather once a second). */
  wx: WindowWeather;
  /** How this landing goes (one of LANDINGS, picked per flight and day). */
  style: LandingStyle;
  /** Track over the ground (eased) and its rate of turn (deg per map second, eased). */
  track: number;
  turn: number;
  /** Nose off the track into a crosswind, degrees. */
  crab: number;
  /** In the flare: its own height (ft) and the sink rate it started with (ft/min); then landed. */
  flaring: boolean;
  flareH: number;
  flareV0: number;
  landed: boolean;
  /** Main wheels on (ms), nose wheel on, a bounce, and the nose angle at touchdown. */
  touchAt: number;
  noseAt: number;
  bounceAt: number;
  touchAtt: number;
  /** Random phases for the turbulence. */
  phase: number[];
}

/** The weather the window flies through. */
export interface WindowWeather {
  /** 0 calm … 1 rough. */
  turb: number;
  /** Wind (from, degrees) and speed, kt. */
  windFrom: number;
  windKts: number;
}

/**
 * How a landing goes: when the flare starts, how firmly it touches, the nose
 * angles, how long the nose takes to come down, how hard the thump is. Real
 * landings: a 3° approach at about 700 ft/min, the flare from 20-50 ft, touchdown
 * at 60-300 ft/min, the nose lowered over 3-7 s.
 */
export interface LandingStyle {
  name: string;
  flareFt: number;
  touchFpm: number;
  /** Nose up on the approach, and how much more in the flare, degrees. */
  approachPitch: number;
  flarePitch: number;
  /** Held on the main wheels, then the nose lowered over, seconds. */
  holdS: number;
  lowerS: number;
  /** How hard the wheels thump (1 = firm). */
  thump: number;
  /** A little skip back into the air, m (0: none). */
  bounceM: number;
  /** Rocking the wings on the approach, degrees. */
  rock: number;
}
export const LANDINGS: LandingStyle[] = [
  { name: 'Standard', flareFt: 30, touchFpm: 150, approachPitch: 2.8, flarePitch: 2.4, holdS: 1.2, lowerS: 3.4, thump: 0.45, bounceM: 0, rock: 0.3 },
  { name: 'Butter', flareFt: 36, touchFpm: 70, approachPitch: 2.6, flarePitch: 3, holdS: 2, lowerS: 4, thump: 0.18, bounceM: 0, rock: 0.2 },
  { name: 'Firm', flareFt: 22, touchFpm: 300, approachPitch: 3, flarePitch: 1.8, holdS: 0.6, lowerS: 2.8, thump: 1, bounceM: 0, rock: 0.3 },
  { name: 'Long float', flareFt: 42, touchFpm: 60, approachPitch: 2.5, flarePitch: 3.4, holdS: 1.8, lowerS: 4.4, thump: 0.15, bounceM: 0, rock: 0.4 },
  { name: 'Late flare', flareFt: 18, touchFpm: 240, approachPitch: 3.2, flarePitch: 2, holdS: 0.8, lowerS: 3, thump: 0.75, bounceM: 0, rock: 0.3 },
  { name: 'Early flare', flareFt: 50, touchFpm: 120, approachPitch: 2.7, flarePitch: 2.8, holdS: 1.4, lowerS: 3.8, thump: 0.35, bounceM: 0, rock: 0.25 },
  { name: 'Small bounce', flareFt: 25, touchFpm: 260, approachPitch: 2.9, flarePitch: 2.2, holdS: 1, lowerS: 3.2, thump: 0.7, bounceM: 0.45, rock: 0.35 },
  { name: 'Nose high', flareFt: 32, touchFpm: 130, approachPitch: 3.4, flarePitch: 3.6, holdS: 2.2, lowerS: 4.6, thump: 0.35, bounceM: 0, rock: 0.2 },
  { name: 'Flat', flareFt: 24, touchFpm: 200, approachPitch: 2.2, flarePitch: 1.2, holdS: 0.5, lowerS: 2.4, thump: 0.6, bounceM: 0, rock: 0.3 },
  { name: 'Heavy and steady', flareFt: 35, touchFpm: 180, approachPitch: 2.4, flarePitch: 2, holdS: 1.5, lowerS: 4.2, thump: 0.55, bounceM: 0, rock: 0.1 },
  { name: 'Wing rocking', flareFt: 30, touchFpm: 170, approachPitch: 2.8, flarePitch: 2.5, holdS: 1, lowerS: 3.4, thump: 0.5, bounceM: 0, rock: 1.3 },
  { name: 'Quick nose down', flareFt: 28, touchFpm: 210, approachPitch: 2.9, flarePitch: 2.3, holdS: 0.4, lowerS: 2, thump: 0.65, bounceM: 0, rock: 0.3 },
];
const hashStr = (x: string) => {
  let h = 2166136261;
  for (let i = 0; i < x.length; i++) h = Math.imul(h ^ x.charCodeAt(i), 16777619);
  return h >>> 0;
};
/** This flight's landing today. */
export const landingFor = (flightId: string, dayKey: number) => LANDINGS[hashStr(`${flightId}:${dayKey}`) % LANDINGS.length];

export function newWindowState(flightId: string, side: WindowSide, heading = 0): WindowState {
  const seed = hashStr(flightId);
  const phase = Array.from({ length: 24 }, (_, i) => ((Math.imul(seed ^ (i * 2654435761), 2246822519) >>> 0) / 4294967296) * Math.PI * 2);
  return {
    flightId, side, eyeM: 3.4, samples: [], heading, bank: 0, attitude: 0, fpm: 0, accel: 0, agl: null,
    parts: { flaps: 0, spoilers: 0, aileron: 0 }, wasAir: false, shakeAt: -1e9, off: { lng: 0, lat: 0, agl: 0 }, lastPlace: 0, lastT: 0,
    wx: { turb: 0.06, windFrom: 0, windKts: 0 }, style: landingFor(flightId, Math.floor(Date.now() / 86_400_000)),
    track: heading, turn: 0, crab: 0, flaring: false, flareH: 0, flareV0: 700, landed: false, touchAt: -1e9, noseAt: -1e9, bounceAt: -1e9, touchAtt: 0, phase,
  };
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
  // Height: the positions are to the foot, so no easing here (the last smoothing pass rounds off level-offs)
  const prevAgl = w.agl ?? rawAgl;
  w.agl = rawAgl;
  const dataAgl = rawAgl;
  const st = w.style;

  // Climb rate and speed change in map time, eased
  const mapMinNow = (dtS / 60) * rate;
  if (mapMinNow > 0 && !w.flaring) w.fpm += ((dataAgl - prevAgl) / mapMinNow - w.fpm) * (1 - Math.exp(-dt / 1500));

  // The flare, like a real one: from the flare height the sink rate bleeds off (the
  // nearer the ground, the slower), so it floats for a few seconds and the wheels
  // touch gently a little further down the runway (after the map's own touchdown)
  if (!w.flaring && !w.landed && dataAgl > 0.5 && dataAgl < st.flareFt && w.fpm < -200) {
    w.flaring = true;
    w.flareH = dataAgl;
    w.flareV0 = Math.min(1500, -w.fpm);
  }
  if (w.flaring) {
    const sink = st.touchFpm + (w.flareV0 - st.touchFpm) * Math.max(0, w.flareH / st.flareFt); // ft/min
    w.flareH = Math.max(0, w.flareH - (sink / 60) * dtS * rate);
    if (dataAgl > w.flareH + 40) w.flaring = false; // (climbing away: back to the map's height)
    else if (w.flareH <= 0) {
      w.flaring = false;
      w.landed = true;
    }
  }
  if (w.landed && dataAgl > 30) w.landed = false; // airborne again (a new flight)
  const agl = w.flaring ? w.flareH : w.landed ? 0 : dataAgl;
  const airborne = agl > 0.5;
  const accelNow = (b.gsKts - a.gsKts) / ((span / 1000) * rate);
  if (dt) w.accel += (accelNow - w.accel) * (1 - Math.exp(-dt / 1200));
  const gs = b.gsKts;

  // Track over the ground: from where it's been over the last second (smooth along
  // the rounded turns, where the reported heading moves in whole degrees); on the
  // ground at taxi speeds, the reported heading
  let trackNow: number | null = null;
  if (gs > 40 && n > 1) {
    let k = n - 2;
    while (k > 0 && b.t - ss[k].t < 800) k--;
    const dM = Math.hypot((b.lng - ss[k].lng) * Math.cos(b.lat * DEG) * M_PER_DEG, (b.lat - ss[k].lat) * M_PER_DEG);
    if (dM > 15) trackNow = trackBetween(ss[k], b);
  }
  const target = trackNow ?? b.heading ?? trackBetween(a, b) ?? w.track;
  const prevTrack = w.track;
  const e = 1 - Math.exp(-dt / (airborne ? 600 : 700));
  w.track = (w.track + angDiff(target, w.track) * (dt ? e : 1) + 360) % 360;
  w.heading = w.track;

  // Bank as a real turn needs it: tan(bank) = speed × rate of turn / g (a standard-rate
  // turn at 250 kt is about 25°), rolled in and out at a few degrees a second
  const mapSecs = dtS * rate;
  const turnNow = mapSecs > 0 ? angDiff(w.track, prevTrack) / mapSecs : 0;
  if (dt) w.turn += (turnNow - w.turn) * (1 - Math.exp(-dt / 900));
  const bankPhys = (Math.atan((gs * 0.514444 * w.turn * DEG) / 9.81) / DEG) * Math.min(1, agl / 300);
  // Crosswind: the nose points a little into the wind, straightened just before
  // touchdown with the into-wind wing a touch low
  const xw = w.wx.windKts * Math.sin((w.wx.windFrom - w.track) * DEG); // + from the right
  const crabTarget = airborne && gs > 60 ? Math.max(-12, Math.min(12, Math.atan2(xw, Math.max(gs, 100)) / DEG)) * Math.max(0, Math.min(1, (agl - 6) / 30)) : 0;
  if (dt) w.crab += (crabTarget - w.crab) * (1 - Math.exp(-dt / (agl < 40 ? 900 : 2500)));
  const wingLow = airborne && agl < 80 ? Math.max(-3, Math.min(3, xw * 0.12)) * Math.max(0, 1 - agl / 80) : 0;
  const bankTarget = Math.max(-27, Math.min(27, bankPhys + wingLow));
  const bankStep = 6 * dtS; // degrees a second, at most
  w.bank += Math.max(-bankStep, Math.min(bankStep, (bankTarget - w.bank) * (dt ? 1 - Math.exp(-dt / 500) : 1)));

  const shown = agl;
  const flareU = w.flaring ? Math.max(0, Math.min(1, 1 - agl / st.flareFt)) : 0; // 0 above the flare … 1 at touchdown

  // Touchdown and lowering the nose
  if (w.wasAir && !airborne && dt) {
    w.touchAt = t;
    w.touchAtt = w.attitude;
    w.noseAt = -1e9;
    if (st.bounceM > 0) w.bounceAt = t;
  }
  if (!w.wasAir && airborne && dt) w.shakeAt = t; // liftoff
  w.wasAir = airborne;
  const sinceTouch = (t - w.touchAt) / 1000;

  // Nose angle: rotation on the takeoff roll, well up in the climb, a little up in
  // cruise and on the approach, more in the flare; after touchdown held, then lowered
  let attTarget: number;
  let attTau = airborne ? 1200 : 700;
  if (!airborne) {
    if (sinceTouch < st.holdS + st.lowerS + 0.5) {
      const u = Math.max(0, Math.min(1, (sinceTouch - st.holdS) / st.lowerS));
      attTarget = w.touchAtt * (1 - u * u * (3 - 2 * u));
      attTau = 200;
      if (u >= 1 && w.noseAt < w.touchAt) w.noseAt = t;
    } else attTarget = gs > 115 && w.accel > 0.4 ? Math.min(8, ((gs - 115) / 25) * 8) : 0;
  } else if (w.fpm > 300) {
    attTarget = 2.5 + Math.min(12, (w.fpm / 3000) * 10);
  } else if (w.flaring || (agl < 2500 && w.fpm < -300 && gs < 200)) {
    attTarget = st.approachPitch + st.flarePitch * flareU * flareU * (3 - 2 * flareU);
    if (w.flaring) attTau = 450;
  } else {
    attTarget = 2.5 + Math.max(-2, (Math.min(0, w.fpm) / 2500) * 2);
  }
  w.attitude += (attTarget - w.attitude) * (dt ? 1 - Math.exp(-dt / attTau) : 1);

  // Bumps that aren't smoothed: turbulence (by the weather, most of it low down,
  // hardly any up high), the wheels thumping on, the runway's rumble
  const tS = t / 1000;
  const ph = w.phase;
  const noise = (c: number) => {
    const o = c * 4;
    // Mostly slow sway; only a touch of the quicker jiggle (that read as shake)
    return (Math.sin(tS * 0.61 + ph[o]) + 0.55 * Math.sin(tS * 1.37 + ph[o + 1]) + 0.18 * Math.sin(tS * 2.6 + ph[o + 2]) + 0.05 * Math.sin(tS * 4.7 + ph[o + 3])) / 1.78;
  };
  const altK = !airborne ? 0 : agl < 3000 ? Math.min(1, 0.55 + agl / 600) : agl < 12_000 ? 1 - ((agl - 3000) / 9000) * 0.65 : Math.max(0.05, 0.35 - ((agl - 12_000) / 13_000) * 0.3);
  const turb = w.wx.turb * altK;
  let bumpPitch = turb * 0.25 * noise(0); // the aircraft's nose
  let bumpBank = turb * 0.55 * noise(1) + (airborne && agl < 1500 ? st.rock * Math.sin(tS * 0.7 + ph[20]) * Math.min(1, agl / 200) : 0);
  let bumpZ = turb * 0.8 * noise(2);
  const bumpYaw = turb * 0.2 * noise(3);
  let flex = turb * 0.9 * noise(4);
  // Main wheels: a short sink as the gear takes the weight, a little rock, the wings flex down
  const thump = (since: number, k: number) => {
    if (since < 0 || since > 1.6) return;
    const d = Math.exp(-since / 0.22);
    bumpZ += -0.07 * k * d * Math.cos(since * 2 * Math.PI * 2.1);
    bumpPitch += 0.18 * k * d * Math.sin(since * 2 * Math.PI * 1.7);
    bumpBank += 0.12 * k * d * Math.sin(since * 2 * Math.PI * 1.3 + 1);
    flex += -0.8 * k * Math.exp(-since / 0.4) * Math.cos(since * 2 * Math.PI * 1.5);
  };
  // A bounce: back up a little, then down again more softly
  let bounceZ = 0;
  const sinceBounce = (t - w.bounceAt) / 1000;
  if (sinceBounce >= 0 && sinceBounce < 1.1) bounceZ = st.bounceM * Math.sin((Math.PI * sinceBounce) / 1.1);
  if (!airborne) {
    thump(sinceTouch, st.thump);
    if (st.bounceM > 0) thump(sinceBounce - 1.1, st.thump * 0.55);
    // Nose wheel: a smaller one, the nose settling
    const sinceNose = (t - w.noseAt) / 1000;
    if (sinceNose >= 0 && sinceNose < 1) {
      const d = Math.exp(-sinceNose / 0.18);
      bumpZ += -0.03 * st.thump * d * Math.cos(sinceNose * 2 * Math.PI * 2.4);
      bumpPitch += -0.12 * st.thump * d * Math.cos(sinceNose * 2 * Math.PI * 2);
    }
    // The runway (and taxiways) rumbling under the wheels
    const r = Math.min(1, gs / 140);
    bumpZ += r * 0.006 * (Math.sin(tS * 46) + 0.6 * Math.sin(tS * 71 + 1));
    bumpPitch += r * 0.018 * Math.sin(tS * 32 + 2);
    flex += r * 0.06 * Math.sin(tS * 38);
  } else {
    // Liftoff: the wheels leave and the wings take the weight
    const sinceLift = (t - w.shakeAt) / 1000;
    if (sinceLift >= 0 && sinceLift < 2) flex += 0.35 * Math.exp(-sinceLift / 0.6) * Math.sin(sinceLift * 2 * Math.PI * 0.9);
  }

  const s = w.side === 'right' ? 1 : -1;
  // Straight out, a touch down: the horizon a little above the middle of the window
  const base = 88 - 4 * Math.min(1, agl / 10_000);

  // A last smoothing pass over everything the camera does: it glides after where
  // it should be (like a spring with no bounce), so small kinks in the path, late
  // positions and wobbles in the readings don't reach the screen. The bumps are
  // added after it, so they stay crisp.
  const sm = w.smooth;
  const wantPitch = base - s * w.bank;
  const wantBearing = w.track + w.crab + s * 90;
  const wantRoll = s * w.attitude;
  const wantAlt = shown * 0.3048 + w.eyeM;
  if (!sm || !dt) {
    w.smooth = { lng: [lng, 0], lat: [lat, 0], alt: [wantAlt, 0], pitch: [wantPitch, 0], bearing: [wantBearing, 0], roll: [wantRoll, 0] };
  } else {
    damp(sm.lng, lng, SMOOTH_POS_S, dtS);
    damp(sm.lat, lat, SMOOTH_POS_S, dtS);
    // Never let it lag far on a long frame or a jump it wasn't told about
    if (Math.abs(sm.lng[0] - lng) > 0.02 || Math.abs(sm.lat[0] - lat) > 0.02) (sm.lng = [lng, 0]), (sm.lat = [lat, 0]);
    damp(sm.alt, wantAlt, agl < 60 ? 0.12 : SMOOTH_POS_S, dtS);
    damp(sm.pitch, wantPitch, SMOOTH_ANGLE_S, dtS);
    // (the heading unwrapped, so turning through north doesn't spin round)
    damp(sm.bearing, sm.bearing[0] + angDiff(wantBearing, sm.bearing[0]), SMOOTH_ANGLE_S, dtS);
    damp(sm.roll, wantRoll, SMOOTH_ANGLE_S, dtS);
  }
  const f2 = w.smooth!;
  lng = f2.lng[0];
  lat = f2.lat[0];
  const pitch = Math.max(50, Math.min(100, f2.pitch[0] - s * bumpBank));
  const bearing = (((f2.bearing[0] + bumpYaw) % 360) + 360) % 360;
  const roll = f2.roll[0] + s * bumpPitch;

  // The wing: flaps out low and slow, spoilers up on the landing roll, ailerons in roll
  const slow = gs < 230;
  const want: WingParts = {
    flaps: airborne ? (agl < 6000 && slow ? Math.min(1, 0.35 + (1 - agl / 6000) * 0.8) : 0) : gs > 30 ? 0.45 : 0,
    spoilers: !airborne && gs > 30 && (w.accel < -0.3 || sinceTouch < 25) && sinceTouch > 0.4 ? 1 : 0,
    aileron: Math.max(-1, Math.min(1, (s * (bankTarget - w.bank + bumpBank * 2)) / 8)),
  };
  // Flaps run out slowly, spoilers pop up quickly
  const ease = (k: keyof WingParts, tau: number) => {
    w.parts[k] += (want[k] - w.parts[k]) * (dt ? 1 - Math.exp(-dt / tau) : 1);
  };
  ease('flaps', 4000);
  ease('spoilers', 350);
  ease('aileron', 700);
  const wing: WingParts = { ...w.parts };
  return { lng, lat, altM: Math.max(0.5, Math.max(f2.alt[0], w.eyeM * 0.8) + bumpZ + bounceZ), bearing, pitch, roll, base, aglFt: shown, gsKts: gs, wing, fpm: w.fpm, flex: Math.max(-1, Math.min(1, flex)), style: st.name };
}

/** The highest the map's own camera looks (degrees from straight down): just under level. */
const PITCH_CAP = 88.5;

/** Moves the map's camera to the window (at most ~30 times a second). */
export function placeWindowCamera(map: any, w: WindowState, t: number, mapRate: number): boolean {
  if (t - w.lastPlace < PLACE_MS) return false;
  const cam = windowCamera(w, t, mapRate);
  if (!cam) return false;
  w.lastPlace = t;
  w.last = cam;
  try {
    if ((map.getMaxPitch?.() ?? 85) < 100) map.setMaxPitch?.(100);
    // The map draws no ground once the camera looks above level (a bank away from the
    // window looks up into the sky): it stays just under level, and the rest of the look
    // up is a lens shift (the picture slides down, the ground stays in the window's foot)
    const pitch = Math.min(cam.pitch, PITCH_CAP);
    const opts = map.calculateCameraOptionsFromCameraLngLatAltRotation?.([cam.lng, cam.lat], cam.altM, cam.bearing, pitch, cam.roll);
    if (opts) {
      const h = map.getCanvas?.()?.clientHeight ?? 0;
      const fov = map.getVerticalFieldOfView?.() ?? 36.87;
      const shift = h && cam.pitch > PITCH_CAP ? ((h / 2) / Math.tan((fov * DEG) / 2)) * Math.tan((cam.pitch - PITCH_CAP) * DEG) : 0;
      opts.padding = { top: Math.min(h * 0.9, 2 * shift), bottom: 0, left: 0, right: 0 };
      map.jumpTo(opts);
    }
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
  /** The haze of distance over the ground. */
  haze: string;
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
  const day = { sky: '#4f86d4', horizon: '#cfe2f4', fog: '#dbe7f2', haze: '#a9c0df', wing: '#d5dae1', wingDark: '#9aa3ae', wall: '#e8e5de', wallShade: '#bdb8ae' };
  const dusk = { sky: '#4c5f99', horizon: '#f0a66e', fog: '#d9a684', haze: '#9c93b4', wing: '#b9a99c', wingDark: '#7d7069', wall: '#d9d2c6', wallShade: '#a59c8f' };
  const night = { sky: '#070c18', horizon: '#18233b', fog: '#121a2c', haze: '#0e1526', wing: '#2b313b', wingDark: '#1a1e25', wall: '#3b3a37', wallShade: '#252422' };
  // day above 8°, sunset round 0°, night below -8°
  const pick = (k: keyof typeof day) =>
    sunEl >= 8 ? day[k] : sunEl >= 0 ? mix(dusk[k], day[k], sunEl / 8) : sunEl >= -8 ? mix(night[k], dusk[k], (sunEl + 8) / 8) : night[k];
  return {
    sky: pick('sky'),
    horizon: pick('horizon'),
    fog: pick('fog'),
    haze: pick('haze'),
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
