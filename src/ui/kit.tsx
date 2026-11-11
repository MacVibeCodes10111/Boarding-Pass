// ============================================================================
// Shared UI kit: design tokens and small reusable controls.
// Look: a dispatcher's console. Deep navy surfaces, one amber accent for your
// airline, quiet steel-blue for information, green/red reserved for money.
// ============================================================================
import React, { useEffect, useRef, useState } from 'react';
import { DAY_LETTERS } from '../game/time';
import type { WeekDays } from '../game/types';
import { Icon, type IconName } from './icons';
import './fonts';
import { DEFAULT_PALETTE, buildPalette, loadThemeSpec, mix, saveThemeSpec, themeFromUrl, type Palette, type ThemeSpec } from './theme';
import { useLayout } from './layout';

// Look (v3.1): calm glass over the map. Flat controls, one highlight colour,
// lists divided by hairlines instead of boxes in boxes, and words only where a
// control can't speak for itself.
export const FONT = `'Barlow', 'Segoe UI Variable Text', 'Segoe UI', system-ui, -apple-system, sans-serif`;
/** Headings, big numbers, toolbar labels */
export const DISPLAY = `'Barlow Condensed', 'Barlow', 'Segoe UI', system-ui, sans-serif`;
/** A floating panel's surface: the theme's panel colour, see-through with the map blurred behind it. */
export const glass = (alpha = 'e6'): React.CSSProperties => ({
  background: `${C.panel}${alpha}`,
  backdropFilter: 'blur(16px) saturate(1.2)',
  WebkitBackdropFilter: 'blur(16px) saturate(1.2)',
  border: `1px solid ${C.border}80`,
  boxShadow: '0 12px 36px rgba(0,0,0,0.34)',
});

/** Control faces worked out from the theme: a button's face, a pressed or chosen face, and a shallow well. */
export const face = () => mix(C.raised, C.text, 0.05);
export const faceHi = () => mix(C.raised, C.text, 0.13);
export const well = () => `${C.text}0d`;

export const C: Palette = { ...DEFAULT_PALETTE };
/** The map's own colours (route lines, labels, halos): they suit the map styles, not the interface theme. */
export const MAP_C: Readonly<Palette> = Object.freeze({ ...DEFAULT_PALETTE });

// ---------------------------------------------------------------------------
// Themes (ui/theme.ts). C holds the current colours. A theme change rewrites C
// in place, refreshes the shared style objects below and the global CSS, and
// re-renders the app (App subscribes with useThemeVersion), so it applies live.
// ---------------------------------------------------------------------------
let themeSpec: ThemeSpec = (() => {
  const fromUrl = typeof location !== 'undefined' ? themeFromUrl(location.search) : null;
  if (fromUrl) {
    saveThemeSpec(fromUrl);
    try {
      const u = new URL(location.href);
      ['theme', 'bg', 'hl', 'ac'].forEach((k) => u.searchParams.delete(k));
      history.replaceState(null, '', u.pathname + u.search + u.hash);
    } catch {
      /* address left as it is */
    }
  }
  return fromUrl ?? loadThemeSpec();
})();
Object.assign(C, buildPalette(themeSpec));

const liveStyles: { refresh: () => void }[] = [];
/**
 * A style object that follows the theme: its fields read the current theme's
 * values (getters), so spreading it (`{ ...inputStyle }`) always gives the
 * current colours. Pass it spread, not by reference, so React sees the change.
 */
function live<T extends object>(make: () => T): T {
  let cur = make() as Record<string, unknown>;
  const obj = {} as Record<string, unknown>;
  for (const k of Object.keys(cur)) Object.defineProperty(obj, k, { enumerable: true, get: () => cur[k] });
  liveStyles.push({ refresh: () => (cur = make() as Record<string, unknown>) });
  return obj as T;
}
let themeVersion = 0;
const themeListeners = new Set<() => void>();

export const getThemeSpec = () => themeSpec;

/** Apply a theme now (and remember it on this device unless `preview`). */
export function setTheme(spec: ThemeSpec, opts: { preview?: boolean } = {}) {
  themeSpec = spec;
  if (!opts.preview) saveThemeSpec(spec);
  Object.assign(C, buildPalette(spec));
  liveStyles.forEach((l) => l.refresh());
  applyThemeToDocument();
  themeVersion++;
  themeListeners.forEach((f) => f());
}

