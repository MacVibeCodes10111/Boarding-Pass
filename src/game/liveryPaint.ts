// ============================================================================
// LIVERY PAINTING (v2.65)
//   Paints a livery onto an aircraft picture. Each picture has a mask
//   (public/aircraft/<id>.mask.png: red = tail, green = fuselage, blue =
//   engines, only where they can be seen).
//
//   The design is drawn as vector shapes, not pixel by pixel: the fuselage is
//   measured once (a straight crown line and its height along the cabin) and
//   the fin's leading and trailing edges are fitted as straight lines. The
//   belly, cheatlines, swoosh, tail sweep and tail designs are then smooth
//   anti-aliased paths in those frames, so lines run straight through the
//   wing root and the tail designs sit in the middle of the fin. Each part is
//   cut to its mask, and the paint is multiplied into the white picture so
//   the template's shading, panel lines and windows show through. Results
//   are cached as object URLs.
// ============================================================================
import type { Livery } from './livery';
import { liveryKey } from './livery';

const cache = new Map<string, Promise<string | null>>();
const MAX = 120;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.decoding = 'async';
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error(`could not load ${src}`));
    im.src = src;
  });
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d', { willReadFrequently: true })!];
}

/** The painted picture for an aircraft (an object URL), or null if it has no mask. */
export function paintedPhoto(id: string, livery: Livery, airlineName: string): Promise<string | null> {
  const key = `${id}|${liveryKey(livery, airlineName)}`;
  let p = cache.get(key);
  if (!p) {
    p = paint(id, livery, airlineName).catch(() => null);
    cache.set(key, p);
    if (cache.size > MAX) {
      const first = cache.keys().next().value as string;
      cache.get(first)?.then((u) => u && URL.revokeObjectURL(u));
      cache.delete(first);
    }
  }
  return p;
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

const FONT = { sans: 'Barlow, "Segoe UI", system-ui, sans-serif', serif: 'Georgia, "Times New Roman", serif', italic: 'Barlow, "Segoe UI", system-ui, sans-serif' };

async function paint(id: string, L: Livery, name: string): Promise<string | null> {
  const [base, mask] = await Promise.all([loadImage(`/aircraft/${id}.webp`), loadImage(`/aircraft/${id}.mask.png`)]);
  const w = base.naturalWidth;
  const h = base.naturalHeight;
  const [, mg] = canvas(w, h);
  mg.drawImage(mask, 0, 0, w, h);
  const M = mg.getImageData(0, 0, w, h).data;
  const [, bg] = canvas(w, h);
  bg.drawImage(base, 0, 0, w, h);
  const B = bg.getImageData(0, 0, w, h).data;
  const body = measureBody(M, w, h);
  if (!body) return null;
  const fin = measureFin(M, w, h);
  const title = name.trim();

  // --- the fuselage, drawn in its own frame (u along, v down the cabin)
  const [fc, fg] = canvas(w, h);
  fg.fillStyle = L.body;
  fg.fillRect(0, 0, w, h);
  fg.save();
  // x = nose + u·len, y = crown(x) + v·hc
  fg.setTransform(body.len, body.slope * body.len, 0, body.hc, body.nose, body.c0 + body.slope * body.nose);
  const U0 = -0.2, U1 = 1.2; // past the nose and the tail, the mask cuts it off
  const band = (v0: number, v1: number, colour: string) => {
    fg.fillStyle = colour;
    fg.fillRect(U0, v0, U1 - U0, v1 - v0);
  };
  if (L.bellyTo > 0) band(1 - L.bellyTo, 3, L.belly);
  if (L.cheat === 'stripe') {
    band(0.55, 0.63, L.cheat1);
    band(0.655, 0.685, L.cheat2);
  } else if (L.cheat === 'double') {
    band(0.52, 0.58, L.cheat1);
    band(0.62, 0.68, L.cheat2);
  } else if (L.cheat === 'swoosh') {
    // a band that starts thin under the cockpit and sweeps up and widens to the tail
    fg.beginPath();
    fg.moveTo(0.1, 1.05);
    fg.bezierCurveTo(0.45, 0.98, 0.72, 0.62, 1.15, -0.25);
    fg.lineTo(1.25, 1.6);
    fg.lineTo(0.1, 1.6);
    fg.closePath();
    fg.fillStyle = L.cheat2;
    fg.fill();
    fg.beginPath();
    fg.moveTo(0.14, 1.12);
    fg.bezierCurveTo(0.48, 1.0, 0.76, 0.7, 1.2, -0.12);
    fg.lineTo(1.25, 1.6);
    fg.lineTo(0.14, 1.6);
    fg.closePath();
    fg.fillStyle = L.cheat1;
    fg.fill();
  } else if (L.cheat === 'tailsweep') {
    // the rear fuselage in colour, behind a curve that rises from the belly to the crown
    const sweep = (du: number, colour: string) => {
      fg.beginPath();
      fg.moveTo(0.6 + du, 1.3);
      fg.bezierCurveTo(0.7 + du, 0.95, 0.74 + du, 0.35, 0.86 + du, -0.3);
      fg.lineTo(1.3, -0.3);
      fg.lineTo(1.3, 1.3);
      fg.closePath();
      fg.fillStyle = colour;
      fg.fill();
    };
    sweep(0, L.cheat2);
    sweep(0.025, L.cheat1);
  }
  fg.restore();
  if (L.titles && title) {
    // on the forward cabin, just above the (top) row of windows
    const x0 = Math.round(body.nose + body.len * 0.2);
    const room = body.len * 0.3;
    const x1 = Math.min(w - 1, Math.round(x0 + room * 0.6));
    let crown = Infinity;
    for (let x = x0; x <= x1; x++) if (body.top[x] >= 0) crown = Math.min(crown, body.top[x] - body.slope * (x - x0));
    if (!Number.isFinite(crown)) crown = body.c0 + body.slope * x0;
    const [win, winEnd] = windowRow(B, M, w, body, x0, x1, crown);
    const gap = body.hc * 0.05;
    let size = Math.min(body.hc * 0.17, (win - gap - body.hc * 0.05) / 0.74);
    // no room above the windows (an upper deck close to the top): below them instead
    let baseline = win - gap;
    if (size < body.hc * 0.12) {
      size = body.hc * 0.15;
      baseline = winEnd + gap + size * 0.74;
    }
    const style = `${L.titleFont === 'italic' ? 'italic ' : ''}700`;
    fg.font = `${style} ${size}px ${FONT[L.titleFont]}`;
    const tw = fg.measureText(title).width;
    if (tw > room) size *= room / tw;
    fg.save();
    fg.translate(x0, crown + baseline);
    fg.rotate(Math.atan(body.slope));
    fg.font = `${style} ${size}px ${FONT[L.titleFont]}`;
    fg.fillStyle = L.titleColour;
    fg.textBaseline = 'alphabetic';
    fg.fillText(title, 0, 0);
    fg.restore();
  }

  fg.globalCompositeOperation = 'destination-in';
  fg.drawImage(channel(M, w, h, 1), 0, 0);

  // --- the fin, drawn in its own frame (r leading to trailing edge, s root to tip)
  const [tc, tg] = canvas(w, h);
  tg.fillStyle = L.tail;
  tg.fillRect(0, 0, w, h);
  if (fin && L.tailArt !== 'solid') {
    const fh = fin.root - fin.tip;
    const at = (r: number, s: number): [number, number] => {
      const y = fin.root - s * fh;
      const le = fin.le.a + fin.le.b * y;
      const te = fin.te.a + fin.te.b * y;
      return [le + r * (te - le), y];
    };
    const chord = (s: number) => {
      const y = fin.root - s * fh;
      return fin.te.a + fin.te.b * y - (fin.le.a + fin.le.b * y);
    };
    /** A region of the fin as a polygon, from samples of its outline in (r, s). */
    const region = (pts: [number, number][], colour: string) => {
      tg.beginPath();
      pts.forEach(([r, s], i) => {
        const [x, y] = at(r, s);
        if (i) tg.lineTo(x, y);
        else tg.moveTo(x, y);
      });
      tg.closePath();
      tg.fillStyle = colour;
      tg.fill();
    };
    const curve = (n: number, f: (t: number) => [number, number]) => Array.from({ length: n + 1 }, (_, i) => f(i / n));
    if (L.tailArt === 'split') {
      // the upper forward part, below a gentle curve from low on the leading edge to high on the trailing edge
      const edge = curve(24, (t) => [-0.4 + t * 1.8, 0.22 + 0.6 * Math.pow(t, 1.4)]);
      region([...edge, [1.4, 1.4], [-0.4, 1.4]], L.tail2);
    } else if (L.tailArt === 'band') {
      region([[-0.5, 0.42], [1.5, 0.42], [1.5, 0.6], [-0.5, 0.6]], L.tail2);
    } else if (L.tailArt === 'stripes') {
      // three stripes along the leading edge
      for (const r0 of [0.14, 0.4, 0.66]) region([[r0, -0.2], [r0 + 0.13, -0.2], [r0 + 0.13, 1.3], [r0, 1.3]], L.tail2);
    } else if (L.tailArt === 'disc' || L.tailArt === 'letter') {
      const s = 0.46;
      const [cx, cy] = at(0.52, s);
      const room = Math.min(chord(s) * 0.36, fh * 0.26);
      if (L.tailArt === 'disc') {
        tg.beginPath();
        tg.arc(cx, cy, room, 0, Math.PI * 2);
        tg.fillStyle = L.tail2;
        tg.fill();
      } else if (title) {
        const size = room * 1.9;
        tg.save();
        tg.translate(cx, cy);
        tg.font = `800 ${size}px ${FONT[L.titleFont]}`;
        tg.fillStyle = L.tail2;
        tg.textAlign = 'center';
        tg.textBaseline = 'alphabetic';
        // centre the letter by its own outline, not the font's line box
        const ch = title[0].toUpperCase();
        const m = tg.measureText(ch);
        tg.fillText(ch, 0, (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2);
        tg.restore();
      }
    }
  }
  tg.globalCompositeOperation = 'destination-in';
  tg.drawImage(channel(M, w, h, 0), 0, 0);

  // --- engines
  const [ec, eg] = canvas(w, h);
  eg.fillStyle = L.engines;
  eg.fillRect(0, 0, w, h);
  eg.globalCompositeOperation = 'destination-in';
  eg.drawImage(channel(M, w, h, 2), 0, 0);

  // --- the paint over white, then multiplied into the picture
  const [, pg] = canvas(w, h);
  pg.fillStyle = '#ffffff';
  pg.fillRect(0, 0, w, h);
  pg.drawImage(fc, 0, 0);
  pg.drawImage(tc, 0, 0);
  pg.drawImage(ec, 0, 0);
  const P = pg.getImageData(0, 0, w, h).data;
  const [oc, og] = canvas(w, h);
  og.drawImage(base, 0, 0, w, h);
  const out = og.getImageData(0, 0, w, h);
  const O = out.data;
  for (let i = 0; i < O.length; i += 4) {
    if (!O[i + 3]) continue;
    O[i] = (O[i] * P[i]) / 255;
    O[i + 1] = (O[i + 1] * P[i + 1]) / 255;
    O[i + 2] = (O[i + 2] * P[i + 2]) / 255;
  }
  og.putImageData(out, 0, 0);
  const blob: Blob | null = await new Promise((r) => oc.toBlob(r, 'image/webp', 0.92));
  return blob ? URL.createObjectURL(blob) : null;
}
