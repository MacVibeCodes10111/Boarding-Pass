// ============================================================================
// Shared UI kit: design tokens and small reusable controls.
// Look: a dispatcher's console. Deep navy surfaces, one amber accent for your
// airline, quiet steel-blue for information, green/red reserved for money.
// ============================================================================
import React, { useEffect, useState } from 'react';
import { DAY_LETTERS } from '../game/time';
import type { WeekDays } from '../game/types';
import { Icon } from './icons';

export const FONT = `'Segoe UI Variable Text', 'Segoe UI', Inter, system-ui, -apple-system, sans-serif`;

export const C = {
  // surfaces
  bg: '#0c1320',
  panel: '#131c2e',
  panelAlt: '#172235',
  raised: '#1d2a40',
  line: '#212c42',
  lineSoft: '#1b2538',
  border: '#2b3852',
  // text
  text: '#e7ecf5',
  textSoft: '#d3dae6',
  textDim: '#b4bfd0',
  muted: '#8d99ae',
  faint: '#5f6b82',
  // accents
  brand: '#f5a524', // your airline: fleet, primary actions, selection
  brandInk: '#1d1405', // text on brand
  accent: '#8fb8de', // information, secondary emphasis
  accentStrong: '#3d6b96',
  yellow: '#f5a524',
  // money & status
  green: '#3ecf8e',
  greenStrong: '#1f9d6a',
  amber: '#e8b04b',
  amberStrong: '#d9932b',
  red: '#f0565b',
  redSoft: '#f7a1a4',
  redDeep: '#3a1a22',
  purple: '#a78bfa',
  orange: '#f59e0b',
};