/** Global CSS, page colours and the browser's theme colour. */
export function applyThemeToDocument() {
  if (typeof document === 'undefined') return;
  let style = document.getElementById('bp-global-reset');
  if (!style) {
    style = document.createElement('style');
    style.id = 'bp-global-reset';
    document.head.appendChild(style);
  }
  style.innerHTML = globalCss();
  document.documentElement.style.colorScheme = C.scheme;
  document.documentElement.dataset.theme = C.scheme;
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', C.bg);
}

/** Re-renders the calling component when the theme changes; returns a counter. */
export function useThemeVersion(): number {
  const [v, setV] = useState(themeVersion);
  useEffect(() => {
    const f = () => setV(themeVersion);
    themeListeners.add(f);
    f();
    return () => {
      themeListeners.delete(f);
    };
  }, []);
  return v;
}

/** Global CSS: font, focus rings, hover feedback, panel animation (from the current theme). */
export const globalCss = () => `
  /* Layout sizes; the phone layout (ui/layout.ts) swaps the side rail for a bottom tab bar */
  /* Layout sizes. Desktop and tablet: a floating top bar (10 + 50 px) and a floating toolbar at the bottom; panels float between them, --bp-gap from the edges */
  :root { --bp-top-h: 68px; --bp-rail-w: 0px; --bp-bottom-h: 86px; --bp-gap: 10px; color-scheme: ${C.scheme}; }
  html[data-layout=phone] { --bp-top-h: 50px; --bp-rail-w: 0px; --bp-bottom-h: calc(60px + env(safe-area-inset-bottom, 0px)); --bp-gap: 0px; }
  html, body, #root { margin: 0; padding: 0; width: 100vw; height: 100vh; height: 100dvh; overflow: hidden;
    background: ${C.bg}; color: ${C.text}; font-family: ${FONT}; font-size: 14px; -webkit-font-smoothing: antialiased;
    -webkit-text-size-adjust: 100%; overscroll-behavior: none; }
  body { -webkit-tap-highlight-color: transparent; }
  * { box-sizing: border-box; }
  input, select, button, textarea { font-family: inherit; }
  .num, .bp-num { font-variant-numeric: tabular-nums; }
  h1, h2, h3, .bp-display { font-family: ${DISPLAY}; letter-spacing: 0.005em; }
  .bp-glass { background: ${C.panel}e6; backdrop-filter: blur(16px) saturate(1.2); -webkit-backdrop-filter: blur(16px) saturate(1.2);
    border: 1px solid ${C.border}80; box-shadow: 0 12px 36px rgba(0,0,0,.34); }
  /* List rows are tiles */
  .bp-row { border-radius: 10px; }
  button { transition: background-color .12s, border-color .12s, color .12s, filter .12s; }
  button:not(:disabled):hover { filter: brightness(1.1); }
  /* Quiet controls show a face only under the pointer */
  .bp-btn-ghost:not(:disabled):hover, .bp-icon-btn:not(:disabled):hover, .bp-tab:not([aria-current]):hover { background: ${C.text}12 !important; filter: none; color: ${C.text} !important; }
  .bp-list > * + * { border-top: 1px solid ${C.line}; }
  /* A panel's own buttons drop under its tabs on a phone */
  html[data-layout=phone] .bp-panel-actions { order: 3; flex-basis: 100%; justify-content: flex-end; }
  html[data-layout=phone] .bp-panel-actions:empty { display: none; }
  button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid ${C.brand}; outline-offset: 1px; }
  input::placeholder { color: ${C.faint}; }
  input[type=number]::-webkit-inner-spin-button, input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
  input[type=number] { -moz-appearance: textfield; }
  select option, select optgroup { background: ${C.panel}; color: ${C.text}; }
  ::-webkit-scrollbar { width: 10px; height: 10px; }
  ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 6px; border: 2px solid transparent; background-clip: padding-box; }
  ::-webkit-scrollbar-track { background: transparent; }
  .bp-row:hover { background: ${C.panelAlt}; }
  .bp-saved-item:hover { background: ${C.panelAlt}; }
  .bp-saved-item button[aria-label^=Delete]:hover { color: ${C.red}; }
  @keyframes bp-panel-in { from { transform: translateX(-14px); opacity: 0; } to { transform: none; opacity: 1; } }
  @keyframes bp-fade-in { from { opacity: 0; } to { opacity: 1; } }
  @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
  .maplibregl-popup-content { background: ${C.panel}eb !important; color: ${C.text}; border: 1px solid ${C.border}; border-radius: 14px !important;
    backdrop-filter: blur(16px) saturate(1.2); -webkit-backdrop-filter: blur(16px) saturate(1.2);
    box-shadow: 0 14px 36px rgba(0,0,0,.5) !important; padding: 12px 14px !important; }
  .maplibregl-popup-tip { border-top-color: ${C.border} !important; border-bottom-color: ${C.border} !important; }
  .bp-orbit-popup .maplibregl-popup-tip { display: none; }
  .bp-orbit-popup .maplibregl-popup-content { cursor: grab; user-select: none; }
  .bp-orbit-popup.bp-orbit-dragging .maplibregl-popup-content { cursor: grabbing; }
  .bp-orbit-leader { position: absolute; left: 50%; top: 50%; width: 1px; height: 1px; overflow: visible; pointer-events: none; z-index: -1; }
  .bp-orbit-leader line { stroke: ${C.brand}; stroke-width: 1.5; stroke-dasharray: 3 3; opacity: 0.85; }
  .maplibregl-popup-close-button { color: ${C.muted}; font-size: 18px; padding: 2px 8px; }
  /* The close button sits in the top corner: the first line of a popup keeps clear of it */
  .bp-pop-head { padding-right: 26px; }
  html[data-input=touch] .bp-pop-head { padding-right: 40px; }
  /* A flight's info sheet covers the bottom of the map: the map buttons step aside until it closes */
  html:has(.bp-sheet-popup) .bp-layers-fab, html:has(.bp-sheet-popup) .bp-zoom, html:has(.bp-sheet-popup) .bp-camera-alt { visibility: hidden; }
  .bp-camera-alt { color: ${C.textDim}; background: ${C.panel}b8; }
  /* Room the camera box takes under the zoom buttons in 3D (a narrow column on phones) */
  :root { --bp-cam-space: 40px; }
  html[data-layout=phone] { --bp-cam-space: 82px; }
  html[data-layout=phone] .bp-camera-alt { flex-direction: column; padding: 3px !important; gap: 4px !important; }
  html[data-layout=phone] .bp-cam-text { display: none; }
  .bp-cam-btn { border: 1px solid ${C.border}; background: ${C.raised}; color: ${C.text}; }
  .bp-zoom { border: 1px solid ${C.border}; background: ${C.panel}d8; box-shadow: 0 6px 18px rgba(0,0,0,.35); }
  .bp-zoom-btn { background: transparent; color: ${C.text}; }
  .bp-zoom-btn + .bp-zoom-btn { border-top: 1px solid ${C.border} !important; }
  .bp-zoom-btn:hover { background: ${C.raised}; }

  /* Touch screens: no sticky hover, roomier controls */
  html[data-input=touch] button:not(:disabled):hover { filter: none; }
  html[data-input=touch] .maplibregl-ctrl-group button { width: 38px; height: 38px; }
  html[data-input=touch] .maplibregl-popup-close-button { font-size: 24px; padding: 4px 12px; }
  /* Touch screens: every button at least 32 px each way, so nothing is fiddly to hit */
  html[data-input=touch] button:not(.bp-no-min) { min-height: 32px; min-width: 32px; }
  html[data-input=touch] .bp-switch { width: 44px !important; height: 26px !important; min-height: 26px !important; min-width: 44px !important; }
  html[data-input=touch] .bp-switch > span { width: 22px !important; height: 22px !important; }
  .bp-scroll-x { overflow-x: auto; scrollbar-width: none; -webkit-overflow-scrolling: touch; }
  .bp-scroll-x::-webkit-scrollbar { display: none; }

  /* Phones */
  @keyframes bp-sheet-in { from { transform: translateY(18px); opacity: 0; } to { transform: none; opacity: 1; } }
  html[data-layout=phone] .bp-hide-phone { display: none !important; }
  html[data-layout=phone] .bp-sidepanel { left: 0 !important; width: 100vw !important; border-radius: 0 !important; border: none !important; box-shadow: none !important; animation: bp-sheet-in .16s ease-out !important; }
  html[data-layout=tablet] .bp-hide-tablet { display: none !important; }
  html[data-layout=tablet] .bp-topcard-airline { padding: 0 6px !important; }
  html[data-layout=phone] .bp-topcard { background: none !important; border: none !important; box-shadow: none !important; backdrop-filter: none !important; -webkit-backdrop-filter: none !important; padding: 0 !important; height: auto !important; }
  html[data-layout=phone] .bp-panel-head { padding: 8px 6px 8px 8px !important; }
  html[data-layout=phone] .bp-panel-body { padding: 12px 12px 20px !important; }
  /* Grids inside panels and dialogs: stat rows become two columns, marked layouts stack */
  html[data-layout=phone] :is(.bp-panel-body, [role=dialog]) [style*="grid-template-columns: repeat("]:not(.bp-stack) { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
  html[data-layout=phone] .bp-stack { grid-template-columns: minmax(0, 1fr) !important; }
  html[data-layout=phone] .bp-ap-row { flex-wrap: wrap; row-gap: 6px !important; }
  html[data-layout=phone] .bp-ap-row > :nth-child(2) { flex-basis: calc(100% - 52px) !important; }
  html[data-layout=phone] .bp-ap-row > :nth-child(3) { margin-left: 52px; }
  html[data-layout=phone] .bp-ap-row > :nth-child(4) { margin-left: auto; }
  html[data-layout=phone] :is(.bp-panel-body, [role=dialog]) .bp-model-grid { grid-template-columns: minmax(0, 1fr) !important; }
  html[data-layout=phone] .bp-wrap { display: flex !important; flex-wrap: wrap; row-gap: 6px !important; }
  html[data-layout=phone] .bp-wrap > * { min-width: 0; }
  html[data-layout=phone] .bp-modal-backdrop { padding: 10px 8px calc(10px + env(safe-area-inset-bottom, 0px)) !important; align-items: stretch !important; }
  html[data-layout=phone] .bp-modal-backdrop > [role=dialog] { padding: 16px !important; max-height: calc(100dvh - 20px) !important; }
  html[data-layout=phone] .bp-drawer { left: 0 !important; right: 0 !important; width: 100vw !important; top: var(--bp-top-h) !important; box-shadow: none !important;
    bottom: var(--bp-bottom-h) !important; border-radius: 0 !important; border-left: none !important; border-right: none !important; animation: bp-sheet-in .16s ease-out !important; }
  html[data-layout=phone] .maplibregl-popup { max-width: calc(100vw - 16px) !important; }
  .bp-sheet-popup { position: fixed !important; left: 8px !important; right: 8px !important; top: auto !important;
    bottom: calc(var(--bp-bottom-h) + 8px) !important; transform: none !important; max-width: none !important; z-index: 30; }
  .bp-sheet-popup.bp-sheet-side { left: auto !important; right: 12px !important; width: min(380px, calc(100vw - 24px)); bottom: calc(var(--bp-bottom-h) + 10px) !important; }
  .bp-sheet-popup .maplibregl-popup-tip { display: none !important; }
  .bp-sheet-popup .maplibregl-popup-content { width: 100%; max-height: 46dvh; overflow-y: auto; overscroll-behavior: contain; }
  html[data-layout=phone] .bp-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
  html[data-layout=phone] .bp-tiles > :first-child { grid-column: 1 / -1; }
  html[data-layout=phone] .bp-debt-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
  html[data-layout=phone] .bp-debt-grid > :last-child { grid-column: 1 / -1; }
  html[data-layout=phone] .bp-goal { grid-template-columns: 22px minmax(0, 1fr) !important; }
  html[data-layout=phone] .bp-goal > :nth-child(n+3) { grid-column: 2; }
  html[data-layout=phone] .bp-goal > :nth-child(4) { text-align: left !important; }
  html[data-layout=phone] .maplibregl-ctrl-bottom-left, html[data-layout=phone] .maplibregl-ctrl-bottom-right { margin-bottom: var(--bp-bottom-h); }
`;

