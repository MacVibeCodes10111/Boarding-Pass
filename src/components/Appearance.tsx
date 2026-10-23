// ============================================================================
// APPEARANCE
//   Theme presets and a colour picker for the three colours a theme is made
//   of (background, highlight, your aircraft). Changes apply straight away
//   and are kept on this device. Opened from the home screen and from the Map
//   layers menu (openAppearance()), shown by <AppearanceHost> in App.
// ============================================================================
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../ui/icons';
import { Button, C, ModalShell, getThemeSpec, inputStyle, setTheme, useThemeVersion } from '../ui/kit';
import {
  DEFAULT_THEME,
  POP_COLOURS,
  THEME_PRESETS,
  buildPalette,
  hexToHsv,
  highlightWarning,
  hsvToHex,
  isLightColour,
  normHex,
  type ThemeSpec,
} from '../ui/theme';
import type { MapStyleChoice } from './DashboardChrome';

// ---------------------------------------------------------------------------
// Opening it from anywhere
// ---------------------------------------------------------------------------
let openListeners: ((open: boolean) => void)[] = [];
export function openAppearance() {
  openListeners.forEach((f) => f(true));
}

export function AppearanceHost(props: { mapStyle: MapStyleChoice; onMapStyle: (m: MapStyleChoice) => void }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    openListeners.push(setOpen);
    return () => {
      openListeners = openListeners.filter((f) => f !== setOpen);
    };
  }, []);
  return open ? <AppearanceModal {...props} onClose={() => setOpen(false)} /> : null;
}

