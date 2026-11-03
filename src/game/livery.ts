// ============================================================================
// LIVERY (v2.66: layers)
//   The airline's livery as a stack of layers, like an image editor: fills,
//   bands along the fuselage, shapes, curves, text, brush strokes and logos.
//   Layers are placed in the aircraft's own frames, not in pixels, so one
//   design fits every type:
//
//     body  u 0 (nose) to 1 (tail), v 0 (crown) to 1 (belly) of the cabin;
//           sizes are in cabin heights, so a circle stays round on any type
//     fin   r 0 (leading edge) to 1 (trailing edge), s 0 (root) to 1 (tip);
//           sizes are in fin heights
//
//   Each layer is cut to a region of the aircraft (fuselage, tail, engines or
//   all of them). Stored in the save; painted by liveryPaint.ts. Liveries
//   from v2.64-2.65 (a flat set of colours) are turned into layers on load.
// ============================================================================

export type Region = 'fuselage' | 'tail' | 'engines' | 'wings' | 'winglets' | 'stabiliser' | 'all';
export type Frame = 'body' | 'fin';
export type ShapeKind = 'rect' | 'ellipse' | 'triangle' | 'star' | 'chevron';
export type FontId = 'sans' | 'serif' | 'italic' | 'condensed' | 'script';

/** A path in frame coordinates: M x y, L x y, C x1 y1 x2 y2 x y (closed and filled). */
export type PathCmd = ['M', number, number] | ['L', number, number] | ['C', number, number, number, number, number, number];

export interface Stroke {
  colour: string;
  /** Width in cabin heights (body) or fin heights (fin). */
  width: number;
  /** x, y pairs in the layer's frame. */
  pts: number[];
  erase?: boolean;
}

interface Base {
  id: string;
  name: string;
  hidden?: boolean;
  locked?: boolean;
  /** 0 to 1. */
  opacity: number;
  region: Region;
}

export type Layer = Base &
  (
    | { kind: 'fill'; colour: string }
    /** Straight along the whole fuselage (belly, cheatlines), from v0 to v1. */
    | { kind: 'band'; colour: string; v0: number; v1: number }
    | { kind: 'shape'; frame: Frame; shape: ShapeKind; colour: string; x: number; y: number; w: number; h: number; rot: number }
    | { kind: 'path'; frame: Frame; colour: string; d: PathCmd[]; dx: number; dy: number }
    | {
        kind: 'text';
        frame: Frame;
        text: string;
        font: FontId;
        colour: string;
        x: number;
        y: number;
        size: number;
        rot: number;
        /** Placed by the aircraft: 'titles' above the windows, 'registration' on the rear fuselage (until moved). */
        auto?: 'titles' | 'registration';
        /** Use the airline's name (it follows a rename). */
        airlineName?: boolean;
        /** Use each aircraft's registration (P4-LKA). */
        registration?: boolean;
      }
    | { kind: 'paint'; frame: Frame; strokes: Stroke[] }
    | { kind: 'logo'; frame: Frame; logo: string; x: number; y: number; size: number; rot: number }
  );

export type LayerKind = Layer['kind'];

export interface Livery {
  v: 2;
  /** What the player calls it ("Main", "Retro"). */
  name?: string;
  layers: Layer[];
  /** Uploaded logos: id → 128×128 WebP or PNG data URL. */
  logos: Record<string, string>;
  /** The logo shown as the airline's logo (in the corner of the screen and beside its flights), v2.67. */
  badge?: string;
}

export const MAX_LAYERS = 40;
export const MAX_STROKES = 400;
export const MAX_LOGOS = 5;
/** Liveries an airline can have; each aircraft wears one of them. */
export const MAX_LIVERIES = 2;
export const LOGO_PX = 128;
/** Biggest logo data URL kept (characters, about 16 KB of image). */
export const MAX_LOGO_CHARS = 22_000;

