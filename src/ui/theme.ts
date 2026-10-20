// ============================================================================
// THEMES
//   The game's colours come from three choices: a background, a highlight
//   (buttons, selection, your airline in the interface) and the colour of your
//   aircraft on the map. Everything else (panels, borders, text, status
//   colours) is worked out from those, with enough contrast to read, for dark
//   and light backgrounds alike.
//
//   Presets are ready-made sets of the three; any of them can be changed with
//   the colour picker, which turns it into a custom theme. The choice is kept
//   on this device (all careers share it).
// ============================================================================

export interface Palette {
  bg: string;
  panel: string;
  panelAlt: string;
  raised: string;
  line: string;
  lineSoft: string;
  border: string;
  text: string;
  textSoft: string;
  textDim: string;
  muted: string;
  faint: string;
  brand: string;
  brandInk: string;
  accent: string;
  accentStrong: string;
  yellow: string;
  green: string;
  greenStrong: string;
  amber: string;
  amberStrong: string;
  red: string;
  redSoft: string;
  redDeep: string;
  purple: string;
  orange: string;
  /** Your aircraft on the map: icons, 3D shapes, labels, the flown trail. */
  fleet: string;
  /** 'dark' or 'light', for native controls (scrollbars, drop-down lists). */
  scheme: 'dark' | 'light';
}

/** The original look (v2.5 on): deep navy, amber highlight, orange aircraft. */
export const DEFAULT_PALETTE: Palette = {
  bg: '#0c1320',
  panel: '#131c2e',
  panelAlt: '#172235',
  raised: '#1d2a40',
  line: '#212c42',
  lineSoft: '#1b2538',
  border: '#2b3852',
  text: '#e7ecf5',
  textSoft: '#d3dae6',
  textDim: '#b4bfd0',
  muted: '#8d99ae',
  faint: '#5f6b82',
  brand: '#f5a524',
  brandInk: '#1d1405',
  accent: '#8fb8de',
  accentStrong: '#3d6b96',
  yellow: '#f5a524',
  green: '#3ecf8e',
  greenStrong: '#1f9d6a',
  amber: '#e8b04b',
  amberStrong: '#d9932b',
  red: '#f0565b',
  redSoft: '#f7a1a4',
  redDeep: '#3a1a22',
  purple: '#a78bfa',
  orange: '#f59e0b',
  fleet: '#f97316',
  scheme: 'dark',
};

export interface ThemeSpec {
  /** Preset id, or 'custom' once a colour has been changed. */
  preset: string;
  base: string;
  accent: string;
  /** null: same as the highlight. */
  fleet: string | null;
}

export interface ThemePreset extends ThemeSpec {
  name: string;
  blurb: string;
}

export const THEME_PRESETS: ThemePreset[] = [
  { preset: 'night', name: 'Night shift', blurb: 'Deep navy with an amber highlight. The original.', base: '#0c1320', accent: '#f5a524', fleet: '#f97316' },
  { preset: 'studio-black', name: 'Studio black', blurb: 'Black and white, with one colour of your choice.', base: '#000000', accent: '#ff4f1f', fleet: null },
  { preset: 'studio-white', name: 'Studio white', blurb: 'White and black, with one colour of your choice.', base: '#ffffff', accent: '#2f54ff', fleet: null },
  { preset: 'tarmac', name: 'Tarmac', blurb: 'Asphalt grey and taxiway yellow.', base: '#16171a', accent: '#ffd21f', fleet: null },
  { preset: 'cockpit', name: 'Cockpit', blurb: 'Glass-cockpit graphite with avionics green.', base: '#0b1210', accent: '#3ee08f', fleet: '#5fd4ff' },
];

/** Quick picks next to the colour picker. */
export const POP_COLOURS = ['#ff3b30', '#ff4f1f', '#ff9500', '#ffd21f', '#34c759', '#00c7be', '#0a84ff', '#2f54ff', '#5e5ce6', '#bf5af2', '#ff2d92', '#ffffff', '#000000'];

export const DEFAULT_THEME: ThemeSpec = { preset: 'night', base: DEFAULT_PALETTE.bg, accent: DEFAULT_PALETTE.brand, fleet: DEFAULT_PALETTE.fleet };

