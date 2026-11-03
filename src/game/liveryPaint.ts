// ============================================================================
// LIVERY PAINTING (v2.66: layers)
//   Paints a layered livery (livery.ts) onto an aircraft picture. Each picture
//   has a mask (public/aircraft/<id>.mask.png: red = tail, green = fuselage,
//   blue = engines, only where they can be seen).
//
//   The aircraft is measured once (aircraftGeometry): a straight crown line
//   and the cabin height along the fuselage, and the fin's leading and
//   trailing edges as straight lines. Those give the two frames layers are
//   placed in (body and fin), so one design fits every type. Each layer is
//   drawn as smooth anti-aliased shapes, cut to its region's mask and laid
//   over white; the paint is then multiplied into the white picture so the
//   template's shading, panel lines and windows show through. Painted
//   pictures are cached as object URLs.
// ============================================================================
import { FONT_CSS, layerText, liveryKey, type Frame, type Layer, type Livery, type PathCmd, type Region } from './livery';

/**
 * Painted pictures, by aircraft, livery, registration and size. A picture
 * still on screen is never thrown away (taking back its address while an
 * <img> shows it makes the picture vanish, which Safari does at once), so
 * pictures are counted while shown and only unused ones are dropped. Paints
 * run two at a time: hundreds at once, after a reload with a big fleet, ran
 * the browser out of canvas memory and came out blank.
 */
interface Entry {
  p: Promise<string | null>;
  refs: number;
}
const cache = new Map<string, Entry>();
const KEEP = 300;

const queue: (() => Promise<void>)[] = [];
let running = 0;
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    queue.push(() => job().then(resolve, reject));
    pump();
  });
}
function pump() {
  while (running < 2 && queue.length) {
    const job = queue.shift()!;
    running++;
    job().finally(() => {
      running--;
      pump();
    });
  }
}

/** Sizes painted: a thumbnail doesn't need the full 1280 pixels. */
const sizeFor = (cssWidth: number) => (cssWidth <= 120 ? 320 : cssWidth <= 300 ? 640 : 1280);

const keyOf = (id: string, livery: Livery, airlineName: string, reg: string, px: number) => `${id}|${px}|${liveryKey(livery, airlineName, reg)}`;

/** The painted picture for an aircraft (an object URL), or null if it has no mask. `cssWidth`: how wide it's shown. */
export function paintedPhoto(id: string, livery: Livery, airlineName: string, reg = '', cssWidth = 1280): Promise<string | null> {
  const px = sizeFor(cssWidth * (typeof window !== 'undefined' ? Math.min(2, window.devicePixelRatio || 1) : 1));
  const key = keyOf(id, livery, airlineName, reg, px);
  let e = cache.get(key);
  if (!e) {
    e = { p: enqueue(() => paint(id, livery, airlineName, reg, px)).catch(() => null), refs: 0 };
    cache.set(key, e);
    trim();
  }
  return e.p;
}

/** Keep a picture while it's on screen (call the returned function when it's gone). */
export function holdPhoto(id: string, livery: Livery, airlineName: string, reg = '', cssWidth = 1280): () => void {
  const px = sizeFor(cssWidth * (typeof window !== 'undefined' ? Math.min(2, window.devicePixelRatio || 1) : 1));
  const key = keyOf(id, livery, airlineName, reg, px);
  const e = cache.get(key);
  if (!e) return () => {};
  e.refs++;
  return () => {
    e.refs = Math.max(0, e.refs - 1);
    trim();
  };
}

function trim() {
  if (cache.size <= KEEP) return;
  for (const [k, e] of cache) {
    if (cache.size <= KEEP) break;
    if (e.refs > 0) continue;
    cache.delete(k);
    e.p.then((u) => u && URL.revokeObjectURL(u));
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.decoding = 'async';
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error(`could not load ${src}`));
    im.src = src;
  });
}

/**
 * Browsers cap the memory all canvases may use (Safari tightly): past it a
 * canvas silently draws nothing. So the painter keeps few canvases: two
 * reused for drawing, masks made only when a layer needs them, a short cache
 * of measured aircraft, and every other canvas emptied as soon as it's done.
 */