/** Global CSS: font, focus rings, hover feedback, panel animation. */
export const GLOBAL_CSS = `
  /* Layout sizes; the phone layout (ui/layout.ts) swaps the side rail for a bottom tab bar */
  :root { --bp-top-h: 52px; --bp-rail-w: 72px; --bp-bottom-h: 0px; }
  html[data-layout=phone] { --bp-top-h: 50px; --bp-rail-w: 0px; --bp-bottom-h: calc(58px + env(safe-area-inset-bottom, 0px)); }
  html, body, #root { margin: 0; padding: 0; width: 100vw; height: 100vh; height: 100dvh; overflow: hidden;
    background: ${C.bg}; color: ${C.text}; font-family: ${FONT}; font-size: 13px; -webkit-font-smoothing: antialiased;
    -webkit-text-size-adjust: 100%; overscroll-behavior: none; }
  body { -webkit-tap-highlight-color: transparent; }
  * { box-sizing: border-box; }
  input, select, button, textarea { font-family: inherit; }
  .num, .bp-num { font-variant-numeric: tabular-nums; }
  button { transition: background-color .12s, border-color .12s, color .12s, filter .12s; }
  button:not(:disabled):hover { filter: brightness(1.12); }
  button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid ${C.brand}; outline-offset: 1px; }
  input::placeholder { color: ${C.faint}; }
  input[type=number]::-webkit-inner-spin-button, input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
  input[type=number] { -moz-appearance: textfield; }
  select option, select optgroup { background: ${C.panel}; color: ${C.text}; }
  ::-webkit-scrollbar { width: 9px; height: 9px; }
  ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  .bp-row:hover { background: ${C.panelAlt}; }
  .bp-saved-item:hover { background: ${C.panelAlt}; }
  .bp-saved-item button[aria-label^=Delete]:hover { color: ${C.red}; }
  @keyframes bp-panel-in { from { transform: translateX(-14px); opacity: 0; } to { transform: none; opacity: 1; } }
  @keyframes bp-fade-in { from { opacity: 0; } to { opacity: 1; } }
  @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
  .maplibregl-popup-content { background: ${C.panel} !important; color: ${C.text}; border: 1px solid ${C.border}; border-radius: 10px !important;
    box-shadow: 0 12px 32px rgba(0,0,0,.5) !important; padding: 12px 14px !important; }
  .maplibregl-popup-tip { border-top-color: ${C.border} !important; border-bottom-color: ${C.border} !important; }
  .bp-orbit-popup .maplibregl-popup-tip { display: none; }
  .bp-orbit-popup .maplibregl-popup-content { cursor: grab; user-select: none; }
  .bp-orbit-popup.bp-orbit-dragging .maplibregl-popup-content { cursor: grabbing; }
  .bp-orbit-leader { position: absolute; left: 50%; top: 50%; width: 1px; height: 1px; overflow: visible; pointer-events: none; z-index: -1; }
  .bp-orbit-leader line { stroke: ${C.brand}; stroke-width: 1.5; stroke-dasharray: 3 3; opacity: 0.85; }
  .maplibregl-popup-close-button { color: ${C.muted}; font-size: 18px; padding: 2px 8px; }

  /* Touch screens: no sticky hover, roomier controls */
  html[data-input=touch] button:not(:disabled):hover { filter: none; }
  html[data-input=touch] .maplibregl-ctrl-group button { width: 38px; height: 38px; }
  html[data-input=touch] .maplibregl-popup-close-button { font-size: 24px; padding: 4px 12px; }
  .bp-scroll-x { overflow-x: auto; scrollbar-width: none; -webkit-overflow-scrolling: touch; }
  .bp-scroll-x::-webkit-scrollbar { display: none; }

  /* Phones */
  @keyframes bp-sheet-in { from { transform: translateY(18px); opacity: 0; } to { transform: none; opacity: 1; } }
  html[data-layout=phone] .bp-hide-phone { display: none !important; }
  html[data-layout=phone] .bp-sidepanel { width: 100vw !important; box-shadow: none !important; border-right: none !important; animation: bp-sheet-in .16s ease-out !important; }
  html[data-layout=phone] .bp-panel-head { padding: 12px 14px 10px !important; }
  html[data-layout=phone] .bp-panel-body { padding: 12px 12px 20px !important; }
  /* Grids inside panels and dialogs: stat rows become two columns, marked layouts stack */
  html[data-layout=phone] :is(.bp-panel-body, [role=dialog]) [style*="grid-template-columns: repeat("] { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
  html[data-layout=phone] .bp-stack { grid-template-columns: minmax(0, 1fr) !important; }
  html[data-layout=phone] .bp-wrap { display: flex !important; flex-wrap: wrap; row-gap: 6px !important; }
  html[data-layout=phone] .bp-wrap > * { min-width: 0; }
  html[data-layout=phone] .bp-modal-backdrop { padding: 10px 8px calc(10px + env(safe-area-inset-bottom, 0px)) !important; align-items: stretch !important; }
  html[data-layout=phone] .bp-modal-backdrop > [role=dialog] { padding: 16px !important; max-height: calc(100dvh - 20px) !important; }
  html[data-layout=phone] .bp-drawer { left: 0 !important; right: 0 !important; width: 100vw !important; top: var(--bp-top-h) !important;
    bottom: var(--bp-bottom-h) !important; border-radius: 0 !important; border-left: none !important; border-right: none !important; animation: bp-sheet-in .16s ease-out !important; }
  html[data-layout=phone] .maplibregl-popup { max-width: calc(100vw - 16px) !important; }
  .bp-sheet-popup { position: fixed !important; left: 8px !important; right: 8px !important; top: auto !important;
    bottom: calc(var(--bp-bottom-h) + 8px) !important; transform: none !important; max-width: none !important; z-index: 30; }
  .bp-sheet-popup.bp-sheet-side { left: auto !important; right: 12px !important; width: min(380px, calc(100vw - 24px)); bottom: 46px !important; }
  .bp-sheet-popup .maplibregl-popup-tip { display: none !important; }
  .bp-sheet-popup .maplibregl-popup-content { width: 100%; max-height: 46dvh; overflow-y: auto; overscroll-behavior: contain; }
  html[data-layout=phone] .bp-buy { height: auto !important; }
  html[data-layout=phone] .bp-buy-catalogue { max-height: 52dvh; }
  html[data-layout=phone] .bp-buy-details { overflow: visible !important; }
  html[data-layout=phone] .bp-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
  html[data-layout=phone] .bp-tiles > :first-child { grid-column: 1 / -1; }
  html[data-layout=phone] .bp-fleet-row { grid-template-columns: 28px minmax(0, 1fr) auto !important; }
  html[data-layout=phone] .bp-fleet-row > :nth-child(3), html[data-layout=phone] .bp-fleet-row > :nth-child(4) { grid-column: 2 / -1; }
  html[data-layout=phone] .bp-debt-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
  html[data-layout=phone] .bp-debt-grid > :last-child { grid-column: 1 / -1; }
  html[data-layout=phone] .bp-goal { grid-template-columns: 22px minmax(0, 1fr) !important; }
  html[data-layout=phone] .bp-goal > :nth-child(n+3) { grid-column: 2; }
  html[data-layout=phone] .bp-goal > :nth-child(4) { text-align: left !important; }
  html[data-layout=phone] .maplibregl-ctrl-bottom-left, html[data-layout=phone] .maplibregl-ctrl-bottom-right { margin-bottom: var(--bp-bottom-h); }
`;

