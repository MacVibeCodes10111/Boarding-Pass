// ============================================================================
// COLOUR PICKER (v2.66)
//   A colour wheel (hue around, strength outwards, with a brightness slider),
//   a hex box, the player's favourite colours (saved on this device; add with
//   the star, take out with the ×), the livery's own colours and a few
//   standard ones.
// ============================================================================
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { C } from '../../ui/kit';

const SWATCHES = ['#ffffff', '#e9edf2', '#9aa3ad', '#3a3f45', '#111111', '#1d4e89', '#0b2545', '#0098d8', '#c8102e', '#7a0019', '#f5a623', '#ffd400', '#00843d', '#6c2c91', '#e4007c'];
const HEX = /^#[0-9a-f]{6}$/i;

// ---------------------------------------------------------------- favourites
const FAV_KEY = 'bp_fav_colours_v1';
const MAX_FAVS = 24;
let favs: string[] = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(FAV_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && HEX.test(x)).slice(0, MAX_FAVS) : [];
  } catch {
    return [];
  }
})();
const subs = new Set<() => void>();
function setFavs(next: string[]) {
  favs = next.slice(0, MAX_FAVS);
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify(favs));
  } catch {
    /* private window: kept for this visit only */
  }
  subs.forEach((f) => f());
}
const useFavs = () =>
  useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => favs
  );

