// ============================================================================
// WINDOW VIEW overlay (v3.5.2): the cabin wall, one window (the same for every
// type) and the wing outside it, over the 3D map whose camera sits at the
// window (src/game/windowView.ts). Drag to look round; Left / Right picks the
// side; Esc or Exit goes back to the map.
// ============================================================================
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { WindowLight, WindowSide } from '../game/windowView';
import { C, DISPLAY } from '../ui/kit';

export interface WindowHud {
  label: string;
  altText: string;
  gsKts: number;
  /** 0 smooth … 1 bumpy (climbing, descending, taxiing). */
  bump: number;
}

const mixHex = (a: string, b: string, f: number) => {
  const p = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const x = p(a), y = p(b);
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * f).toString(16).padStart(2, '0')).join('')}`;
};

export function WindowView(props: {
  side: WindowSide;
  light: WindowLight;
  hud: WindowHud;
  onSide: (s: WindowSide) => void;
  onLook: (dx: number, dy: number) => void;
  onExit: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setSize({ w: el.clientWidth, h: el.clientHeight });
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

  // Drag to look round
  const drag = useRef<{ x: number; y: number; id: number } | null>(null);
  const onDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    drag.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    props.onLook(-(e.clientX - d.x) * 0.12, (e.clientY - d.y) * 0.08);
    d.x = e.clientX;
    d.y = e.clientY;
  };
  const onUp = (e: React.PointerEvent) => {
    if (drag.current?.id === e.pointerId) drag.current = null;
  };

  const { w: vw, h: vh } = size;
  const l = props.light;
  // The window: a tall rounded opening, as big as fits between the bars
  const topPad = 70, botPad = 130;
  const H = Math.max(120, Math.min(vh - topPad - botPad, ((vw - 40) / 0.68) | 0, 760));
  const W = H * 0.68;
  const x = (vw - W) / 2;
  const y = topPad + (vh - topPad - botPad - H) / 2;
  const r = W * 0.46;
  const bevel = W * 0.17;
  const rr = (px: number, py: number, pw: number, ph: number, pr: number) =>
    `M${px + pr},${py} H${px + pw - pr} A${pr},${pr} 0 0 1 ${px + pw},${py + pr} V${py + ph - pr} A${pr},${pr} 0 0 1 ${px + pw - pr},${py + ph} H${px + pr} A${pr},${pr} 0 0 1 ${px},${py + ph - pr} V${py + pr} A${pr},${pr} 0 0 1 ${px + pr},${py} Z`;
  const hole = rr(x, y, W, H, r);
  const outer = rr(x - bevel, y - bevel * 0.9, W + bevel * 2, H + bevel * 1.8, r + bevel);
  const page = `M0,0 H${vw} V${vh} H0 Z`;

  // The wing, drawn for the right window (forward is to the left) and mirrored for the left
  const right = props.side === 'right';
  const P = (u: number, v: number) => `${(x + (right ? u : 1 - u) * W).toFixed(1)},${(y + v * H).toFixed(1)}`;
  const lerp = (a: [number, number], b: [number, number], f: number): [number, number] => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  const LE0: [number, number] = [-0.15, 0.97]; // leading edge at the root
  const LE1: [number, number] = [0.8, 0.63]; // leading edge at the tip
  const TE1: [number, number] = [0.9, 0.645]; // trailing edge at the tip
  const TE0: [number, number] = [0.62, 1.32]; // trailing edge at the root
  /** A point on the wing: `span` 0 root … 1 tip, `chord` 0 leading … 1 trailing edge. */
  const at = (span: number, chord: number) => lerp(lerp(LE0, LE1, span), lerp(TE0, TE1, span), chord);
  const pts = (list: [number, number][]) => list.map((p) => P(p[0], p[1])).join(' ');
  const xy = (p: [number, number]) => P(p[0], p[1]).split(',').map(Number) as [number, number];
  /** A panel between two spans and two chords. */
  const panel = (s0: number, s1: number, c0: number, c1: number) => `M${P(...at(s0, c0))} L${P(...at(s1, c0))} L${P(...at(s1, c1))} L${P(...at(s0, c1))} Z`;
  const wingTop = pts([LE0, LE1, TE1, TE0, [-0.15, 1.32]]);
  const slats = [0, 0.2, 0.4, 0.6, 0.8].map((s0) => panel(s0, Math.min(0.98, s0 + 0.2), 0, 0.075)).join(' ');
  const spoilers = [0.12, 0.24, 0.36, 0.48].map((s0) => panel(s0, s0 + 0.11, 0.58, 0.71)).join(' ');
  const flaps = `${panel(0.0, 0.33, 0.73, 1)} ${panel(0.34, 0.64, 0.73, 1)}`;
  const aileron = panel(0.66, 0.92, 0.76, 1);
  // Flap track fairings: the "canoes" sticking out behind the trailing edge
  const canoe = (span: number) => {
    const a0 = xy(at(span, 0.82)), a1 = xy(at(span, 1.2));
    const dx = a1[0] - a0[0], dy = a1[1] - a0[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * W * 0.012, ny = (dx / len) * W * 0.012;
    return `M${a0[0] + nx},${a0[1] + ny} Q${a1[0] + nx * 1.6},${a1[1] + ny * 1.6} ${a1[0]},${a1[1]} Q${a1[0] - nx * 1.6},${a1[1] - ny * 1.6} ${a0[0] - nx},${a0[1] - ny} Z`;
  };
  const canoes = [0.16, 0.34, 0.52, 0.7].map(canoe).join(' ');
  const winglet = pts([LE1, [0.83, 0.535], [0.858, 0.505], [0.885, 0.5], TE1]);
  const [lx, ly] = xy(at(0.5, 0));
  const [tx, ty] = xy(at(0.5, 1));
  const tip = at(1, 0.12);
  const navColor = right ? '#3ef08a' : '#ff3b3b';
  const flex = (0.0025 + props.hud.bump * 0.009) * H; // px the wing flexes up and down

  return (
    <div
      ref={ref}
      className="bp-window-view"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      style={{ position: 'absolute', inset: 0, zIndex: 6, touchAction: 'none', cursor: 'grab', userSelect: 'none', ['--bp-flex' as any]: `${flex.toFixed(1)}px` }}
    >
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
            <linearGradient id="bp-win-wing" gradientUnits="userSpaceOnUse" x1={lx} y1={ly} x2={tx} y2={ty}>
              <stop offset="0" stopColor={l.wing} />
              <stop offset="0.6" stopColor={mixHex(l.wing, l.wingDark, 0.35)} />
              <stop offset="1" stopColor={mixHex(l.wing, l.wingDark, 0.7)} />
            </linearGradient>
            <linearGradient id="bp-win-winglet" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={l.wingDark} />
              <stop offset="1" stopColor={mixHex(l.wing, l.wingDark, 0.5)} />
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
            <g className="bp-win-wing" style={{ transformOrigin: `${right ? x : x + W}px ${y + H}px` }}>
              <path d={canoes} fill={l.wingDark} opacity="0.85" />
              <polygon points={wingTop} fill="url(#bp-win-wing)" />
              <path d={flaps} fill={l.wingDark} opacity="0.16" stroke={l.wingDark} strokeOpacity="0.55" strokeWidth="1" />
              <path d={aileron} fill={l.wingDark} opacity="0.12" stroke={l.wingDark} strokeOpacity="0.55" strokeWidth="1" />
              <path d={spoilers} fill="none" stroke={l.wingDark} strokeOpacity="0.45" strokeWidth="1" />
              <path d={slats} fill={l.wingDark} fillOpacity="0.28" stroke={l.wingDark} strokeOpacity="0.4" strokeWidth="0.8" />
              <polygon points={winglet} fill="url(#bp-win-winglet)" />
              <circle className="bp-win-nav" cx={xy(tip)[0]} cy={xy(tip)[1]} r={W * (0.05 + l.night * 0.05)} fill="url(#bp-win-nav)" opacity={0.55 + l.night * 0.45} />
              <circle className="bp-win-strobe" cx={xy(tip)[0]} cy={xy(tip)[1]} r={W * 0.14} fill="url(#bp-win-nav)" style={{ mixBlendMode: 'screen' }} />
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
          bottom: 'calc(var(--bp-bottom-h, 0px) + 22px)',
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
          cursor: 'default',
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