export const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '7px 9px',
  background: C.bg,
  border: `1px solid ${C.border}`,
  borderRadius: 6,
  color: C.text,
  fontSize: 13,
};

export const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  color: C.muted,
  fontWeight: 600,
  marginBottom: 4,
};

export const panelStyle: React.CSSProperties = {
  background: C.panel,
  border: `1px solid ${C.line}`,
  borderRadius: 10,
  padding: 16,
};

export const cardStyle: React.CSSProperties = {
  background: C.bg,
  border: `1px solid ${C.line}`,
  borderRadius: 8,
  padding: '10px 12px',
};

// ----------------------------------------------------------------------------
// Buttons
// ----------------------------------------------------------------------------
type ButtonVariant = 'primary' | 'success' | 'danger' | 'warning' | 'ghost' | 'subtle' | 'violet';

const VARIANTS: Record<ButtonVariant, React.CSSProperties> = {
  primary: { background: C.brand, color: C.brandInk, border: `1px solid ${C.brand}` },
  success: { background: C.greenStrong, color: '#fff', border: `1px solid ${C.greenStrong}` },
  danger: { background: 'transparent', color: C.red, border: `1px solid ${C.red}66` },
  warning: { background: 'transparent', color: C.amber, border: `1px solid ${C.amber}66` },
  violet: { background: C.accentStrong, color: '#fff', border: `1px solid ${C.accentStrong}` },
  subtle: { background: C.raised, color: C.textSoft, border: `1px solid ${C.border}` },
  ghost: { background: 'transparent', color: C.muted, border: '1px solid transparent' },
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  block?: boolean;
}