export const freeCanvas = (c: HTMLCanvasElement | null | undefined) => {
  if (c) c.width = c.height = 0;
};
const scratch: [HTMLCanvasElement, CanvasRenderingContext2D][] = [];
function reused(i: number, w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  if (!scratch[i]) scratch[i] = canvas(w, h);
  const [c, g] = scratch[i];
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  } else g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  return [c, g];
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d', { willReadFrequently: true })!];
}

/** Least-squares line y = a + b·x through points, refitted without outliers. */
function fitLine(xs: number[], ys: number[], tol: number): { a: number; b: number } {
  let use = xs.map((_, i) => i);
  let a = 0, b = 0;
  for (let pass = 0; pass < 3; pass++) {
    if (use.length < 2) break;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (const i of use) {
      sx += xs[i];
      sy += ys[i];
      sxx += xs[i] * xs[i];
      sxy += xs[i] * ys[i];
    }
    const k = use.length;
    const d = k * sxx - sx * sx;
    b = d ? (k * sxy - sx * sy) / d : 0;
    a = (sy - b * sx) / k;
    const next = use.filter((i) => Math.abs(ys[i] - (a + b * xs[i])) <= tol);
    if (next.length === use.length || next.length < 2) break;
    use = next;
  }
  return { a, b };
}

/** The fuselage frame: u runs 0 (nose) to 1 (tail), v 0 (crown) to 1 (belly) of the cabin. */
interface Body {
  nose: number;
  len: number;
  /** Crown line: y = c0 + slope·x. */
  c0: number;
  slope: number;
  /** Cabin height, crown to belly. */
  hc: number;
  /** The fuselage's top edge in each column (-1 where none). */
  top: Int32Array;
}

function measureBody(M: Uint8ClampedArray, w: number, h: number): Body | null {
  const top = new Int32Array(w).fill(-1);
  const bot = new Int32Array(w).fill(-1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++)
      if (M[(y * w + x) * 4 + 1] > 128) {
        top[x] = y;
        break;
      }
    for (let y = h - 1; y >= 0; y--)
      if (M[(y * w + x) * 4 + 1] > 128) {
        bot[x] = y;
        break;
      }
  }
  let nose = 0;
  while (nose < w && top[nose] < 0) nose++;
  let tail = w - 1;
  while (tail > 0 && top[tail] < 0) tail--;
  if (tail - nose < 20) return null;
  // the cabin's height is the most common column height (wings, engines and
  // gear fairings only change a few columns)
  const counts = new Map<number, number>();
  for (let x = nose; x <= tail; x++) if (top[x] >= 0) counts.set(bot[x] - top[x], (counts.get(bot[x] - top[x]) ?? 0) + 1);
  const hmax = Math.max(...counts.keys());
  let best = 0, hc = 0;
  for (const [hh] of counts) {
    if (hh < hmax * 0.45) continue;
    let c = 0;
    for (let k = -2; k <= 2; k++) c += counts.get(hh + Math.round((k * hh) / 100)) ?? 0;
    if (c > best) {
      best = c;
      hc = hh;
    }
  }
  if (!hc) return null;
  // the crown line, fitted where the column is the full cabin height
  const xs: number[] = [], ys: number[] = [];
  for (let x = nose; x <= tail; x++) {
    const hh = bot[x] - top[x];
    if (top[x] >= 0 && Math.abs(hh - hc) <= Math.max(2, hc * 0.03)) {
      xs.push(x);
      ys.push(top[x]);
    }
  }
  if (xs.length < 4) return null;
  const { a, b } = fitLine(xs, ys, Math.max(1.5, hc * 0.02));
  return { nose, len: tail - nose, c0: a, slope: b, hc: hc + 1, top };
}

