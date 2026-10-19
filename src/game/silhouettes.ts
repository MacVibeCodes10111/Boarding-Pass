// ============================================================================
// MAP AIRCRAFT SILHOUETTES
//   One top-down silhouette per visually distinct airframe family, drawn on a
//   canvas from a small parametric spec (fuselage, wing, tail, engines). The
//   layouts follow the real aircraft: where the engines hang, high or low wing,
//   T-tail, tail engine, upper deck. Coordinates are in a 64-unit box with the
//   nose pointing up; the canvas is scaled to whatever size is asked for.
// ============================================================================
import type { RadarIconGroup } from './types';

interface WingSpec {
  /** Distance from the nose to the wing root leading edge. */
  rootY: number;
  rootChord: number;
  /** Half span, from the centreline. */
  span: number;
  /** How far aft the tip leading edge sits behind the root leading edge. */
  sweep: number;
  tipChord: number;
}

interface EngineSpec {
  /** Distance from the centreline (mirrored to both sides). */
  x: number;
  /** Distance from the nose to the pod's front. */
  y: number;
  w: number;
  len: number;
  /** Turboprop: draws a propeller disc ahead of the nacelle. */
  prop?: number;
}

interface SilhouetteSpec {
  /** Fuselage length and half width. */
  len: number;
  w: number;
  /** Nose taper length; tail cone length and half width at the very end. */
  nose: number;
  tail: number;
  tailEnd: number;
  /** Wider front fuselage for a short distance (747 upper deck). */
  hump?: { len: number; extra: number };
  wing: WingSpec;
  /** High wing: drawn over the fuselage. */
  highWing?: boolean;
  stab: WingSpec;
  /** T-tail: tailplane drawn over everything at the top of the fin. */
  tTail?: boolean;
  /** Engines under or on the wing, mirrored. */
  engines: EngineSpec[];
  /** Engines on the rear fuselage, mirrored. */
  rearEngines?: { y: number; w: number; len: number };
  /** Third engine on the centreline at the tail (trijets). */
  tailEngine?: { y: number; w: number; len: number };
  /** Winglets or raked tips, as a short fence at each tip. */
  tipFence?: number;
}

/** Display names, used in menus and docs. */
export const SILHOUETTE_LABELS: Record<RadarIconGroup, string> = {
  commuter: 'Commuter turboprop (Twin Otter, Beech 1900)',
  prop: 'Regional turboprop (ATR, Dash 8, MA60, An-24)',
  rj_tail: 'Rear-engine regional jet (CRJ, ERJ-145, ARJ21, Fokker 100)',
  small_jet: 'Regional jet (E-Jets, A220, Superjet)',
  rear_jet: 'Rear-engine narrowbody (MD-80/90, 717, DC-9)',
  medium_jet: 'Narrowbody (A320 family, 737, C919)',
  long_narrow: 'Long narrowbody (757, Tu-204)',
  large_jet: 'Widebody twin (A330, A350, 767, 787, A300)',
  heavy_twin: 'Large widebody twin (777, 777X)',
  trijet: 'Trijet (MD-11, DC-10, L-1011)',
  a340: 'Four-engine widebody (A340, Il-96)',
  b747: 'Boeing 747',
  a380: 'Airbus A380',
  high_quad: 'High-wing heavy freighter (Il-76, An-124)',
};