// ---------------------------------------------------------------------------
// Colour maths (sRGB hex, HSL and HSV, WCAG contrast)
// ---------------------------------------------------------------------------
export type RGB = [number, number, number];
const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

export function normHex(hex: string): string | null {
  const m = hex.trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{3}$/.test(m)) return '#' + m.split('').map((c) => c + c).join('');
  if (/^[0-9a-f]{6}$/.test(m)) return '#' + m;
  return null;
}
export function hexToRgb(hex: string): RGB {
  const h = normHex(hex) ?? '#000000';
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}
export function rgbToHex([r, g, b]: RGB): string {
  return '#' + [r, g, b].map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
}
/** h 0..360, s and l 0..1 */
export function rgbToHsl([r, g, b]: RGB): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
export function hslToRgb(h: number, s: number, l: number): RGB {
  h = ((h % 360) + 360) % 360;
  s = clamp(s);
  l = clamp(l);
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}
const hsl = (h: number, s: number, l: number) => rgbToHex(hslToRgb(h, s, l));
/** h 0..360, s and v 0..1 */
export function hexToHsv(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  const s = max === 0 ? 0 : d / max;
  let h = 0;
  if (d) h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) * 60 : max === g ? ((b - r) / d + 2) * 60 : ((r - g) / d + 4) * 60;
  return [h, s, max];
}
export function hsvToHex(h: number, s: number, v: number): string {
  h = ((h % 360) + 360) % 360;
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return rgbToHex([f(5) * 255, f(3) * 255, f(1) * 255]);
}
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
/** Mix two colours, t = 0 gives a, 1 gives b. */
export function mix(a: string, b: string, t: number): string {
  const p = hexToRgb(a);
  const q = hexToRgb(b);
  return rgbToHex([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t]);
}
/** Move a colour's lightness (keeping its hue) until it reaches `min` contrast against `bg`. */
function withContrast(fg: string, bg: string, min: number, towardsLight: boolean): string {
  if (contrast(fg, bg) >= min) return fg;
  const [h, s, l0] = rgbToHsl(hexToRgb(fg));
  for (let i = 1; i <= 50; i++) {
    const l = clamp(towardsLight ? l0 + i * 0.02 : l0 - i * 0.02);
    const c = hsl(h, s, l);
    if (contrast(c, bg) >= min) return c;
  }
  return towardsLight ? '#ffffff' : '#000000';
}
/** Black or white, whichever reads better on `bg`. */
const inkFor = (bg: string) => (contrast(bg, '#ffffff') >= contrast(bg, '#101010') ? '#ffffff' : '#101010');

export const isLightColour = (hex: string) => luminance(hex) > 0.35;