/** How far below a straight crown line (y = crown + slope·(x - x0)) the top row of cabin windows starts between x0 and x1, found from the dark spots there. */
function windowRow(B: Uint8ClampedArray, M: Uint8ClampedArray, w: number, body: Body, x0: number, x1: number, crown: number): [number, number] {
  const n = Math.ceil(body.hc * 1.2);
  const dark = new Float32Array(n), all = new Float32Array(n);
  for (let x = x0; x <= x1; x++) {
    const t = Math.round(crown + body.slope * (x - x0));
    for (let d = 0; d < n; d++) {
      const i = ((t + d) * w + x) * 4;
      if (i < 0 || i >= M.length || M[i + 1] < 160) continue;
      all[d]++;
      if (0.3 * B[i] + 0.59 * B[i + 1] + 0.11 * B[i + 2] < 120) dark[d]++;
    }
  }
  const on = (d: number) => all[d] > 10 && dark[d] / all[d] > 0.14;
  for (let d = Math.round(body.hc * 0.1); d < n * 0.7; d++)
    if (on(d)) {
      let e = d;
      while (e + 1 < n && on(e + 1)) e++;
      return [d, e + 1];
    }
  return [body.hc * 0.33, body.hc * 0.42];
}

/** The fin: leading and trailing edges as lines x = e0 + e1·y, from the root up to the tip. */
interface Fin {
  root: number;
  tip: number;
  le: { a: number; b: number };
  te: { a: number; b: number };
}

function measureFin(M: Uint8ClampedArray, w: number, h: number): Fin | null {
  const left: number[] = [], right: number[] = [], rows: number[] = [];
  for (let y = 0; y < h; y++) {
    let l = -1, r = -1;
    for (let x = 0; x < w; x++)
      if (M[(y * w + x) * 4] > 128) {
        if (l < 0) l = x;
        r = x;
      }
    if (l >= 0) {
      rows.push(y);
      left.push(l);
      right.push(r);
    }
  }
  if (rows.length < 8) return null;
  const tip = rows[0];
  const root = rows[rows.length - 1];
  const fh = root - tip;
  // fit the edges on the middle of the fin, away from the tailplane and the tip
  const ys: number[] = [], ls: number[] = [], rs: number[] = [];
  rows.forEach((y, i) => {
    const s = (root - y) / fh;
    if (s > 0.25 && s < 0.88) {
      ys.push(y);
      ls.push(left[i]);
      rs.push(right[i]);
    }
  });
  if (ys.length < 4) return null;
  const tol = Math.max(2, fh * 0.03);
  return { root, tip, le: fitLine(ys, ls, tol), te: fitLine(ys, rs, tol) };
}

/** A mask channel (0 red, 1 green, 2 blue) as an alpha-only canvas for cutting. */
function channel(M: Uint8ClampedArray, w: number, h: number, k: number): HTMLCanvasElement {
  const [c, g] = canvas(w, h);
  const d = new ImageData(w, h);
  for (let i = 0; i < M.length; i += 4) {
    d.data[i] = d.data[i + 1] = d.data[i + 2] = 255;
    d.data[i + 3] = M[i + k];
  }
  g.putImageData(d, 0, 0);
  return c;
}

// ----------------------------------------------------------------------------
// The aircraft, measured once
// ----------------------------------------------------------------------------
export interface Geometry {
  id: string;
  w: number;
  h: number;
  base: HTMLImageElement;
  /** Base and mask pixels (M: tail, fuselage, engines; M2: wings, wingtips, tailplanes). */
  B: Uint8ClampedArray;
  M: Uint8ClampedArray;
  M2: Uint8ClampedArray;
  /** The parts this aircraft has (no wingtips on some types). */
  parts: Region[];
  body: Body;
  fin: Fin;
  /** A part's mask as a canvas, made the first time a layer needs it. */
  mask: (r: Region) => HTMLCanvasElement;
  made: Partial<Record<Region, HTMLCanvasElement>>;
}

const geoCache = new Map<string, Promise<Geometry | null>>();

export function aircraftGeometry(id: string): Promise<Geometry | null> {
  let p = geoCache.get(id);
  if (!p) {
    p = measure(id).catch(() => null);
    geoCache.set(id, p);
    if (geoCache.size > 4) {
      const first = geoCache.keys().next().value as string;
      // its masks are emptied, and made again if the editor still shows it
      geoCache.get(first)?.then((g) => {
        if (!g) return;
        for (const k of Object.keys(g.made) as Region[]) {
          freeCanvas(g.made[k]);
          delete g.made[k];
        }
      });
      geoCache.delete(first);
    }
  }
  return p;
}