export const REGION_LABEL: Record<Region, string> = { fuselage: 'Fuselage', tail: 'Tail', engines: 'Engines', wings: 'Wings', winglets: 'Wingtips', stabiliser: 'Tailplane', all: 'Whole aircraft' };
/** The parts every aircraft has a mask for (wings, wingtips and tailplanes since v2.66; a type may not have wingtips). */
export const REGIONS: Region[] = ['fuselage', 'tail', 'engines', 'wings', 'winglets', 'stabiliser', 'all'];
export const FONT_LABEL: Record<FontId, string> = { sans: 'Modern', italic: 'Italic', serif: 'Classic', condensed: 'Condensed', script: 'Script' };
export const FONT_CSS: Record<FontId, { family: string; style: string; weight: number }> = {
  sans: { family: 'Barlow, "Segoe UI", system-ui, sans-serif', style: 'normal', weight: 700 },
  italic: { family: 'Barlow, "Segoe UI", system-ui, sans-serif', style: 'italic', weight: 700 },
  serif: { family: 'Georgia, "Times New Roman", serif', style: 'normal', weight: 700 },
  condensed: { family: '"Barlow Condensed", "Arial Narrow", sans-serif-condensed, sans-serif', style: 'normal', weight: 700 },
  script: { family: '"Brush Script MT", "Segoe Script", cursive', style: 'italic', weight: 400 },
};

let seq = 0;
export const newId = () => `l${Date.now().toString(36)}${(seq++).toString(36)}`;

// ----------------------------------------------------------------------------
// Ready-made pieces and styles
// ----------------------------------------------------------------------------
const base = (name: string, region: Region): Base => ({ id: newId(), name, opacity: 1, region });

export const fillLayer = (name: string, region: Region, colour: string): Layer => ({ ...base(name, region), kind: 'fill', colour });
export const bandLayer = (name: string, colour: string, v0: number, v1: number): Layer => ({ ...base(name, 'fuselage'), kind: 'band', colour, v0, v1 });
export const titlesLayer = (colour: string, font: FontId = 'sans'): Layer => ({
  ...base('Titles', 'fuselage'),
  kind: 'text',
  frame: 'body',
  text: '',
  airlineName: true,
  font,
  colour,
  x: 0.2,
  y: 0.25,
  size: 0.16,
  rot: 0,
  auto: 'titles',
});
export const registrationLayer = (colour: string): Layer => ({
  ...base('Registration', 'fuselage'),
  kind: 'text',
  frame: 'body',
  text: '',
  registration: true,
  font: 'sans',
  colour,
  x: 0.86,
  y: 0.32,
  size: 0.1,
  rot: 0,
  auto: 'registration',
});
export const shapeLayer = (name: string, frame: Frame, shape: ShapeKind, colour: string, x: number, y: number, w: number, h = w, rot = 0): Layer => ({
  ...base(name, frame === 'fin' ? 'tail' : 'fuselage'),
  kind: 'shape',
  frame,
  shape,
  colour,
  x,
  y,
  w,
  h,
  rot,
});
export const pathLayer = (name: string, frame: Frame, colour: string, d: PathCmd[]): Layer => ({
  ...base(name, frame === 'fin' ? 'tail' : 'fuselage'),
  kind: 'path',
  frame,
  colour,
  d,
  dx: 0,
  dy: 0,
});

/** A curve sampled into a path: from (t) → [x, y] for t 0..1. */
const curve = (n: number, f: (t: number) => [number, number]): PathCmd[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const [x, y] = f(i / n);
    return (i ? ['L', x, y] : ['M', x, y]) as PathCmd;
  });

const swoosh = (du: number, dv: number): PathCmd[] => [
  ['M', 0.1 + du, 1.05 + dv],
  ['C', 0.45 + du, 0.98 + dv, 0.72 + du, 0.62 + dv, 1.15 + du, -0.25 + dv],
  ['L', 1.3, 1.6],
  ['L', 0.1 + du, 1.6],
];
const sweep = (du: number): PathCmd[] => [
  ['M', 0.6 + du, 1.3],
  ['C', 0.7 + du, 0.95, 0.74 + du, 0.35, 0.86 + du, -0.3],
  ['L', 1.3, -0.3],
  ['L', 1.3, 1.3],
];
const finSplit = (): PathCmd[] => [...curve(24, (t) => [-0.4 + t * 1.8, 0.22 + 0.6 * Math.pow(t, 1.4)]), ['L', 1.4, 1.4], ['L', -0.4, 1.4]];
const finBand = (): PathCmd[] => [['M', -0.5, 0.42], ['L', 1.5, 0.42], ['L', 1.5, 0.6], ['L', -0.5, 0.6]];
const finStripe = (r0: number): PathCmd[] => [['M', r0, -0.2], ['L', r0 + 0.13, -0.2], ['L', r0 + 0.13, 1.3], ['L', r0, 1.3]];