// ---------------------------------------------------------------- colour maths
function hexToHsv(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [((h * 60) + 360) % 360, mx ? d / mx : 0, mx];
}
function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}
const rgbHex = ([r, g, b]: [number, number, number]) => `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;

// ---------------------------------------------------------------- the wheel
function Wheel({ value, onChange, size = 156 }: { value: string; onChange: (v: string) => void; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [h, s, v] = hexToHsv(value);
  // keep the hue and strength while the colour is black or grey
  const keep = useRef<[number, number]>([h, s]);
  if (v > 0.02 && s > 0.02) keep.current = [h, s];
  else if (v > 0.02) keep.current = [keep.current[0], s];
  const [hh, ss] = keep.current;
  const vRound = Math.round(v * 100);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const px = size * 2;
    c.width = c.height = px;
    const g = c.getContext('2d')!;
    const img = g.createImageData(px, px);
    const r = px / 2;
    for (let y = 0; y < px; y++)
      for (let x = 0; x < px; x++) {
        const dx = x - r + 0.5, dy = y - r + 0.5;
        const d = Math.hypot(dx, dy) / r;
        const i = (y * px + x) * 4;
        if (d > 1) continue;
        const [R, G, B] = hsvToRgb(((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360, d, vRound / 100);
        img.data[i] = R;
        img.data[i + 1] = G;
        img.data[i + 2] = B;
        img.data[i + 3] = d > 0.985 ? Math.round(255 * (1 - (d - 0.985) / 0.015)) : 255;
      }
    g.putImageData(img, 0, 0);
  }, [vRound, size]);
  const pick = (e: React.PointerEvent) => {
    const b = ref.current!.getBoundingClientRect();
    const dx = e.clientX - (b.left + b.width / 2), dy = e.clientY - (b.top + b.height / 2);
    const d = Math.min(1, Math.hypot(dx, dy) / (b.width / 2));
    const hue = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
    keep.current = [hue, d];
    onChange(rgbHex(hsvToRgb(hue, d, Math.max(v, 0.05))));
  };
  const a = (hh * Math.PI) / 180;
  return (
    <div style={{ display: 'grid', gap: 8, justifyItems: 'center' }}>
      <div style={{ position: 'relative', width: size, height: size }}>
        <canvas
          ref={ref}
          aria-label="Colour wheel"
          style={{ width: size, height: size, borderRadius: '50%', touchAction: 'none', cursor: 'crosshair', display: 'block' }}
          onPointerDown={(e) => {
            (e.target as Element).setPointerCapture(e.pointerId);
            pick(e);
          }}
          onPointerMove={(e) => e.buttons && pick(e)}
        />
        <span
          style={{
            position: 'absolute',
            left: size / 2 + Math.cos(a) * ss * (size / 2) - 7,
            top: size / 2 + Math.sin(a) * ss * (size / 2) - 7,
            width: 14,
            height: 14,
            borderRadius: '50%',
            border: '2px solid #fff',
            boxShadow: '0 0 0 1px rgba(0,0,0,.6)',
            background: value,
            pointerEvents: 'none',
          }}
        />
      </div>
      <label style={{ display: 'grid', gap: 3, width: '100%', fontSize: 12, color: C.muted }}>
        Brightness {vRound}%
        <input
          type="range"
          min={0}
          max={100}
          value={vRound}
          onChange={(e) => onChange(rgbHex(hsvToRgb(hh, ss, Number(e.target.value) / 100)))}
          style={{ width: '100%', accentColor: rgbHex(hsvToRgb(hh, ss, 1)) }}
        />
      </label>
    </div>
  );
}

// ---------------------------------------------------------------- the picker
export function ColourPicker(props: { label: string; value: string; onChange: (v: string) => void; recent?: string[]; open?: boolean }) {
  const [open, setOpen] = useState(Boolean(props.open));
  const [text, setText] = useState(props.value);
  useEffect(() => setText(props.value), [props.value]);
  const favourites = useFavs();
  const isFav = favourites.includes(props.value);
  const others = [...new Set([...(props.recent ?? []), ...SWATCHES])].filter((c) => !favourites.includes(c)).slice(0, 18);
  const chip = (c: string, fav: boolean) => (
    <span key={c} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        aria-label={`${props.label} ${c}`}
        title={c}
        onClick={() => props.onChange(c)}
        style={{ width: 20, height: 20, borderRadius: 5, background: c, border: `1px solid ${c === props.value ? C.brand : C.line}`, outline: c === props.value ? `1px solid ${C.brand}` : 'none', cursor: 'pointer', padding: 0 }}
      />
      {fav && (
        <button
          type="button"
          aria-label={`Remove ${c} from favourites`}
          title="Remove from favourites"
          onClick={() => setFavs(favourites.filter((f) => f !== c))}
          style={{ position: 'absolute', top: -6, right: -6, width: 13, height: 13, borderRadius: 99, border: `1px solid ${C.border}`, background: C.raised, color: C.textSoft, fontSize: 9, lineHeight: '10px', padding: 0, cursor: 'pointer' }}
        >
          ×
        </button>
      )}
    </span>
  );
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          aria-label={`${props.label}: ${open ? 'hide' : 'show'} the colour wheel`}
          aria-expanded={open}
          title="Colour wheel"
          onClick={() => setOpen((o) => !o)}
          style={{ width: 34, height: 28, borderRadius: 6, border: `1px solid ${C.border}`, background: props.value, cursor: 'pointer', padding: 0, boxShadow: 'inset 0 0 0 2px rgba(255,255,255,.25)' }}
        />
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>{props.label}</span>
        <input
          aria-label={`${props.label} hex code`}
          value={text}
          maxLength={7}
          spellCheck={false}
          onChange={(e) => {
            let t = e.target.value.trim();
            if (t && !t.startsWith('#')) t = `#${t}`;
            setText(t);
            if (HEX.test(t)) props.onChange(t.toLowerCase());
          }}
          onBlur={() => setText(props.value)}
          className="num"
          style={{ width: 78, background: C.bg, color: C.text, border: `1px solid ${HEX.test(text) ? C.border : C.red}`, borderRadius: 6, padding: '4px 6px', fontSize: 12.5 }}
        />
        <button
          type="button"
          aria-label={isFav ? `Remove ${props.value} from favourites` : `Save ${props.value} as a favourite`}
          title={isFav ? 'Remove from favourites' : 'Save as a favourite'}
          onClick={() => setFavs(isFav ? favourites.filter((f) => f !== props.value) : [props.value, ...favourites])}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: isFav ? C.brand : C.muted, padding: '0 2px' }}
        >
          {isFav ? '★' : '☆'}
        </button>
      </div>
      {open && <Wheel value={props.value} onChange={props.onChange} />}
      {favourites.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: C.muted, marginRight: 2 }}>Favourites</span>
          {favourites.map((c) => chip(c, true))}
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>{others.map((c) => chip(c, false))}</div>
    </div>
  );
}