// ---------------------------------------------------------------------------
// Colour picker: saturation/brightness square, hue strip, hex box
// ---------------------------------------------------------------------------
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function ColourPicker({ value, onChange, label }: { value: string; onChange: (hex: string) => void; label: string }) {
  const [hsv, setHsv] = useState<[number, number, number]>(() => hexToHsv(value));
  const [hexText, setHexText] = useState(value);
  // Follow outside changes (a preset, a quick colour), keeping the hue of greys
  useEffect(() => {
    if (hsvToHex(...hsv) !== value) {
      const [h, s, v] = hexToHsv(value);
      setHsv([s === 0 || v === 0 ? hsv[0] : h, s, v]);
    }
    setHexText(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const commit = (next: [number, number, number]) => {
    setHsv(next);
    const hex = hsvToHex(...next);
    setHexText(hex);
    onChange(hex);
  };
  const drag = (el: HTMLElement, e: React.PointerEvent, at: (x: number, y: number) => void) => {
    const go = (cx: number, cy: number) => {
      const r = el.getBoundingClientRect();
      at(clamp01((cx - r.left) / r.width), clamp01((cy - r.top) / r.height));
    };
    el.setPointerCapture?.(e.pointerId);
    go(e.clientX, e.clientY);
    const move = (ev: PointerEvent) => go(ev.clientX, ev.clientY);
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };
  const [h, s, v] = hsv;
  const nudge = (e: React.KeyboardEvent, dx: number, dy: number, f: (dx: number, dy: number) => void) => {
    e.preventDefault();
    const k = e.shiftKey ? 5 : 1;
    f(dx * k, dy * k);
  };

  return (
    <div className="bp-colour-picker" style={{ display: 'grid', gap: 10 }}>
      <div
        role="slider"
        tabIndex={0}
        aria-label={`${label}: saturation and brightness`}
        aria-valuetext={`saturation ${Math.round(s * 100)}%, brightness ${Math.round(v * 100)}%`}
        onPointerDown={(e) => drag(e.currentTarget, e, (x, y) => commit([h, x, 1 - y]))}
        onKeyDown={(e) => {
          const f = (dx: number, dy: number) => commit([h, clamp01(s + dx * 0.02), clamp01(v + dy * 0.02)]);
          if (e.key === 'ArrowLeft') nudge(e, -1, 0, f);
          if (e.key === 'ArrowRight') nudge(e, 1, 0, f);
          if (e.key === 'ArrowUp') nudge(e, 0, 1, f);
          if (e.key === 'ArrowDown') nudge(e, 0, -1, f);
        }}
        style={{
          position: 'relative',
          height: 150,
          borderRadius: 8,
          cursor: 'crosshair',
          touchAction: 'none',
          background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent), ${hsvToHex(h, 1, 1)}`,
          border: `1px solid ${C.border}`,
        }}
      >
        <span
          style={{
            position: 'absolute',
            left: `${s * 100}%`,
            top: `${(1 - v) * 100}%`,
            width: 18,
            height: 18,
            margin: '-9px 0 0 -9px',
            borderRadius: '50%',
            border: '2px solid #fff',
            boxShadow: '0 0 0 1px rgba(0,0,0,.5), 0 2px 6px rgba(0,0,0,.4)',
            background: hsvToHex(h, s, v),
            pointerEvents: 'none',
          }}
        />
      </div>
      <div
        role="slider"
        tabIndex={0}
        aria-label={`${label}: hue`}
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(h)}
        onPointerDown={(e) => drag(e.currentTarget, e, (x) => commit([x * 359.9, s, v]))}
        onKeyDown={(e) => {
          const f = (dx: number) => commit([(h + dx * 3 + 360) % 360, s, v]);
          if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') nudge(e, -1, 0, f);
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') nudge(e, 1, 0, f);
        }}
        style={{
          position: 'relative',
          height: 16,
          borderRadius: 8,
          cursor: 'pointer',
          touchAction: 'none',
          background: 'linear-gradient(to right, #f00, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00)',
          border: `1px solid ${C.border}`,
        }}
      >
        <span
          style={{
            position: 'absolute',
            left: `${(h / 360) * 100}%`,
            top: '50%',
            width: 18,
            height: 18,
            margin: '-9px 0 0 -9px',
            borderRadius: '50%',
            border: '2px solid #fff',
            boxShadow: '0 0 0 1px rgba(0,0,0,.5), 0 2px 6px rgba(0,0,0,.4)',
            background: hsvToHex(h, 1, 1),
            pointerEvents: 'none',
          }}
        />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span aria-hidden style={{ width: 30, height: 30, borderRadius: 6, background: value, border: `1px solid ${C.border}`, flexShrink: 0 }} />
        <input
          value={hexText}
          aria-label={`${label}: colour code`}
          spellCheck={false}
          maxLength={7}
          onChange={(e) => {
            setHexText(e.target.value);
            const n = normHex(e.target.value);
            if (n && n.length === 7 && e.target.value.replace('#', '').length === 6) onChange(n);
          }}
          onBlur={() => {
            const n = normHex(hexText);
            if (n) onChange(n);
            else setHexText(value);
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          style={{ ...inputStyle, width: 110, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', textTransform: 'uppercase' }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The Appearance window
// ---------------------------------------------------------------------------
type Target = 'base' | 'accent' | 'fleet';
const TARGETS: { id: Target; label: string; hint: string }[] = [
  { id: 'base', label: 'Background', hint: 'Panels, menus and text are worked out from it.' },
  { id: 'accent', label: 'Highlight', hint: 'Buttons, selections and your airline in menus.' },
  { id: 'fleet', label: 'Your aircraft', hint: 'Your aircraft, labels and trails on the map.' },
];

/** A small mock-up of a theme: background, a panel with text, the highlight and an aircraft. */
function ThemeSwatch({ spec }: { spec: ThemeSpec }) {
  const p = buildPalette(spec);
  return (
    <div aria-hidden style={{ height: 62, borderRadius: 7, background: p.bg, border: `1px solid ${p.border}`, position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: 8, top: 8, bottom: 8, width: '52%', borderRadius: 5, background: p.panel, border: `1px solid ${p.line}`, padding: '7px 7px', display: 'grid', alignContent: 'start', gap: 4 }}>
        <span style={{ height: 4, width: '80%', borderRadius: 2, background: p.text }} />
        <span style={{ height: 4, width: '55%', borderRadius: 2, background: p.muted }} />
        <span style={{ height: 9, width: '62%', borderRadius: 3, background: p.brand, marginTop: 3 }} />
      </div>
      <span style={{ position: 'absolute', right: 12, top: 16, transform: 'rotate(45deg)', color: p.fleet, display: 'flex' }}>
        <Icon name="fleet" size={24} />
      </span>
    </div>
  );
}

function AppearanceModal({ onClose, mapStyle, onMapStyle }: { onClose: () => void; mapStyle: MapStyleChoice; onMapStyle: (m: MapStyleChoice) => void }) {
  useThemeVersion(); // re-render with the colours being picked
  // What the window shows; the game follows on the next frame (at most once a frame while dragging)
  const [live, setLive] = useState<ThemeSpec>(getThemeSpec);
  const [target, setTarget] = useState<Target>('accent');
  // Picking re-colours the whole game; at most once a frame while dragging
  const pending = useRef<ThemeSpec | null>(null);
  const raf = useRef(0);
  const apply = (next: ThemeSpec) => {
    setLive(next);
    pending.current = next;
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      if (pending.current) setTheme(pending.current);
    });
  };
  // Closing mid-drag still applies the last colour
  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current);
      if (raf.current && pending.current) setTheme(pending.current);
    },
    []
  );

  const valueOf = (t: Target) => (t === 'base' ? live.base : t === 'accent' ? live.accent : live.fleet ?? live.accent);
  const setColour = (t: Target, hex: string) => {
    const next: ThemeSpec = { ...live, preset: 'custom' };
    if (t === 'base') next.base = hex;
    else if (t === 'accent') next.accent = hex;
    else next.fleet = hex;
    apply(next);
  };
  const palette = buildPalette(live);
  const warning = highlightWarning(palette);
  const isCustom = !THEME_PRESETS.some((p) => p.preset === live.preset);
  const light = isLightColour(live.base);

  return (
    <ModalShell onClose={onClose} maxWidth={640} zIndex={420} closeButton={false}>
      <div role="dialog" aria-label="Appearance" style={{ padding: '22px 24px', maxHeight: 'calc(100dvh - 80px)', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: C.text }}>Appearance</h2>
            <div style={{ fontSize: 12.5, color: C.muted, marginTop: 4 }}>Colours for the whole game. Saved on this device, for every career.</div>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', padding: 4, display: 'flex' }}>
            <Icon name="close" size={18} />
          </button>
        </div>

        <h3 style={{ margin: '18px 0 8px', fontSize: 13.5, fontWeight: 650, color: C.text }}>Themes</h3>
        <div className="bp-theme-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
          {[...THEME_PRESETS, ...(isCustom ? [{ ...live, name: 'Custom', blurb: 'Your own colours.' }] : [])].map((p) => {
            const on = p.preset === live.preset;
            return (
              <button
                key={p.preset}
                type="button"
                aria-pressed={on}
                onClick={() => p.preset !== 'custom' && apply({ preset: p.preset, base: p.base, accent: p.accent, fleet: p.fleet })}
                style={{
                  textAlign: 'left',
                  padding: 8,
                  borderRadius: 10,
                  cursor: 'pointer',
                  background: on ? C.raised : C.bg,
                  border: `${on ? 2 : 1}px solid ${on ? C.brand : C.line}`,
                  margin: on ? 0 : 1,
                  color: C.text,
                  display: 'grid',
                  gap: 6,
                }}
              >
                <ThemeSwatch spec={p} />
                <span style={{ fontSize: 13, fontWeight: 650 }}>{p.name}</span>
                <span style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.35 }}>{p.blurb}</span>
              </button>
            );
          })}
        </div>

        <h3 style={{ margin: '20px 0 8px', fontSize: 13.5, fontWeight: 650, color: C.text }}>Make it yours</h3>
        <div role="radiogroup" aria-label="Colour to change" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
          {TARGETS.map((t) => {
            const on = target === t.id;
            const same = t.id === 'fleet' && live.fleet === null;
            return (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setTarget(t.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', borderRadius: 8, cursor: 'pointer', textAlign: 'left', minWidth: 0, background: on ? C.raised : 'transparent', border: `1px solid ${on ? C.brand : C.border}`, color: C.text }}
              >
                <span aria-hidden style={{ width: 22, height: 22, borderRadius: 6, background: valueOf(t.id), border: `1px solid ${C.border}`, flexShrink: 0 }} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.label}</span>
                  <span className="num" style={{ display: 'block', fontSize: 11, color: C.muted }}>{same ? 'Same as highlight' : valueOf(t.id).toUpperCase()}</span>
                </span>
              </button>
            );
          })}
        </div>
        <div style={{ fontSize: 12, color: C.muted, margin: '8px 0 10px' }}>{TARGETS.find((t) => t.id === target)!.hint}</div>

        <div className="bp-stack" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 190px', gap: 16, alignItems: 'start' }}>
          <div>
            {target === 'fleet' && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: C.textSoft, marginBottom: 10, cursor: 'pointer' }}>
                <input type="checkbox" checked={live.fleet === null} onChange={(e) => apply({ ...live, preset: 'custom', fleet: e.target.checked ? null : live.accent })} style={{ accentColor: C.brand }} />
                Same as the highlight
              </label>
            )}
            {!(target === 'fleet' && live.fleet === null) && <ColourPicker key={target} label={TARGETS.find((t) => t.id === target)!.label} value={valueOf(target)} onChange={(hex) => setColour(target, hex)} />}
          </div>
          <div>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 6 }}>Quick colours</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {POP_COLOURS.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  aria-label={`Use ${hex.toUpperCase()}`}
                  title={hex.toUpperCase()}
                  onClick={() => setColour(target, hex)}
                  style={{ width: 26, height: 26, borderRadius: '50%', background: hex, cursor: 'pointer', border: `2px solid ${valueOf(target) === hex ? C.text : C.border}`, padding: 0 }}
                />
              ))}
            </div>
          </div>
        </div>

        {warning && (
          <div role="status" style={{ marginTop: 12, padding: '8px 10px', borderRadius: 7, fontSize: 12, lineHeight: 1.45, color: C.amber, background: `${C.amber}17`, border: `1px solid ${C.amberStrong}66` }}>
            {warning}
          </div>
        )}
        {light && mapStyle === 'dark' && (
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', fontSize: 12.5, color: C.textDim }}>
            <span>The map is still dark. The light map goes with a light theme.</span>
            <Button size="sm" onClick={() => onMapStyle('light')}>
              Use the light map
            </Button>
          </div>
        )}
        {!light && mapStyle === 'light' && (
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', fontSize: 12.5, color: C.textDim }}>
            <span>The map is light. The dark map goes with a dark theme.</span>
            <Button size="sm" onClick={() => onMapStyle('dark')}>
              Use the dark map
            </Button>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginTop: 20, paddingTop: 14, borderTop: `1px solid ${C.line}` }}>
          <Button variant="ghost" onClick={() => apply({ ...DEFAULT_THEME })} disabled={live.preset === 'night' && live.base === DEFAULT_THEME.base && live.accent === DEFAULT_THEME.accent}>
            Reset to Night shift
          </Button>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </ModalShell>
  );
}