/** The tail letter: the first letter of the airline's name. */
const tailLetter = (colour: string): Layer => ({
  ...base('Tail initial', 'tail'),
  kind: 'text',
  frame: 'fin',
  text: '',
  airlineName: true,
  font: 'sans',
  colour,
  x: 0.52,
  y: 0.46,
  size: 0.42,
  rot: 0,
});

export interface LiveryStyle {
  id: string;
  label: string;
  make: (a: string, b: string) => Layer[];
}

/** Ready-made layer stacks to start from, in the player's two colours. */
export const LIVERY_STYLES: LiveryStyle[] = [
  { id: 'eurowhite', label: 'White with coloured tail', make: (a) => [fillLayer('Fuselage', 'all', '#ffffff'), fillLayer('Tail', 'tail', a), titlesLayer(a), registrationLayer('#3a3f45')] },
  {
    id: 'cheatline',
    label: 'Classic cheatline',
    make: (a, b) => [
      fillLayer('Fuselage', 'all', '#ffffff'),
      bandLayer('Belly', '#c9ced4', 0.7, 3),
      bandLayer('Cheatline', a, 0.55, 0.63),
      bandLayer('Pinstripe', b, 0.655, 0.685),
      fillLayer('Tail', 'tail', a),
      pathLayer('Tail band', 'fin', b, finBand()),
      fillLayer('Engines', 'engines', a),
      titlesLayer(a),
      registrationLayer('#3a3f45'),
    ],
  },
  {
    id: 'belly',
    label: 'Coloured belly',
    make: (a, b) => [
      fillLayer('Fuselage', 'all', '#ffffff'),
      bandLayer('Belly', a, 0.65, 3),
      fillLayer('Tail', 'tail', a),
      shapeLayer('Tail disc', 'fin', 'ellipse', b, 0.52, 0.46, 0.44),
      fillLayer('Engines', 'engines', a),
      titlesLayer(a),
      registrationLayer('#3a3f45'),
    ],
  },
  {
    id: 'swoosh',
    label: 'Swoosh',
    make: (a, b) => [
      fillLayer('Fuselage', 'all', '#ffffff'),
      pathLayer('Swoosh edge', 'body', b, swoosh(0, 0)),
      pathLayer('Swoosh', 'body', a, swoosh(0.04, 0.07)),
      fillLayer('Tail', 'tail', a),
      pathLayer('Tail split', 'fin', b, finSplit()),
      fillLayer('Engines', 'engines', a),
      titlesLayer(a),
      registrationLayer('#3a3f45'),
    ],
  },
  {
    id: 'sweep',
    label: 'Tail sweep',
    make: (a, b) => [
      fillLayer('Fuselage', 'all', '#ffffff'),
      pathLayer('Sweep edge', 'body', b, sweep(0)),
      pathLayer('Sweep', 'body', a, sweep(0.025)),
      fillLayer('Tail', 'tail', a),
      ...[0.14, 0.4, 0.66].map((r, i) => pathLayer(`Tail stripe ${i + 1}`, 'fin', b, finStripe(r))),
      titlesLayer(a),
      registrationLayer('#3a3f45'),
    ],
  },
  {
    id: 'twin',
    label: 'Twin stripes',
    make: (a, b) => [
      fillLayer('Fuselage', 'all', '#ffffff'),
      bandLayer('Stripe 1', a, 0.56, 0.61),
      bandLayer('Stripe 2', b, 0.635, 0.665),
      fillLayer('Tail', 'tail', a),
      ...[0.3, 0.55].map((r, i) => pathLayer(`Tail stripe ${i + 1}`, 'fin', b, finStripe(r))),
      fillLayer('Engines', 'engines', a),
      titlesLayer(a),
      registrationLayer('#3a3f45'),
    ],
  },
  {
    id: 'window',
    label: 'Window line',
    make: (a, b) => [
      fillLayer('Fuselage', 'all', '#ffffff'),
      bandLayer('Belly', '#c9ced4', 0.68, 3),
      bandLayer('Window line', a, 0.3, 0.5),
      bandLayer('Pinstripe', b, 0.52, 0.545),
      fillLayer('Tail', 'tail', '#ffffff'),
      tailLetter(a),
      fillLayer('Engines', 'engines', a),
      registrationLayer('#3a3f45'),
    ],
  },
  {
    id: 'darkbelly',
    label: 'Dark belly',
    make: (a, b) => [
      fillLayer('Fuselage', 'all', '#ffffff'),
      bandLayer('Pinstripe', b, 0.5, 0.535),
      bandLayer('Belly', a, 0.535, 3),
      fillLayer('Tail', 'tail', a),
      shapeLayer('Tail star', 'fin', 'star', b, 0.52, 0.46, 0.36),
      fillLayer('Tailplane', 'stabiliser', a),
      fillLayer('Engines', 'engines', b),
      titlesLayer(a),
      registrationLayer('#3a3f45'),
    ],
  },
  {
    id: 'full',
    label: 'Full colour',
    make: (a, b) => [fillLayer('Fuselage', 'all', a), tailLetter(b), fillLayer('Engines', 'engines', a), titlesLayer('#ffffff'), registrationLayer('#ffffff')],
  },
];