async function measure(id: string): Promise<Geometry | null> {
  const [base, maskImg] = await Promise.all([loadImage(`/aircraft/${id}.webp`), loadImage(`/aircraft/${id}.mask.png`)]);
  const w = base.naturalWidth;
  const h = base.naturalHeight;
  const [bc, bg] = canvas(w, h);
  bg.drawImage(base, 0, 0, w, h);
  const B = bg.getImageData(0, 0, w, h).data;
  freeCanvas(bc);
  // since v2.66 the mask is twice the picture's height: the top half tail, fuselage, engines; the bottom half wings, wingtips, tailplanes
  const atlas = maskImg.naturalHeight >= base.naturalHeight * 1.9;
  const [mc, mg] = canvas(w, atlas ? h * 2 : h);
  mg.drawImage(maskImg, 0, 0, w, atlas ? h * 2 : h);
  const M = mg.getImageData(0, 0, w, h).data;
  const M2 = atlas ? mg.getImageData(0, h, w, h).data : new Uint8ClampedArray(M.length);
  freeCanvas(mc);
  const body = measureBody(M, w, h);
  if (!body) return null;
  // no fin found (very rare): a box over the rear fuselage
  const fin = measureFin(M, w, h) ?? fakeFin(body);
  // the whole paintable aircraft: the strongest of the three channels
  const all = new Uint8ClampedArray(M.length);
  const seen = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < M.length; i += 4) {
    all[i] = all[i + 1] = all[i + 2] = Math.max(M[i], M[i + 1], M[i + 2], M2[i], M2[i + 1], M2[i + 2]);
    for (let k = 0; k < 3; k++) {
      if (M[i + k] > 128) seen[k]++;
      if (M2[i + k] > 128) seen[k + 3]++;
    }
  }
  const src: Record<Region, [Uint8ClampedArray, number]> = { tail: [M, 0], fuselage: [M, 1], engines: [M, 2], wings: [M2, 0], winglets: [M2, 1], stabiliser: [M2, 2], all: [all, 0] };
  const made: Partial<Record<Region, HTMLCanvasElement>> = {};
  const mask = (r: Region) => (made[r] ??= channel(src[r][0], w, h, src[r][1]));
  const order: Region[] = ['tail', 'fuselage', 'engines', 'wings', 'winglets', 'stabiliser'];
  const parts = order.filter((_, k) => seen[k] > 20);
  return { id, w, h, base, B, M, M2, parts, body, fin, mask, made };
}

function fakeFin(b: Body): Fin {
  const x = b.nose + b.len * 0.9;
  const root = Math.round(b.c0 + b.slope * x);
  return { root, tip: Math.round(root - b.hc * 1.3), le: { a: b.nose + b.len * 0.82, b: 0 }, te: { a: b.nose + b.len, b: 0 } };
}

// ----------------------------------------------------------------------------
// Frames: aircraft coordinates ⇄ picture pixels
// ----------------------------------------------------------------------------
export function toPx(g: Geometry, frame: Frame, x: number, y: number): [number, number] {
  if (frame === 'body') {
    const X = g.body.nose + x * g.body.len;
    return [X, g.body.c0 + g.body.slope * X + y * g.body.hc];
  }
  const f = g.fin;
  const Y = f.root - y * (f.root - f.tip);
  const le = f.le.a + f.le.b * Y;
  const te = f.te.a + f.te.b * Y;
  return [le + x * (te - le), Y];
}

export function fromPx(g: Geometry, frame: Frame, px: number, py: number): [number, number] {
  if (frame === 'body') return [(px - g.body.nose) / g.body.len, (py - g.body.c0 - g.body.slope * px) / g.body.hc];
  const f = g.fin;
  const le = f.le.a + f.le.b * py;
  const te = f.te.a + f.te.b * py;
  return [(px - le) / Math.max(1, te - le), (f.root - py) / Math.max(1, f.root - f.tip)];
}

/** Pixels in one size unit: a cabin height (body) or a fin height (fin). */
export const unitPx = (g: Geometry, frame: Frame) => (frame === 'body' ? g.body.hc : g.fin.root - g.fin.tip);
/** The frame's angle: along the crown line for the body, upright for the fin. */
export const frameAngle = (g: Geometry, frame: Frame) => (frame === 'body' ? Math.atan(g.body.slope) : 0);

