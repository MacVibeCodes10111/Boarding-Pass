// ============================================================================
// LOGO UPLOADS (v2.66)
//   A picture the player picks becomes a 128×128 logo: fitted in the square
//   (or cropped to fill it), optionally with its white background taken out,
//   and saved again as WebP (PNG where the browser can't), small enough to
//   keep in the save. Saving it again drops whatever else the file carried
//   (camera details, location). SVG isn't accepted: it can carry scripts.
// ============================================================================
import { LOGO_PX, MAX_LOGO_CHARS } from '../../game/livery';

export const LOGO_TYPES = 'image/png,image/jpeg,image/webp';
const MAX_FILE_BYTES = 8 * 1024 * 1024;

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
  if (file.size > MAX_FILE_BYTES) return { error: 'That picture is over 8 MB. Pick a smaller one.' };
  let im: HTMLImageElement;
  try {
    im = await readImage(file);
  } catch (e) {
    return { error: (e as Error).message };
  }
  const c = document.createElement('canvas');
  c.width = c.height = LOGO_PX;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  const w = im.naturalWidth, h = im.naturalHeight;
  if (!w || !h) return { error: 'That picture is empty.' };
  const k = opt.fit === 'cover' ? Math.max(LOGO_PX / w, LOGO_PX / h) : Math.min(LOGO_PX / w, LOGO_PX / h);
  g.imageSmoothingQuality = 'high';
  g.drawImage(im, (LOGO_PX - w * k) / 2, (LOGO_PX - h * k) / 2, w * k, h * k);
  if (opt.removeWhite) {
    const d = g.getImageData(0, 0, LOGO_PX, LOGO_PX);
    const p = d.data;
    for (let i = 0; i < p.length; i += 4) {
      const m = Math.min(p[i], p[i + 1], p[i + 2]);
      // near-white fades out, so edges stay smooth
      if (m > 225) p[i + 3] = Math.round(p[i + 3] * Math.max(0, (250 - m) / 25));
    }
    g.putImageData(d, 0, 0);
  }
  for (const q of [0.9, 0.8, 0.65, 0.5]) {
    const url = c.toDataURL('image/webp', q);
    if (url.startsWith('data:image/webp') && url.length <= MAX_LOGO_CHARS) return { url };
  }
  const png = c.toDataURL('image/png');
  if (png.length <= MAX_LOGO_CHARS) return { url: png };
  return { error: 'That picture is too detailed to keep as a logo. Try a simpler one.' };
}