export const DEFAULT_LIVERY: Livery = { v: 2, layers: LIVERY_STYLES[0].make('#1d4e89', '#f5a623'), logos: {} };

// ----------------------------------------------------------------------------
// Loading: checks every field, and turns v1 liveries into layers
// ----------------------------------------------------------------------------
const HEX = /^#[0-9a-f]{6}$/i;
const hex = (v: unknown, d: string) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : d);
const num = (v: unknown, d: number, lo = -1e3, hi = 1e3) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const one = <T extends string>(v: unknown, list: readonly T[], d: T): T => (list.includes(v as T) ? (v as T) : d);
const str = (v: unknown, d: string, max: number) => (typeof v === 'string' ? v.slice(0, max) : d);
const FRAMES: Frame[] = ['body', 'fin'];
const SHAPES: ShapeKind[] = ['rect', 'ellipse', 'triangle', 'star', 'chevron'];
const FONTS: FontId[] = ['sans', 'serif', 'italic', 'condensed', 'script'];

function layerFrom(x: unknown): Layer | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const b: Base = {
    id: str(o.id, newId(), 40) || newId(),
    name: str(o.name, 'Layer', 40),
    hidden: o.hidden === true || undefined,
    locked: o.locked === true || undefined,
    opacity: num(o.opacity, 1, 0, 1),
    region: one(o.region, REGIONS, 'fuselage'),
  };
  const frame = one(o.frame, FRAMES, 'body');
  const colour = hex(o.colour, '#ffffff');
  switch (o.kind) {
    case 'fill':
      return { ...b, kind: 'fill', colour };
    case 'band':
      return { ...b, kind: 'band', colour, v0: num(o.v0, 0.5, -2, 4), v1: num(o.v1, 0.6, -2, 4) };
    case 'shape':
      return { ...b, kind: 'shape', frame, shape: one(o.shape, SHAPES, 'rect'), colour, x: num(o.x, 0.5, -2, 3), y: num(o.y, 0.5, -2, 3), w: num(o.w, 0.3, 0.005, 20), h: num(o.h, 0.3, 0.005, 20), rot: num(o.rot, 0, -360, 360) };
    case 'path': {
      const d: PathCmd[] = [];
      if (Array.isArray(o.d))
        for (const c of o.d.slice(0, 200)) {
          if (!Array.isArray(c)) continue;
          const n = c.slice(1).map((v) => num(v, 0, -5, 5));
          if (c[0] === 'M' && n.length === 2) d.push(['M', n[0], n[1]]);
          else if (c[0] === 'L' && n.length === 2) d.push(['L', n[0], n[1]]);
          else if (c[0] === 'C' && n.length === 6) d.push(['C', n[0], n[1], n[2], n[3], n[4], n[5]]);
        }
      return d.length ? { ...b, kind: 'path', frame, colour, d, dx: num(o.dx, 0, -3, 3), dy: num(o.dy, 0, -3, 3) } : null;
    }
    case 'text':
      return {
        ...b,
        kind: 'text',
        frame,
        text: str(o.text, '', 40),
        font: one(o.font, FONTS, 'sans'),
        colour,
        x: num(o.x, 0.2, -2, 3),
        y: num(o.y, 0.25, -2, 3),
        size: num(o.size, 0.16, 0.01, 5),
        rot: num(o.rot, 0, -360, 360),
        auto: o.auto === 'titles' || o.auto === 'registration' ? o.auto : undefined,
        airlineName: o.airlineName === true || undefined,
        registration: o.registration === true || undefined,
      };
    case 'paint': {
      const strokes: Stroke[] = [];
      if (Array.isArray(o.strokes))
        for (const s of o.strokes.slice(0, MAX_STROKES)) {
          if (!s || typeof s !== 'object') continue;
          const so = s as Record<string, unknown>;
          const pts = Array.isArray(so.pts) ? so.pts.slice(0, 4000).map((v) => num(v, 0, -3, 4)) : [];
          if (pts.length >= 2) strokes.push({ colour: hex(so.colour, '#000000'), width: num(so.width, 0.05, 0.002, 3), pts: pts.length % 2 ? pts.slice(0, -1) : pts, erase: so.erase === true || undefined });
        }
      return { ...b, kind: 'paint', frame, strokes };
    }
    case 'logo':
      return typeof o.logo === 'string' ? { ...b, kind: 'logo', frame, logo: o.logo.slice(0, 40), x: num(o.x, 0.5, -2, 3), y: num(o.y, 0.5, -2, 3), size: num(o.size, 0.4, 0.01, 5), rot: num(o.rot, 0, -360, 360) } : null;
  }
  return null;
}