export const inputStyle: React.CSSProperties = live(() => ({
  width: '100%',
  padding: '8px 11px',
  background: C.bg,
  border: `1px solid ${C.border}`,
  borderRadius: 10,
  color: C.text,
  fontSize: 14,
}));

export const labelStyle: React.CSSProperties = live(() => ({
  display: 'block',
  fontSize: 12.5,
  color: C.muted,
  fontWeight: 600,
  marginBottom: 5,
}));

export const panelStyle: React.CSSProperties = live(() => ({
  background: C.panelAlt,
  border: '1px solid transparent',
  borderRadius: 14,
  padding: 16,
}));

export const cardStyle: React.CSSProperties = live(() => ({
  background: C.panelAlt,
  border: '1px solid transparent',
  borderRadius: 12,
  padding: '10px 12px',
}));

// ----------------------------------------------------------------------------
// Buttons
// ----------------------------------------------------------------------------
type ButtonVariant = 'primary' | 'success' | 'danger' | 'warning' | 'ghost' | 'subtle' | 'violet';

const VARIANTS: Record<ButtonVariant, React.CSSProperties> = live(() => ({
  // Flat faces: the one filled with the highlight is the thing to do next
  primary: { background: C.brand, color: C.brandInk, border: '1px solid transparent' },
  success: { background: C.greenStrong, color: '#fff', border: '1px solid transparent' },
  danger: { background: `${C.red}1c`, color: C.red, border: '1px solid transparent' },
  warning: { background: `${C.amber}1c`, color: C.amber, border: '1px solid transparent' },
  violet: { background: C.accentStrong, color: '#fff', border: '1px solid transparent' },
  subtle: { background: face(), color: C.text, border: '1px solid transparent' },
  // No face until the pointer is over it
  ghost: { background: 'transparent', color: C.textDim, border: '1px solid transparent' },
}));

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  block?: boolean;
}

