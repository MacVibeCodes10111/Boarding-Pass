// ============================================================================
// LOGO UPLOADS (v2.66; any size since 2026-11-07)
//   A picture the player picks becomes a square logo at its own size (up to
//   LOGO_MAX_PX): fitted in the square (or cropped to fill it), optionally with
//   its white background taken out, and saved again as WebP (PNG where the
//   browser can't). If that's over MAX_LOGO_BYTES it's saved a little smaller
//   until it fits, so no picture is turned away for its size. Saving it again
//   drops whatever else the file carried (camera details, location). SVG isn't
//   accepted: it can carry scripts.
// ============================================================================
import { LOGO_MAX_PX, MAX_LOGO_CHARS } from '../../game/livery';

export const LOGO_TYPES = 'image/png,image/jpeg,image/webp';
/** What can be opened at all (a phone photo is a few MB). */
const MAX_FILE_BYTES = 25 * 1024 * 1024;

export interface LogoOptions {
  fit: 'contain' | 'cover';
  removeWhite: boolean;
}

function readImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => {
      URL.revokeObjectURL(url);
      resolve(im);
    };
    im.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That file isn’t a picture we can read.'));
    };
    im.src = url;
  });
}

/** The picked file as a logo data URL, or an error message. */
export async function makeLogo(file: File, opt: LogoOptions): Promise<{ url: string } | { error: string }> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return { error: 'Pick a PNG, JPG or WebP picture.' };
  if (file.size > MAX_FILE_BYTES) return { error: 'That picture is over 25 MB. Pick a smaller one.' };
  let im: HTMLImageElement;
  try {
    im = await readImage(file);
  } catch (e) {
    return { error: (e as Error).message };
  }
  const w = im.naturalWidth, h = im.naturalHeight;
  if (!w || !h) return { error: 'That picture is empty.' };
  // Its own size, square; the smallest few steps only matter for a very busy photo
  const full = Math.max(16, Math.min(LOGO_MAX_PX, opt.fit === 'cover' ? Math.min(w, h) : Math.max(w, h)));
  for (const side of [full, 768, 512, 384, 256, 192, 128].filter((x, i) => i === 0 || x < full)) {
    const c = drawLogo(im, side, opt);
    for (const q of [0.92, 0.85, 0.75, 0.6]) {
      const url = c.toDataURL('image/webp', q);
      if (!url.startsWith('data:image/webp')) break; // this browser can't make WebP
      if (url.length <= MAX_LOGO_CHARS) return { url };
    }
    const png = c.toDataURL('image/png');
    if (png.length <= MAX_LOGO_CHARS) return { url: png };
  }
  return { error: 'That picture is too detailed to keep as a logo. Try a simpler one.' };
}

function drawLogo(im: HTMLImageElement, side: number, opt: LogoOptions): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = side;
  const g = c.getContext('2d', { willReadFrequently: opt.removeWhite })!;
  const w = im.naturalWidth, h = im.naturalHeight;
  const k = opt.fit === 'cover' ? Math.max(side / w, side / h) : Math.min(side / w, side / h);
  g.imageSmoothingQuality = 'high';
  g.drawImage(im, (side - w * k) / 2, (side - h * k) / 2, w * k, h * k);
  if (opt.removeWhite) {
    const d = g.getImageData(0, 0, side, side);
    const p = d.data;
    for (let i = 0; i < p.length; i += 4) {
      const m = Math.min(p[i], p[i + 1], p[i + 2]);
      // near-white fades out, so edges stay smooth
      if (m > 225) p[i + 3] = Math.round(p[i + 3] * Math.max(0, (250 - m) / 25));
    }
    g.putImageData(d, 0, 0);
  }
  return c;
}