/** The v1 livery (v2.64-2.65: colours and a few choices) as layers. */
function fromV1(o: Record<string, unknown>): Livery {
  const body = hex(o.body, '#ffffff'), belly = hex(o.belly, '#ffffff'), tail = hex(o.tail, '#1d4e89'), tail2 = hex(o.tail2, '#f5a623');
  const engines = hex(o.engines, '#ffffff'), c1 = hex(o.cheat1, '#1d4e89'), c2 = hex(o.cheat2, '#f5a623');
  const bellyTo = num(o.bellyTo, 0, 0, 0.7);
  const L: Layer[] = [fillLayer('Fuselage', 'all', body)];
  if (bellyTo > 0) L.push(bandLayer('Belly', belly, 1 - bellyTo, 3));
  switch (o.cheat) {
    case 'stripe':
      L.push(bandLayer('Cheatline', c1, 0.55, 0.63), bandLayer('Pinstripe', c2, 0.655, 0.685));
      break;
    case 'double':
      L.push(bandLayer('Stripe 1', c1, 0.52, 0.58), bandLayer('Stripe 2', c2, 0.62, 0.68));
      break;
    case 'swoosh':
      L.push(pathLayer('Swoosh edge', 'body', c2, swoosh(0, 0)), pathLayer('Swoosh', 'body', c1, swoosh(0.04, 0.07)));
      break;
    case 'tailsweep':
      L.push(pathLayer('Sweep edge', 'body', c2, sweep(0)), pathLayer('Sweep', 'body', c1, sweep(0.025)));
      break;
  }
  L.push(fillLayer('Tail', 'tail', tail));
  switch (o.tailArt) {
    case 'split':
      L.push(pathLayer('Tail split', 'fin', tail2, finSplit()));
      break;
    case 'band':
      L.push(pathLayer('Tail band', 'fin', tail2, finBand()));
      break;
    case 'disc':
      L.push(shapeLayer('Tail disc', 'fin', 'ellipse', tail2, 0.52, 0.46, 0.44));
      break;
    case 'stripes':
      [0.14, 0.4, 0.66].forEach((r, i) => L.push(pathLayer(`Tail stripe ${i + 1}`, 'fin', tail2, finStripe(r))));
      break;
    case 'letter':
      L.push(tailLetter(tail2));
      break;
  }
  if (engines !== '#ffffff') L.push(fillLayer('Engines', 'engines', engines));
  if (o.titles !== false) L.push(titlesLayer(hex(o.titleColour, '#1d4e89'), one(o.titleFont, FONTS, 'sans')));
  return { v: 2, layers: L, logos: {} };
}