// ----------------------------------------------------------------------------
// Drawing the layers
// ----------------------------------------------------------------------------
const logoImages = new Map<string, Promise<HTMLImageElement | null>>();
/** The livery's logos as images, ready to draw. */
export async function loadLogos(l: Livery): Promise<Map<string, HTMLImageElement>> {
  const out = new Map<string, HTMLImageElement>();
  await Promise.all(
    Object.entries(l.logos).map(async ([k, src]) => {
      let p = logoImages.get(src);
      if (!p) {
        p = loadImage(src).catch(() => null);
        logoImages.set(src, p);
        if (logoImages.size > 30) logoImages.delete(logoImages.keys().next().value as string);
      }
      const im = await p;
      if (im) out.set(k, im);
    })
  );
  return out;
}

const fontOf = (l: Extract<Layer, { kind: 'text' }>, px: number) => {
  const f = FONT_CSS[l.font];
  return `${f.style === 'italic' ? 'italic ' : ''}${f.weight} ${Math.max(1, px)}px ${f.family}`;
};

function shapePath(c: CanvasRenderingContext2D, shape: Extract<Layer, { kind: 'shape' }>['shape'], w: number, h: number) {
  c.beginPath();
  if (shape === 'rect') c.rect(-w / 2, -h / 2, w, h);
  else if (shape === 'ellipse') c.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
  else if (shape === 'triangle') {
    c.moveTo(-w / 2, h / 2);
    c.lineTo(0, -h / 2);
    c.lineTo(w / 2, h / 2);
  } else if (shape === 'star') {
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const r = i % 2 ? 0.4 : 1;
      const x = (Math.cos(a) * r * w) / 2;
      const y = (Math.sin(a) * r * h) / 2;
      if (i) c.lineTo(x, y);
      else c.moveTo(x, y);
    }
  } else {
    // chevron pointing forward (to the nose)
    c.moveTo(w / 2, -h / 2);
    c.lineTo(0, -h / 2);
    c.lineTo(-w / 2, 0);
    c.lineTo(0, h / 2);
    c.lineTo(w / 2, h / 2);
    c.lineTo(0, 0);
  }
  c.closePath();
}

/** A path's points in pixels (curves sampled), for the fin frame and for outlines. */
function pathPoints(g: Geometry, frame: Frame, d: PathCmd[], dx: number, dy: number): [number, number][] {
  const out: [number, number][] = [];
  let cx = 0, cy = 0;
  for (const c of d) {
    if (c[0] === 'C') {
      for (let k = 1; k <= 16; k++) {
        const t = k / 16, u = 1 - t;
        const x = u * u * u * cx + 3 * u * u * t * c[1] + 3 * u * t * t * c[3] + t * t * t * c[5];
        const y = u * u * u * cy + 3 * u * u * t * c[2] + 3 * u * t * t * c[4] + t * t * t * c[6];
        out.push(toPx(g, frame, x + dx, y + dy));
      }
      cx = c[5];
      cy = c[6];
    } else {
      out.push(toPx(g, frame, c[1] + dx, c[2] + dy));
      cx = c[1];
      cy = c[2];
    }
  }
  return out;
}

/** Where titles go on this aircraft: just above the top row of windows on the forward cabin (or below it if there's no room). */
function titlesPlace(g: Geometry, l: Extract<Layer, { kind: 'text' }>, text: string, c: CanvasRenderingContext2D): { x: number; y: number; size: number } {
  const { body } = g;
  const x0 = Math.round(body.nose + body.len * l.x);
  const room = body.len * 0.3;
  const x1 = Math.min(g.w - 1, Math.round(x0 + room * 0.6));
  let crown = Infinity;
  for (let x = x0; x <= x1; x++) if (body.top[x] >= 0) crown = Math.min(crown, body.top[x] - body.slope * (x - x0));
  if (!Number.isFinite(crown)) crown = body.c0 + body.slope * x0;
  const [win, winEnd] = windowRow(g.B, g.M, g.w, body, x0, x1, crown);
  const gap = body.hc * 0.05;
  // the size the player picked (in cabin heights), if it fits above the windows
  let size = Math.min(body.hc * l.size, (win - gap - body.hc * 0.05) / 0.74);
  let baseline = win - gap;
  if (size < body.hc * 0.12) {
    size = body.hc * Math.min(l.size, 0.15);
    baseline = winEnd + gap + size * 0.74;
  }
  c.font = fontOf(l, size);
  const tw = c.measureText(text).width;
  if (tw > room) size *= room / tw;
  return { x: x0, y: crown + baseline, size };
}

