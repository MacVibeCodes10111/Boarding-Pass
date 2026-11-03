// ============================================================================
// LIVERY PAINTING (v2.64)
//   Paints a livery onto an aircraft picture. Each picture has a mask
//   (public/aircraft/<id>.mask.png: red = tail, green = fuselage, blue =
//   engines, only where they can be seen). The paint is multiplied into the
//   white picture, so the template's shading, panel lines and windows show
//   through. Results are cached as object URLs.
// ============================================================================
import type { Livery } from './livery';
import { liveryKey } from './livery';

type RGB = [number, number, number];
const rgb = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const WHITE: RGB = [255, 255, 255];

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

function pixels(im: HTMLImageElement, w: number, h: number): Uint8ClampedArray {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(im, 0, 0, w, h);
  return g.getImageData(0, 0, w, h).data;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

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

async function paint(id: string, L: Livery, name: string): Promise<string | null> {
  const [base, mask] = await Promise.all([loadImage(`/aircraft/${id}.webp`), loadImage(`/aircraft/${id}.mask.png`)]);
  const w = base.naturalWidth;
  const h = base.naturalHeight;
  const B = pixels(base, w, h);
  const M = pixels(mask, w, h);

  // --- fuselage outline, column by column (wings and engines hide parts of it)
  const top = new Float32Array(w).fill(-1);
  const bot = new Float32Array(w).fill(-1);
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
  if (tail <= nose) return null;
  const heights: number[] = [];
  for (let x = nose; x <= tail; x++) if (top[x] >= 0) heights.push(bot[x] - top[x]);
  heights.sort((a, b) => a - b);
  const H = heights[Math.floor(heights.length * 0.9)] || 1;
  // where the bottom edge is hidden (a wing, an engine), carry it over from the neighbours
  const fixed = Array.from(bot);
  const ok = (x: number) => top[x] >= 0 && bot[x] - top[x] > 0.7 * H;
  for (let x = nose; x <= tail; x++) {
    if (ok(x)) continue;
    let a = x - 1;
    while (a >= nose && !ok(a)) a--;
    let b = x + 1;
    while (b <= tail && !ok(b)) b++;
    if (a >= nose && b <= tail) fixed[x] = fixed[a] + ((fixed[b] - fixed[a]) * (x - a)) / (b - a);
    else if (a >= nose) fixed[x] = fixed[a];
    else if (b <= tail) fixed[x] = fixed[b];
  }
  // the belly line ignores bulges (gear fairings) and is smoothed, so stripes run straight
  const topS = Array.from(top);
  for (let x = nose; x <= tail; x++) {
    if (top[x] < 0) topS[x] = topS[Math.max(nose, x - 1)];
    fixed[x] = Math.min(fixed[x], topS[x] + H * 1.02);
  }
  const avg = (arr: number[], r: number) => {
    const o = arr.slice();
    for (let x = nose; x <= tail; x++) {
      let sum = 0, n = 0;
      for (let k = Math.max(nose, x - r); k <= Math.min(tail, x + r); k++) {
        sum += arr[k];
        n++;
      }
      o[x] = sum / n;
    }
    return o;
  };
  const botS = avg(fixed, 6);
  for (let x = nose; x <= tail; x++) fixed[x] = botS[x];

  // --- tail fin box
  let fx0 = w, fx1 = 0, fy0 = h, fy1 = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (M[(y * w + x) * 4] > 128) {
        if (x < fx0) fx0 = x;
        if (x > fx1) fx1 = x;
        if (y < fy0) fy0 = y;
        if (y > fy1) fy1 = y;
      }
  const finH = Math.max(1, fy1 - fy0);
  const finW = Math.max(1, fx1 - fx0);
  // the fin's middle (centre of the upper three quarters)
  let cx = 0, cy = 0, cn = 0;
  for (let y = fy0; y < fy0 + finH * 0.8; y++)
    for (let x = fx0; x <= fx1; x++)
      if (M[(y * w + x) * 4] > 160) {
        cx += x;
        cy += y;
        cn++;
      }
  if (cn) {
    cx /= cn;
    cy /= cn;
  }

  // --- text layers: titles and the tail letter
  const text = document.createElement('canvas');
  text.width = w;
  text.height = h;
  const tg = text.getContext('2d', { willReadFrequently: true })!;
  const titleFont = L.titleFont === 'serif' ? 'Georgia, "Times New Roman", serif' : 'Barlow, "Segoe UI", system-ui, sans-serif';
  if (L.titles && name.trim()) {
    const len = tail - nose;
    const tx = nose + len * 0.16;
    const xi = Math.round(tx);
    let size = H * 0.17;
    tg.font = `${L.titleFont === 'italic' ? 'italic ' : ''}700 ${size}px ${titleFont}`;
    const room = len * 0.34;
    const tw = tg.measureText(name).width;
    if (tw > room) size *= room / tw;
    tg.font = `${L.titleFont === 'italic' ? 'italic ' : ''}700 ${size}px ${titleFont}`;
    tg.fillStyle = '#ff0000';
    tg.textBaseline = 'alphabetic';
    tg.fillText(name, tx, topS[xi] + H * 0.27);
  }
  if (L.tailArt === 'letter' && name.trim() && cn) {
    const size = finH * 0.42;
    tg.font = `800 ${size}px ${titleFont}`;
    tg.fillStyle = '#00ff00';
    tg.textAlign = 'center';
    tg.textBaseline = 'middle';
    tg.fillText(name.trim()[0].toUpperCase(), cx + finW * 0.04, cy);
  }
  const T = tg.getImageData(0, 0, w, h).data;

  const body = rgb(L.body), belly = rgb(L.belly), tailC = rgb(L.tail), tail2 = rgb(L.tail2), eng = rgb(L.engines);
  const c1 = rgb(L.cheat1), c2 = rgb(L.cheat2), tc = rgb(L.titleColour);
  const out = new Uint8ClampedArray(B.length);
  const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = B[i + 3];
      if (!a) continue;
      const wt = M[i] / 255, wf = M[i + 1] / 255, we = M[i + 2] / 255;
      let p: RGB = WHITE;
      if (wf > 0 && top[x] >= 0) {
        const t0 = topS[x];
        const hh = Math.max(1, fixed[x] - t0);
        const v = (y - t0) / hh; // 0 at the crown, 1 at the belly
        const u = (x - nose) / (tail - nose); // 0 at the nose, 1 at the tail
        let f: RGB = body;
        if (L.bellyTo > 0) f = mix(f, belly, smooth(1 - L.bellyTo - 0.012, 1 - L.bellyTo + 0.012, v));
        if (L.cheat === 'stripe') {
          if (v > 0.55 && v < 0.63) f = c1;
          else if (v > 0.65 && v < 0.68) f = c2;
        } else if (L.cheat === 'double') {
          if (v > 0.52 && v < 0.58) f = c1;
          else if (v > 0.62 && v < 0.68) f = c2;
        } else if (L.cheat === 'swoosh') {
          const s = smooth(0.3, 1.0, u);
          const c = 0.8 - 0.62 * s;
          const t = 0.03 + 0.16 * s;
          const on = smooth(0.12, 0.3, u);
          if (on > 0 && Math.abs(v - c) < t * on) f = c1;
          else if (on > 0 && v > c + t * on && v < c + t * on + 0.035 * on) f = c2;
        } else if (L.cheat === 'tailsweep') {
          const edge = 0.08 + (u - 0.66) * 3.2;
          if (u > 0.66 && v < edge) f = c1;
          else if (u > 0.66 && v < edge + 0.06) f = c2;
        }
        const ta = T[i + 3] / 255;
        if (ta > 0 && T[i] > 128) f = mix(f, tc, ta);
        p = mix(p, f, wf);
      }
      if (wt > 0) {
        let t: RGB = tailC;
        const fx = (x - fx0) / finW, fy = (y - fy0) / finH;
        if (L.tailArt === 'split') {
          if (fy < 0.62 - 0.55 * fx) t = tail2;
        } else if (L.tailArt === 'band') {
          if (fy > 0.4 && fy < 0.58) t = tail2;
        } else if (L.tailArt === 'disc') {
          const d = Math.hypot(x - cx, y - cy);
          if (d < finH * 0.24) t = tail2;
        } else if (L.tailArt === 'stripes') {
          const k = (fx * 0.9 + fy * 1.1) * 4;
          if (k - Math.floor(k) < 0.34 && fy < 0.9) t = tail2;
        } else if (L.tailArt === 'letter') {
          const ta = T[i + 3] / 255;
          if (ta > 0 && T[i + 1] > 128) t = mix(t, tail2, ta);
        }
        p = mix(p, t, wt);
      }
      if (we > 0) p = mix(p, eng, we);
      out[i] = (B[i] * p[0]) / 255;
      out[i + 1] = (B[i + 1] * p[1]) / 255;
      out[i + 2] = (B[i + 2] * p[2]) / 255;
      out[i + 3] = a;
    }
  }
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d')!.putImageData(new ImageData(out, w, h), 0, 0);
  const blob: Blob | null = await new Promise((r) => c.toBlob(r, 'image/png'));
  return blob ? URL.createObjectURL(blob) : null;
}