/** A livery from saved data, with anything missing or wrong dropped. */
export function normaliseLivery(x: unknown): Livery | undefined {
  if (!x || typeof x !== 'object') return undefined;
  const o = x as Record<string, unknown>;
  if (o.v === 1) return fromV1(o);
  if (o.v !== 2 || !Array.isArray(o.layers)) return undefined;
  const layers = o.layers.slice(0, MAX_LAYERS).map(layerFrom).filter((l): l is Layer => Boolean(l));
  const logos: Record<string, string> = {};
  if (o.logos && typeof o.logos === 'object')
    for (const [k, v] of Object.entries(o.logos as Record<string, unknown>).slice(0, MAX_LOGOS))
      if (typeof v === 'string' && /^data:image\/(webp|png);base64,[A-Za-z0-9+/=]+$/.test(v) && v.length <= MAX_LOGO_CHARS) logos[k.slice(0, 40)] = v;
  // ids are unique
  const seen = new Set<string>();
  for (const l of layers) {
    if (seen.has(l.id)) l.id = newId();
    seen.add(l.id);
  }
  const badge = typeof o.badge === 'string' && logos[o.badge] ? o.badge : undefined;
  return { v: 2, name: typeof o.name === 'string' ? o.name.slice(0, 30) : undefined, layers, logos, badge };
}

/** The airline's liveries from saved data: the v2.66 list, or the single livery of earlier versions. */
export function normaliseLiveries(list: unknown, single?: unknown): Livery[] {
  const raw = Array.isArray(list) ? list : single ? [single] : [];
  return raw.slice(0, MAX_LIVERIES).map(normaliseLivery).filter((l): l is Livery => Boolean(l));
}

/** The airline's logo: the one picked in the main livery, else in the second (a data URL). */
export function airlineBadge(liveries: Livery[]): string | undefined {
  for (const l of liveries) if (l.badge && l.logos[l.badge]) return l.logos[l.badge];
  return undefined;
}

/** A logo picture from saved data (a small WebP or PNG data URL), or undefined. */
export const normaliseLogo = (v: unknown): string | undefined =>
  typeof v === 'string' && /^data:image\/(webp|png);base64,[A-Za-z0-9+/=]+$/.test(v) && v.length <= MAX_LOGO_CHARS ? v : undefined;

/** A short key for caching painted pictures. */
export function liveryKey(l: Livery, name: string, reg = ''): string {
  const s = JSON.stringify(l.layers) + '|' + Object.keys(l.logos).join(',') + '|' + name + '|' + reg;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return `${(h >>> 0).toString(36)}-${s.length}`;
}

/** The text a text layer shows (the airline's name for titles, the aircraft's registration). */
export const layerText = (l: Extract<Layer, { kind: 'text' }>, airlineName: string, reg = '') =>
  l.registration ? reg : l.airlineName ? (l.frame === 'fin' ? airlineName.trim().charAt(0).toUpperCase() : airlineName.trim()) : l.text;



// ----------------------------------------------------------------------------
// The airline's colours (v2.67)
// ----------------------------------------------------------------------------
export interface AirlineColours {
  /** Main and second colour: used by the ready-made liveries and logos. */
  a: string;
  b: string;
  /** Use them for the game's own look while playing this airline. */
  theme?: boolean;
}

export const DEFAULT_AIRLINE_COLOURS: AirlineColours = { a: '#1d4e89', b: '#f5a623' };

export function normaliseAirlineColours(x: unknown): AirlineColours | undefined {
  if (!x || typeof x !== 'object') return undefined;
  const o = x as Record<string, unknown>;
  return { a: hex(o.a, DEFAULT_AIRLINE_COLOURS.a), b: hex(o.b, DEFAULT_AIRLINE_COLOURS.b), theme: o.theme === true || undefined };
}