export function Button({ variant = 'subtle', size = 'md', block, style, disabled, ...rest }: ButtonProps) {
  const pad = size === 'sm' ? '4px 9px' : size === 'lg' ? '10px 16px' : '6px 12px';
  const fontSize = size === 'sm' ? 12 : size === 'lg' ? 14 : 13;
  return (
    <button
      type="button"
      disabled={disabled}
      {...rest}
      style={{
        padding: pad,
        borderRadius: 6,
        fontWeight: 600,
        fontSize,
        lineHeight: 1.3,
        cursor: disabled ? 'not-allowed' : 'pointer',
        width: block ? '100%' : undefined,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        whiteSpace: 'nowrap',
        ...VARIANTS[variant],
        ...(disabled ? { background: C.raised, color: C.faint, border: `1px solid ${C.line}` } : null),
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
        padding: '4px 10px',
        borderRadius: 999,
        border: `1px solid ${active ? activeColor : C.border}`,
        fontSize: 12,
        fontWeight: 600,
        cursor: 'pointer',
        background: active ? activeColor : 'transparent',
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
    <div style={{ display: block ? 'flex' : 'inline-flex', width: block ? '100%' : undefined, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 7, padding: 2, gap: 2 }}>
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
              padding: block ? '4px 2px' : size === 'sm' ? '3px 9px' : '5px 12px',
              fontSize: size === 'sm' ? 12 : 13,
              fontWeight: 600,
              borderRadius: 5,
              border: 'none',
              cursor: 'pointer',
              background: on ? C.raised : 'transparent',
              color: on ? C.text : C.muted,
              boxShadow: on ? `inset 0 0 0 1px ${C.border}` : 'none',
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
        fontSize: 11.5,
        padding: '1px 8px',
        borderRadius: 999,
        background: solid ? `${color}26` : 'transparent',
        color,
        border: `1px solid ${color}55`,
        fontWeight: 600,
        whiteSpace: 'nowrap',
        lineHeight: 1.6,
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
    width: 28,
    height: 28,
    display: 'grid',
    placeItems: 'center',
    background: C.raised,
    border: `1px solid ${C.border}`,
    color: C.textSoft,
    cursor: 'pointer',
    padding: 0,
  };
  return (
    <div style={{ display: 'inline-flex', alignItems: 'stretch' }}>
      <button type="button" aria-label="Decrease" style={{ ...btn, borderRadius: '6px 0 0 6px' }} onClick={() => onChange(Math.max(min, value - step))}>
        <Icon name="minus" size={14} />
      </button>
      <NumberField
        value={value}
        min={min}
        max={max}
        onChange={onChange}
        style={{ width: 56, textAlign: 'center', borderRadius: 0, borderLeft: 'none', borderRight: 'none', padding: '4px 4px', height: 28 }}
      />
      <button type="button" aria-label="Increase" style={{ ...btn, borderRadius: '0 6px 6px 0' }} onClick={() => onChange(Math.min(max, value + step))}>
        <Icon name="plus" size={14} />
      </button>
    </div>
  );
}

export function Field({ label, hint, children, style }: { label: string; hint?: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={style}>
      <label style={labelStyle}>{label}</label>
      {children}
      {hint && <div style={{ fontSize: 11.5, color: C.faint, marginTop: 4 }}>{hint}</div>}
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
            padding: '6px 0',
            borderRadius: 6,
            border: `1px solid ${days[idx] ? C.accentStrong : C.border}`,
            fontWeight: 600,
            fontSize: 12,
            cursor: 'pointer',
            background: days[idx] ? C.accentStrong : 'transparent',
            color: days[idx] ? '#fff' : C.faint,
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
}: {
  children: React.ReactNode;
  onClose?: () => void;
  maxWidth?: number;
  zIndex?: number;
}) {
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="bp-modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(6, 10, 18, 0.7)',
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
        role="dialog"
        style={{
          background: C.panel,
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          width: '100%',
          maxWidth,
          maxHeight: 'calc(100dvh - 68px)',
          overflowY: 'auto',
          padding: 22,
          boxShadow: '0 24px 60px rgba(0,0,0,0.6)',
        }}
      >
        {children}
      </div>
    </div>
  );
}

export const TOPBAR_H = 52;
export const RAIL_W = 72;

/** Panel that slides in from the left, over the map, next to the nav rail. */
export function SidePanel({
  title,
  subtitle,
  width = 720,
  actions,
  onClose,
  children,
}: {
  title: string;
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

  return (
    <section
      aria-label={title}
      className="bp-sidepanel"
      style={{
        position: 'absolute',
        top: 'var(--bp-top-h)',
        left: 'var(--bp-rail-w)',
        bottom: 'var(--bp-bottom-h)',
        width: `min(${width}px, calc(100vw - var(--bp-rail-w) - 24px))`,
        background: C.panel,
        borderRight: `1px solid ${C.line}`,
        boxShadow: '12px 0 40px rgba(0,0,0,0.45)',
        zIndex: 40,
        display: 'flex',
        flexDirection: 'column',
        animation: 'bp-panel-in .16s ease-out',
      }}
    >
      <header className="bp-panel-head" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px 14px', borderBottom: `1px solid ${C.line}` }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 650, color: C.text, letterSpacing: '-0.01em' }}>{title}</h2>
          {subtitle && <div style={{ fontSize: 12.5, color: C.muted, marginTop: 2 }}>{subtitle}</div>}
        </div>
        {actions}
        <button
          type="button"
          aria-label="Close panel"
          onClick={onClose}
          style={{ background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', padding: 6, borderRadius: 6 }}
        >
          <Icon name="close" size={18} />
        </button>
      </header>
      <div className="bp-panel-body" style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '16px 20px 24px', overscrollBehavior: 'contain' }}>
        {children}
      </div>
    </section>
  );
}

export function SectionTitle({ children, color = C.textSoft, right }: { children: React.ReactNode; color?: string; right?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', margin: '0 0 8px' }}>
      <div style={{ fontSize: 13, fontWeight: 650, color }}>{children}</div>
      {right}
    </div>
  );
}

/** Thin horizontal progress bar. */
export function Meter({ pct, gradient, height = 6 }: { pct: number; gradient: string; height?: number }) {
  return (
    <div style={{ height, background: C.line, borderRadius: 4, overflow: 'hidden' }}>
      <div style={{ width: `${Math.max(0, Math.min(100, pct))}%`, height: '100%', background: gradient, transition: 'width 0.25s ease' }} />
    </div>
  );
}

/** Label/value pair used in spec grids. */
export function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div>
      <div style={{ fontSize: 11.5, color: C.muted }}>{label}</div>
      <div className="num" style={{ fontSize: 15, fontWeight: 600, color: C.text, marginTop: 1 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: C.faint }}>{sub}</div>}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div style={{ padding: '36px 20px', textAlign: 'center', border: `1px dashed ${C.border}`, borderRadius: 10 }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: C.textSoft }}>{title}</div>
      {body && <div style={{ fontSize: 12.5, color: C.muted, marginTop: 4, maxWidth: 420, marginInline: 'auto' }}>{body}</div>}
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </div>
  );
}