export function Button({ variant = 'subtle', size = 'md', block, style, disabled, ...rest }: ButtonProps) {
  const pad = size === 'sm' ? '5px 11px' : size === 'lg' ? '11px 18px' : '7px 14px';
  const fontSize = size === 'sm' ? 13 : size === 'lg' ? 15.5 : 14;
  return (
    <button
      type="button"
      disabled={disabled}
      {...rest}
      className={[variant === 'ghost' ? 'bp-btn-ghost' : 'bp-btn', rest.className].filter(Boolean).join(' ')}
      style={{
        padding: pad,
        borderRadius: size === 'lg' ? 12 : 10,
        fontWeight: 600,
        fontSize,
        lineHeight: 1.25,
        cursor: disabled ? 'not-allowed' : 'pointer',
        width: block ? '100%' : undefined,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        whiteSpace: 'nowrap',
        ...VARIANTS[variant],
        ...(disabled ? { background: variant === 'ghost' ? 'transparent' : well(), color: C.faint, border: '1px solid transparent' } : null),
        ...style,
      }}
    />
  );
}

/** Toggle chip used for filters. */
export function Chip({
  active,
  activeColor = C.brand,
  activeText = C.brandInk,
  children,
  onClick,
  style,
}: {
  active: boolean;
  activeColor?: string;
  activeText?: string;
  children: React.ReactNode;
  onClick: () => void;
  style?: React.CSSProperties;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '5px 12px',
        borderRadius: 999,
        border: '1px solid transparent',
        fontSize: 13,
        fontWeight: 600,
        cursor: 'pointer',
        background: active ? activeColor : well(),
        color: active ? activeText : C.textDim,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

/** Segmented control: one choice out of a few. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  block = false,
}: {
  options: { value: T; label: string; title?: string }[];
  value: T;
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
  /** Stretch across the full width, options sharing it equally. */
  block?: boolean;
}) {
  return (
    <div style={{ display: block ? 'flex' : 'inline-flex', width: block ? '100%' : undefined, background: well(), borderRadius: 10, padding: 3, gap: 2 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            title={o.title}
            onClick={() => onChange(o.value)}
            aria-pressed={on}
            style={{
              flex: block ? 1 : undefined,
              padding: block ? '5px 2px' : size === 'sm' ? '4px 11px' : '6px 14px',
              fontSize: size === 'sm' ? 13 : 14,
              fontWeight: 600,
              borderRadius: 8,
              border: 'none',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              background: on ? faceHi() : 'transparent',
              color: on ? C.text : C.muted,
              boxShadow: on ? '0 1px 2px rgba(0,0,0,.25)' : 'none',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Small coloured tag. */
export function Pill({ color, children, solid }: { color: string; children: React.ReactNode; solid?: boolean }) {
  return (
    <span
      style={{
        fontSize: 12.5,
        padding: '1px 8px',
        borderRadius: 999,
        background: `${color}${solid ? '30' : '1f'}`,
        color,
        border: '1px solid transparent',
        fontFamily: DISPLAY,
        fontWeight: 700,
        letterSpacing: '0.02em',
        whiteSpace: 'nowrap',
        lineHeight: 1.5,
      }}
    >
      {children}
    </span>
  );
}

// ----------------------------------------------------------------------------
// Inputs
// ----------------------------------------------------------------------------

/**
 * Number input that lets you type freely (including clearing the field) and
 * only clamps when you leave the field or press Enter.
 */
export function NumberField({
  value,
  onChange,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
  step,
  style,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  style?: React.CSSProperties;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  const commit = () => {
    const parsed = Number(draft);
    const next = Number.isFinite(parsed) && draft.trim() !== '' ? Math.min(max, Math.max(min, parsed)) : value;
    setDraft(String(next));
    if (next !== value) onChange(next);
  };

  return (
    <input
      type="number"
      inputMode="numeric"
      className="num"
      value={draft}
      min={min}
      max={max}
      step={step}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      style={{ ...inputStyle, padding: '6px 8px', fontSize: 13, ...style }}
    />
  );
}

/** − value + control for seat counts and similar. */
export function Stepper({
  value,
  onChange,
  min = 0,
  max = 9999,
  step = 1,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  const btn: React.CSSProperties = {
    width: 30,
    height: 30,
    display: 'grid',
    placeItems: 'center',
    background: face(),
    border: `1px solid ${C.border}`,
    color: C.textSoft,
    cursor: 'pointer',
    padding: 0,
  };
  return (
    <div style={{ display: 'inline-flex', alignItems: 'stretch' }}>
      <button type="button" aria-label="Decrease" style={{ ...btn, borderRadius: '8px 0 0 8px' }} onClick={() => onChange(Math.max(min, value - step))}>
        <Icon name="minus" size={14} />
      </button>
      <NumberField
        value={value}
        min={min}
        max={max}
        onChange={onChange}
        style={{ width: 58, textAlign: 'center', borderRadius: 0, borderLeft: 'none', borderRight: 'none', padding: '4px 4px', height: 30, fontFamily: DISPLAY, fontSize: 15, fontWeight: 600 }}
      />
      <button type="button" aria-label="Increase" style={{ ...btn, borderRadius: '0 8px 8px 0' }} onClick={() => onChange(Math.min(max, value + step))}>
        <Icon name="plus" size={14} />
      </button>
    </div>
  );
}

export function Field({ label, hint, children, style }: { label: string; hint?: string; children: React.ReactNode; style?: React.CSSProperties }) {
  // Accessibility: a single input/select is tied to its label; anything else is a labelled group
  const id = React.useId();
  const hintEl = hint && (
    <div id={`${id}-hint`} style={{ fontSize: 11.5, color: C.faint, marginTop: 4 }}>
      {hint}
    </div>
  );
  const only = React.isValidElement(children) && typeof children.type === 'string' && ['input', 'select', 'textarea'].includes(children.type) ? (children as React.ReactElement<{ id?: string; 'aria-describedby'?: string }>) : null;
  if (only) {
    const cid = only.props.id ?? id;
    return (
      <div style={style}>
        <label htmlFor={cid} style={{ ...labelStyle }}>
          {label}
        </label>
        {React.cloneElement(only, { id: cid, 'aria-describedby': only.props['aria-describedby'] ?? (hint ? `${id}-hint` : undefined) })}
        {hintEl}
      </div>
    );
  }
  return (
    <div style={style} role="group" aria-labelledby={`${id}-label`}>
      <div id={`${id}-label`} style={{ ...labelStyle }}>
        {label}
      </div>
      {children}
      {hintEl}
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder, style }: { value: string; onChange: (v: string) => void; placeholder: string; style?: React.CSSProperties }) {
  return (
    <div style={{ position: 'relative', ...style }}>
      <Icon name="search" size={15} color={C.faint} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)' }} />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} style={{ ...inputStyle, paddingLeft: 30 }} />
    </div>
  );
}

export function DayPicker({ days, onChange }: { days: WeekDays; onChange: (d: WeekDays) => void }) {
  const names = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {DAY_LETTERS.map((letter, idx) => (
        <button
          key={idx}
          type="button"
          title={names[idx]}
          aria-pressed={days[idx]}
          onClick={() => onChange(days.map((d, i) => (i === idx ? !d : d)))}
          style={{
            flex: 1,
            padding: '7px 0',
            borderRadius: 8,
            border: '1px solid transparent',
            fontWeight: 600,
            fontSize: 12,
            cursor: 'pointer',
            background: days[idx] ? C.accentStrong : well(),
            color: days[idx] ? '#fff' : C.muted,
          }}
        >
          {letter}
        </button>
      ))}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Layout
// ----------------------------------------------------------------------------
export function ModalShell({
  children,
  onClose,
  maxWidth = 860,
  zIndex = 200,
  closeButton = true,
  label,
}: {
  children: React.ReactNode;
  onClose?: () => void;
  maxWidth?: number;
  zIndex?: number;
  /** A close tile in the top corner (default); off for windows that draw their own. */
  closeButton?: boolean;
  /** The window's name for screen readers (defaults to its first heading). */
  label?: string;
}) {
  const backdrop = useRef<HTMLDivElement | null>(null);
  const dialog = useRef<HTMLDivElement | null>(null);
  // Accessibility: focus moves into the window when it opens, Tab stays inside
  // it, and focus goes back to where it was when it closes.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const el = dialog.current;
    if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
    if (el && !label && !el.getAttribute('aria-labelledby')) {
      const h = el.querySelector('h1, h2, h3');
      if (h) {
        h.id ||= `bp-dlg-${Math.random().toString(36).slice(2, 8)}`;
        el.setAttribute('aria-labelledby', h.id);
      }
    }
    const onTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !el) return;
      const shells = document.querySelectorAll('.bp-modal-backdrop');
      if (backdrop.current && shells[shells.length - 1] !== backdrop.current) return;
      const items = [...el.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter((n) => n.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === el)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onTab);
    return () => {
      window.removeEventListener('keydown', onTab);
      if (before && document.contains(before)) before.focus({ preventScroll: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!onClose) return;
    // The window takes Escape for itself: the panel or planner under it stays open
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Only the window on top (the last one opened) answers
      const shells = document.querySelectorAll('.bp-modal-backdrop');
      if (backdrop.current && shells[shells.length - 1] !== backdrop.current) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div
      ref={backdrop}
      className="bp-modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(4, 7, 13, 0.62)',
        backdropFilter: 'blur(3px)',
        WebkitBackdropFilter: 'blur(3px)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        zIndex,
        padding: '48px 20px 20px',
        overflowY: 'auto',
        animation: 'bp-fade-in .12s ease-out',
      }}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        style={{
          outline: 'none',
          ...glass('f4'),
          borderRadius: 18,
          width: '100%',
          maxWidth,
          maxHeight: 'calc(100dvh - 68px)',
          overflowY: 'auto',
          padding: 22,
          boxShadow: '0 28px 70px rgba(0,0,0,0.55)',
        }}
      >
        {onClose && closeButton && (
          // Stays in the corner while the window scrolls
          <div style={{ position: 'sticky', top: 0, height: 0, zIndex: 5 }}>
            <button
              type="button"
              className="bp-modal-close"
              aria-label="Close"
              title="Close"
              onClick={onClose}
              style={{ position: 'absolute', top: -12, right: -12, width: 34, height: 34, borderRadius: 999, display: 'grid', placeItems: 'center', background: face(), border: 'none', color: C.textSoft, cursor: 'pointer' }}
            >
              <Icon name="close" size={14} />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

export const TOPBAR_H = 52;
export const RAIL_W = 72;

/**
 * Tabs of a side panel, for panels grouped under one toolbar button
 * (Airline: Overview, Fleet, Schedule; Buy: Aircraft, Airports).
 * App provides them; every SidePanel inside shows them as its heading.
 */
export interface PanelTab {
  id: string;
  label: string;
  icon?: IconName;
  /** A small count beside the label (things waiting). */
  badge?: number;
}
export interface PanelTabsValue {
  group: string;
  tabs: PanelTab[];
  active: string;
  onPick: (id: string) => void;
}
export const PanelTabsContext = React.createContext<PanelTabsValue | null>(null);

/** A square button that is only an icon (close, delete, more): no face until the pointer is over it. */
export function IconButton({
  icon,
  label,
  size = 34,
  iconSize = 16,
  color,
  style,
  ...rest
}: { icon: IconName; label: string; size?: number; iconSize?: number; color?: string } & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'>) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...rest}
      className={['bp-icon-btn', rest.className].filter(Boolean).join(' ')}
      style={{ width: size, height: size, flex: 'none', borderRadius: 10, display: 'grid', placeItems: 'center', padding: 0, background: 'transparent', border: 'none', color: color ?? C.textDim, cursor: rest.disabled ? 'not-allowed' : 'pointer', opacity: rest.disabled ? 0.4 : 1, ...style }}
    >
      <Icon name={icon} size={iconSize} />
    </button>
  );
}

/** A bare on/off switch; `label` is read out, not drawn. */
export function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      className="bp-switch"
      aria-checked={on}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      style={{ width: 36, height: 22, borderRadius: 999, border: 'none', padding: 2, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.45 : 1, background: on ? C.brand : C.border, display: 'flex', justifyContent: on ? 'flex-end' : 'flex-start', flex: 'none' }}
    >
      <span style={{ width: 18, height: 18, borderRadius: 999, background: on ? C.brandInk : C.textDim }} />
    </button>
  );
}

/** The tabs of a grouped panel: they are its heading. */
function PanelTabsStrip({ v }: { v: PanelTabsValue }) {
  return (
    <nav aria-label={v.group} className="bp-panel-tabs bp-scroll-x" style={{ display: 'flex', alignItems: 'center', gap: 2, flex: '1 1 auto', minWidth: 0, overflowX: 'auto' }}>
      {v.tabs.map((t) => {
        const on = t.id === v.active;
        return (
          <button
            key={t.id}
            type="button"
            className="bp-tab"
            aria-current={on ? 'page' : undefined}
            onClick={() => v.onPick(t.id)}
            style={{
              flex: 'none',
              height: 36,
              padding: '0 13px',
              borderRadius: 10,
              whiteSpace: 'nowrap',
              cursor: 'pointer',
              fontFamily: DISPLAY,
              fontSize: 18,
              fontWeight: on ? 700 : 600,
              letterSpacing: '0.01em',
              color: on ? C.text : C.muted,
              background: on ? faceHi() : 'transparent',
              border: 'none',
            }}
          >
            {t.label}
            {t.badge ? (
              <span className="num" style={{ marginLeft: 6, padding: '1px 6px', borderRadius: 999, background: C.brand, color: C.brandInk, fontFamily: FONT, fontSize: 11, fontWeight: 700, verticalAlign: 2 }}>
                {t.badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}

export function SidePanel({
  title,
  subtitle,
  width = 720,
  actions,
  onClose,
  children,
  tabs: ownTabs,
}: {
  /** The panel's name. Shown as its heading unless the panel has tabs (then the tabs are the heading). */
  title: string;
  /** The panel's own tabs, shown as its heading (a panel with its own never shows its group's as well). */
  tabs?: PanelTabsValue;
  /** One quiet line under the heading, for a figure worth seeing at a glance. Not for explaining the panel. */
  subtitle?: React.ReactNode;
  width?: number;
  actions?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    // Escape closes the panel, unless a dialog on top of it gets the key first
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('[role=dialog]') && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const groupTabs = React.useContext(PanelTabsContext);
  const tabs = ownTabs ?? groupTabs;
  const phone = useLayout() === 'phone';

  return (
    <section
      aria-label={title}
      className="bp-sidepanel"
      style={{
        position: 'absolute',
        top: 'var(--bp-top-h)',
        left: 'var(--bp-gap)',
        bottom: 'var(--bp-bottom-h)',
        width: `min(${width}px, calc(100vw - 2 * var(--bp-gap) - 24px))`,
        ...glass('f0'),
        borderRadius: 18,
        overflow: 'hidden',
        zIndex: 40,
        display: 'flex',
        flexDirection: 'column',
        animation: 'bp-panel-in .16s ease-out',
      }}
    >
      <header className="bp-panel-head" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: phone ? 8 : 10, padding: tabs ? '10px 10px 10px 12px' : '12px 10px 12px 18px', borderBottom: `1px solid ${C.line}`, flex: 'none' }}>
        {tabs ? (
          <PanelTabsStrip v={tabs} />
        ) : (
          <div style={{ flex: '1 1 auto', minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, lineHeight: 1.15, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</h2>
            {subtitle && <div style={{ fontSize: 12.5, color: C.muted, marginTop: 2 }}>{subtitle}</div>}
          </div>
        )}
        {actions && (
          <div className="bp-panel-actions" style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 'none' }}>
            {actions}
          </div>
        )}
        <IconButton icon="close" label="Close" onClick={onClose} />
      </header>
      {tabs && subtitle && (
        <div className="num" style={{ flex: 'none', padding: phone ? '8px 12px 0' : '10px 18px 0', fontSize: 12.5, color: C.muted }}>
          {subtitle}
        </div>
      )}
      <div className="bp-panel-body" style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '14px 18px 22px', overscrollBehavior: 'contain' }}>
        {children}
      </div>
    </section>
  );
}

export function SectionTitle({ children, color = C.textSoft, right }: { children: React.ReactNode; color?: string; right?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', margin: '0 0 8px' }}>
      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: color === C.textSoft ? C.muted : color }}>{children}</div>
      {right}
    </div>
  );
}

/** Thin horizontal progress bar. */
export function Meter({ pct, gradient, height = 6 }: { pct: number; gradient: string; height?: number }) {
  return (
    <div style={{ height, background: C.line, borderRadius: 999, overflow: 'hidden' }}>
      <div style={{ width: `${Math.max(0, Math.min(100, pct))}%`, height: '100%', background: gradient, transition: 'width 0.25s ease' }} />
    </div>
  );
}

/** Label/value pair used in spec grids. */
export function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div>
      <div style={{ fontSize: 12.5, color: C.muted }}>{label}</div>
      <div className="num" style={{ fontFamily: DISPLAY, fontSize: 20, fontWeight: 600, lineHeight: 1.15, color: C.text, marginTop: 1 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: C.faint }}>{sub}</div>}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div style={{ padding: '44px 20px', textAlign: 'center', borderRadius: 16, background: well() }}>
      <div style={{ fontFamily: DISPLAY, fontSize: 21, fontWeight: 700, color: C.textSoft }}>{title}</div>
      {body && <div style={{ fontSize: 13, color: C.muted, marginTop: 4, maxWidth: 380, marginInline: 'auto' }}>{body}</div>}
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </div>
  );
}