// ---------------------------------------------------------------------------
// Palette from a theme
// ---------------------------------------------------------------------------
export function buildPalette(spec: ThemeSpec): Palette {
  const base = normHex(spec.base) ?? DEFAULT_PALETTE.bg;
  const accent = normHex(spec.accent) ?? DEFAULT_PALETTE.brand;
  const fleet = (spec.fleet && normHex(spec.fleet)) || accent;
  const brandInk = accent === DEFAULT_PALETTE.brand ? DEFAULT_PALETTE.brandInk : inkFor(accent);

  // The original background keeps its hand-tuned surfaces and text exactly
  if (base === DEFAULT_PALETTE.bg) return { ...DEFAULT_PALETTE, brand: accent, yellow: accent, brandInk, fleet };

  const light = isLightColour(base);
  const [h, s0, l0] = rgbToHsl(hexToRgb(base));
  // Surfaces: steps of lightness from the background, same hue (greys stay grey)
  const s = Math.min(s0, 0.6);
  const step = (dl: number) => hsl(h, s * (light ? 0.9 : 0.85), clamp(l0 + (light ? -dl : dl)));
  const panel = light ? mix(base, '#000000', l0 > 0.97 ? 0.025 : 0.035) : step(0.045);
  const surfaces = light
    ? { bg: base, panel, panelAlt: step(0.055), raised: step(0.085), line: step(0.1), lineSoft: step(0.065), border: step(0.17) }
    : { bg: base, panel, panelAlt: step(0.065), raised: step(0.1), line: step(0.11), lineSoft: step(0.075), border: step(0.16) };
  // Text: near-white or near-black with a touch of the background's hue, each level checked for contrast on panels
  const ts = Math.min(s0, 0.4);
  const tone = (l: number, sat: number) => hsl(h, sat, l);
  const on = surfaces.panel;
  const text = light
    ? { text: withContrast(tone(0.1, ts * 0.6), on, 12, false), textSoft: withContrast(tone(0.2, ts * 0.5), on, 9, false), textDim: withContrast(tone(0.32, ts * 0.4), on, 6, false), muted: withContrast(tone(0.42, ts * 0.3), on, 4.6, false), faint: withContrast(tone(0.6, ts * 0.25), on, 2.4, false) }
    : { text: withContrast(tone(0.93, ts), on, 12, true), textSoft: withContrast(tone(0.86, ts * 0.9), on, 9, true), textDim: withContrast(tone(0.76, ts * 0.7), on, 6, true), muted: withContrast(tone(0.62, ts * 0.35), on, 4.6, true), faint: withContrast(tone(0.44, ts * 0.3), on, 2.4, true) };
  // Information and status colours, darker on light backgrounds so they still read
  const status = light
    ? { accent: '#2f6596', accentStrong: '#2c5a87', green: '#127a4b', greenStrong: '#0f7a4a', amber: '#9a6200', amberStrong: '#b06f00', red: '#c62f37', redSoft: '#b03038', redDeep: '#fbe2e3', purple: '#6545d0', orange: '#c25e00' }
    : { accent: DEFAULT_PALETTE.accent, accentStrong: DEFAULT_PALETTE.accentStrong, green: DEFAULT_PALETTE.green, greenStrong: DEFAULT_PALETTE.greenStrong, amber: DEFAULT_PALETTE.amber, amberStrong: DEFAULT_PALETTE.amberStrong, red: DEFAULT_PALETTE.red, redSoft: DEFAULT_PALETTE.redSoft, redDeep: mix(base, '#f0565b', 0.18), purple: DEFAULT_PALETTE.purple, orange: DEFAULT_PALETTE.orange };
  return { ...surfaces, ...text, ...status, brand: accent, yellow: accent, brandInk, fleet, scheme: light ? 'light' : 'dark' };
}

/** How readable the highlight is on the panels: shown as a hint in the picker. */
export function highlightWarning(p: Palette): string | null {
  const c = contrast(p.brand, p.panel);
  if (c < 1.6) return 'The highlight is almost the same as the background, so selections and buttons will be hard to see.';
  if (c < 2.4) return 'The highlight is close to the background; selections may be hard to see.';
  return null;
}

// ---------------------------------------------------------------------------
// Saved on this device
// ---------------------------------------------------------------------------
const THEME_KEY = 'bp_pc_theme_v1';

export function loadThemeSpec(): ThemeSpec {
  try {
    const v = JSON.parse(localStorage.getItem(THEME_KEY) ?? 'null');
    if (v && typeof v.base === 'string' && typeof v.accent === 'string' && normHex(v.base) && normHex(v.accent)) {
      return { preset: typeof v.preset === 'string' ? v.preset : 'custom', base: normHex(v.base)!, accent: normHex(v.accent)!, fleet: v.fleet && normHex(v.fleet) ? normHex(v.fleet) : null };
    }
  } catch {
    /* storage off: the default look */
  }
  return { ...DEFAULT_THEME };
}

export function saveThemeSpec(spec: ThemeSpec) {
  try {
    localStorage.setItem(THEME_KEY, JSON.stringify(spec));
  } catch {
    /* not remembered, still applied for this visit */
  }
}

/** A theme passed in the address (from the website): ?theme=studio-black or ?bg=000000&hl=ff4f1f&ac=ff4f1f */
export function themeFromUrl(search: string): ThemeSpec | null {
  try {
    const q = new URLSearchParams(search);
    const preset = THEME_PRESETS.find((p) => p.preset === q.get('theme'));
    const bg = q.get('bg') && normHex(q.get('bg')!);
    const hl = q.get('hl') && normHex(q.get('hl')!);
    const ac = q.get('ac') && normHex(q.get('ac')!);
    if (bg && hl) return { preset: preset?.preset ?? 'custom', base: bg, accent: hl, fleet: ac || null };
    if (preset) return { preset: preset.preset, base: preset.base, accent: preset.accent, fleet: preset.fleet };
  } catch {
    /* ignore */
  }
  return null;
}