export const SILHOUETTE_SPECS: Record<RadarIconGroup, SilhouetteSpec> = {
  commuter: {
    len: 36, w: 2.3, nose: 5, tail: 10, tailEnd: 0.8,
    wing: { rootY: 11, rootChord: 5.2, span: 20, sweep: 0, tipChord: 4.4 },
    highWing: true,
    stab: { rootY: 30, rootChord: 4.2, span: 8, sweep: 1, tipChord: 3 },
    engines: [{ x: 7.5, y: 8.5, w: 2.8, len: 7.5, prop: 8 }],
  },
  prop: {
    len: 44, w: 2.8, nose: 6, tail: 12, tailEnd: 0.9,
    wing: { rootY: 14, rootChord: 5.8, span: 24, sweep: 0.6, tipChord: 3.6 },
    highWing: true,
    stab: { rootY: 38.5, rootChord: 4, span: 8.5, sweep: 1.5, tipChord: 2.6 },
    tTail: true,
    engines: [{ x: 8.5, y: 10.5, w: 3.2, len: 10, prop: 9 }],
  },
  rj_tail: {
    len: 46, w: 2.6, nose: 7, tail: 11, tailEnd: 0.8,
    wing: { rootY: 17, rootChord: 8.5, span: 19.5, sweep: 7.5, tipChord: 3.2 },
    stab: { rootY: 41, rootChord: 4.2, span: 8.5, sweep: 3.2, tipChord: 2.4 },
    tTail: true,
    engines: [],
    rearEngines: { y: 30, w: 4, len: 9.5 },
    tipFence: 1.6,
  },
  small_jet: {
    len: 46, w: 2.8, nose: 7.5, tail: 11, tailEnd: 0.9,
    wing: { rootY: 18, rootChord: 9, span: 21, sweep: 8, tipChord: 3.2 },
    stab: { rootY: 38.5, rootChord: 5, span: 9, sweep: 3.6, tipChord: 2.6 },
    engines: [{ x: 7.6, y: 13.5, w: 3.8, len: 8.5 }],
    tipFence: 1.8,
  },
  rear_jet: {
    len: 52, w: 2.8, nose: 8, tail: 12, tailEnd: 0.8,
    wing: { rootY: 18, rootChord: 10, span: 21.5, sweep: 9, tipChord: 3.2 },
    stab: { rootY: 47, rootChord: 4.6, span: 9.5, sweep: 3.8, tipChord: 2.4 },
    tTail: true,
    engines: [],
    rearEngines: { y: 35, w: 4.2, len: 10.5 },
  },
  medium_jet: {
    len: 50, w: 3.1, nose: 8, tail: 12, tailEnd: 1,
    wing: { rootY: 18.5, rootChord: 10.5, span: 23.5, sweep: 10, tipChord: 3.2 },
    stab: { rootY: 41, rootChord: 5.4, span: 10, sweep: 4.2, tipChord: 2.6 },
    engines: [{ x: 8.6, y: 13.5, w: 4.3, len: 9 }],
    tipFence: 2,
  },
  long_narrow: {
    len: 56, w: 3.1, nose: 8.5, tail: 13, tailEnd: 1,
    wing: { rootY: 20, rootChord: 11, span: 25, sweep: 11, tipChord: 3.2 },
    stab: { rootY: 46.5, rootChord: 5.6, span: 10.5, sweep: 4.4, tipChord: 2.6 },
    engines: [{ x: 9.2, y: 14.5, w: 4.8, len: 10 }],
  },
  large_jet: {
    len: 56, w: 4.1, nose: 9, tail: 14, tailEnd: 1.1,
    wing: { rootY: 20, rootChord: 13, span: 28, sweep: 13, tipChord: 3.6 },
    stab: { rootY: 45.5, rootChord: 6.5, span: 12, sweep: 5.2, tipChord: 3 },
    engines: [{ x: 11, y: 15.5, w: 5.8, len: 11 }],
    tipFence: 2,
  },
  heavy_twin: {
    len: 62, w: 4.4, nose: 9.5, tail: 15, tailEnd: 1.1,
    wing: { rootY: 22, rootChord: 14, span: 30, sweep: 14.5, tipChord: 3.4 },
    stab: { rootY: 50.5, rootChord: 7, span: 13, sweep: 5.6, tipChord: 3 },
    engines: [{ x: 11.8, y: 16, w: 7, len: 13 }],
  },
  trijet: {
    len: 58, w: 4.0, nose: 9, tail: 12, tailEnd: 1.6,
    wing: { rootY: 21, rootChord: 13, span: 27.5, sweep: 13.5, tipChord: 3.4 },
    stab: { rootY: 47, rootChord: 6.4, span: 12, sweep: 5, tipChord: 2.8 },
    engines: [{ x: 11, y: 16.5, w: 5.4, len: 10.5 }],
    tailEngine: { y: 46, w: 4.8, len: 12.5 },
    tipFence: 2,
  },
  a340: {
    len: 62, w: 3.8, nose: 9.5, tail: 15, tailEnd: 1.1,
    wing: { rootY: 22, rootChord: 13, span: 29, sweep: 14, tipChord: 3.2 },
    stab: { rootY: 51, rootChord: 6.6, span: 12, sweep: 5, tipChord: 2.8 },
    engines: [
      { x: 9.5, y: 19, w: 3.6, len: 8 },
      { x: 18.5, y: 24.5, w: 3.4, len: 7.5 },
    ],
    tipFence: 2.2,
  },
  b747: {
    len: 60, w: 4.3, nose: 8, tail: 14, tailEnd: 1.1,
    hump: { len: 22, extra: 0.9 },
    wing: { rootY: 22, rootChord: 15, span: 30, sweep: 17, tipChord: 3.6 },
    stab: { rootY: 48.5, rootChord: 7.2, span: 13, sweep: 6, tipChord: 3 },
    engines: [
      { x: 10.5, y: 19, w: 4.2, len: 8.5 },
      { x: 19.5, y: 25.5, w: 4.0, len: 8 },
    ],
    tipFence: 2,
  },
  a380: {
    len: 60, w: 5.4, nose: 9, tail: 14, tailEnd: 1.3,
    wing: { rootY: 20, rootChord: 18, span: 31, sweep: 15.5, tipChord: 4 },
    stab: { rootY: 46, rootChord: 8, span: 14, sweep: 6, tipChord: 3.4 },
    engines: [
      { x: 11.5, y: 17.5, w: 5, len: 9.5 },
      { x: 20.5, y: 23, w: 4.8, len: 9 },
    ],
    tipFence: 2.8,
  },
  high_quad: {
    len: 60, w: 4.4, nose: 7, tail: 13, tailEnd: 1.2,
    wing: { rootY: 21, rootChord: 13, span: 30, sweep: 11, tipChord: 4.2 },
    highWing: true,
    stab: { rootY: 50, rootChord: 6.5, span: 12.5, sweep: 4, tipChord: 3.2 },
    tTail: true,
    engines: [
      { x: 10.5, y: 18, w: 4, len: 8.5 },
      { x: 19, y: 22, w: 3.8, len: 8 },
    ],
  },
};

