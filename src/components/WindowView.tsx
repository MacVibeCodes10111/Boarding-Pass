// ============================================================================
// WINDOW VIEW overlay (v3.5.2): the cabin wall, one window (the same for every
// type) and the wing outside it, over the 3D map whose camera sits at the
// window (src/game/windowView.ts). The wing is each aircraft family's own
// (the proportions of its 3D shape, aircraftMeshes.ts, and its type's
// wingtip), drawn in true perspective with the map's own camera, so it sits
// in the world the way a real wing does. It is fixed to the aircraft: no
// looking round. Left / Right picks the side; Esc or Exit goes back.
// ============================================================================
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { aircraftSpec } from '../game/aircraftMeshes';
import type { RadarIconGroup } from '../game/types';
import type { WindowLight, WindowSide, WingParts, WingTip } from '../game/windowView';
import { C, DISPLAY } from '../ui/kit';

export interface WindowHud {
  label: string;
  altText: string;
  gsKts: number;
  /** 0 smooth … 1 bumpy (climbing, descending, taxiing). */
  bump: number;
}

/** The map camera's vertical field of view in the window view (LiveMap sets the same). */
export const WINDOW_FOV_DEG = 50;

const mixHex = (a: string, b: string, f: number) => {
  const p = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const x = p(a), y = p(b);
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * f).toString(16).padStart(2, '0')).join('')}`;
};

type V3 = [number, number, number];
type V2 = [number, number];
const DEG = Math.PI / 180;
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/** Convex hull of screen points (monotone chain). */
function hull(pts: V2[]): V2[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: V2, a: V2, b: V2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: V2[] = [], up: V2[] = [];
  for (const q of p) {
    while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop();
    lo.push(q);
  }
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop();
    up.push(q);
  }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

export function WindowView(props: {
  side: WindowSide;
  light: WindowLight;
  hud: WindowHud;
  wing: WingParts;
  group: RadarIconGroup;
  tip: WingTip;
  /** The camera's pitch from straight down (90 = level), without the bank. */
  basePitch: number;
  onSide: (s: WindowSide) => void;
  onExit: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const topProbe = useRef<HTMLDivElement | null>(null);
  const botProbe = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0, top: 0, bottom: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setSize({ w: el.clientWidth, h: el.clientHeight, top: topProbe.current?.offsetHeight ?? 60, bottom: botProbe.current?.offsetHeight ?? 80 });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onExit();
      else if (e.key === 'ArrowLeft') props.onSide('left');
      else if (e.key === 'ArrowRight') props.onSide('right');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const { w: vw, h: vh } = size;
  const l = props.light;
  const phone = vw < 640;
  // The window: a tall rounded opening, as big as fits. On phones it fills the
  // width (a thinner frame) between the top bar and the readout above the tabs
  const bevelK = phone ? 0.1 : 0.15;
  const byWidth = (vw - (phone ? 10 : 40)) / (0.68 * (1 + 2 * bevelK));
  const top = phone ? size.top + 8 : 34;
  const room = phone ? vh - size.top - size.bottom - 70 : vh - 96;
  const H = Math.max(140, Math.min(room, byWidth, 940));
  const W = H * 0.68;
  const x = (vw - W) / 2;
  const y = top + Math.max(0, (room - H) / 2);
  const r = W * 0.46;
  const bevel = W * bevelK;
  const rr = (px: number, py: number, pw: number, ph: number, pr: number) =>
    `M${px + pr},${py} H${px + pw - pr} A${pr},${pr} 0 0 1 ${px + pw},${py + pr} V${py + ph - pr} A${pr},${pr} 0 0 1 ${px + pw - pr},${py + ph} H${px + pr} A${pr},${pr} 0 0 1 ${px},${py + ph - pr} V${py + pr} A${pr},${pr} 0 0 1 ${px + pr},${py} Z`;
  const hole = rr(x, y, W, H, r);
  const outer = rr(x - bevel, y - bevel * 0.9, W + bevel * 2, H + bevel * 1.8, r + bevel);
  const page = `M0,0 H${vw} V${vh} H0 Z`;

  // ---- The wing, in perspective -------------------------------------------
  // Aircraft frame, half the aircraft's length = 1: x out along the wing on
  // this side, y forward, z up. The eye is at the window; the camera looks
  // straight out, tilted down a touch, with the map's field of view.
  const right = props.side === 'right';
  const sp = aircraftSpec(props.group);
  const fr = sp.r, frz = sp.rz ?? sp.r;
  const high = sp.wingZ > 0;
  const prop = Boolean(sp.props);
  const x0 = fr * 0.8;
  const spanX = sp.span;
  const sweepT = Math.tan(sp.sweep * DEG);
  const diT = Math.tan(sp.dihedral * DEG);
  const zRoot = sp.wingZ * (frz / fr) + (high ? -frz * 0.1 : frz * 0.12); // the surface we see: top (low wing) or underside (high wing)
  const yLE = (px: number) => sp.wingY - sweepT * (px - x0);
  const zAt = (px: number) => zRoot + diT * (px - x0);
  // Jets: a straight inboard trailing edge to the kink, so the root chord is long
  const xk = x0 + (spanX - x0) * 0.33;
  const chordK = sp.rootChord * (prop ? 1 : 0.9);
  const yTE = (px: number) => {
    if (prop) return yLE(px) - (sp.rootChord + (sp.tipChord - sp.rootChord) * ((px - x0) / (spanX - x0)));
    if (px <= xk) return yLE(xk) - chordK;
    const f = (px - xk) / (spanX - xk);
    return yLE(xk) - chordK + (yLE(spanX) - sp.tipChord - (yLE(xk) - chordK)) * f;
  };
  const at = (s: number, c: number): V3 => {
    const px = x0 + (spanX - x0) * s;
    const le = yLE(px), te = yTE(px);
    return [px, le + (te - le) * c, zAt(px)];
  };
  const rootChordEff = yLE(x0) - yTE(x0);
  // The seat just behind the wing's root: the wing reaches out ahead, its tip near the middle of the window
  // (under a high wing: a row further forward, with the engine and its propeller just ahead)
  const engX = x0 + (spanX - x0) * (sp.wingEngines?.[0] ?? 0.3);
  const eye: V3 = high
    ? [fr * 0.82, yLE(engX) + sp.engineLen * 0.35 - (engX - fr * 0.82) * 0.1, -frz * 0.05]
    : [fr * 0.82, yTE(x0) - rootChordEff * 0.1, frz * 0.25];
  const tilt = (90 - props.basePitch) * DEG;
  const ct = Math.cos(tilt), st = Math.sin(tilt);
  const F = vh / 2 / Math.tan((WINDOW_FOV_DEG / 2) * DEG);
  const NEAR = 0.01;
  /** Camera space: [right, up, forward]. */
  const cam = (p: V3): V3 => {
    const d: V3 = [p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]];
    return [-d[1], d[0] * st + d[2] * ct, d[0] * ct - d[2] * st];
  };
  const scr = (c: V3): V2 => {
    const sx = (c[0] / c[2]) * F;
    return [vw / 2 + (right ? sx : -sx), vh / 2 - (c[1] / c[2]) * F];
  };
  /** A 3D polygon on screen, cut at the near plane. */
  const poly = (pts: V3[]): V2[] => {
    const cs = pts.map(cam);
    const out: V3[] = [];
    for (let i = 0; i < cs.length; i++) {
      const a = cs[i], b = cs[(i + 1) % cs.length];
      const ina = a[2] > NEAR, inb = b[2] > NEAR;
      if (ina) out.push(a);
      if (ina !== inb) {
        const t = (NEAR - a[2]) / (b[2] - a[2]);
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, NEAR]);
      }
    }
    return out.map(scr);
  };
  const path = (pts: V3[]) => {
    const p = poly(pts);
    return p.length > 2 ? `M${p.map((q) => `${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(' L')} Z` : '';
  };
  const pt = (p: V3) => {
    const c = cam(p);
    return c[2] > NEAR ? scr(c) : null;
  };
  const panel = (s0: number, s1: number, c0: number, c1: number) => path([at(s0, c0), at(s1, c0), at(s1, c1), at(s0, c1)]);

  const tipLE = at(1, 0), tipTE = at(1, 1);
  const tipChordV = tipTE[1] - tipLE[1];
  // Raked tips: the wing carries on, more swept, to a point
  const raked = props.tip === 'raked';
  const rakeTip: V3 = [spanX + (spanX - x0) * 0.075, tipLE[1] - (spanX - x0) * 0.075 * Math.tan((sp.sweep + 22) * DEG) + tipChordV * 0.15, tipLE[2] + 0.004];
  const wingTop = path([at(0, 0), at(0.33, 0), tipLE, ...(raked ? [rakeTip] : []), tipTE, at(0.33, 1), at(0, 1)]);
  // Wingtip devices (heights in half-lengths: about 2.4 m on an A320)
  const up = (p: V3, dx: number, dy: number, dz: number): V3 => [p[0] + dx, p[1] + dy, p[2] + dz];
  const c = tipChordV; // negative: aft
  let tipUp = '', tipDown = '';
  const h = 0.11;
  switch (props.tip) {
    case 'blended':
      tipUp = path([tipLE, up(tipLE, 0.012, c * 0.15, h * 0.35), up(tipLE, 0.02, c * 0.45, h), up(tipLE, 0.021, c * 0.85, h), tipTE]);
      break;
    case 'sharklet':
      tipUp = path([tipLE, up(tipLE, 0.008, c * 0.3, h * 0.3), up(tipLE, 0.016, c * 0.7, h * 0.95), up(tipLE, 0.017, c * 0.98, h * 0.98), tipTE]);
      break;
    case 'scimitar':
      tipUp = path([tipLE, up(tipLE, 0.012, c * 0.15, h * 0.35), up(tipLE, 0.02, c * 0.5, h), up(tipLE, 0.021, c * 0.85, h), tipTE]);
      tipDown = path([up(tipLE, 0, c * 0.2, 0), up(tipLE, 0.012, c * 0.55, -h * 0.45), up(tipLE, 0.012, c * 0.75, -h * 0.42), up(tipLE, 0, c * 0.8, 0)]);
      break;
    case 'curved':
      tipUp = path([tipLE, up(tipLE, 0.01, c * 0.25, h * 0.25), up(tipLE, 0.02, c * 0.6, h * 0.75), up(tipLE, 0.024, c * 1.1, h * 1.15), up(tipLE, 0.022, c * 1.15, h * 1.0), tipTE]);
      break;
    case 'winglet':
      tipUp = path([up(tipLE, 0, c * 0.05, 0), up(tipLE, 0.02, c * 0.55, h * 0.95), up(tipLE, 0.022, c * 0.9, h * 0.95), tipTE]);
      break;
    case 'fence':
      tipUp = path([up(tipLE, 0, c * 0.1, 0), up(tipLE, 0.002, c * 0.55, h * 0.35), up(tipLE, 0.002, c * 0.85, h * 0.33), tipTE]);
      tipDown = path([up(tipLE, 0, c * 0.05, 0), up(tipLE, 0.002, c * 0.25, -h * 0.25), up(tipLE, 0.002, c * 0.4, -h * 0.22), up(tipLE, 0, c * 0.6, 0)]);
      break;
  }
  // Moving parts: flaps, spoilers, aileron, slats (jets)
  const flapSpan = prop ? 0.7 : 0.64;
  const flapPanels = prop ? [panel(0, flapSpan, 0.72, 1)] : [panel(0, 0.33, 0.73, 1), panel(0.34, flapSpan, 0.73, 1)];
  const flapGap = prop ? panel(0, flapSpan, 0.7, 0.74) : `${panel(0, 0.33, 0.71, 0.75)} ${panel(0.34, flapSpan, 0.71, 0.75)}`;
  const flapOut = (() => {
    // Where a flap's trailing edge goes when fully out: back and down
    const a = pt(at(0.4, 1)), b = pt(add(at(0.4, 1), [0, -0.035, -0.02]));
    return a && b ? [b[0] - a[0], b[1] - a[1]] : [0, 0];
  })();
  const aileron = panel(flapSpan + 0.02, 0.92, 0.76, 1);
  const spoilerPanels = prop ? '' : [0.1, 0.22, 0.34, 0.46].map((s0) => panel(s0, s0 + 0.11, 0.58, 0.71)).join(' ');
  const slats = prop ? '' : [0.02, 0.2, 0.39, 0.58, 0.77].map((s0) => panel(s0, Math.min(0.99, s0 + 0.18), 0, 0.07)).join(' ');
  // Engines: nacelles (and turboprops' propeller discs)
  const engines = (sp.wingEngines ?? []).map((f) => {
    const px = x0 + (spanX - x0) * f;
    const zw = zAt(px) - (high ? 0 : frz * 0.12);
    const R = sp.engineR, L = sp.engineLen;
    const front = prop ? yLE(px) + L * 0.35 : yLE(px) + L * 0.55;
    const zc = prop ? zw - R * 0.4 : zw - R * 1.25;
    const ring = (dy: number, k: number) => Array.from({ length: 14 }, (_, i) => [px + Math.cos((i / 14) * 2 * Math.PI) * R * k, front + dy, zc + Math.sin((i / 14) * 2 * Math.PI) * R * k] as V3);
    const all = [...ring(0, 0.85), ...ring(-L * 0.18, 1), ...ring(-L * 0.7, 0.92), ...ring(-L, 0.55)].map(pt).filter(Boolean) as V2[];
    const body = all.length > 2 ? `M${hull(all).map((q) => `${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(' L')} Z` : '';
    const inlet = path(ring(0.001, 0.82));
    const disc = prop ? path(Array.from({ length: 24 }, (_, i) => [px + Math.cos((i / 24) * 2 * Math.PI) * R * 2.7, front + 0.014, zc + Math.sin((i / 24) * 2 * Math.PI) * R * 2.7] as V3)) : '';
    const pylon = prop ? '' : path([[px, front - L * 0.25, zc + R * 0.8], [px, front - L * 0.95, zc + R * 0.6], [px, yTE(px) + 0.02, zw], [px, yLE(px) - 0.01, zw]]);
    return { body, inlet, disc, pylon, px };
  });

  const navAt = pt(raked ? rakeTip : up(tipLE, 0, c * 0.1, 0.004)) ?? [x + W * 0.8, y + H * 0.6];
  const navColor = right ? '#3ef08a' : '#ff3b3b';
  const flex = (0.0025 + props.hud.bump * 0.008) * H; // px the wing flexes up and down
  const surface = high ? mixHex(l.wingDark, l.wing, 0.35) : l.wing; // the underside of a high wing is in shadow
  const g1 = pt(at(0.5, 0)) ?? [0, 0], g2 = pt(at(0.5, 1)) ?? [0, 1];
  const ui = { trans: (s: number) => `transform ${s}s ease-in-out, opacity ${s}s ease-in-out` };

  const engineEls = engines.map((e, i) => (
    <g key={i}>
      {e.pylon && <path d={e.pylon} fill={mixHex(l.wing, l.wingDark, 0.6)} />}
      <path d={e.body} fill="url(#bp-win-nacelle)" stroke={l.wingDark} strokeOpacity="0.4" strokeWidth="1" />
      <path d={e.inlet} fill={mixHex(l.wingDark, '#000000', 0.55)} opacity="0.85" />
      {e.disc && <path className="bp-win-prop" d={e.disc} fill="#1b1f26" stroke="#1b1f26" strokeOpacity="0.35" strokeWidth="2" filter="url(#bp-win-blur)" />}
    </g>
  ));

  return (
    <div
      ref={ref}
      className="bp-window-view"
      style={{ position: 'absolute', inset: 0, zIndex: 6, touchAction: 'none', cursor: 'default', userSelect: 'none', ['--bp-flex' as any]: `${flex.toFixed(1)}px` }}
    >
      {/* the bars' heights, to fit the window between them */}
      <div ref={topProbe} style={{ position: 'absolute', visibility: 'hidden', height: 'var(--bp-top-h, 60px)', width: 1 }} />
      <div ref={botProbe} style={{ position: 'absolute', visibility: 'hidden', height: 'var(--bp-bottom-h, 80px)', width: 1 }} />
      {vw > 0 && (
        <svg width={vw} height={vh} style={{ position: 'absolute', inset: 0, display: 'block' }} aria-hidden="true">
          <defs>
            <clipPath id="bp-win-hole">
              <path d={hole} />
            </clipPath>
            <linearGradient id="bp-win-wall" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor={l.wallShade} />
              <stop offset="0.5" stopColor={l.wall} />
              <stop offset="1" stopColor={l.wallShade} />
            </linearGradient>
            <radialGradient id="bp-win-glow" cx="0.5" cy="0.45" r="0.6">
              <stop offset="0.55" stopColor="#000" stopOpacity="0" />
              <stop offset="1" stopColor="#000" stopOpacity={0.28 + l.night * 0.3} />
            </radialGradient>
            <linearGradient id="bp-win-bevel" x1="0" y1="0" x2="0.3" y2="1">
              <stop offset="0" stopColor={l.wall} />
              <stop offset="0.55" stopColor={l.wallShade} />
              <stop offset="1" stopColor={l.wall} />
            </linearGradient>
            {/* lit from the sky: lighter at the leading edge, darker towards the flaps */}
            <linearGradient id="bp-win-wing" gradientUnits="userSpaceOnUse" x1={g1[0]} y1={g1[1]} x2={g2[0]} y2={g2[1]}>
              <stop offset="0" stopColor={surface} />
              <stop offset="0.6" stopColor={mixHex(surface, l.wingDark, 0.3)} />
              <stop offset="1" stopColor={mixHex(surface, l.wingDark, 0.6)} />
            </linearGradient>
            <linearGradient id="bp-win-winglet" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={l.wingDark} />
              <stop offset="1" stopColor={mixHex(l.wing, l.wingDark, 0.5)} />
            </linearGradient>
            <linearGradient id="bp-win-nacelle" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={mixHex(l.wing, '#ffffff', 0.15)} />
              <stop offset="0.55" stopColor={l.wing} />
              <stop offset="1" stopColor={l.wingDark} />
            </linearGradient>
            <linearGradient id="bp-win-glass" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#fff" stopOpacity="0.1" />
              <stop offset="0.4" stopColor="#fff" stopOpacity="0" />
              <stop offset="1" stopColor="#9fc4ff" stopOpacity="0.06" />
            </linearGradient>
            <linearGradient id="bp-win-shade" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={l.wallShade} />
              <stop offset="1" stopColor={l.wall} />
            </linearGradient>
            <filter id="bp-win-soft" x="-10%" y="-10%" width="120%" height="120%">
              <feGaussianBlur stdDeviation={Math.max(2, W * 0.012)} />
            </filter>
            <filter id="bp-win-blur" x="-10%" y="-10%" width="120%" height="120%">
              <feGaussianBlur stdDeviation="3" />
            </filter>
            <radialGradient id="bp-win-nav">
              <stop offset="0" stopColor="#fff" />
              <stop offset="0.25" stopColor={navColor} />
              <stop offset="1" stopColor={navColor} stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* outside: the wing */}
          <g clipPath="url(#bp-win-hole)">
            {/* the world gets darker with the sky (the map itself is drawn the same day and night) */}
            {l.night > 0.02 && <rect x={x} y={y} width={W} height={H} fill="#0a1330" opacity={l.night * 0.74} style={{ mixBlendMode: 'multiply' }} />}
            <g className="bp-win-wing">
              {/* under a low wing: the engines show ahead of it; under a high wing they hang in front of it */}
              {!high && engineEls}
              <path d={flapGap} fill="#101318" style={{ opacity: props.wing.flaps * 0.85, transition: ui.trans(2.5) }} />
              <g style={{ transform: `translate(${(flapOut[0] * props.wing.flaps).toFixed(1)}px, ${(flapOut[1] * props.wing.flaps).toFixed(1)}px)`, transition: ui.trans(2.5) }}>
                {flapPanels.map((d, i) => (
                  <path key={i} d={d} fill={mixHex(surface, l.wingDark, 0.45)} stroke={l.wingDark} strokeOpacity="0.55" strokeWidth="1" />
                ))}
              </g>
              <path d={wingTop} fill="url(#bp-win-wing)" />
              {/* the fixed part of the wing over the flaps' roots */}
              <path d={panel(0, flapSpan, 0.55, 0.73)} fill={mixHex(surface, l.wingDark, 0.25)} opacity="0.5" />
              <path d={flapPanels.join(' ')} fill={l.wingDark} opacity="0.1" stroke={l.wingDark} strokeOpacity="0.5" strokeWidth="1" />
              <path
                d={aileron}
                fill={l.wingDark}
                opacity="0.14"
                stroke={l.wingDark}
                strokeOpacity="0.55"
                strokeWidth="1"
                style={{ transform: `translateY(${(-props.wing.aileron * H * 0.006).toFixed(1)}px)`, transition: ui.trans(0.9) }}
              />
              {spoilerPanels && <path d={spoilerPanels} fill="none" stroke={l.wingDark} strokeOpacity="0.45" strokeWidth="1" />}
              {spoilerPanels && (
                <path
                  d={spoilerPanels}
                  fill={mixHex(surface, '#ffffff', 0.25)}
                  stroke="#0b0e12"
                  strokeOpacity="0.6"
                  strokeWidth="2.5"
                  style={{ opacity: props.wing.spoilers, transform: `translateY(${(-H * 0.012 * props.wing.spoilers).toFixed(1)}px)`, transition: ui.trans(0.7) }}
                />
              )}
              {slats && <path d={slats} fill={l.wingDark} fillOpacity="0.25" stroke={l.wingDark} strokeOpacity="0.4" strokeWidth="0.8" />}
              {tipDown && <path d={tipDown} fill="url(#bp-win-winglet)" />}
              {tipUp && <path d={tipUp} fill="url(#bp-win-winglet)" />}
              {high && engineEls}
              <circle cx={navAt[0]} cy={navAt[1]} r={W * (0.035 + l.night * 0.04)} fill="url(#bp-win-nav)" opacity={0.55 + l.night * 0.45} />
              <circle className="bp-win-strobe" cx={navAt[0]} cy={navAt[1]} r={W * 0.12} fill="url(#bp-win-nav)" style={{ mixBlendMode: 'screen' }} />
            </g>
            {/* a little light on the glass, and the blind pulled down a bit */}
            <rect x={x} y={y} width={W} height={H} fill="url(#bp-win-glass)" />
            <rect x={x} y={y - 1} width={W} height={H * 0.13} fill="url(#bp-win-shade)" />
            <rect x={x + W * 0.38} y={y + H * 0.105} width={W * 0.24} height={H * 0.018} rx={H * 0.009} fill={l.wallShade} />
          </g>

          {/* the wall, its rounded recess, and the shadow inside the frame */}
          <path d={`${page} ${outer}`} fillRule="evenodd" fill="url(#bp-win-wall)" />
          <path d={`${outer} ${hole}`} fillRule="evenodd" fill="url(#bp-win-bevel)" />
          <path d={hole} fill="none" stroke="#000" strokeOpacity={0.35} strokeWidth={W * 0.03} filter="url(#bp-win-soft)" clipPath="url(#bp-win-hole)" />
          <path d={hole} fill="none" stroke={l.wallShade} strokeWidth="2" />
          <path d={`${page} ${outer}`} fillRule="evenodd" fill="url(#bp-win-glow)" />
        </svg>
      )}

      <div
        className="bp-window-hud"
        style={{
          position: 'absolute',
          left: '50%',
          bottom: 'calc(var(--bp-bottom-h, 0px) + 14px)',
          transform: 'translateX(-50%)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '6px 6px 6px 14px',
          borderRadius: 999,
          background: C.panel,
          border: `1px solid ${C.line}`,
          color: C.text,
          whiteSpace: 'nowrap',
          maxWidth: 'calc(100vw - 24px)',
          boxShadow: '0 8px 24px rgba(0,0,0,.25)',
        }}
      >
        <b style={{ fontFamily: DISPLAY, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis' }}>{props.hud.label}</b>
        <span className="num bp-window-stats" style={{ fontSize: 13, color: C.textDim }}>
          {props.hud.altText} · {Math.round(props.hud.gsKts)} kt
        </span>
        <span style={{ display: 'inline-flex', background: C.raised, borderRadius: 999, padding: 2 }}>
          {(['left', 'right'] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={props.side === s}
              onClick={() => props.onSide(s)}
              style={{ padding: '5px 10px', border: 0, borderRadius: 999, background: props.side === s ? C.panel : 'transparent', color: props.side === s ? C.text : C.muted, font: 'inherit', fontSize: 13, fontWeight: 650, cursor: 'pointer' }}
            >
              {s === 'left' ? 'Left' : 'Right'}
            </button>
          ))}
        </span>
        <button
          type="button"
          onClick={props.onExit}
          style={{ padding: '6px 14px', border: 0, borderRadius: 999, background: C.brand, color: C.brandInk, font: 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
        >
          Exit
        </button>
      </div>
    </div>
  );
}