/** Where a registration goes: on the rear fuselage, just ahead of the fin. */
function registrationPlace(g: Geometry, l: Extract<Layer, { kind: 'text' }>, text: string, c: CanvasRenderingContext2D): { x: number; y: number; size: number } {
  const { body, fin } = g;
  const size = body.hc * l.size;
  c.font = fontOf(l, size);
  const tw = c.measureText(text).width;
  const finRoot = fin.le.a + fin.le.b * fin.root;
  const x = Math.max(body.nose + body.len * 0.6, finRoot - body.hc * 0.25 - tw);
  return { x, y: body.c0 + body.slope * x + body.hc * 0.32, size };
}

function autoPlace(g: Geometry, l: Extract<Layer, { kind: 'text' }>, text: string, c: CanvasRenderingContext2D) {
  return l.auto === 'registration' ? registrationPlace(g, l, text, c) : titlesPlace(g, l, text, c);
}

function drawLayer(c: CanvasRenderingContext2D, g: Geometry, l: Layer, name: string, logos: Map<string, HTMLImageElement>, reg: string) {
  c.save();
  switch (l.kind) {
    case 'fill':
      c.fillStyle = l.colour;
      c.fillRect(0, 0, g.w, g.h);
      break;
    case 'band': {
      const b = g.body;
      c.setTransform(b.len, b.slope * b.len, 0, b.hc, b.nose, b.c0 + b.slope * b.nose);
      c.fillStyle = l.colour;
      c.fillRect(-0.3, Math.min(l.v0, l.v1), 1.6, Math.abs(l.v1 - l.v0));
      break;
    }
    case 'shape': {
      const [x, y] = toPx(g, l.frame, l.x, l.y);
      const u = unitPx(g, l.frame);
      c.translate(x, y);
      c.rotate(frameAngle(g, l.frame) + (l.rot * Math.PI) / 180);
      shapePath(c, l.shape, l.w * u, l.h * u);
      c.fillStyle = l.colour;
      c.fill();
      break;
    }
    case 'path': {
      c.fillStyle = l.colour;
      if (l.frame === 'body') {
        // the body frame is a straight-line transform, so curves stay exact
        const b = g.body;
        c.setTransform(b.len, b.slope * b.len, 0, b.hc, b.nose, b.c0 + b.slope * b.nose);
        c.translate(l.dx, l.dy);
        c.beginPath();
        for (const p of l.d) {
          if (p[0] === 'M') c.moveTo(p[1], p[2]);
          else if (p[0] === 'L') c.lineTo(p[1], p[2]);
          else c.bezierCurveTo(p[1], p[2], p[3], p[4], p[5], p[6]);
        }
      } else {
        c.beginPath();
        pathPoints(g, l.frame, l.d, l.dx, l.dy).forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
      }
      c.closePath();
      c.fill();
      break;
    }
    case 'text': {
      const text = layerText(l, name, reg);
      if (!text) break;
      c.fillStyle = l.colour;
      if (l.frame === 'body' && l.auto) {
        const t = autoPlace(g, l, text, c);
        c.translate(t.x, t.y);
        c.rotate(frameAngle(g, 'body'));
        c.font = fontOf(l, t.size);
        c.textBaseline = 'alphabetic';
        c.fillText(text, 0, 0);
        break;
      }
      const [x, y] = toPx(g, l.frame, l.x, l.y);
      c.translate(x, y);
      c.rotate(frameAngle(g, l.frame) + (l.rot * Math.PI) / 180);
      c.font = fontOf(l, l.size * unitPx(g, l.frame));
      c.textAlign = 'center';
      c.textBaseline = 'alphabetic';
      // centred on its own outline
      const m = c.measureText(text);
      c.fillText(text, 0, (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2);
      break;
    }
    case 'paint': {
      const u = unitPx(g, l.frame);
      c.lineCap = 'round';
      c.lineJoin = 'round';
      for (const s of l.strokes) {
        c.globalCompositeOperation = s.erase ? 'destination-out' : 'source-over';
        c.strokeStyle = s.erase ? '#000' : s.colour;
        c.fillStyle = c.strokeStyle;
        c.lineWidth = Math.max(0.5, s.width * u);
        if (s.pts.length === 2) {
          const [x, y] = toPx(g, l.frame, s.pts[0], s.pts[1]);
          c.beginPath();
          c.arc(x, y, c.lineWidth / 2, 0, Math.PI * 2);
          c.fill();
          continue;
        }
        c.beginPath();
        for (let i = 0; i < s.pts.length; i += 2) {
          const [x, y] = toPx(g, l.frame, s.pts[i], s.pts[i + 1]);
          if (i) c.lineTo(x, y);
          else c.moveTo(x, y);
        }
        c.stroke();
      }
      break;
    }
    case 'logo': {
      const im = logos.get(l.logo);
      if (!im) break;
      const [x, y] = toPx(g, l.frame, l.x, l.y);
      const s = l.size * unitPx(g, l.frame);
      c.translate(x, y);
      c.rotate(frameAngle(g, l.frame) + (l.rot * Math.PI) / 180);
      c.imageSmoothingQuality = 'high';
      c.drawImage(im, -s / 2, -s / 2, s, s);
      break;
    }
  }
  c.restore();
}

/** The livery drawn on the aircraft, into `out` (the picture's size). */
export function renderLivery(g: Geometry, livery: Livery, name: string, logos: Map<string, HTMLImageElement>, out: CanvasRenderingContext2D, reg = '') {
  const { w, h } = g;
  const [, pg] = reused(0, w, h);
  pg.fillStyle = '#ffffff';
  pg.fillRect(0, 0, w, h);
  const [sc, sg] = reused(1, w, h);
  for (const l of livery.layers) {
    if (l.hidden || l.opacity <= 0) continue;
    sg.globalCompositeOperation = 'source-over';
    sg.clearRect(0, 0, w, h);
    drawLayer(sg, g, l, name, logos, reg);
    sg.globalCompositeOperation = 'destination-in';
    sg.drawImage(g.mask(l.region), 0, 0);
    pg.globalAlpha = l.opacity;
    pg.drawImage(sc, 0, 0);
    pg.globalAlpha = 1;
  }
  // the paint multiplied into the picture
  const P = pg.getImageData(0, 0, w, h).data;
  const pic = new ImageData(new Uint8ClampedArray(g.B), w, h);
  const O = pic.data;
  for (let i = 0; i < O.length; i += 4) {
    if (!O[i + 3]) continue;
    O[i] = (O[i] * P[i]) / 255;
    O[i + 1] = (O[i + 1] * P[i + 1]) / 255;
    O[i + 2] = (O[i + 2] * P[i + 2]) / 255;
  }
  out.canvas.width = w;
  out.canvas.height = h;
  out.putImageData(pic, 0, 0);
}

async function paint(id: string, L: Livery, name: string, reg: string, px = 1280, retry = true): Promise<string | null> {
  const g = await aircraftGeometry(id);
  if (!g) return null;
  const logos = await loadLogos(L);
  const [fc, fg] = reused(2, g.w, g.h);
  renderLivery(g, L, name, logos, fg, reg);
  // drawn nothing (the browser short of canvas memory): try once more a moment later, else the plain picture
  const x = Math.round(g.body.nose + g.body.len * 0.5), y = Math.round(g.body.c0 + g.body.slope * x + g.body.hc * 0.5);
  if (fg.getImageData(x, y, 1, 1).data[3] === 0) {
    if (!retry) return null;
    await new Promise((r) => setTimeout(r, 600));
    return paint(id, L, name, reg, px, false);
  }
  const w = Math.min(g.w, px);
  const h = Math.round((g.h * w) / g.w);
  const [oc, og] = canvas(w, h);
  og.imageSmoothingQuality = 'high';
  og.drawImage(fc, 0, 0, w, h);
  const blob: Blob | null = await new Promise((r) => oc.toBlob(r, 'image/webp', 0.9));
  freeCanvas(oc);
  return blob ? URL.createObjectURL(blob) : null;
}

// ----------------------------------------------------------------------------
// Outlines, for the editor
// ----------------------------------------------------------------------------
const [, measureCtx] = typeof document !== 'undefined' ? canvas(4, 4) : [null, null as unknown as CanvasRenderingContext2D];

/** The layer's outline in picture pixels (a polygon), or null for a fill. */
export function layerOutline(g: Geometry, l: Layer, name: string, reg = ''): [number, number][] | null {
  const box = (cx: number, cy: number, w: number, h: number, ang: number, ox = 0, oy = 0): [number, number][] => {
    const cs = Math.cos(ang), sn = Math.sin(ang);
    return [
      [-w / 2 + ox, -h / 2 + oy],
      [w / 2 + ox, -h / 2 + oy],
      [w / 2 + ox, h / 2 + oy],
      [-w / 2 + ox, h / 2 + oy],
    ].map(([x, y]) => [cx + x * cs - y * sn, cy + x * sn + y * cs] as [number, number]);
  };
  const bbox = (pts: [number, number][]): [number, number][] | null => {
    if (!pts.length) return null;
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const x0 = Math.max(0, Math.min(...xs)), x1 = Math.min(g.w, Math.max(...xs)), y0 = Math.max(0, Math.min(...ys)), y1 = Math.min(g.h, Math.max(...ys));
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  };
  switch (l.kind) {
    case 'fill':
      return null;
    case 'band': {
      return [toPx(g, 'body', 0, l.v0), toPx(g, 'body', 1, l.v0), toPx(g, 'body', 1, Math.min(l.v1, 1.05)), toPx(g, 'body', 0, Math.min(l.v1, 1.05))].map(([x, y]) => [x, Math.max(0, Math.min(g.h, y))] as [number, number]);
    }
    case 'shape': {
      const [x, y] = toPx(g, l.frame, l.x, l.y);
      const u = unitPx(g, l.frame);
      return box(x, y, l.w * u, l.h * u, frameAngle(g, l.frame) + (l.rot * Math.PI) / 180);
    }
    case 'path':
      return bbox(pathPoints(g, l.frame, l.d, l.dx, l.dy));
    case 'paint': {
      const pts: [number, number][] = [];
      for (const s of l.strokes) if (!s.erase) for (let i = 0; i < s.pts.length; i += 2) pts.push(toPx(g, l.frame, s.pts[i], s.pts[i + 1]));
      return bbox(pts);
    }
    case 'logo': {
      const [x, y] = toPx(g, l.frame, l.x, l.y);
      const s = l.size * unitPx(g, l.frame);
      return box(x, y, s, s, frameAngle(g, l.frame) + (l.rot * Math.PI) / 180);
    }
    case 'text': {
      const text = layerText(l, name, reg) || ' ';
      if (l.frame === 'body' && l.auto) {
        const t = autoPlace(g, l, text, measureCtx);
        measureCtx.font = fontOf(l, t.size);
        const tw = measureCtx.measureText(text).width;
        return box(t.x + tw / 2, t.y - t.size * 0.36, tw, t.size * 0.9, frameAngle(g, 'body'));
      }
      const [x, y] = toPx(g, l.frame, l.x, l.y);
      const px = l.size * unitPx(g, l.frame);
      measureCtx.font = fontOf(l, px);
      const tw = measureCtx.measureText(text).width;
      return box(x, y, tw, px * 0.85, frameAngle(g, l.frame) + (l.rot * Math.PI) / 180);
    }
  }
}

/** Where an auto-placed title or registration sits on this aircraft, as a position in the body frame (when the player starts moving it). */
export function titlesPosition(g: Geometry, l: Extract<Layer, { kind: 'text' }>, name: string, reg = ''): { x: number; y: number; size: number } {
  const text = layerText(l, name, reg) || ' ';
  const t = autoPlace(g, l, text, measureCtx);
  measureCtx.font = fontOf(l, t.size);
  const m = measureCtx.measureText(text);
  // centre of the text (the editor places text by its middle)
  const cx = t.x + m.width / 2;
  const cy = t.y - (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
  const [x, y] = fromPx(g, 'body', cx, cy);
  return { x, y, size: t.size / g.body.hc };
}