export const SILHOUETTE_GROUPS = Object.keys(SILHOUETTE_SPECS) as RadarIconGroup[];

/** Draws a silhouette into ctx, nose up, centred on (0,0), in 64-unit space. */
function drawSpec(ctx: CanvasRenderingContext2D, s: SilhouetteSpec) {
  const top = -s.len / 2;
  const at = (y: number) => top + y; // nose-relative → canvas
  const outline = () => {
    ctx.fill();
    ctx.stroke();
  };

  const wingPath = (wg: WingSpec, rootHalf: number) => {
    for (const side of [1, -1]) {
      ctx.beginPath();
      ctx.moveTo(side * rootHalf * 0.6, at(wg.rootY));
      ctx.lineTo(side * wg.span, at(wg.rootY + wg.sweep));
      ctx.lineTo(side * wg.span, at(wg.rootY + wg.sweep + wg.tipChord));
      ctx.lineTo(side * rootHalf * 0.6, at(wg.rootY + wg.rootChord));
      ctx.closePath();
      outline();
    }
  };
  const fence = (wg: WingSpec, h: number) => {
    for (const side of [1, -1]) {
      ctx.beginPath();
      ctx.moveTo(side * wg.span, at(wg.rootY + wg.sweep - h * 0.4));
      ctx.lineTo(side * wg.span, at(wg.rootY + wg.sweep + wg.tipChord + h * 0.2));
      ctx.lineWidth = 2.6;
      ctx.stroke();
      ctx.lineWidth = LINE;
    }
  };
  const pod = (cx: number, y: number, w: number, len: number) => {
    const r = w / 2;
    ctx.beginPath();
    ctx.moveTo(cx - r, at(y + r));
    ctx.arcTo(cx - r, at(y), cx, at(y), r);
    ctx.arcTo(cx + r, at(y), cx + r, at(y + r), r);
    ctx.lineTo(cx + r * 0.8, at(y + len));
    ctx.lineTo(cx - r * 0.8, at(y + len));
    ctx.closePath();
    outline();
  };
  const propDisc = (cx: number, y: number, span: number) => {
    ctx.beginPath();
    ctx.moveTo(cx - span / 2, at(y - 0.8));
    ctx.lineTo(cx + span / 2, at(y - 0.8));
    ctx.lineWidth = 3.4;
    ctx.strokeStyle = STROKE;
    ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = ctx.fillStyle as string;
    ctx.stroke();
    ctx.lineWidth = LINE;
    ctx.strokeStyle = STROKE;
  };
  const fuselage = () => {
    const { w, nose, tail, tailEnd } = s;
    const len = s.len;
    const hw = s.hump ? w + s.hump.extra : w;
    ctx.beginPath();
    ctx.moveTo(0, at(0));
    ctx.quadraticCurveTo(hw, at(0), hw, at(nose));
    if (s.hump) {
      ctx.lineTo(hw, at(s.hump.len - 4));
      ctx.quadraticCurveTo(hw, at(s.hump.len), w, at(s.hump.len + 2));
    }
    ctx.lineTo(w, at(len - tail));
    ctx.quadraticCurveTo(w, at(len - tail * 0.25), tailEnd, at(len));
    ctx.lineTo(-tailEnd, at(len));
    ctx.quadraticCurveTo(-w, at(len - tail * 0.25), -w, at(len - tail));
    if (s.hump) {
      ctx.lineTo(-w, at(s.hump.len + 2));
      ctx.quadraticCurveTo(-hw, at(s.hump.len), -hw, at(s.hump.len - 4));
    }
    ctx.lineTo(-hw, at(nose));
    ctx.quadraticCurveTo(-hw, at(0), 0, at(0));
    ctx.closePath();
    outline();
  };

  // Low tailplane sits under the fuselage; a T-tail is drawn last, on top
  if (!s.tTail) wingPath(s.stab, s.w);
  if (!s.highWing) {
    // Underwing engines show ahead of the wing's leading edge
    for (const e of s.engines) for (const side of [1, -1]) pod(side * e.x, e.y, e.w, e.len);
    wingPath(s.wing, s.w);
    if (s.tipFence) fence(s.wing, s.tipFence);
  }
  fuselage();
  if (s.highWing) {
    for (const e of s.engines) for (const side of [1, -1]) if (!e.prop) pod(side * e.x, e.y, e.w, e.len);
    wingPath(s.wing, 0);
    // Turboprop nacelles sit on top of a high wing, propellers out front
    for (const e of s.engines) for (const side of [1, -1]) if (e.prop) {
      pod(side * e.x, e.y, e.w, e.len);
      propDisc(side * e.x, e.y, e.prop);
    }
  }
  if (s.rearEngines) for (const side of [1, -1]) pod(side * (s.w + s.rearEngines.w / 2 + 0.2), s.rearEngines.y, s.rearEngines.w, s.rearEngines.len);
  if (s.tTail) wingPath(s.stab, s.w * 0.6);
  if (s.tailEngine) pod(0, s.tailEngine.y, s.tailEngine.w, s.tailEngine.len);
}

const STROKE = '#090d16';
const LINE = 1.6;

export function drawSilhouette(group: RadarIconGroup, fillHex: string, size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.translate(size / 2, size / 2);
  ctx.scale(size / 64, size / 64);
  ctx.fillStyle = fillHex;
  ctx.strokeStyle = STROKE;
  ctx.lineWidth = LINE;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  drawSpec(ctx, SILHOUETTE_SPECS[group] ?? SILHOUETTE_SPECS.medium_jet);
  return canvas;
}
